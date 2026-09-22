import type Stripe from 'stripe';
import { stripe, stripeConfigured } from '@/server/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { reportError } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook Stripe.
 *
 * Trois garde-fous, parce qu'un webhook est un point d'entrée public :
 *
 *  1. SIGNATURE vérifiée sur le corps BRUT. Sans elle, n'importe qui
 *     pourrait offrir l'offre Business à n'importe quelle organisation.
 *  2. IDEMPOTENCE : chaque événement est enregistré avec une contrainte
 *     d'unicité. Stripe rejoue volontiers le même événement ; on ne le
 *     traite qu'une fois.
 *  3. On répond 200 même sur erreur de traitement, après avoir tracé
 *     l'incident : sinon Stripe rejoue indéfiniment un événement qui ne
 *     passera jamais.
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
      if (!organizationId || !session.subscription) return;

      const subscription = await stripe().subscriptions.retrieve(session.subscription as string);
      await applySubscription(organizationId, subscription);
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
