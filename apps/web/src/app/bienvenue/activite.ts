/**
 * LE PARAMÈTRE `?activite=` — une LISTE BLANCHE, rien d'autre.
 *
 * Module à part, sans dépendance au registre des profils : le middleware
 * le lit aussi (renvoi d'un compte connecté de /inscription?activite=…
 * vers /bienvenue?activite=…), et il doit rester léger.
 */

import { ACTIVITY_LABEL } from '@/lib/copy';
import type { ActivityType } from '@/lib/profiles/types';

/**
 * Seule une chaîne qui est EXACTEMENT un code de `ACTIVITY_LABEL` est
 * retenue ; tout le reste (inconnu, vide, répété, casse différente, clé
 * héritée comme « toString ») est ignoré, sans erreur : le parcours démarre
 * alors comme d'habitude.
 */
export function parseActivityParam(value: string | string[] | undefined | null): ActivityType | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  if (!Object.prototype.hasOwnProperty.call(ACTIVITY_LABEL, code)) return null;
  return code as ActivityType;
}
