import type { ProfileDefinition } from './types';

/**
 * PASSAGE AU FAUTEUIL — barbiers, coiffure, ongles, beauté.
 *
 * Le comportement d'aujourd'hui, à l'identique. Ce vocabulaire EST celui
 * de `lib/copy.ts` : il n'est recopié ici que pour que tous les profils se
 * lisent de la même façon. Aucun réglage n'est appliqué au passage dans ce
 * profil (`queueDefaults` vide) et aucune prestation n'est créée : un
 * barbier ne voit rien changer.
 */
export const walkin: ProfileDefinition = {
  id: 'walkin',
  label: 'Passage au fauteuil',
  tagline: 'La personne avance, dans l’ordre d’arrivée.',
  usesPosition: true,
  parallel: false,
  autoAdvance: true,
  stages: [],
  initialStage: null,
  numbering: 'none',
  vocab: {
    subject: 'client',
    subjectPlural: 'clients',
    subjectGender: 'm',
    dossier: null,
    counter: 'Comptoir',
    professional: 'Professionnel',
    queue: 'File',
    openQueue: 'Ouvrir la file',
    complete: 'Terminer',
    start: 'Démarrer',
    call: 'Appeler',
    todayCounter: 'passés aujourd’hui',
    clientWaiting: 'N personnes devant vous',
    clientTurn: 'C’est votre tour',
  },
  queueDefaults: {},
  defaultServices: [],
  templates: [],
};
