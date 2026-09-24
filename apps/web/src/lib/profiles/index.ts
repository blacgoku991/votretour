/**
 * REGISTRE DES PROFILS MÉTIER.
 *
 * Quinze métiers, sept parcours. Le profil se règle PAR FILE
 * (`queues.profile`) : un centre auto peut avoir une file « Atelier » en
 * `vehicle` et une file « Pneus minute » en `walkin`. Sa valeur par défaut
 * vient de l'activité de l'organisation (`ACTIVITY_PROFILE`, miroir exact
 * de `internal.default_profile` en SQL, vérifié par test).
 *
 * Tout ce module est du TypeScript pur, sans accès réseau ni hook : il se
 * lit aussi bien côté serveur (pages métier, notifications) que côté
 * client (formulaires, postes).
 */

import { device } from './device';
import { desk } from './desk';
import { event } from './event';
import { retail } from './retail';
import { table } from './table';
import { vehicle } from './vehicle';
import { walkin } from './walkin';
import type {
  ActivityType,
  ProfileDefinition,
  ProfileStage,
  QueueProfile,
  StageDef,
} from './types';
import type { EntryStatus } from '@/lib/types';

export * from './types';

export const PROFILES: Readonly<Record<QueueProfile, ProfileDefinition>> = {
  walkin,
  vehicle,
  device,
  table,
  desk,
  retail,
  event,
};

/**
 * Activité → profil par défaut. La santé va au guichet, avec l'option
 * `sensitive` (voir `SENSITIVE_ACTIVITIES`) : pas de prénom, pas de texte
 * libre, jamais de nom à la TV.
 */
export const ACTIVITY_PROFILE: Readonly<Record<ActivityType, QueueProfile>> = {
  barber: 'walkin',
  hair_salon: 'walkin',
  nail_bar: 'walkin',
  beauty: 'walkin',
  other: 'walkin',
  garage: 'vehicle',
  auto_center: 'vehicle',
  phone_repair: 'device',
  aftersales: 'device',
  restaurant: 'table',
  counter: 'desk',
  admin_service: 'desk',
  health: 'desk',
  shop: 'retail',
  event: 'event',
};

/** Activités dont les files sont `sensitive` : données de santé (RGPD, art. 9). */
export const SENSITIVE_ACTIVITIES: ReadonlySet<ActivityType> = new Set(['health']);

/**
 * Activités pour lesquelles la demande d'avis Google est COUPÉE par défaut.
 * En santé, solliciter des avis pose des questions déontologiques ; dans un
 * service administratif, elle n'a pas de sens. Le pro peut la réactiver.
 */
export const NO_REVIEW_ACTIVITIES: ReadonlySet<ActivityType> = new Set(['health', 'admin_service']);

export function isQueueProfile(value: unknown): value is QueueProfile {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, value);
}

export function isActivityType(value: unknown): value is ActivityType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITY_PROFILE, value);
}

/** Le profil ; une valeur inconnue retombe sur `walkin`, le comportement d'aujourd'hui. */
export function getProfile(profile: QueueProfile | string | null | undefined): ProfileDefinition {
  return isQueueProfile(profile) ? PROFILES[profile] : PROFILES.walkin;
}

/** Profil par défaut d'une activité ; une activité inconnue donne `walkin`. */
export function profileForActivity(activity: string | null | undefined): QueueProfile {
  return isActivityType(activity) ? ACTIVITY_PROFILE[activity] : 'walkin';
}

/** Définition d'une étape pour un profil ; null si elle n'y existe pas. */
export function stageDef(profile: QueueProfile, stage: string | null | undefined): StageDef | null {
  if (!stage) return null;
  return getProfile(profile).stages.find((s) => s.key === stage) ?? null;
}

/** Miroir de `internal.stage_status` : null si l'étape est inconnue pour ce profil. */
export function stageStatus(profile: QueueProfile, stage: string): EntryStatus | null {
  return stageDef(profile, stage)?.status ?? null;
}

export function isStageOf(profile: QueueProfile, stage: unknown): stage is ProfileStage {
  return typeof stage === 'string' && stageDef(profile, stage) !== null;
}

/** Toutes les étapes connues, tous profils confondus (ordre de première apparition). */
export function allStages(): ProfileStage[] {
  const seen = new Set<ProfileStage>();
  for (const p of Object.values(PROFILES)) for (const s of p.stages) seen.add(s.key);
  return [...seen];
}

/** Profils à étapes (vehicle, device, retail). */
export function hasStages(profile: QueueProfile): boolean {
  return getProfile(profile).stages.length > 0;
}

/**
 * Le profil garde-t-il exactement le comportement des barbiers ? C'est la
 * garde de tous les aiguillages : walkin ET event passent par les écrans
 * d'aujourd'hui, inchangés.
 */
export function isLegacyProfile(profile: QueueProfile | string | null | undefined): boolean {
  const id = getProfile(profile).id;
  return id === 'walkin' || id === 'event';
}
