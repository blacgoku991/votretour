import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FRAIS D'INSTALLATION (offre unique, 0043).
 *
 *  - startCheckout ajoute la ligne ponctuelle d'installation SEULEMENT
 *    tant que l'organisation ne l'a pas réglée (premier abonnement) ;
 *  - il REFUSE d'ouvrir le paiement si les frais sont dus et que l'offre
 *    n'a pas de prix Stripe d'installation : jamais un abonnement encaissé
 *    sans ses frais par erreur ;
 *  - il refuse un second abonnement par-dessus un abonnement vivant ;
 *  - le webhook horodate le paiement des frais, une fois, et seulement
 *    quand Stripe dit la session payée.
 *
 * Supabase et Stripe sont simulés au niveau de leurs clients : on vérifie
 * ce qui part vers Stripe et ce qui s'écrit en base.
 */

type Row = Record<string, unknown> | null;
interface Op { table: string; kind: 'update' | 'insert'; values: unknown; filters: Array<[string, string, unknown]> }

const state = vi.hoisted(() => ({
  plan: null as Record<string, unknown> | null,
  subscription: null as Record<string, unknown> | null,
  ops: [] as Array<{ table: string; kind: 'update' | 'insert'; values: unknown; filters: Array<[string, string, unknown]> }>,
  sessions: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  event: null as unknown,
  retrievedSubscription: null as unknown,
  tags: [] as string[],
}));

/** Constructeur de requête minimal : filtres enregistrés, résultat par table. */
function query(table: string) {
  const filters: Array<[string, string, unknown]> = [];
  let pending: Op | null = null;
  const result = (): { data: Row; error: null } => {
    if (pending) return { data: null, error: null };
    if (table === 'plans') {
      const code = filters.find(([, col]) => col === 'code')?.[2];
      const plan = state.plan && (code === undefined || state.plan.code === code) ? state.plan : null;
      return { data: plan, error: null };
    }
    if (table === 'subscriptions') return { data: state.subscription, error: null };
    if (table === 'organizations') return { data: { name: 'Barber House' }, error: null };
    return { data: null, error: null };
  };
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    or: (expr: string) => { filters.push(['or', expr, null]); return builder; },
    eq: (col: string, value: unknown) => { filters.push(['eq', col, value]); return builder; },
    is: (col: string, value: unknown) => { filters.push(['is', col, value]); return builder; },
    update: (values: unknown) => {
      pending = { table, kind: 'update', values, filters };
      state.ops.push(pending);
      return builder;
    },
    insert: async (values: unknown) => {
      state.ops.push({ table, kind: 'insert', values, filters });
      return { error: null };
    },
    maybeSingle: async () => result(),
    then: (resolve: (value: { data: Row; error: null }) => unknown) => resolve(result()),
  };
  return builder;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (table: string) => query(table) }) }));
vi.mock('@/server/auth', () => ({
  assertOrgMembership: async () => ({ user: { id: 'user-1', email: 'owner@barberhouse.test' } }),
  assertPlatformAdmin: async () => ({ id: 'admin-1' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: (tag: string) => { state.tags.push(tag); } }));
vi.mock('@/server/queue', () => ({ propagate: vi.fn(), setQueueStatus: vi.fn() }));
vi.mock('@/server/notifications/dispatch', () => ({ dispatchEventEntryNotification: vi.fn() }));
vi.mock('@/server/audit', () => ({
  audit: async (entry: Record<string, unknown>) => { state.audits.push(entry); },
  reportError: async () => {},
}));
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      siteUrl: 'https://rangvia.test',
      stripe: { secretKey: 'sk_test_x', webhookSecret: 'whsec_x', publishableKey: undefined },
    },
  };
});
vi.mock('@/server/stripe', () => ({
  stripeConfigured: () => true,
  stripe: () => ({
    customers: { create: async () => ({ id: 'cus_new' }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.sessions.push(params);
          return { url: 'https://checkout.stripe.test/s/1' };
        },
      },
    },
    webhooks: { constructEvent: () => state.event },
    subscriptions: { retrieve: async () => state.retrievedSubscription },
  }),
}));

const { startCheckout } = await import('@/server/actions/billing');
const { POST } = await import('@/app/api/stripe/webhook/route');
const { updatePlan } = await import('@/server/actions/admin');

const ORG = '5d0c6f0e-0000-4000-8000-00000000000a';
const OFFER = {
  code: 'rangvia',
  name: 'Rangvia',
  setup_fee_cents: 14900,
  stripe_price_id_month: 'price_mois',
  stripe_price_id_year: null,
  stripe_price_id_setup: 'price_installation',
};
const TRIAL = {
  status: 'trialing',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: null,
  setup_fee_paid_at: null,
};

beforeEach(() => {
  state.plan = { ...OFFER };
  state.subscription = { ...TRIAL };
  state.ops = [];
  state.sessions = [];
  state.audits = [];
  state.event = null;
  state.retrievedSubscription = null;
  state.tags = [];
});

describe('startCheckout : frais d’installation au premier abonnement seulement', () => {
  it('premier abonnement : le mois ET la ligne ponctuelle d’installation', async () => {
    const result = await startCheckout({ organizationId: ORG, planCode: 'rangvia' });
    expect(result).toEqual({ ok: true, data: { url: 'https://checkout.stripe.test/s/1' } });
    const session = state.sessions[0]!;
    expect(session.mode).toBe('subscription');
    expect(session.line_items).toEqual([
      { price: 'price_mois', quantity: 1 },
      { price: 'price_installation', quantity: 1 },
    ]);
    expect(session.metadata).toMatchObject({ organization_id: ORG, plan_code: 'rangvia', setup_fee: '1' });
    expect(state.audits[0]?.metadata).toMatchObject({ setupFee: true });
  });

  it('installation déjà réglée (résilié puis revenu) : le mois seul', async () => {
    state.subscription = {
      ...TRIAL, status: 'canceled', stripe_subscription_id: 'sub_ancien', setup_fee_paid_at: '2026-10-01T09:00:00Z',
    };
    const result = await startCheckout({ organizationId: ORG, planCode: 'rangvia' });
    expect(result.ok).toBe(true);
    expect(state.sessions[0]!.line_items).toEqual([{ price: 'price_mois', quantity: 1 }]);
    expect(state.sessions[0]!.metadata).toMatchObject({ setup_fee: '0' });
  });

  it('offre sans frais d’installation : le mois seul, même au premier abonnement', async () => {
    state.plan = { ...OFFER, setup_fee_cents: 0, stripe_price_id_setup: null };
    const result = await startCheckout({ organizationId: ORG, planCode: 'rangvia' });
    expect(result.ok).toBe(true);
    expect(state.sessions[0]!.line_items).toEqual([{ price: 'price_mois', quantity: 1 }]);
  });

  it('frais dus sans prix Stripe d’installation : refus clair, aucune session ouverte', async () => {
    state.plan = { ...OFFER, stripe_price_id_setup: null };
    const result = await startCheckout({ organizationId: ORG, planCode: 'rangvia' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_configured');
      expect(result.error).toMatch(/frais d’installation/);
      expect(result.error).toMatch(/prix Stripe/);
    }
    expect(state.sessions).toHaveLength(0);
    // Rien n'a été créé chez Stripe ni écrit en base.
    expect(state.ops.filter((op) => op.kind === 'update')).toHaveLength(0);
  });

  it('prix mensuel manquant : refus, même motif', async () => {
    state.plan = { ...OFFER, stripe_price_id_month: null };
    const result = await startCheckout({ organizationId: ORG, planCode: 'rangvia' });
    expect(result.ok).toBe(false);
    expect(state.sessions).toHaveLength(0);
  });

  it('abonnement déjà vivant : pas de second abonnement facturé en double', async () => {
    state.subscription = { ...TRIAL, status: 'active', stripe_subscription_id: 'sub_1', setup_fee_paid_at: '2026-10-01T09:00:00Z' };
    const result = await startCheckout({ organizationId: ORG, planCode: 'rangvia' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('already_subscribed');
    expect(state.sessions).toHaveLength(0);
  });

  it('ancienne offre retirée (inactive) : introuvable au paiement', async () => {
    const result = await startCheckout({ organizationId: ORG, planCode: 'business' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });
});

describe('webhook : l’installation réglée est horodatée une fois', () => {
  const request = () => new Request('https://rangvia.test/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=x' },
    body: '{}',
  });
  const completed = (session: Record<string, unknown>, type = 'checkout.session.completed') => ({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: { object: { mode: 'subscription', subscription: null, metadata: { organization_id: ORG, setup_fee: '1' }, ...session } },
  });
  const feeStamps = () => state.ops.filter((op) =>
    op.table === 'subscriptions' && op.kind === 'update'
    && typeof op.values === 'object' && op.values !== null && 'setup_fee_paid_at' in op.values);

  it('session payée qui portait les frais : horodatage, sans jamais écraser une heure déjà posée', async () => {
    state.event = completed({ payment_status: 'paid' });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const stamps = feeStamps();
    expect(stamps).toHaveLength(1);
    expect(stamps[0]!.filters).toContainEqual(['eq', 'organization_id', ORG]);
    // Rejeu, ou deux événements pour la même session : la première heure reste.
    expect(stamps[0]!.filters).toContainEqual(['is', 'setup_fee_paid_at', null]);
    expect(Date.parse(String((stamps[0]!.values as { setup_fee_paid_at: string }).setup_fee_paid_at))).not.toBeNaN();
  });

  it('code promotionnel couvrant tout : installation réglée à 0 €', async () => {
    state.event = completed({ payment_status: 'no_payment_required' });
    await POST(request());
    expect(feeStamps()).toHaveLength(1);
  });

  it('paiement différé encore en cours : rien, puis horodatage à la confirmation', async () => {
    state.event = completed({ payment_status: 'unpaid' });
    await POST(request());
    expect(feeStamps()).toHaveLength(0);

    state.event = completed({ payment_status: 'paid' }, 'checkout.session.async_payment_succeeded');
    await POST(request());
    expect(feeStamps()).toHaveLength(1);
  });

  it('session sans frais (installation déjà réglée) : aucun horodatage', async () => {
    state.event = completed({ payment_status: 'paid', metadata: { organization_id: ORG, setup_fee: '0' } });
    await POST(request());
    expect(feeStamps()).toHaveLength(0);
  });

  it('l’abonnement de la session est toujours rattaché à l’organisation', async () => {
    state.retrievedSubscription = {
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      metadata: { organization_id: ORG, plan_code: 'rangvia' },
      items: { data: [{ price: { id: 'price_mois', recurring: { interval: 'month' } }, current_period_start: 1, current_period_end: 2 }] },
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
    };
    state.event = completed({ payment_status: 'paid', subscription: 'sub_1' });
    await POST(request());
    expect(feeStamps()).toHaveLength(1);
    const applied = state.ops.find((op) =>
      op.table === 'subscriptions' && op.kind === 'update'
      && (op.values as Record<string, unknown>).stripe_subscription_id === 'sub_1');
    expect(applied).toBeDefined();
  });
});

describe('super-admin : les frais d’installation se règlent dans /admin/offres', () => {
  const PLAN_ID = '5d0c6f0e-0000-4000-8000-000000000001';

  it('enregistre le montant et le prix Stripe ponctuel, puis invalide le cache « plans »', async () => {
    const result = await updatePlan({ planId: PLAN_ID, setupFeeCents: 14900, stripePriceIdSetup: 'price_installation' });
    expect(result.ok).toBe(true);
    const update = state.ops.find((op) => op.table === 'plans' && op.kind === 'update');
    expect(update?.values).toEqual({ setup_fee_cents: 14900, stripe_price_id_setup: 'price_installation' });
    expect(update?.filters).toContainEqual(['eq', 'id', PLAN_ID]);
    expect(state.tags).toEqual(['plans']);
  });

  it('refuse des frais négatifs et un identifiant qui n’est pas un prix Stripe', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await updatePlan({ planId: PLAN_ID, setupFeeCents: -100 })).ok).toBe(false);
    expect((await updatePlan({ planId: PLAN_ID, stripePriceIdSetup: 'prod_123' })).ok).toBe(false);
    spy.mockRestore();
    expect(state.ops.filter((op) => op.table === 'plans')).toHaveLength(0);
    expect(state.tags).toHaveLength(0);
  });

  it('vider le prix Stripe d’installation est possible (null), le paiement le refusera alors', async () => {
    const result = await updatePlan({ planId: PLAN_ID, stripePriceIdSetup: null });
    expect(result.ok).toBe(true);
    expect(state.ops.find((op) => op.table === 'plans')?.values).toEqual({ stripe_price_id_setup: null });
  });
});
