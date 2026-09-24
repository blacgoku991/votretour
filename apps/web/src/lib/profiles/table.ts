import type { ProfileDefinition } from './types';

/**
 * TABLE — restaurants.
 *
 * Ce qui avance, c'est le groupe, et c'est la table libérée qui décide :
 * une table de deux ne convient pas à un groupe de six. Il n'y a donc pas
 * d'appel automatique (« Installer » ne promeut personne) : l'hôte touche
 * « Table libre pour 4 », Rangvia met en évidence le bon groupe, l'hôte
 * confirme (`table-suggest.ts`). Le prénom est obligatoire : l'accueil
 * appelle des noms. La demande d'avis part après le repas, pas quand on
 * s'assoit (`reviewDelayMinutes`, appliqué en SQL).
 */
export const table: ProfileDefinition = {
  id: 'table',
  label: 'Table',
  tagline: 'Le groupe attend sa table, et c’est la table libérée qui décide.',
  usesPosition: true,
  parallel: false,
  autoAdvance: false,
  stages: [],
  initialStage: null,
  numbering: 'none',
  vocab: {
    subject: 'groupe',
    subjectPlural: 'groupes',
    subjectGender: 'm',
    dossier: null,
    counter: 'Accueil',
    professional: 'Accueil',
    queue: 'Liste d’attente',
    openQueue: 'Ouvrir la liste',
    complete: 'Installer',
    start: null,
    call: 'Table prête · appeler',
    todayCounter: 'couverts installés',
    clientWaiting: 'N groupes avant vous',
    clientTurn: 'Votre table est prête',
  },
  queueDefaults: {
    mode: 'shared',
    advanceMode: 'call_next',
    askClientName: true,
    clientNameRequired: true,
    entryTtlMinutes: 240,
    absentPolicy: 'remove',
    absentGraceMinutes: 5,
    allowServiceChoice: false,
  },
  defaultServices: [],
  templates: [
    { key: 'bientot', label: 'Dans 5 minutes', body: 'Votre table sera prête dans 5 minutes.' },
    {
      key: 'terrasse',
      label: 'Terrasse libre',
      body: 'Une table en terrasse se libère : elle vous convient ? Répondez à l’accueil.',
    },
    { key: 'complet', label: 'Complet', body: 'Nous sommes complets pour ce service. Toutes nos excuses.' },
  ],
};
