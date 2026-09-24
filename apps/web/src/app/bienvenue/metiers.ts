/**
 * L'ONBOARDING PAR MÉTIER — la logique pure, sans hook ni accès réseau.
 *
 * Trois décisions vivent ici, et seulement ici, pour être testées sans
 * navigateur (`tests/onboarding-profiles.test.ts`) et partagées par la
 * page, le parcours et l'action serveur :
 *
 *  1. le paramètre `?activite=` : une LISTE BLANCHE (`ACTIVITY_LABEL`),
 *     rien d'autre n'est repris de l'URL ; une valeur inconnue est ignorée ;
 *  2. le profil qu'obtient un métier à l'inscription : celui de son
 *     activité (`ACTIVITY_PROFILE`) s'il est OUVERT à tout nouveau compte
 *     (`OPEN_PROFILES`), sinon `walkin`, le produit d'aujourd'hui ;
 *  3. les textes du parcours selon ce profil. En walkin et en event, ce
 *     sont EXACTEMENT les textes d'avant les profils : un barbier ne voit
 *     rien changer.
 *
 * L'ensemble des profils ouverts est toujours passé en argument (avec
 * `OPEN_PROFILES` par défaut) : les tests simulent ainsi l'ouverture d'un
 * profil sans toucher à `lib/profiles/capabilities.ts`, que seul un lot
 * d'ouverture modifie.
 */

import { ACTIVITY_LABEL } from '@/lib/copy';
import { OPEN_PROFILES } from '@/lib/profiles/capabilities';
import { ACTIVITY_PROFILE, NO_REVIEW_ACTIVITIES, getProfile, isActivityType } from '@/lib/profiles';
import type { ActivityType, QueueProfile } from '@/lib/profiles/types';

/* ------------------------------------------------------------------ */
/* 1. Le paramètre ?activite=                                           */
/* ------------------------------------------------------------------ */

/**
 * Lit `?activite=` sur liste blanche. Seule une chaîne qui est EXACTEMENT
 * un code de `ACTIVITY_LABEL` est retenue ; tout le reste (inconnu, vide,
 * répété, casse différente) est ignoré, sans erreur : le parcours démarre
 * alors comme d'habitude, sur « Barbier ».
 */
export function parseActivityParam(value: string | string[] | undefined | null): ActivityType | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  if (!Object.prototype.hasOwnProperty.call(ACTIVITY_LABEL, code)) return null;
  return isActivityType(code) ? code : null;
}

/** L'activité proposée à l'arrivée : celle de l'URL si elle est valide, sinon « Barbier ». */
export const DEFAULT_ACTIVITY: ActivityType = 'barber';

/* ------------------------------------------------------------------ */
/* 2. Activité → profil                                                 */
/* ------------------------------------------------------------------ */

export interface OnboardingProfileChoice {
  /** Le profil du métier (`ACTIVITY_PROFILE`). */
  target: QueueProfile;
  /** Le profil réellement provisionné : `target` s'il est ouvert, sinon `walkin`. */
  profile: QueueProfile;
  /** Le profil du métier est-il ouvert à tout nouveau compte ? */
  open: boolean;
  /**
   * L'activité passée à `provision_organization`, et gardée ensuite par
   * l'organisation. Pour un métier dont le profil n'est pas encore ouvert,
   * c'est `other` : la base suit alors EXACTEMENT le chemin d'un barbier
   * (file walkin, réglages par défaut des colonnes, aucune prestation
   * créée, mode de file choisi conservé).
   *
   * L'activité réelle n'est PAS inscrite sur l'organisation dans ce cas :
   * `create_location` (0037) la relit pour chaque nouvel établissement
   * (« Ajouter un établissement » l'appelle avec `p_activity: null`), et un
   * garage non ouvert verrait son deuxième établissement naître en
   * `vehicle`, avec ses motifs — l'exposition prématurée que la garantie
   * n° 12 du plan interdit. Le métier choisi reste lisible dans le journal
   * (`onboarding.completed`, `metadata.activity`), et l'exploitant peut
   * l'inscrire depuis l'administration.
   */
  provisionActivity: ActivityType;
}

export function onboardingProfile(
  activity: ActivityType,
  openProfiles: ReadonlySet<QueueProfile> = OPEN_PROFILES,
): OnboardingProfileChoice {
  const target = ACTIVITY_PROFILE[activity];
  const open = openProfiles.has(target);
  const profile: QueueProfile = open ? target : 'walkin';
  // `other` est lui-même walkin : c'est le seul code neutre de l'enum.
  const provisionActivity: ActivityType = open ? activity : 'other';
  return { target, profile, open, provisionActivity };
}

/**
 * Le métier a-t-il un APERÇU ? Seulement si son profil est ouvert et
 * différent du parcours d'aujourd'hui : un barbier garde son écran tel
 * quel, un garage dont le profil n'est pas ouvert ne voit rien qu'il ne
 * trouverait pas en s'inscrivant.
 */
export function hasProfilePreview(profile: QueueProfile): profile is PreviewProfile {
  return profile !== 'walkin' && profile !== 'event';
}

export type PreviewProfile = Exclude<QueueProfile, 'walkin' | 'event'>;

/** Un métier représentatif de chaque profil à aperçu, pour l'invitation ci-dessous. */
const PREVIEW_EXAMPLE: Readonly<Record<PreviewProfile, string>> = {
  vehicle: 'garage',
  device: 'réparation',
  table: 'restaurant',
  desk: 'guichet',
  retail: 'boutique',
};
const PREVIEW_ORDER: readonly PreviewProfile[] = ['vehicle', 'device', 'table', 'desk', 'retail'];

/**
 * L'invitation affichée à la place de l'aperçu quand le métier choisi n'en
 * a pas (barbier, événement…). Elle ne cite QUE des métiers dont le profil
 * est ouvert : aucune promesse d'un écran qu'on ne trouverait pas en
 * s'inscrivant. `null` si aucun profil à aperçu n'est ouvert.
 */
export function previewInvitation(openProfiles: ReadonlySet<QueueProfile> = OPEN_PROFILES): string | null {
  const examples = PREVIEW_ORDER.filter((p) => openProfiles.has(p)).map((p) => PREVIEW_EXAMPLE[p]);
  if (examples.length === 0) return null;
  const list = examples.join(', ');
  return `${list.charAt(0).toUpperCase()}${list.slice(1)}\u00a0: choisissez votre métier, et voyez ici le téléphone de vos clients et l’écran de la salle.`;
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
/* 4. Les textes du parcours, selon le profil provisionné               */
/* ------------------------------------------------------------------ */

export interface OnboardingCopy {
  /** Ce que l'on crée : « votre file », « votre atelier », « vos guichets »… */
  target: string;
  /** « avant votre file » : suit le volet de la colonne de progression. */
  remainingTarget: string;
  /** Dernière touche du parcours. */
  createCta: string;
  /** L'étape « File » (commune ou par professionnel) : walkin et event seulement. */
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
  /** Les fiches créées portent-elles un libellé de guichet (`staff.desk_label`) ? */
  teamIsDesk: boolean;
  /** Titre de l'écran final. */
  readyTitle: string;
  /** Touche d'ouverture de l'écran final. */
  openNow: string;
  openPending: string;
  /** Bandeau une fois ouvert. */
  openedBanner: string;
  /** Scénario d'essai propre au métier ; vide en walkin et en event. */
  trial: readonly string[];
  /** Étape Avis : quand le remerciement part, dans les mots du métier. */
  reviewLead: string;
}

/** Le texte de l'étape Avis, dont seul le moment change selon le métier. */
function reviewLead(moment: string): string {
  return `${moment}, le client reçoit un remerciement avec un bouton qui ouvre directement ce lien. C’est proposé à tout le monde, sans filtrage.`;
}

const LEGACY_COPY: OnboardingCopy = {
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
  teamIsDesk: false,
  readyTitle: 'Votre file est prête',
  openNow: 'Ouvrir la file maintenant',
  openPending: 'Ouverture…',
  openedBanner: 'La file est ouverte. Vos clients peuvent scanner.',
  trial: [],
  reviewLead: reviewLead('À la fin de chaque passage'),
};

/**
 * « Prêt · prévenir » : les touches citées sont celles du vocabulaire du
 * profil (§ 0.8 du plan). Une touche citée ne se coupe jamais : toutes ses
 * espaces deviennent insécables, guillemets compris, pour ne laisser ni
 * « Prêt · » en fin de ligne ni « » » seul au début de la suivante.
 */
export const quoted = (label: string) => `«\u00a0${label.replace(/ /g, '\u00a0')}\u00a0»`;

export function onboardingCopy(profile: QueueProfile): OnboardingCopy {
  const vocab = getProfile(profile).vocab;
  switch (profile) {
    case 'vehicle':
      return {
        ...LEGACY_COPY,
        target: 'votre atelier',
        remainingTarget: 'avant votre atelier',
        createCta: 'Créer mon atelier',
        teamRemoveLabel: (i) => `Retirer le technicien ${i + 1}`,
        asksQueueMode: false,
        teamTitle: 'Qui travaille à l’atelier ?',
        teamLead:
          'Un prénom par technicien. Vous pourrez en ajouter à tout moment, sans leur créer de compte.',
        teamPlaceholder: (i) => (i === 0 ? 'Vous' : `Technicien ${i + 1}`),
        teamFieldLabel: (i) => `Technicien ${i + 1}`,
        teamAdd: 'Ajouter un technicien',
        readyTitle: 'Votre atelier est prêt',
        openNow: `${vocab.openQueue} maintenant`,
        openedBanner: 'Les dépôts sont ouverts. Vos clients peuvent scanner.',
        trial: [
          'Scannez la plaque avec votre téléphone et déposez un véhicule test.',
          `Sur le poste, passez-le en réparation, puis ${quoted(vocab.call)}.`,
          'Regardez votre téléphone.',
        ],
        reviewLead: reviewLead('À la remise du véhicule'),
      };
    case 'device':
      return {
        ...LEGACY_COPY,
        target: 'votre atelier',
        remainingTarget: 'avant votre atelier',
        createCta: 'Créer mon atelier',
        teamRemoveLabel: (i) => `Retirer le technicien ${i + 1}`,
        asksQueueMode: false,
        teamTitle: 'Qui répare à l’atelier ?',
        teamLead:
          'Un prénom par technicien. Vous pourrez en ajouter à tout moment, sans leur créer de compte.',
        teamPlaceholder: (i) => (i === 0 ? 'Vous' : `Technicien ${i + 1}`),
        teamFieldLabel: (i) => `Technicien ${i + 1}`,
        teamAdd: 'Ajouter un technicien',
        readyTitle: 'Votre atelier est prêt',
        openNow: `${vocab.openQueue} maintenant`,
        openedBanner: 'Les dépôts sont ouverts. Vos clients peuvent scanner.',
        trial: [
          'Scannez la plaque avec votre téléphone et déposez un appareil test.',
          `Sur le poste, passez-le en réparation, puis ${quoted(vocab.call)}.`,
          'Regardez votre téléphone.',
        ],
        reviewLead: reviewLead('À la remise de l’appareil'),
      };
    case 'table':
      return {
        ...LEGACY_COPY,
        target: 'votre salle',
        remainingTarget: 'avant votre salle',
        createCta: 'Créer ma liste d’attente',
        teamRemoveLabel: (i) => `Retirer la personne ${i + 1}`,
        asksQueueMode: false,
        teamStep: 'Accueil',
        teamTitle: 'Qui gère l’accueil ?',
        teamLead:
          'Facultatif : un prénom par personne à l’accueil. Vous pourrez en ajouter à tout moment, sans leur créer de compte.',
        teamPlaceholder: (i) => (i === 0 ? 'Vous' : `Accueil ${i + 1}`),
        teamFieldLabel: (i) => `Personne à l’accueil ${i + 1}`,
        teamAdd: 'Ajouter une personne',
        readyTitle: 'Votre salle est prête',
        openNow: `${vocab.openQueue} maintenant`,
        openedBanner: 'La liste est ouverte. Vos clients peuvent scanner.',
        trial: [
          'Scannez la plaque avec votre téléphone et inscrivez-vous pour 4 couverts.',
          `Sur le poste, touchez ${quoted(vocab.call)}.`,
          `Regardez votre téléphone, puis ${quoted(vocab.complete)} sur le poste.`,
        ],
        reviewLead: reviewLead('Un peu après le repas'),
      };
    case 'desk':
      return {
        ...LEGACY_COPY,
        target: 'vos guichets',
        remainingTarget: 'avant vos guichets',
        createCta: 'Créer mes guichets',
        teamRemoveLabel: (i) => `Retirer le guichet ${i + 1}`,
        asksQueueMode: false,
        teamStep: 'Guichets',
        teamTitle: 'Vos guichets',
        teamLead:
          'Un guichet par ligne : c’est ce que lira la personne appelée, sur son téléphone et sur l’écran de la salle.',
        teamPlaceholder: (i) => `Guichet ${i + 1}`,
        teamFieldLabel: (i) => `Guichet ${i + 1}`,
        teamAdd: 'Ajouter un guichet',
        teamIsDesk: true,
        readyTitle: 'Vos guichets sont prêts',
        openNow: `${vocab.openQueue} maintenant`,
        openedBanner: 'Les guichets sont ouverts. Vos visiteurs peuvent scanner.',
        trial: [
          'Scannez la plaque avec votre téléphone et prenez un ticket.',
          `Sur le poste, touchez ${quoted(vocab.call)}.`,
          'Regardez votre téléphone : votre numéro, puis votre guichet.',
        ],
        reviewLead: reviewLead('À la fin de chaque passage au guichet'),
      };
    case 'retail':
      return {
        ...LEGACY_COPY,
        target: 'votre boutique',
        remainingTarget: 'avant votre boutique',
        createCta: 'Créer ma file',
        teamRemoveLabel: (i) => `Retirer le vendeur ${i + 1}`,
        asksQueueMode: false,
        teamTitle: 'Qui vend ici ?',
        teamLead:
          'Un prénom par vendeur. Vous pourrez en ajouter à tout moment, sans leur créer de compte.',
        teamPlaceholder: (i) => (i === 0 ? 'Vous' : `Vendeur ${i + 1}`),
        teamFieldLabel: (i) => `Vendeur ${i + 1}`,
        teamAdd: 'Ajouter un vendeur',
        readyTitle: 'Votre boutique est prête',
        openNow: `${vocab.openQueue} maintenant`,
        trial: [
          `Scannez la plaque avec votre téléphone et choisissez ${quoted('Retirer une commande')}.`,
          `Sur le poste, touchez ${quoted(vocab.call)}.`,
          'Regardez votre téléphone.',
        ],
        reviewLead: reviewLead('Une fois la commande retirée'),
      };
    default:
      // walkin, event : le parcours d'aujourd'hui, mot pour mot.
      return LEGACY_COPY;
  }
}
