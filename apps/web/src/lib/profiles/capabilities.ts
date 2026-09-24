/**
 * CAPACITÉS — le contrat entre les profils métier et les pages publiques.
 *
 * Une page métier (`/pour/garages`) ne promet que ce qu'un garage qui
 * s'inscrit AUJOURD'HUI trouvera dans le produit. Elle lit donc cette
 * liste, et seulement elle : un bloc « Le devis validé depuis le
 * téléphone » ne s'affiche que si `profile.garage.quote` y figure.
 *
 * Règle d'équipe : ces deux listes ne sont modifiées QUE par la PR qui
 * ouvre un profil à tous les nouveaux comptes (lot P9), avec ses tests.
 * Jamais pendant le développement, jamais depuis une variable
 * d'environnement : une capacité ne peut pas exister en production et
 * pas en préproduction.
 *
 * Tant qu'un profil n'est pas ouvert, il reste accessible au banc de
 * développement et aux organisations qui ont `features.profiles = true`
 * (posé par `assignQueueProfile`, l'attribution d'un métier par le
 * super-admin, server/actions/admin-profiles.ts) : `profileAvailable`
 * ci-dessous. Rien
 * dans le développement ni dans les tests n'attend une organisation
 * « pilote ».
 */

import type { QueueProfile } from './types';

export type ProfileCapability =
  | 'profile.garage.dropoff'
  | 'profile.garage.vehicle_ready'
  | 'profile.garage.quote'
  | 'profile.garage.key_tag'
  | 'profile.repair.dropoff'
  | 'profile.repair.device_ready'
  | 'profile.restaurant.party_size'
  | 'profile.restaurant.table_ready'
  | 'profile.restaurant.delayed_review'
  | 'profile.counter.desk_number'
  | 'profile.counter.ticket_number';

/** Profil qui porte chaque capacité (sert au contrôle de cohérence). */
export const CAPABILITY_PROFILE: Readonly<Record<ProfileCapability, QueueProfile>> = {
  'profile.garage.dropoff': 'vehicle',
  'profile.garage.vehicle_ready': 'vehicle',
  'profile.garage.quote': 'vehicle',
  'profile.garage.key_tag': 'vehicle',
  'profile.repair.dropoff': 'device',
  'profile.repair.device_ready': 'device',
  'profile.restaurant.party_size': 'table',
  'profile.restaurant.table_ready': 'table',
  'profile.restaurant.delayed_review': 'table',
  'profile.counter.desk_number': 'desk',
  'profile.counter.ticket_number': 'desk',
};

/**
 * Profils servis. Tous les métiers sont ouverts : le métier d'une file
 * n'est jamais choisi par le commerçant, il est attribué par l'équipe
 * Rangvia à l'installation (super-admin, `assignQueueProfile`).
 */
export const OPEN_PROFILES: ReadonlySet<QueueProfile> = new Set<QueueProfile>([
  'walkin', 'event', 'vehicle', 'device', 'table', 'desk', 'retail',
]);

/**
 * Capacités livrées. Modifié UNIQUEMENT par un lot P9, dans la même PR
 * que `OPEN_PROFILES`.
 */
export const PROFILE_CAPABILITIES: readonly ProfileCapability[] = [
  'profile.garage.dropoff',
  'profile.garage.vehicle_ready',
  'profile.garage.quote',
  'profile.garage.key_tag',
  'profile.repair.dropoff',
  'profile.repair.device_ready',
  'profile.restaurant.party_size',
  'profile.restaurant.table_ready',
  'profile.restaurant.delayed_review',
  'profile.counter.desk_number',
  'profile.counter.ticket_number',
];

export function hasCapability(capability: ProfileCapability): boolean {
  return PROFILE_CAPABILITIES.includes(capability);
}

/**
 * Un profil peut-il être choisi par cette organisation ? Ouvert à tous, ou
 * activé pour elle (`organization_settings.features.profiles`, colonne
 * existante depuis 0002).
 */
export function profileAvailable(
  profile: QueueProfile,
  features?: Readonly<Record<string, unknown>> | null,
): boolean {
  return OPEN_PROFILES.has(profile) || features?.profiles === true;
}
