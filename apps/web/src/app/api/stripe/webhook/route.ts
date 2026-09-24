import type Stripe from 'stripe';
import { stripe, stripeConfigured } from '@/server/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { audit, reportError } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook Stripe.
 *
 * Trois garde-fous, parce qu'un webhook est un point d'entrée public :
 *
 *  1. SIGNATURE vérifiée sur le corps BRUT. Sans elle, n'importe qui
 *     pourrait offrir un abonnement (ou son installation) à n'importe quelle
 *     organisation.
 *  2. IDEMPOTENCE : chaque événement est enregistré avec une contrainte
 *     d'unicité. Stripe rejoue volontiers le même événement ; on ne le
 *     traite qu'une fois.
 *  3. On répond 200 même sur erreur de traitement, après avoir tracé
 *     l'incident : sinon Stripe rejoue indéfiniment un événement qui ne
 *     passera jamais.
 *
 * Les frais d'installation (offre unique, 0043) sont horodatés ici, et
 * seulement ici : voir markSetupFeePaid.
 */
export async function POST(request: Request) {
  if (!stripeConfigured() || !env.stripe.webhookSecret) {
    return new Response('Facturation non configurée', { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('Signature manquante', { status: 400 });

  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, env.stripe.webhookSecret);
  } catch (error) {
    console.error('[stripe] signature invalide', error);
    return new Response('Signature invalide', { status: 400 });
  }

  const db = supabaseAdmin();

  // Idempotence : la contrainte d'unicité (provider, event_id) fait foi.
  const { error: insertError } = await db.from('billing_events').insert({
    provider: 'stripe',
    event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      return Response.json({ received: true, duplicate: true });
    }
    console.error('[stripe] journalisation impossible', insertError);
  }

  try {
    await handleEvent(event);
    await db.from('billing_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider', 'stripe').eq('event_id', event.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    await db.from('billing_events')
      .update({ error: message }).eq('provider', 'stripe').eq('event_id', event.id);
    await reportError({
      source: 'stripe.webhook',
      message: `${event.type}: ${message}`,
      context: { eventId: event.id },
    });
    // 200 volontaire : rejouer n'y changerait rien et bloquerait la file
    // d'événements Stripe.
  }

  return Response.json({ received: true });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  const db = supabaseAdmin();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const organizationId = session.metadata?.organization_id;
      if (!organizationId) return;

      // Les frais d'installation d'abord : ils sont réglés dès que la
      // première facture l'est, quoi qu'il arrive ensuite à l'abonnement.
      await markSetupFeePaid(organizationId, session);

      if (!session.subscription) return;
      const subscription = await stripe().subscriptions.retrieve(session.subscription as string);
      await applySubscription(organizationId, subscription);
      break;
    }

    // Paiement différé (prélèvement SEPA…) : la session est « complétée »
    // avant d'être payée. Les frais ne sont horodatés qu'ici, une fois
    // l'argent confirmé.
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      const organizationId = session.metadata?.organization_id;
      if (!organizationId) return;
      await markSetupFeePaid(organizationId, session);
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const organizationId = subscription.metadata?.organization_id
        ?? (await organizationFromCustomer(subscription.customer as string));
      if (!organizationId) return;
      await applySubscription(organizationId, subscription);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string | null };
      const organizationId = await organizationFromCustomer(invoice.customer as string);
      if (!organizationId) return;
      await db.from('subscriptions')
        .update({ status: 'past_due' })
        .eq('organization_id', organizationId);
      break;
    }

    default:
      break;
  }
}

/**
 * FRAIS D'INSTALLATION RÉGLÉS (0043) : `subscriptions.setup_fee_paid_at`.
 *
 * Seulement pour une session qui les portait (`setup_fee = '1'`, posé par
 * startCheckout côté serveur) et que Stripe dit payée — ou sans paiement
 * dû, quand un code promotionnel couvre toute la facture : l'installation
 * est alors réglée, à 0 €. Une session encore « unpaid » (prélèvement en
 * cours) attend `checkout.session.async_payment_succeeded`.
 *
 * Horodatée UNE fois : le filtre `setup_fee_paid_at is null` rend le
 * rejeu d'un événement (ou l'arrivée des deux événements) sans effet, et
 * garde la première heure. C'est cette colonne qui empêche de facturer
 * l'installation une seconde fois.
 *
 * L'installation est un service HUMAIN : le paiement doit prévenir
 * l'équipe. Une entrée d'audit `billing.setup_fee_paid` (une seule, quand
 * la ligne vient vraiment d'être horodatée) le trace, et la commande
 * apparaît dans « Installations à faire » de /admin/offres jusqu'à ce que
 * le super-admin la marque faite (`setup_done_at`).
 */
async function markSetupFeePaid(organizationId: string, session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== 'subscription' || session.metadata?.setup_fee !== '1') return;
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return;

  const { data, error } = await supabaseAdmin()
    .from('subscriptions')
    .update({ setup_fee_paid_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .is('setup_fee_paid_at', null)
    .select('organization_id');
  // Levée : l'erreur est tracée par POST (billing_events.error et
  // system_errors) au lieu de passer en silence.
  if (error) throw new Error(`Frais d’installation non horodatés : ${error.message}`);
  // Rien d'horodaté (rejeu, second événement) : l'équipe est déjà prévenue.
  if (!data || data.length === 0) return;

  await audit({
    organizationId,
    actor: 'system',
    actorLabel: 'Stripe',
    action: 'billing.setup_fee_paid',
    targetType: 'organization',
    targetId: organizationId,
    metadata: { checkoutSession: session.id },
  });
}

async function organizationFromCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await supabaseAdmin()
    .from('subscriptions').select('organization_id')
    .eq('stripe_customer_id', customerId).maybeSingle();
  return data?.organization_id ?? null;
}

/** Aligne l'abonnement local sur l'état que Stripe fait autorité. */
async function applySubscription(
  organizationId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const db = supabaseAdmin();

  const priceId = subscription.items.data[0]?.price.id ?? null;
  const interval = subscription.items.data[0]?.price.recurring?.interval === 'year' ? 'year' : 'month';

  let planId: string | null = null;
  if (priceId) {
    const { data: plan } = await db
      .from('plans').select('id')
      .or(`stripe_price_id_month.eq.${priceId},stripe_price_id_year.eq.${priceId}`)
      .maybeSingle();
    planId = plan?.id ?? null;
  }
  if (!planId) {
    const code = subscription.metadata?.plan_code;
    if (code) {
      const { data: plan } = await db.from('plans').select('id').eq('code', code).maybeSingle();
      planId = plan?.id ?? null;
    }
  }

  const statusMap: Record<string, string> = {
    active: 'active', trialing: 'trialing', past_due: 'past_due',
    canceled: 'canceled', unpaid: 'past_due', incomplete: 'incomplete',
    incomplete_expired: 'canceled', paused: 'paused',
  };

  const item = subscription.items.data[0];
  const toIso = (seconds: number | null | undefined) =>
    seconds ? new Date(seconds * 1000).toISOString() : null;

  const patch: Record<string, unknown> = {
    status: statusMap[subscription.status] ?? 'incomplete',
    billing_interval: interval,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: subscription.customer as string,
    current_period_start: toIso(item?.current_period_start),
    current_period_end: toIso(item?.current_period_end),
    trial_ends_at: toIso(subscription.trial_end),
    cancel_at_period_end: subscription.cancel_at_period_end,
    canceled_at: toIso(subscription.canceled_at),
  };
  if (planId) patch.plan_id = planId;

  await db.from('subscriptions').update(patch).eq('organization_id', organizationId);
}
