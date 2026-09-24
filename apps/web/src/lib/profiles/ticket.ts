/**
 * NUMÉROS DE TICKET — l'exception assumée à la règle « pas de numéro ».
 *
 * `docs/ARCHITECTURE.md` (§ 4) refuse le « ticket A013 » : pour un client
 * au fauteuil, l'information utile est le nombre de personnes devant lui.
 * Deux profils en ont pourtant besoin, pour une raison précise :
 *
 *  - au guichet (`desk`), la TV de la salle appelle un NUMÉRO, jamais un
 *    nom : le numéro protège la vie privée. Remis à zéro chaque jour, avec
 *    un préfixe réglable : « A-042 » ;
 *  - à l'atelier appareil (`device`), le numéro de dossier relie le
 *    téléphone déposé, le client et le technicien : « 0042 », continu.
 *
 * La mise en forme est aussi faite en SQL (clé `ticketNo` de 0035) ; ces
 * fonctions servent à l'aperçu, aux objets visuels et aux tests.
 */

import type { QueueProfile } from './types';

export const TICKET_PREFIX_RE = /^[A-Z]{1,2}$/;

/** « A-042 » (guichet), « 0042 » (dossier d'atelier) ; null hors numérotation. */
export function formatTicketNo(profile: QueueProfile, n: number | null | undefined, prefix = 'A'): string | null {
  if (n == null || !Number.isInteger(n) || n < 1) return null;
  if (profile === 'device') return String(n).padStart(4, '0');
  const p = TICKET_PREFIX_RE.test(prefix) ? prefix : 'A';
  return `${p}-${String(n).padStart(3, '0')}`;
}

/** Découpe « A-042 » en préfixe et chiffres, pour le volet. */
export function splitTicketNo(ticketNo: string): { prefix: string | null; digits: string } {
  const m = /^([A-Z]{1,2})-(\d+)$/.exec(ticketNo.trim());
  if (m) return { prefix: m[1] ?? null, digits: m[2] ?? '' };
  return { prefix: null, digits: ticketNo.trim() };
}
