'use server';

import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { assertOrgMembership } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripe, stripeConfigured } from '@/server/stripe';
import { audit } from '@/server/audit';
import { env } from '@/lib/env';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[billing]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const checkoutSchema = z.object({
  organizationId: z.string().uuid(),
  planCode: z.string().min(1).max(40),
  // L'offre unique n'a pas de prix annuel (0043) : « year » reste accepté
  // pour une offre qui en aurait un, et refusé proprement sinon.
  interval: z.enum(['month', 'year']).default('month'),
});

/** Statuts d'un abonnement Stripe encore vivant : on n'en ouvre pas un second par-dessus. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused']);

/**
 * Ouvre la session de paiement Stripe de l'abonnement.
 *
 * FRAIS D'INSTALLATION (0043) : la session porte, en plus du prix
 * mensuel, la ligne PONCTUELLE des frais (`plans.stripe_price_id_setup`),
 * que Stripe ajoute à la première facture. Elle ne la porte que tant que
 * l'organisation ne les a pas réglés (`subscriptions.setup_fee_paid_at`
 * vide, posé par le webhook quand Stripe confirme le paiement) : un
 * commerce qui résilie puis revient ne repaie pas son installation.
 *
 * Deux refus plutôt qu'une facture fausse :
 *  - frais dus mais sans prix Stripe d'installation : on n'ouvre PAS le
 *    paiement. Un abonnement encaissé sans ses frais ne se rattrape pas
 *    proprement (il faudrait une facture à part, que personne n'attend) ;
 *  - un abonnement Stripe encore vivant : on n'en crée pas un second, qui
 *    serait facturé en double. Le portail de paiement gère la suite.
 */
export async function startCheckout(
  input: z.input<typeof checkoutSchema>,
): Promise<Result<{ url: string }>> {
  try {
    if (!stripeConfigured()) {
      throw new AppError(
        'not_configured',
        "La facturation n'est pas activée sur cette installation. Voir SETUP.md, section Stripe.",
        503,
      );
    }
    const parsed = checkoutSchema.parse(input);
    const { user } = await assertOrgMembership(parsed.organizationId, 'billing.manage');
    const db = supabaseAdmin();

    const [{ data: plan }, { data: organization }, { data: subscription }] = await Promise.all([
      db.from('plans')
        .select('code, name, setup_fee_cents, stripe_price_id_month, stripe_price_id_year, stripe_price_id_setup')
        .eq('code', parsed.planCode).eq('is_active', true).maybeSingle(),
      db.from('organizations').select('name').eq('id', parsed.organizationId).maybeSingle(),
      db.from('subscriptions')
        .select('status, stripe_customer_id, stripe_subscription_id, setup_fee_paid_at')
        .eq('organization_id', parsed.organizationId).maybeSingle(),
    ]);

    if (!plan) throw new AppError('not_found', 'Offre introuvable.', 404);

    if (subscription?.stripe_subscription_id && LIVE_STATUSES.has(subscription.status)) {
      throw new AppError(
        'already_subscribed',
        'Votre abonnement est déjà actif. Moyen de paiement, factures et résiliation se gèrent depuis l’espace de paiement.',
        409,
      );
    }

    const priceId = parsed.interval === 'year' ? plan.stripe_price_id_year : plan.stripe_price_id_month;
    if (!priceId) {
      throw new AppError(
        'not_configured',
        parsed.interval === 'year'
          ? `L'offre ${plan.name} n'a pas de tarif annuel.`
          : `L'offre ${plan.name} n'a pas encore de tarif Stripe associé. Renseignez-le dans l'espace plateforme.`,
        503,
      );
    }

    const setupFeeDue = plan.setup_fee_cents > 0 && !subscription?.setup_fee_paid_at;
    if (setupFeeDue && !plan.stripe_price_id_setup) {
      throw new AppError(
        'not_configured',
        `Les frais d’installation de l’offre ${plan.name} n’ont pas encore de prix Stripe. `
          + 'Renseignez le prix ponctuel d’installation dans l’espace plateforme avant d’ouvrir le paiement.',
        503,
      );
    }

    const client = stripe();

    // Un seul client Stripe par organisation, réutilisé d'un abonnement
    // à l'autre.
    let customerId = subscription?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await client.customers.create({
        name: organization?.name ?? undefined,
        email: user.email ?? undefined,
        metadata: { organization_id: parsed.organizationId },
      });
      customerId = customer.id;
      await db.from('subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('organization_id', parsed.organizationId);
    }

    const lineItems: Array<{ price: string; quantity: number }> = [{ price: priceId, quantity: 1 }];
    // Prix ponctuel dans une session d'abonnement : Stripe le facture une
    // seule fois, sur la première facture, avec le premier mois.
    if (setupFeeDue && plan.stripe_price_id_setup) {
      lineItems.push({ price: plan.stripe_price_id_setup, quantity: 1 });
    }

    // L'identifiant d'organisation voyage dans les métadonnées : c'est lui
    // que le webhook utilisera pour rattacher l'abonnement. `setup_fee`
    // lui dit si cette session encaisse l'installation (métadonnée posée
    // ici, côté serveur : le navigateur ne peut pas la modifier).
    const metadata = {
      organization_id: parsed.organizationId,
      plan_code: plan.code,
      setup_fee: setupFeeDue ? '1' : '0',
    };

    const session = await client.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: lineItems,
      subscription_data: {
        metadata: { organization_id: parsed.organizationId, plan_code: plan.code },
      },
      metadata,
      success_url: `${env.siteUrl}/app/${parsed.organizationId}/abonnement?paiement=ok`,
      cancel_url: `${env.siteUrl}/app/${parsed.organizationId}/abonnement?paiement=annule`,
      allow_promotion_codes: true,
      locale: 'fr',
    });

    if (!session.url) throw new AppError('internal', 'Stripe n’a pas renvoyé d’URL de paiement.', 502);

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'billing.checkout_started', targetType: 'plan', targetId: plan.code,
      metadata: { interval: parsed.interval, setupFee: setupFeeDue },
    });

    return { ok: true, data: { url: session.url } };
  } catch (error) {
    return fail(error);
  }
}

/** Ouvre le portail client Stripe (moyens de paiement, factures, résiliation). */
export async function openBillingPortal(
  organizationId: string,
): Promise<Result<{ url: string }>> {
  try {
    if (!stripeConfigured()) {
      throw new AppError('not_configured', "La facturation n'est pas activée.", 503);
    }
    await assertOrgMembership(organizationId, 'billing.manage');

    const { data: subscription } = await supabaseAdmin()
      .from('subscriptions').select('stripe_customer_id')
      .eq('organization_id', organizationId).maybeSingle();

    if (!subscription?.stripe_customer_id) {
      throw new AppError('not_found', "Aucun abonnement payant n'est encore rattaché.", 404);
    }

    const session = await stripe().billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${env.siteUrl}/app/${organizationId}/abonnement`,
      locale: 'fr',
    });

    return { ok: true, data: { url: session.url } };
  } catch (error) {
    return fail(error);
  }
}
