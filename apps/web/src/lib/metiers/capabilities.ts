import 'server-only';
import { PROFILE_CAPABILITIES } from '@/lib/profiles/capabilities';
import { appClipPublished } from '@/lib/seo/site';
import type { Capability, CoreCapability } from './types';

/**
 * CAPACITÉS LIVRÉES — ce que les pages métier ont le droit de promettre.
 *
 * Trois sources, et aucune autre :
 *  1. `CORE` : le produit d'aujourd'hui, vérifié dans le code ;
 *  2. `PROFILE_CAPABILITIES`, IMPORTÉ de `lib/profiles/capabilities.ts` :
 *     c'est la PR qui ouvre un profil à tous (lot P9) qui l'alimente. Ce
 *     fichier n'est jamais retouché pour cela : les pages garages,
 *     réparation, restaurants et guichets s'enrichissent seules au
 *     déploiement suivant ;
 *  3. `channel.app_clip`, seulement quand l'App Clip est PUBLIÉ
 *     (`NEXT_PUBLIC_APP_CLIP_PUBLIE=1`, figé au build).
 *
 * Aucune capacité ne vient d'une variable d'environnement propre aux
 * pages : une capacité ne peut pas exister en production et pas en
 * préproduction.
 */

/**
 * Le produit d'aujourd'hui, vérifié écran par écran (septembre 2026) :
 *  - rejoindre par QR ou plaque NFC, sans compte ni application (`/e/…`) ;
 *  - position en direct, notification du navigateur, « Je suis de retour »,
 *    « Quitter la file » ;
 *  - au poste : Terminer, Démarrer, Appeler, Présent, Absent (reculer,
 *    mettre de côté, sortir), Décaler, Retirer, Ajouter au comptoir, pause
 *    d'un professionnel, pause ou fermeture de la file ;
 *  - Réglages : file commune ou par professionnel, choix du professionnel
 *    et de la prestation, « Après Terminer », seuil de notification,
 *    expiration, durée de conservation, avis Google ;
 *  - écran TV, statistiques, historique, plusieurs établissements (selon
 *    l'offre) ; événements : vagues, laisser-passer à usage unique,
 *    contrôle à l'entrée, « Stock épuisé ».
 *
 * VOLONTAIREMENT ABSENTES, bien que le moteur les connaisse :
 *  - `core.multi_queue` : plusieurs files dans un même établissement
 *    existent en base, mais aucun écran ne permet encore au commerçant
 *    d'en créer une seconde ;
 *  - `core.capacity_cap` : le plafond de la file (`max_active_entries`)
 *    n'a pas encore sa ligne dans Réglages ;
 *  - `core.service_on_board` : le client choisit sa prestation, mais ni le
 *    poste, ni l'écran TV, ni l'historique ne l'affichent encore. Une page
 *    ne peut donc pas promettre « vous savez qui vient pour quoi ».
 * Le jour où leur écran existe, on les ajoute ici, dans la même PR.
 */
export const CORE: readonly CoreCapability[] = [
  'core.join_qr_nfc',
  'core.position_live',
  'core.web_push',
  'core.back_button',
  'core.client_leave',
  'core.absent_policy',
  'core.walkin',
  'core.per_staff',
  'core.staff_choice',
  'core.service_choice',
  'core.staff_break',
  'core.queue_pause',
  'core.call_next',
  'core.expiry',
  'core.tv_screen',
  'core.google_review',
  'core.stats',
  'core.history',
  'core.multi_location',
  'core.retention_purge',
  'events.waves',
  'events.single_use_pass',
  'events.scan',
  'events.sold_out',
];

/**
 * Les capacités livrées, calculées à l'APPEL : dans une page statique ou
 * ISR, c'est donc au build puis à chaque régénération (comme
 * `appClipPublished()`, figée au build par nature).
 */
export function shippedCapabilities(): ReadonlySet<Capability> {
  return new Set<Capability>([
    ...CORE,
    ...PROFILE_CAPABILITIES,
    ...(appClipPublished() ? (['channel.app_clip'] as const) : []),
  ]);
}
