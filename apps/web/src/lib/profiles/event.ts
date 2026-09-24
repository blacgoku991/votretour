import type { ProfileDefinition } from './types';

/**
 * ÉVÉNEMENTS ET DROPS — inchangé.
 *
 * Le module Événements (vagues, laisser-passer, contrôle) garde ses propres
 * écrans et ses propres textes. Le profil ne sert qu'à choisir le
 * vocabulaire et l'écran TV, déjà spécifique. Les notifications de
 * position restent coupées pendant un événement actif (`dispatch.ts`).
 */
export const event: ProfileDefinition = {
  id: 'event',
  label: 'Événement',
  tagline: 'Les participants entrent par vagues, avec un laisser-passer.',
  usesPosition: true,
  parallel: false,
  autoAdvance: true,
  stages: [],
  initialStage: null,
  numbering: 'none',
  vocab: {
    subject: 'participant',
    subjectPlural: 'participants',
    subjectGender: 'm',
    dossier: 'laisser-passer',
    counter: 'Entrée',
    professional: 'Contrôle',
    queue: 'File',
    openQueue: 'Ouvrir la file',
    complete: 'Terminer',
    start: 'Démarrer',
    call: 'Appeler',
    todayCounter: 'entrés aujourd’hui',
    clientWaiting: 'N personnes devant vous',
    clientTurn: 'Votre accès est prêt',
  },
  queueDefaults: {},
  defaultServices: [],
  templates: [],
};
