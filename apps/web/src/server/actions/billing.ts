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
  interval: z.enum(['month', 'year']).default('month'),
});

/** Ouvre une session de paiement Stripe pour changer d'offre. */
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
      db.from('plans').select('*').eq('code', parsed.planCode).eq('is_active', true).maybeSingle(),
      db.from('organizations').select('name').eq('id', parsed.organizationId).maybeSingle(),
      db.from('subscriptions').select('stripe_customer_id').eq('organization_id', parsed.organizationId).maybeSingle(),
    ]);

    if (!plan) throw new AppError('not_found', 'Offre introuvable.', 404);

    const priceId = parsed.interval === 'year' ? plan.stripe_price_id_year : plan.stripe_price_id_month;
    if (!priceId) {
      throw new AppError(
        'not_configured',
        `L'offre ${plan.name} n'a pas encore de tarif Stripe associé. Renseignez-le dans l'espace plateforme.`,
        503,
      );
    }

    const client = stripe();

    // Un seul client Stripe par organisation, réutilisé d'un changement
    // d'offre à l'autre.
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

    const session = await client.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // L'identifiant d'organisation voyage dans les métadonnées : c'est
      // lui que le webhook utilisera pour rattacher l'abonnement.
      subscription_data: {
        metadata: { organization_id: parsed.organizationId, plan_code: plan.code },
      },
      metadata: { organization_id: parsed.organizationId, plan_code: plan.code },
      success_url: `${env.siteUrl}/app/${parsed.organizationId}/abonnement?paiement=ok`,
      cancel_url: `${env.siteUrl}/app/${parsed.organizationId}/abonnement?paiement=annule`,
      allow_promotion_codes: true,
      locale: 'fr',
    });

    if (!session.url) throw new AppError('internal', 'Stripe n’a pas renvoyé d’URL de paiement.', 502);

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'billing.checkout_started', targetType: 'plan', targetId: plan.code,
      metadata: { interval: parsed.interval },
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
