import { WORKSHOP_STAGES } from './stages';
import type { ProfileDefinition } from './types';

/**
 * ATELIER VÉHICULE — garages et centres auto.
 *
 * Ce qui avance, c'est le véhicule, et il est prêt DANS LE DÉSORDRE : un
 * mécanicien a trois voitures sur les ponts. Il n'y a donc ni position
 * montrée au client (sauf à l'étape « Reçu »), ni « suivant » automatique,
 * ni limite d'un ticket servi par technicien. Une réparation dure souvent
 * plusieurs jours : la fiche vit une semaine (10 080 min), comptée depuis
 * le dernier changement d'étape.
 */
export const vehicle: ProfileDefinition = {
  id: 'vehicle',
  label: 'Atelier véhicule',
  tagline: 'Le véhicule avance d’étape en étape, et il est prêt quand il est prêt.',
  usesPosition: false,
  parallel: true,
  autoAdvance: false,
  stages: WORKSHOP_STAGES,
  initialStage: 'received',
  numbering: 'none',
  vocab: {
    subject: 'véhicule',
    subjectPlural: 'véhicules',
    subjectGender: 'm',
    dossier: 'fiche atelier',
    counter: 'Réception atelier',
    professional: 'Technicien',
    queue: 'Atelier',
    openQueue: 'Ouvrir les dépôts',
    complete: 'Rendu au client',
    start: 'Prendre en charge',
    call: 'Prêt\u00a0· prévenir',
    todayCounter: 'rendus aujourd’hui',
    clientWaiting: 'étape en cours',
    clientTurn: 'Votre véhicule est prêt',
  },
  queueDefaults: {
    mode: 'shared',
    advanceMode: 'call_next',
    askClientName: true,
    clientNameRequired: false,
    entryTtlMinutes: 10_080,
    // Un véhicule non récupéré ne « recule » pas : il attend son client.
    absentPolicy: 'hold',
    allowServiceChoice: true,
  },
  defaultServices: ['Vidange', 'Pneus', 'Freins', 'Diagnostic', 'Carrosserie', 'Climatisation', 'Autre'],
  templates: [
    { key: 'retard', label: 'Retard', body: 'Petit retard : votre véhicule sera prêt demain matin.' },
    { key: 'rappel', label: 'Nous rappeler', body: 'Pouvez-vous nous rappeler au {telephone_etablissement} ?' },
    { key: 'cles', label: 'Clés à l’accueil', body: 'Vos clés sont disponibles à l’accueil.' },
    {
      key: 'fermeture',
      label: 'Fermeture',
      body: 'Nous fermons à {heure_fermeture}. Votre véhicule vous attend demain dès {heure_ouverture}.',
    },
    { key: 'devis_maj', label: 'Devis mis à jour', body: 'Le devis a été mis à jour : touchez pour le consulter.' },
    {
      key: 'fausse_alerte',
      label: 'Fausse alerte',
      body: 'Désolé, fausse alerte : votre véhicule n’est pas encore prêt. Nous vous prévenons dès qu’il l’est.',
    },
  ],
};
