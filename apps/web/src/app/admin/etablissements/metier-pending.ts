/**
 * « MÉTIER À ACTIVER » — la règle, pure et partagée.
 *
 * Le commerçant qui s'inscrit comme garage, restaurant, guichet ou
 * boutique lit : « L'équipe Rangvia active l'interface de votre métier
 * lors de l'installation. » Cette promesse n'est tenue que si l'équipe
 * SAIT qu'une installation l'attend. D'où ce signal, lu au même endroit
 * par la liste des établissements (pastille et filtre), par la vue
 * d'ensemble /admin (compteur) et par la fiche d'un établissement (ligne
 * « À activer » en tête de la section Métier).
 *
 * La règle : l'activité déclarée correspond à un métier propre (pas un
 * profil hérité : ni le passage d'un barbier, ni l'événement, qui garde
 * son module) ET aucune file de l'organisation n'est encore dans ce
 * métier. Dès qu'une file y est, le signal s'éteint, même si d'autres
 * files restent au passage (un garage peut garder un comptoir « Pneus
 * minute » au passage, par choix).
 *
 * Aucune dépendance au serveur : testée sans base
 * (`tests/admin-profiles.test.ts`).
 */

import { ACTIVITY_PROFILE, isActivityType, isLegacyProfile } from '@/lib/profiles';
import type { ActivityType, QueueProfile } from '@/lib/profiles/types';

/** Les activités qui ont un métier propre à activer (garage, réparation, restaurant, guichets, boutique). */
export const ACTIVITIES_WITH_METIER: readonly ActivityType[] = (Object.keys(ACTIVITY_PROFILE) as ActivityType[])
  .filter((activity) => !isLegacyProfile(ACTIVITY_PROFILE[activity]));

/**
 * Le métier que l'équipe doit encore activer pour cette organisation, ou
 * null s'il n'y a rien à faire.
 *
 * @param activity l'activité déclarée (`organizations.activity`)
 * @param queueProfiles le profil de chaque file de l'organisation
 */
export function metierToActivate(
  activity: string | null | undefined,
  queueProfiles: readonly (string | null | undefined)[],
): QueueProfile | null {
  if (!isActivityType(activity)) return null;
  const target = ACTIVITY_PROFILE[activity];
  if (isLegacyProfile(target)) return null;
  return queueProfiles.some((profile) => profile === target) ? null : target;
}

/**
 * La même règle pour une liste d'organisations : l'identifiant de chacune
 * qui attend son métier, avec ce métier. `queues` peut contenir des files
 * d'autres organisations (elles sont ignorées).
 */
export function metiersToActivate(
  organizations: readonly { id: string; activity: string | null }[],
  queues: readonly { organization_id: string; profile: string | null }[],
): Map<string, QueueProfile> {
  const byOrg = new Map<string, (string | null)[]>();
  for (const queue of queues) {
    const list = byOrg.get(queue.organization_id);
    if (list) list.push(queue.profile);
    else byOrg.set(queue.organization_id, [queue.profile]);
  }
  const pending = new Map<string, QueueProfile>();
  for (const org of organizations) {
    const target = metierToActivate(org.activity, byOrg.get(org.id) ?? []);
    if (target) pending.set(org.id, target);
  }
  return pending;
}
