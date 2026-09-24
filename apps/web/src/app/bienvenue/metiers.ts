/**
 * L'ONBOARDING PAR MÉTIER — la logique pure, sans hook ni accès réseau.
 *
 * Décision du propriétaire : le commerçant DÉCLARE son activité (la grille
 * de métiers), mais il ne choisit pas son métier. Sa file naît TOUJOURS au
 * passage (walkin) ; l'équipe Rangvia active l'interface de son métier
 * (atelier, table, guichet…) lors de l'installation, depuis l'espace
 * super-admin. Rien, dans ce parcours, ne promet donc un écran de métier.
 *
 * Trois décisions vivent ici, et seulement ici, pour être testées sans
 * navigateur (`tests/onboarding-profiles.test.ts`) et partagées par la
 * page, le parcours et l'action serveur :
 *
 *  1. le paramètre `?activite=` : une LISTE BLANCHE (`activite.ts`) ;
 *  2. ce que la base reçoit : l'activité déclarée, telle quelle, et une
 *     file au passage (la migration 0042 le garantit aussi en SQL) ;
 *  3. les textes du parcours : ceux d'avant les profils, mot pour mot,
 *     plus une phrase honnête pour un métier que l'équipe installera.
 */

import { ACTIVITY_LABEL } from '@/lib/copy';
import { ACTIVITY_PROFILE, isLegacyProfile, NO_REVIEW_ACTIVITIES } from '@/lib/profiles';
import type { ActivityType, QueueProfile } from '@/lib/profiles/types';

export { parseActivityParam } from './activite';

/** L'activité proposée à l'arrivée : celle de l'URL si elle est valide, sinon « Barbier ». */
export const DEFAULT_ACTIVITY: ActivityType = 'barber';

/* ------------------------------------------------------------------ */
/* 2. Activité déclarée → ce que la base reçoit                         */
/* ------------------------------------------------------------------ */

export interface OnboardingProfileChoice {
  /** Le métier qui correspond à l'activité (`ACTIVITY_PROFILE`) : l'équipe l'activera. */
  target: QueueProfile;
  /** Le profil provisionné : toujours le passage. */
  profile: 'walkin';
  /** L'activité passée à `provision_organization` : la déclaration, telle quelle. */
  provisionActivity: ActivityType;
  /** L'équipe Rangvia a une interface de métier à activer pour cette activité. */
  installedByTeam: boolean;
}

export function onboardingProfile(activity: ActivityType): OnboardingProfileChoice {
  const target = ACTIVITY_PROFILE[activity];
  // `event` garde l'écran d'aujourd'hui (son module Événements) : rien à installer.
  return { target, profile: 'walkin', provisionActivity: activity, installedByTeam: !isLegacyProfile(target) };
}

/** La phrase honnête, à la place de tout aperçu de métier. */
export const INSTALL_NOTE = 'L’équipe Rangvia active l’interface de votre métier lors de l’installation.';

/**
 * La phrase à montrer pour cette activité : seulement si elle a un métier
 * propre (garage, réparation, restaurant, guichet, boutique). Un barbier,
 * un salon, un événement, « Autre » : rien, leur écran reste celui d'aujourd'hui.
 */
export function metierInstallNote(activity: ActivityType): string | null {
  return onboardingProfile(activity).installedByTeam ? INSTALL_NOTE : null;
}

/** Pas de demande d'avis par défaut (santé, service administratif). */
export function reviewOffByDefault(activity: ActivityType): boolean {
  return NO_REVIEW_ACTIVITIES.has(activity);
}

/* ------------------------------------------------------------------ */
/* 3. La grille de métiers                                              */
/* ------------------------------------------------------------------ */

export interface MetierFamily {
  id: string;
  label: string;
  activities: readonly ActivityType[];
}

/**
 * Les métiers, regroupés par famille. L'ordre est celui de la grille : il
 * se lit aussi bien en lignes (ordinateur, une famille par ligne) qu'en
 * paires (téléphone, deux tuiles par ligne). Chaque code de
 * `ACTIVITY_LABEL` y figure exactement une fois (vérifié par test).
 */
export const METIER_FAMILIES: readonly MetierFamily[] = [
  { id: 'beaute', label: 'Beauté et coiffure', activities: ['barber', 'hair_salon', 'nail_bar', 'beauty'] },
  { id: 'automobile', label: 'Automobile', activities: ['garage', 'auto_center'] },
  { id: 'reparation', label: 'Réparation et SAV', activities: ['phone_repair', 'aftersales'] },
  { id: 'restauration', label: 'Restauration', activities: ['restaurant'] },
  { id: 'guichet', label: 'Guichet et santé', activities: ['counter', 'admin_service', 'health'] },
  { id: 'boutique', label: 'Boutique', activities: ['shop'] },
  { id: 'autre', label: 'Événement et autres', activities: ['event', 'other'] },
];

/** Libellé d'une tuile : celui de `ACTIVITY_LABEL`, source unique des noms de métier. */
export function metierLabel(activity: ActivityType): string {
  return ACTIVITY_LABEL[activity] ?? activity;
}

/**
 * Exemples des champs « Nom du commerce » et « Nom de l'établissement ».
 * Ce sont des indications (placeholder), jamais des valeurs envoyées. Le
 * barbier garde exactement les siennes.
 */
const SAMPLE_NAME: Readonly<Record<ActivityType, string>> = {
  barber: 'Barber House',
  hair_salon: 'Salon Colette',
  nail_bar: 'Studio Ongles',
  beauty: 'Institut Rose',
  garage: 'Garage Martin',
  auto_center: 'Centre Auto Lumière',
  phone_repair: 'Répar’Express',
  aftersales: 'SAV Électro',
  restaurant: 'Chez Margaux',
  counter: 'Point Relais Voltaire',
  admin_service: 'Maison des services',
  health: 'Laboratoire Pasteur',
  shop: 'La Mercerie',
  event: 'Drop Session',
  other: 'Votre commerce',
};

const SAMPLE_PLACE: Readonly<Record<ActivityType, string>> = {
  barber: 'Paris 11',
  hair_salon: 'Nantes',
  nail_bar: 'Lille',
  beauty: 'Bordeaux',
  garage: 'Lyon 7',
  auto_center: 'Villeurbanne',
  phone_repair: 'Marseille 6',
  aftersales: 'Toulouse',
  restaurant: 'Rennes',
  counter: 'Paris 11',
  admin_service: 'Montreuil',
  health: 'Grenoble',
  shop: 'Strasbourg',
  event: 'Paris 3',
  other: 'Centre-ville',
};

export function samplePlaceholders(activity: ActivityType): { organization: string; location: string } {
  const name = SAMPLE_NAME[activity];
  return { organization: name, location: `${name} — ${SAMPLE_PLACE[activity]}` };
}

/* ------------------------------------------------------------------ */
/* 4. Les textes du parcours                                            */
/* ------------------------------------------------------------------ */

/**
 * Les textes du parcours et de l'écran final. Une seule version, celle
 * d'avant les profils, mot pour mot : la file créée est toujours au
 * passage, quel que soit le métier déclaré.
 */
export interface OnboardingCopy {
  /** Ce que l'on crée. */
  target: string;
  /** « avant votre file » : suit le volet de la colonne de progression. */
  remainingTarget: string;
  /** Dernière touche du parcours. */
  createCta: string;
  /** L'étape « File » (commune ou par professionnel). */
  asksQueueMode: boolean;
  /** Libellé de l'étape Équipe dans le rail. */
  teamStep: string;
  teamTitle: string;
  teamLead: string;
  /** Indication du champ n (0 = le premier). */
  teamPlaceholder: (index: number) => string;
  /** Nom accessible du champ n. */
  teamFieldLabel: (index: number) => string;
  /** Nom accessible de « Retirer » sur la ligne n. */
  teamRemoveLabel: (index: number) => string;
  teamAdd: string;
  /** Titre de l'écran final. */
  readyTitle: string;
  /** Touche d'ouverture de l'écran final. */
  openNow: string;
  openPending: string;
  /** Bandeau une fois ouvert. */
  openedBanner: string;
  /** Étape Avis : quand le remerciement part. */
  reviewLead: string;
}

export const ONBOARDING_COPY: OnboardingCopy = {
  target: 'votre file',
  remainingTarget: 'avant votre file',
  createCta: 'Créer ma file',
  asksQueueMode: true,
  teamStep: 'Équipe',
  teamTitle: 'Qui travaille ici ?',
  teamLead:
    'Un prénom suffit. Vous pourrez en ajouter à tout moment — et ils n’ont pas besoin de compte pour apparaître dans la file.',
  teamPlaceholder: (i) => (i === 0 ? 'Vous' : `Professionnel ${i + 1}`),
  teamFieldLabel: (i) => `Professionnel ${i + 1}`,
  teamRemoveLabel: (i) => `Retirer le professionnel ${i + 1}`,
  teamAdd: 'Ajouter un professionnel',
  readyTitle: 'Votre file est prête',
  openNow: 'Ouvrir la file maintenant',
  openPending: 'Ouverture…',
  openedBanner: 'La file est ouverte. Vos clients peuvent scanner.',
  reviewLead:
    'À la fin de chaque passage, le client reçoit un remerciement avec un bouton qui ouvre directement ce lien. C’est proposé à tout le monde, sans filtrage.',
};
