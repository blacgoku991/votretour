import type { StageDef } from './types';

/**
 * Étapes des ateliers (véhicule et appareil) : mêmes codes, mêmes statuts,
 * même ordre. Le chemin est NON linéaire (un devis ou une pièce peuvent
 * être sautés, « Prêt » peut revenir en réparation) : l'ordre ci-dessous
 * n'est que l'ordre d'affichage du rail.
 *
 * Chaque ligne est le miroir d'une branche de `internal.stage_status`
 * (migration 0034). `profile-parity.test.ts` vérifie les deux sens.
 */
export const WORKSHOP_STAGES: readonly StageDef[] = [
  {
    key: 'received',
    status: 'waiting',
    short: 'Reçu',
    client: 'Reçu, en attente de prise en charge',
    staff: 'À prendre en charge',
    // Le client vient de le déposer : le prévenir serait du bruit.
    notifyDefault: false,
    notifyKind: 'stage_update',
    optional: false,
    tone: 'neutral',
    column: 'intake',
  },
  {
    key: 'diagnosis',
    status: 'serving',
    short: 'Diagnostic',
    client: 'En diagnostic',
    staff: 'Diagnostic',
    notifyDefault: false,
    notifyKind: 'stage_update',
    optional: false,
    tone: 'cobalt',
    column: 'workshop',
  },
  {
    key: 'quote_pending',
    status: 'serving',
    short: 'Devis',
    client: 'Devis à valider',
    staff: 'Devis envoyé',
    notifyDefault: true,
    notifyKind: 'quote_ready',
    optional: true,
    tone: 'copper',
    column: 'waiting',
  },
  {
    key: 'waiting_parts',
    status: 'serving',
    short: 'Pièce',
    client: 'En attente de pièce',
    staff: 'Pièce commandée',
    notifyDefault: true,
    notifyKind: 'stage_update',
    optional: true,
    tone: 'ardoise',
    column: 'waiting',
  },
  {
    key: 'in_repair',
    status: 'serving',
    short: 'Réparation',
    client: 'En réparation',
    staff: 'En réparation',
    // Proposé, non coché : certains clients aiment le savoir, d'autres non.
    notifyDefault: false,
    notifyKind: 'stage_update',
    optional: false,
    tone: 'cobalt',
    column: 'workshop',
  },
  {
    key: 'ready',
    status: 'next',
    short: 'Prêt',
    client: 'Prêt à récupérer',
    staff: 'Prêt',
    notifyDefault: true,
    notifyKind: 'your_turn',
    optional: false,
    tone: 'signal',
    column: 'ready',
  },
];

/**
 * Étapes du retrait de commande en boutique. Le motif « Être conseillé »
 * n'en a pas : il suit la file comme un walkin.
 */
export const RETAIL_STAGES: readonly StageDef[] = [
  {
    key: 'preparing',
    status: 'serving',
    short: 'Préparation',
    client: 'En préparation',
    staff: 'En préparation',
    notifyDefault: false,
    notifyKind: 'stage_update',
    optional: false,
    tone: 'cobalt',
    column: null,
  },
  {
    key: 'ready',
    status: 'next',
    short: 'Prête',
    // « commande » est féminin.
    client: 'Prête à retirer',
    staff: 'Commande prête',
    notifyDefault: true,
    notifyKind: 'your_turn',
    optional: false,
    tone: 'signal',
    column: null,
  },
];
