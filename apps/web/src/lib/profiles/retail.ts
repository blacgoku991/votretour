import { RETAIL_STAGES } from './stages';
import type { ProfileDefinition } from './types';

/**
 * BOUTIQUE — deux motifs dans la même file.
 *
 *  - « Être conseillé » : se comporte comme un walkin (position, « c'est
 *    votre tour »), avec le vocabulaire « vendeur ».
 *  - « Retirer une commande » : étapes `preparing` puis `ready`, dans le
 *    désordre, et « Votre commande est prête ».
 *
 * Aucune étape n'est posée à l'inscription : c'est le vendeur qui passe
 * une commande en préparation.
 */
export const retail: ProfileDefinition = {
  id: 'retail',
  label: 'Boutique',
  tagline: 'Le conseil dans l’ordre d’arrivée, le retrait dès que la commande est prête.',
  usesPosition: true,
  parallel: false,
  autoAdvance: true,
  stages: RETAIL_STAGES,
  initialStage: null,
  numbering: 'none',
  vocab: {
    subject: 'client',
    subjectPlural: 'clients',
    subjectGender: 'm',
    dossier: 'commande',
    counter: 'Caisse',
    professional: 'Vendeur',
    queue: 'File',
    openQueue: 'Ouvrir la file',
    complete: 'Remise faite',
    start: 'Commencer',
    call: 'Commande prête',
    todayCounter: 'servis aujourd’hui',
    clientWaiting: 'N personnes devant vous',
    clientTurn: 'Votre commande est prête',
  },
  queueDefaults: {
    mode: 'shared',
    allowServiceChoice: true,
  },
  defaultServices: ['Être conseillé', 'Retirer une commande', 'Échange ou retour'],
  templates: [
    { key: 'retard', label: 'Retard', body: 'Votre commande a un peu de retard. Merci de votre patience.' },
    {
      key: 'numero',
      label: 'Numéro de commande',
      body: 'Présentez-vous à la caisse avec votre numéro de commande.',
    },
  ],
};
