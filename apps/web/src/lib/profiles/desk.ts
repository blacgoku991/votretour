import type { ProfileDefinition } from './types';

/**
 * GUICHET — comptoirs, services administratifs, santé.
 *
 * La personne avance dans l'ordre, et plusieurs guichets appellent en même
 * temps (une fiche `staff` par guichet, avec `desk_label`). Le numéro de
 * ticket (« A-042 ») est ici une EXCEPTION ASSUMÉE à la règle « pas de
 * numéro » (`docs/ARCHITECTURE.md`, § 4) : au guichet, il protège la vie
 * privée, car la TV de la salle appelle un numéro et jamais un nom. Le
 * prénom est donc désactivé par défaut, et interdit en santé.
 */
export const desk: ProfileDefinition = {
  id: 'desk',
  label: 'Guichet',
  tagline: 'Un numéro, un guichet : on appelle la personne sans afficher son nom.',
  usesPosition: true,
  parallel: false,
  autoAdvance: true,
  stages: [],
  initialStage: null,
  numbering: 'daily',
  vocab: {
    subject: 'personne',
    subjectPlural: 'personnes',
    subjectGender: 'f',
    dossier: 'ticket',
    counter: 'Guichet',
    professional: 'Guichet',
    queue: 'File',
    openQueue: 'Ouvrir les guichets',
    complete: 'Terminer',
    start: 'Commencer',
    call: 'Appeler au guichet',
    todayCounter: 'servis aujourd’hui',
    clientWaiting: 'N personnes devant vous',
    // Le rideau affiche le guichet réel (« Guichet 3 ») : ceci n'est que le repli.
    clientTurn: 'Présentez-vous au guichet',
  },
  queueDefaults: {
    mode: 'shared',
    advanceMode: 'call_next',
    askClientName: false,
    clientNameRequired: false,
    allowServiceChoice: true,
  },
  defaultServices: ['Accueil', 'Dépôt de dossier', 'Retrait'],
  templates: [
    { key: 'piece_identite', label: 'Pièce d’identité', body: 'Munissez-vous de votre pièce d’identité.' },
    {
      key: 'changement_guichet',
      label: 'Changement de guichet',
      body: 'Le guichet 2 ferme : vous serez appelé au guichet 4.',
    },
    { key: 'patienter', label: 'Patienter', body: 'Merci de patienter, un agent arrive.' },
  ],
};
