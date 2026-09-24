import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  FREE_PRICE_LABEL,
  PLANS_REVALIDATE_SECONDS,
  PLANS_TAG,
  PUBLIC_PLAN_COLUMNS,
  SETUP_STEPS,
  SETUP_TITLE,
  cheapestPlan,
  formatPlanPrice,
  getPublicPlans,
  historyLabel,
  mainPlan,
  monthlyPriceLabel,
  planAllowances,
  setupFeeLabel,
  parsePublicPlan,
  parsePublicPlans,
  publicPlansUrl,
  type FetchLike,
  type PublicPlanOffer,
} from '@/lib/public-plans';

/**
 * OFFRES PUBLIQUES — lues avec la clé anon, mises en cache sous
 * l'étiquette `plans`, et jamais inventées : sans réponse fiable, pas de
 * prix du tout.
 */

const SOURCE = readFileSync(fileURLToPath(new URL('../src/lib/public-plans.ts', import.meta.url)), 'utf8');
/** Le code seul : les commentaires, eux, ont le droit d'expliquer pourquoi on n'utilise pas service_role. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Une ligne telle que PostgREST la renvoie (0012 : l'offre Starter). */
const STARTER = {
  code: 'starter',
  name: 'Starter',
  tagline: 'Un commerce, une file, zéro friction.',
  description: 'Pour un salon, un garage ou une boutique.',
  price_month_cents: 1900,
  price_year_cents: 19000,
  setup_fee_cents: 0,
  currency: 'EUR',
  trial_days: 14,
  max_locations: 1,
  max_staff: 3,
  max_plates: 2,
  max_queues: 1,
  history_days: 30,
};
/** L'offre unique de 0043 : 59,90 € HT/mois, 149 € HT d'installation, tout illimité. */
const RANGVIA = {
  ...STARTER,
  code: 'rangvia',
  name: 'Rangvia',
  price_month_cents: 5990,
  price_year_cents: 0,
  setup_fee_cents: 14900,
  max_locations: -1,
  max_staff: -1,
  max_plates: -1,
  max_queues: -1,
  history_days: 730,
};
const PRO = { ...STARTER, code: 'pro', name: 'Pro', price_month_cents: 4900, price_year_cents: 49000, max_plates: -1 };

function source(fetch: FetchLike) {
  return { supabaseUrl: 'https://base.test/', anonKey: 'cle-anon', fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('la requête', () => {
  it('ne demande que les colonnes affichables, les offres actives et publiques, dans l’ordre', () => {
    const url = new URL(publicPlansUrl('https://base.test/'));
    expect(url.origin + url.pathname).toBe('https://base.test/rest/v1/plans');
    expect(url.searchParams.get('select')).toBe(PUBLIC_PLAN_COLUMNS.join(','));
    expect(url.searchParams.get('is_active')).toBe('eq.true');
    expect(url.searchParams.get('is_public')).toBe('eq.true');
    expect(url.searchParams.get('order')).toBe('sort_order.asc,code.asc');
  });

  it('demande les frais d’installation, jamais leur prix Stripe', () => {
    expect(PUBLIC_PLAN_COLUMNS).toContain('setup_fee_cents');
    expect(new URL(publicPlansUrl('https://base.test')).searchParams.get('select')).toContain('setup_fee_cents');
    expect(publicPlansUrl('https://base.test')).not.toMatch(/stripe_price_id_setup/);
  });

  it('ne transporte aucun secret ni aucune donnée interne', () => {
    for (const column of PUBLIC_PLAN_COLUMNS) {
      expect(column).not.toMatch(/stripe|features|^id$|created|updated|is_/);
    }
    expect(publicPlansUrl('https://base.test')).not.toMatch(/stripe|features|\*/);
  });

  it('passe par la clé anon, jamais par la clé service_role', async () => {
    const fetch = vi.fn<FetchLike>(async () => json([STARTER]));
    await getPublicPlans(source(fetch));
    const init = fetch.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('apikey')).toBe('cle-anon');
    expect(headers.get('authorization')).toBe('Bearer cle-anon');
    expect(init?.method).toBe('GET');
    // Le module ne sait même pas où trouver la clé privilégiée.
    expect(CODE).not.toMatch(/serviceRoleKey|service_role|SERVICE_ROLE|supabaseAdmin|supabase\/admin/i);
    expect(SOURCE).toMatch(/^import 'server-only';/);
  });

  it('se met en cache sous l’étiquette « plans », une heure au plus', async () => {
    const fetch = vi.fn<FetchLike>(async () => json([STARTER]));
    await getPublicPlans(source(fetch));
    const init = fetch.mock.calls[0]?.[1];
    expect(PLANS_TAG).toBe('plans');
    expect(init?.next?.tags).toEqual(['plans']);
    expect(init?.next?.revalidate).toBe(PLANS_REVALIDATE_SECONDS);
    expect(PLANS_REVALIDATE_SECONDS).toBeLessThanOrEqual(3600);
    expect(init?.cache).toBe('force-cache');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('la réponse', () => {
  it('rend les offres valides, dans l’ordre reçu', async () => {
    const plans = await getPublicPlans(source(async () => json([STARTER, PRO])));
    expect(plans?.map((p) => p.code)).toEqual(['starter', 'pro']);
    expect(plans?.[1]?.max_plates).toBe(-1);
  });

  it('une liste vide reste une liste vide : aucune offre publique', async () => {
    expect(await getPublicPlans(source(async () => json([])))).toEqual([]);
  });

  it.each([
    ['base injoignable', async () => { throw new TypeError('fetch failed'); }],
    ['délai dépassé', async () => { throw new DOMException('timeout', 'TimeoutError'); }],
    ['erreur HTTP', async () => json({ message: 'boom' }, 503)],
    ['refus', async () => json({ message: 'permission denied' }, 401)],
    ['JSON illisible', async () => new Response('<html>', { status: 200 })],
    ['réponse qui n’est pas une liste', async () => json({ plans: [STARTER] })],
  ] as const)('%s : null, jamais un prix inventé', async (_label, impl) => {
    expect(await getPublicPlans(source(impl as FetchLike))).toBeNull();
  });

  it('ne recopie que les colonnes connues, même si la base en renvoie d’autres', () => {
    const plan = parsePublicPlan({ ...STARTER, stripe_price_id_month: 'price_secret', features: { api: true }, id: 'x' });
    expect(plan).not.toBeNull();
    expect(Object.keys(plan ?? {}).sort()).toEqual([...PUBLIC_PLAN_COLUMNS].sort());
    expect(JSON.stringify(plan)).not.toContain('price_secret');
  });

  it('garde une offre gratuite, comme /tarifs qui affiche toute offre active et publique', () => {
    // La base l'autorise (`check (price_month_cents >= 0)`) : l'écarter ici
    // ferait diverger la page métier et la page des tarifs.
    const tarifs = readFileSync(fileURLToPath(new URL('../src/app/(marketing)/tarifs/page.tsx', import.meta.url)), 'utf8');
    expect(tarifs).toContain(".eq('is_active', true).eq('is_public', true)");
    expect(tarifs).not.toMatch(/price_month_cents\s*>|\.gt\(\s*'price_month_cents'/);
    const free = { ...STARTER, code: 'decouverte', name: 'Découverte', price_month_cents: 0, price_year_cents: 0 };
    expect(parsePublicPlan(free)?.price_month_cents).toBe(0);
    expect(parsePublicPlans([free, STARTER])?.map((p) => p.code)).toEqual(['decouverte', 'starter']);
  });

  it.each([
    ['prix négatif', { price_month_cents: -100 }],
    ['prix décimal', { price_month_cents: 19.5 }],
    ['prix en texte', { price_month_cents: '1900' }],
    ['code invalide', { code: 'Starter!' }],
    ['nom vide', { name: '   ' }],
    ['devise inconnue', { currency: 'euro' }],
    ['quota invalide', { max_staff: -2 }],
    ['essai manquant', { trial_days: null }],
    ['frais d’installation négatifs', { setup_fee_cents: -1 }],
    ['frais d’installation décimaux', { setup_fee_cents: 149.5 }],
    ['frais d’installation en texte', { setup_fee_cents: '14900' }],
    ['frais d’installation nuls au sens SQL', { setup_fee_cents: null }],
  ])('écarte une ligne douteuse : %s', (_label, patch) => {
    expect(parsePublicPlan({ ...STARTER, ...patch })).toBeNull();
    expect(parsePublicPlans([{ ...STARTER, ...patch }, PRO])?.map((p) => p.code)).toEqual(['pro']);
  });

  it('garde la première ligne d’un code en double, et tolère une accroche vide', () => {
    const plans = parsePublicPlans([STARTER, { ...STARTER, name: 'Doublon' }, { ...PRO, tagline: '', description: null }]);
    expect(plans?.map((p) => p.name)).toEqual(['Starter', 'Pro']);
    expect(plans?.[1]?.tagline).toBeNull();
    expect(plans?.[1]?.description).toBeNull();
  });

  it('refuse ce qui n’est pas une liste', () => {
    expect(parsePublicPlans(null)).toBeNull();
    expect(parsePublicPlans({})).toBeNull();
    expect(parsePublicPlans('[]')).toBeNull();
  });
});

describe('l’affichage', () => {
  it('écrit les prix à la française, sans décimales inutiles, avec des espaces insécables', () => {
    expect(formatPlanPrice(1900, 'EUR')).toBe('19\u00a0€');
    expect(formatPlanPrice(129000, 'EUR')).toBe('1\u00a0290\u00a0€');
    expect(formatPlanPrice(2490, 'EUR')).toBe('24,90\u00a0€');
    expect(formatPlanPrice(1900, 'EUR')).not.toMatch(/[ \u202f]/);
  });

  it('écrit « Gratuit » pour une offre à 0 €, jamais « 0 € »', () => {
    expect(FREE_PRICE_LABEL).toBe('Gratuit');
    expect(formatPlanPrice(0, 'EUR')).toBe('Gratuit');
    expect(formatPlanPrice(1, 'EUR')).toBe('0,01\u00a0€');
  });

  it('trouve l’offre d’entrée, ou rien', () => {
    const plans: PublicPlanOffer[] = [PRO, STARTER];
    expect(cheapestPlan(plans)?.code).toBe('starter');
    expect(cheapestPlan([])).toBeNull();
    const free = parsePublicPlan({ ...STARTER, code: 'decouverte', price_month_cents: 0, price_year_cents: 0 });
    expect(free).not.toBeNull();
    if (free) expect(cheapestPlan([PRO, free, STARTER])?.code).toBe('decouverte');
  });
});

describe('l’offre unique (0043)', () => {
  it('lit les frais d’installation tels que la base les donne', () => {
    expect(parsePublicPlan(RANGVIA)?.setup_fee_cents).toBe(14900);
  });

  it('une ligne sans la clé (appel direct, sans la colonne) vaut « pas de frais »', () => {
    // La requête demande toujours la colonne : si elle manquait en base,
    // PostgREST refuserait tout (400 → null). L'absence ne vient donc que
    // d'un appel sans elle.
    const { setup_fee_cents: _omitted, ...withoutFee } = RANGVIA;
    expect(parsePublicPlan(withoutFee)?.setup_fee_cents).toBe(0);
  });

  it('l’offre affichée est la première publique, comme sur /tarifs', () => {
    const plans = parsePublicPlans([RANGVIA, STARTER]);
    expect(mainPlan(plans)?.code).toBe('rangvia');
    expect(mainPlan([])).toBeNull();
    expect(mainPlan(null)).toBeNull();
  });

  it('écrit le prix et les frais en HT, frais « une fois »', () => {
    const plan = parsePublicPlan(RANGVIA)!;
    expect(monthlyPriceLabel(plan)).toBe('59,90\u00a0€\u00a0HT/mois');
    expect(setupFeeLabel(plan)).toBe('149\u00a0€\u00a0HT d’installation, une fois');
    expect(setupFeeLabel({ setup_fee_cents: 0, currency: 'EUR' })).toBeNull();
    expect(monthlyPriceLabel({ price_month_cents: 0, currency: 'EUR' })).toBe('Gratuit');
  });

  it('dit ce que comprend l’abonnement d’après les quotas réels', () => {
    expect(planAllowances(parsePublicPlan(RANGVIA)!)).toEqual([
      'Établissements, professionnels, plaques et files sans limite',
      '2\u00a0ans d’historique',
    ]);
    // Des quotas chiffrés gardent chacun leur ligne ; l'illimité est regroupé.
    expect(planAllowances({ max_locations: 1, max_staff: 3, max_plates: -1, max_queues: 1, history_days: 30 })).toEqual([
      'Plaques sans limite',
      '1\u00a0établissement',
      '3\u00a0professionnels',
      '1\u00a0file',
      '30\u00a0jours d’historique',
    ]);
    expect(historyLabel(365)).toBe('1\u00a0an d’historique');
    expect(historyLabel(-1)).toBe('Historique sans limite');
    expect(historyLabel(1)).toBe('1\u00a0jour d’historique');
  });

  it('présente l’installation telle que le propriétaire la vend, sans promesse de profil', () => {
    expect(SETUP_TITLE).toBe('Installation et configuration de votre métier par l’équipe Rangvia');
    expect(SETUP_STEPS).toHaveLength(3);
    const text = SETUP_STEPS.map((s) => `${s.key} ${s.text}`).join(' ');
    // Apostrophes typographiques, et aucune fonction de profil non livrée
    // (atelier, devis, table, guichet…) promise par l'installation.
    expect(text).not.toMatch(/'/);
    expect(text).not.toMatch(/devis|immatriculation|table|guichet|atelier/i);
  });
});
