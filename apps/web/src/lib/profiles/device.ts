import { WORKSHOP_STAGES } from './stages';
import type { ProfileDefinition } from './types';

/**
 * ATELIER APPAREIL ET SAV — réparation de téléphones, service après-vente.
 *
 * Même moteur et mêmes étapes que l'atelier véhicule. Deux différences :
 * un numéro de dossier continu (« Dossier 0042 », jamais remis à zéro,
 * que le client, la TV et le pro partagent), et une règle de sécurité :
 * le code de déverrouillage n'est JAMAIS demandé.
 */
export const device: ProfileDefinition = {
  id: 'device',
  label: 'Atelier appareil',
  tagline: 'L’appareil a un numéro de dossier et avance d’étape en étape.',
  usesPosition: false,
  parallel: true,
  autoAdvance: false,
  stages: WORKSHOP_STAGES,
  initialStage: 'received',
  numbering: 'continuous',
  vocab: {
    subject: 'appareil',
    subjectPlural: 'appareils',
    subjectGender: 'm',
    dossier: 'dossier',
    counter: 'Comptoir',
    professional: 'Technicien',
    queue: 'Atelier',
    openQueue: 'Ouvrir les dépôts',
    complete: 'Rendu au client',
    start: 'Prendre en charge',
    call: 'Prêt\u00a0· prévenir',
    todayCounter: 'rendus aujourd’hui',
    clientWaiting: 'étape en cours',
    clientTurn: 'Votre appareil est prêt',
  },
  queueDefaults: {
    mode: 'shared',
    advanceMode: 'call_next',
    askClientName: true,
    clientNameRequired: false,
    entryTtlMinutes: 10_080,
    // Un appareil non récupéré ne « recule » pas : il attend son client.
    absentPolicy: 'hold',
    allowServiceChoice: true,
  },
  defaultServices: ['Écran', 'Batterie', 'Connecteur de charge', 'Oxydation', 'Caméra', 'Autre'],
  templates: [
    { key: 'retard', label: 'Retard', body: 'Petit retard : votre appareil sera prêt demain.' },
    { key: 'rappel', label: 'Nous rappeler', body: 'Pouvez-vous nous rappeler au {telephone_etablissement} ?' },
    { key: 'piece_recue', label: 'Pièce reçue', body: 'La pièce est arrivée : la réparation reprend.' },
    {
      key: 'fermeture',
      label: 'Fermeture',
      body: 'Nous fermons à {heure_fermeture}. Votre appareil vous attend demain dès {heure_ouverture}.',
    },
    { key: 'devis_maj', label: 'Devis mis à jour', body: 'Le devis a été mis à jour : touchez pour le consulter.' },
    {
      key: 'fausse_alerte',
      label: 'Fausse alerte',
      body: 'Désolé, fausse alerte : votre appareil n’est pas encore prêt. Nous vous prévenons dès qu’il l’est.',
    },
  ],
};
