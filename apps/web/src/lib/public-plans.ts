import 'server-only';
import { env } from '@/lib/env';

/**
 * OFFRES PUBLIQUES — les tarifs affichés par les pages métier.
 *
 * Les pages `/pour/[metier]` sont statiques (ISR) : elles sont rendues au
 * build, puis régénérées. Elles ne peuvent donc pas lire les offres comme
 * `/tarifs`, qui passe par le client service_role au runtime
 * (`force-dynamic`) pour ne jamais injecter SUPABASE_SERVICE_ROLE_KEY
 * dans l'image Docker. Ici, on lit avec la clé ANON, publique par nature :
 * `plans` est lisible par `anon` (0010, `grant select` et policy
 * `plans_public_select` : `is_active and is_public`). Aucun secret n'entre
 * en jeu, au build comme au runtime.
 *
 * Trois garanties :
 *  - COLONNES CHOISIES : on ne demande que ce qu'une page publique affiche.
 *    Ni `stripe_*`, ni `features`, ni `id` : `anon` y a techniquement
 *    accès, mais une page n'a aucune raison de les transporter ;
 *  - CACHE ÉTIQUETÉ `plans` : la réponse est mise en cache par Next
 *    (une heure au plus), et l'enregistrement d'une offre par le
 *    super-admin l'invalide d'un coup avec `revalidateTag('plans')`
 *    (lot S5) ;
 *  - JAMAIS DE PRIX INVENTÉ : si la base est injoignable (build sans
 *    réseau, panne), `null` revient, et la page affiche le seul lien
 *    « Voir les tarifs ». Une ligne malformée est écartée plutôt que
 *    montrée de travers.
 */

/** Étiquette de cache des offres : `revalidateTag(PLANS_TAG)` après chaque enregistrement. */
export const PLANS_TAG = 'plans';

/** Durée de vie maximale du cache, en secondes (celle des pages métier). */
export const PLANS_REVALIDATE_SECONDS = 3600;

/** Au-delà, on renonce : une page ne doit pas attendre la base pour s'afficher. */
export const PLANS_TIMEOUT_MS = 4000;

/**
 * Colonnes lues, dans l'ordre. Ce sont celles de `/tarifs` (PricingBoard),
 * plus l'accroche : une page métier et la page des tarifs montrent la même
 * offre avec les mêmes chiffres.
 */
export const PUBLIC_PLAN_COLUMNS = [
  'code',
  'name',
  'tagline',
  'description',
  'price_month_cents',
  'price_year_cents',
  'currency',
  'trial_days',
  'max_locations',
  'max_staff',
  'max_plates',
  'max_queues',
  'history_days',
] as const;

/**
 * Une offre telle qu'une page publique peut l'afficher. Même forme que
 * `PublicPlan` de `/tarifs` (plus `tagline`) : le bandeau d'offres d'une
 * page métier et le tableau des tarifs se nourrissent du même objet.
 * Quotas : `-1` signifie « illimité », comme en base.
 */
export interface PublicPlanOffer {
  code: string;
  name: string;
  tagline: string | null;
  description: string | null;
  /** Prix mensuel HT, en centimes. */
  price_month_cents: number;
  /** Prix annuel HT, en centimes ; 0 si l'offre n'a pas d'annuel. */
  price_year_cents: number;
  /** Code ISO 4217 (« EUR »). */
  currency: string;
  trial_days: number;
  max_locations: number;
  max_staff: number;
  max_plates: number;
  max_queues: number;
  history_days: number;
}

/** URL PostgREST des offres publiques : colonnes choisies, filtres redondants avec la policy, ordre d'affichage. */
export function publicPlansUrl(supabaseUrl: string): string {
  const params = new URLSearchParams({
    select: PUBLIC_PLAN_COLUMNS.join(','),
    // La policy filtre déjà : on le redit, pour qu'un changement de policy
    // ne publie pas par surprise une offre privée ou archivée.
    is_active: 'eq.true',
    is_public: 'eq.true',
    order: 'sort_order.asc,code.asc',
  });
  return `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/plans?${params.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Validation : une ligne douteuse ne s'affiche pas                     */
/* ------------------------------------------------------------------ */

const CODE_RE = /^[a-z][a-z0-9_]{1,30}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function wholeNumber(value: unknown, min: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min ? value : null;
}

/** Un quota : un entier positif, ou -1 (illimité). */
function quota(value: unknown): number | null {
  if (value === -1) return -1;
  return wholeNumber(value, 0);
}

/**
 * Une ligne de la base, validée champ par champ ; `null` si elle ne
 * ressemble pas à une offre affichable (prix mensuel nul ou absent, code
 * invalide, devise inconnue…). Les champs inconnus sont ignorés : même si
 * la requête changeait, rien d'autre que ces colonnes ne sortirait d'ici.
 */
export function parsePublicPlan(row: unknown): PublicPlanOffer | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  const code = typeof r.code === 'string' && CODE_RE.test(r.code) ? r.code : null;
  const name = text(r.name);
  const currency = typeof r.currency === 'string' && CURRENCY_RE.test(r.currency) ? r.currency : null;
  // Une offre publique à 0 € n'existe pas chez Rangvia : c'est une ligne
  // mal saisie, pas une offre gratuite à promettre.
  const month = wholeNumber(r.price_month_cents, 1);
  const year = wholeNumber(r.price_year_cents, 0);
  const trial = wholeNumber(r.trial_days, 0);
  const locations = quota(r.max_locations);
  const staff = quota(r.max_staff);
  const plates = quota(r.max_plates);
  const queues = quota(r.max_queues);
  const history = quota(r.history_days);

  if (
    code === null || name === null || currency === null || month === null || year === null || trial === null
    || locations === null || staff === null || plates === null || queues === null || history === null
  ) {
    return null;
  }

  return {
    code,
    name,
    tagline: text(r.tagline),
    description: text(r.description),
    price_month_cents: month,
    price_year_cents: year,
    currency,
    trial_days: trial,
    max_locations: locations,
    max_staff: staff,
    max_plates: plates,
    max_queues: queues,
    history_days: history,
  };
}

/** Toutes les lignes valides, dans l'ordre reçu ; `null` si la réponse n'est pas une liste. */
export function parsePublicPlans(payload: unknown): PublicPlanOffer[] | null {
  if (!Array.isArray(payload)) return null;
  const out: PublicPlanOffer[] = [];
  const seen = new Set<string>();
  for (const row of payload) {
    const plan = parsePublicPlan(row);
    if (plan && !seen.has(plan.code)) {
      seen.add(plan.code);
      out.push(plan);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lecture                                                              */
/* ------------------------------------------------------------------ */

/** Options de `fetch` propres à Next.js (cache de données, étiquettes). */
type NextFetchInit = RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };

export type FetchLike = (input: string, init: NextFetchInit) => Promise<Response>;

export interface PublicPlansSource {
  supabaseUrl: string;
  anonKey: string;
  fetch: FetchLike;
}

function defaultSource(): PublicPlansSource {
  return {
    supabaseUrl: env.supabase.url,
    // La clé ANON, jamais la clé service_role : ce module ne doit pas
    // pouvoir lire plus que ce qu'un visiteur anonyme voit.
    anonKey: env.supabase.anonKey,
    fetch: (input, init) => fetch(input, init),
  };
}

/**
 * Les offres publiques, dans l'ordre d'affichage de `/tarifs`.
 *
 *  - une liste (éventuellement vide) : ce que la base dit, à l'heure près ;
 *  - `null` : la base n'a pas répondu correctement. La page n'affiche
 *    alors AUCUN prix, seulement le lien vers `/tarifs`.
 *
 * Ne lève jamais : une page statique ne doit pas échouer au build parce
 * que la base n'est pas joignable depuis la machine de compilation.
 */
export async function getPublicPlans(source: PublicPlansSource = defaultSource()): Promise<PublicPlanOffer[] | null> {
  try {
    const response = await source.fetch(publicPlansUrl(source.supabaseUrl), {
      method: 'GET',
      headers: {
        apikey: source.anonKey,
        Authorization: `Bearer ${source.anonKey}`,
        Accept: 'application/json',
      },
      // Cache de données de Next : une réponse par heure au plus, et
      // invalidée d'un coup par `revalidateTag('plans')`.
      cache: 'force-cache',
      next: { revalidate: PLANS_REVALIDATE_SECONDS, tags: [PLANS_TAG] },
      signal: AbortSignal.timeout(PLANS_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parsePublicPlans(await response.json());
  } catch {
    // Réseau coupé, délai dépassé, JSON illisible : pas de prix plutôt
    // qu'un prix faux. L'erreur n'a rien de personnel ni de secret, mais
    // elle n'aide pas non plus le visiteur : la page reste silencieuse.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Affichage                                                            */
/* ------------------------------------------------------------------ */

/**
 * « 29 € », « 1 290 € », « 24,90 € » : montant en français, sans
 * décimales quand elles sont nulles, espaces insécables compris.
 */
export function formatPlanPrice(cents: number, currency: string): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .format(cents / 100)
    .replace(/\s/g, '\u00a0');
}

/** L'offre la moins chère au mois, pour un « dès … HT/mois » ; `null` sans offre. */
export function cheapestPlan(plans: readonly PublicPlanOffer[]): PublicPlanOffer | null {
  let best: PublicPlanOffer | null = null;
  for (const plan of plans) {
    if (!best || plan.price_month_cents < best.price_month_cents) best = plan;
  }
  return best;
}
