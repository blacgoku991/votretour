/**
 * OPTIONS DE PROFIL — colonne `queues.profile_options` (jsonb, 1 Ko au plus).
 *
 * Chaque profil n'accepte que SES clés (schéma strict) : une option de
 * restaurant posée sur un garage serait un bogue silencieux. En `walkin`,
 * les options restent `{}` : c'est ce qui garantit, en SQL, que la branche
 * « avis différé » n'est jamais prise pour un barbier.
 */

import { z } from 'zod';
import { NO_REVIEW_ACTIVITIES, SENSITIVE_ACTIVITIES, isActivityType } from './index';
import type { ProfileOptions, PublicProfileOptions, QueueProfile } from './types';

export const PROFILE_OPTIONS_MAX_BYTES = 1024;

/** Couverts : au-delà, « présentez-vous à l'accueil ». */
export const PARTY_MAX_LIMIT = 20;
export const REVIEW_DELAY_MIN = 30;
export const REVIEW_DELAY_MAX = 240;

const review = z.boolean();

/** 0 = immédiat ; null = jamais ; sinon entre 30 et 240 minutes. */
export const reviewDelaySchema = z.union([
  z.literal(0),
  z.number().int().min(REVIEW_DELAY_MIN).max(REVIEW_DELAY_MAX),
  z.null(),
]);

const tableSizesSchema = z
  .array(z.number().int().min(1).max(PARTY_MAX_LIMIT))
  .min(1)
  .max(6)
  .refine((sizes) => new Set(sizes).size === sizes.length, 'Chaque taille de table n’apparaît qu’une fois.');

const SCHEMAS = {
  walkin: z.object({ review: review.optional() }).strict(),
  event: z.object({ review: review.optional() }).strict(),
  vehicle: z
    .object({
      stayChoice: z.boolean().optional(),
      registrationRequired: z.boolean().optional(),
      tvRegistration: z.enum(['masked', 'model_only', 'none']).optional(),
      quotes: z.boolean().optional(),
      review: review.optional(),
    })
    .strict(),
  device: z
    .object({
      quotes: z.boolean().optional(),
      numbering: z.boolean().optional(),
      review: review.optional(),
    })
    .strict(),
  table: z
    .object({
      partyMax: z.number().int().min(2).max(PARTY_MAX_LIMIT).optional(),
      tableSizes: tableSizesSchema.optional(),
      reviewDelayMinutes: reviewDelaySchema.optional(),
      review: review.optional(),
    })
    .strict(),
  desk: z
    .object({
      numbering: z.boolean().optional(),
      sensitive: z.boolean().optional(),
      // En santé, `null` : aucune notification de fin de visite.
      reviewDelayMinutes: reviewDelaySchema.optional(),
      review: review.optional(),
    })
    .strict(),
  retail: z
    .object({
      numbering: z.boolean().optional(),
      review: review.optional(),
    })
    .strict(),
} as const satisfies Record<QueueProfile, z.ZodType>;

/** Schéma strict des options d'un profil, taille comprise. */
export function profileOptionsSchema(profile: QueueProfile) {
  return (SCHEMAS[profile] as z.ZodType<ProfileOptions>).refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= PROFILE_OPTIONS_MAX_BYTES,
    'Options trop volumineuses.',
  );
}

/**
 * Options posées au passage dans le profil (miroir des défauts de
 * `internal.apply_profile_defaults`). L'activité ne compte qu'au guichet :
 * santé → `sensitive`, santé et administration → pas d'avis Google.
 */
export function defaultProfileOptions(profile: QueueProfile, activity?: string | null): ProfileOptions {
  const known = isActivityType(activity) ? activity : null;
  const review = known ? !NO_REVIEW_ACTIVITIES.has(known) : true;
  switch (profile) {
    case 'vehicle':
      return { stayChoice: true, registrationRequired: true, tvRegistration: 'masked', quotes: true, review };
    case 'device':
      return { quotes: true, numbering: true, review };
    case 'table':
      return { partyMax: 12, tableSizes: [2, 4, 6, 8], reviewDelayMinutes: 75, review };
    case 'desk': {
      const sensitive = known ? SENSITIVE_ACTIVITIES.has(known) : false;
      // Santé : ni demande d'avis ni message de fin de visite (null = jamais).
      return sensitive ? { numbering: true, sensitive, review, reviewDelayMinutes: null } : { numbering: true, sensitive, review };
    }
    case 'retail':
      return { numbering: false, review };
    case 'walkin':
    case 'event':
      // Rien : `profile_options = '{}'` est la garantie « barbier inchangé ».
      return {};
  }
}

/**
 * Options effectives d'une file : les défauts du profil, écrasés par chaque
 * clé stockée VALIDE. Une clé invalide (base modifiée à la main, version
 * plus ancienne) est ignorée plutôt que de faire tomber l'écran.
 */
export function resolveProfileOptions(profile: QueueProfile, stored: unknown, activity?: string | null): ProfileOptions {
  const base = defaultProfileOptions(profile, activity);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base;
  const shape = SCHEMAS[profile].shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const field = shape[key];
    if (!field) continue;
    const parsed = field.safeParse(value);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as ProfileOptions;
}

/** Ce que le client a le droit de savoir des réglages (`publicOptions`, 0035). */
export function publicProfileOptions(options: ProfileOptions): PublicProfileOptions {
  const out: PublicProfileOptions = {};
  if (options.partyMax !== undefined) out.partyMax = options.partyMax;
  if (options.stayChoice !== undefined) out.stayChoice = options.stayChoice;
  if (options.numbering !== undefined) out.numbering = options.numbering;
  if (options.sensitive !== undefined) out.sensitive = options.sensitive;
  if (options.quotes !== undefined) out.quotes = options.quotes;
  return out;
}

export type ReviewPolicy = { kind: 'immediate' } | { kind: 'delayed'; minutes: number } | { kind: 'never' };

/**
 * Quand part la demande d'avis ? Même règle que `claim_entry_notification`
 * en SQL : sans `reviewDelayMinutes`, tout de suite (le comportement des
 * barbiers) ; `null`, jamais ; sinon après le délai. `review: false`
 * l'emporte sur tout.
 */
export function reviewPolicy(options: ProfileOptions): ReviewPolicy {
  if (options.review === false) return { kind: 'never' };
  if (!('reviewDelayMinutes' in options) || options.reviewDelayMinutes === undefined) return { kind: 'immediate' };
  if (options.reviewDelayMinutes === null) return { kind: 'never' };
  if (options.reviewDelayMinutes === 0) return { kind: 'immediate' };
  return { kind: 'delayed', minutes: options.reviewDelayMinutes };
}

/**
 * Le prénom peut-il être demandé ? Jamais dans une file `sensitive`
 * (santé) : l'option est alors masquée dans Réglages.
 */
export function clientNameAllowed(options: ProfileOptions): boolean {
  return options.sensitive !== true;
}
