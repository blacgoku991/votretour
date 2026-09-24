/**
 * Types des profils métier.
 *
 * Ce fichier ÉTEND les types de `lib/types.ts` sans les modifier : le
 * chantier Wallet touche la ligne voisine (`NotificationChannel`), et les
 * écrans des barbiers doivent pouvoir continuer à lire exactement les
 * mêmes structures. Toutes les clés ajoutées ici correspondent aux clés
 * JSON AJOUTÉES par la migration 0035 (sérialisation) : aucune n'est
 * retirée ni renommée, et l'App Clip déjà installé les ignore.
 */

import type {
  AbsentPolicy,
  AdvanceMode,
  ClientEntry,
  EntryPoint,
  EntryStatus,
  NotificationKind,
  QueueMode,
  QueueSnapshot,
  StaffEntry,
  StaffMember,
  TicketState,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Profils                                                              */
/* ------------------------------------------------------------------ */

/** Miroir de l'enum SQL `public.queue_profile` (migration 0032). */
export type QueueProfile = 'walkin' | 'vehicle' | 'device' | 'table' | 'desk' | 'retail' | 'event';

export const QUEUE_PROFILES: readonly QueueProfile[] = [
  'walkin', 'vehicle', 'device', 'table', 'desk', 'retail', 'event',
];

/** Miroir de l'enum SQL `public.activity_type` (0001, plus `event` en 0015). */
export type ActivityType =
  | 'barber' | 'hair_salon' | 'nail_bar' | 'beauty' | 'phone_repair' | 'garage'
  | 'auto_center' | 'shop' | 'aftersales' | 'restaurant' | 'counter'
  | 'admin_service' | 'health' | 'event' | 'other';

/**
 * Étapes d'un ticket. Une étape n'est PAS un statut : chacune correspond à
 * un statut existant (`StageDef.status`), si bien que la machine à états,
 * les index et l'App Clip installé ne voient rien de nouveau.
 */
export type ProfileStage =
  | 'received' | 'diagnosis' | 'quote_pending' | 'waiting_parts'
  | 'in_repair' | 'ready' | 'preparing';

/** Genres de notification : ceux d'aujourd'hui, plus les trois de 0032. */
export type ProfileNotificationKind = NotificationKind | 'stage_update' | 'quote_ready' | 'recall';

export const BASE_NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'ahead_two', 'ahead_one', 'your_turn', 'visit_completed', 'removed',
  'queue_closed', 'event_access', 'event_sold_out', 'event_ended', 'custom',
];

export const PROFILE_NOTIFICATION_KINDS: readonly ProfileNotificationKind[] = [
  ...BASE_NOTIFICATION_KINDS, 'stage_update', 'quote_ready', 'recall',
];

export function isBaseNotificationKind(kind: ProfileNotificationKind): kind is NotificationKind {
  return (BASE_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

/**
 * Teinte d'une étape, dans la palette du système : une seule couleur
 * forte (le vermillon), réservée à « Prêt ». Le devis attend le client
 * (cuivre), la pièce attend un fournisseur (ardoise), l'atelier travaille
 * (cobalt), le reste est neutre (os).
 */
export type StageTone = 'neutral' | 'cobalt' | 'copper' | 'ardoise' | 'signal';

/** Colonnes du poste atelier (planning d'atelier, § 4.2 de la conception). */
export type WorkshopColumn = 'intake' | 'workshop' | 'waiting' | 'ready';

export interface StageDef {
  key: ProfileStage;
  /** Statut existant auquel l'étape correspond (miroir de `internal.stage_status`). */
  status: EntryStatus;
  /** Libellé court, pour le rail d'étapes (« Devis »). */
  short: string;
  /** Ce que lit le client (« Devis à valider »). */
  client: string;
  /** Ce que lit le pro (« Devis envoyé »). */
  staff: string;
  /** La case « Prévenir le client » est-elle cochée par défaut ? */
  notifyDefault: boolean;
  /** Genre de notification envoyé si l'on prévient. */
  notifyKind: ProfileNotificationKind;
  /** Étape de détour : on peut la sauter (devis, pièce). */
  optional: boolean;
  tone: StageTone;
  /** Colonne du poste atelier ; null hors atelier. */
  column: WorkshopColumn | null;
}

/** Vocabulaire d'un profil (conception, § 3.5). */
export interface ProfileVocab {
  /** « véhicule » */
  subject: string;
  /** « véhicules » */
  subjectPlural: string;
  /** Genre grammatical du sujet, pour accorder « prêt » / « prête ». */
  subjectGender: 'm' | 'f';
  /** « fiche atelier », « dossier », « ticket », « commande » ; null s'il n'y en a pas. */
  dossier: string | null;
  /** Nom du point d'accueil (« Réception atelier »). */
  counter: string;
  /** Nom du poste qui sert (« Technicien », « Guichet »). */
  professional: string;
  /** Nom de la file (« Atelier », « Liste d'attente »). */
  queue: string;
  /** Touche d'ouverture (« Ouvrir les dépôts »). */
  openQueue: string;
  /** L'équivalent de TERMINER (« Rendu au client », « Installer »). */
  complete: string;
  /** L'équivalent de Démarrer (« Prendre en charge ») ; null si le profil n'en a pas. */
  start: string | null;
  /**
   * L'équivalent d'Appeler (« Prêt · prévenir », « Table prête · appeler »).
   * Espace INSÉCABLE avant « · » : une touche étroite coupe après le point,
   * jamais avant.
   */
  call: string;
  /** Compteur du jour (« rendus aujourd'hui »). */
  todayCounter: string;
  /** Ce que lit le client en attendant (« N groupes avant vous », « étape en cours »). */
  clientWaiting: string;
  /** Ce que lit le client à son tour (« Votre véhicule est prêt »). */
  clientTurn: string;
}

/** Numérotation des tickets (colonne `ticket_no`). */
export type TicketNumbering = 'none' | 'daily' | 'continuous';

/**
 * Réglages de file appliqués au passage dans le profil (miroir de
 * `internal.apply_profile_defaults`). Une clé absente = inchangée.
 */
export interface QueueDefaults {
  mode?: QueueMode;
  advanceMode?: AdvanceMode;
  askClientName?: boolean;
  clientNameRequired?: boolean;
  entryTtlMinutes?: number;
  absentPolicy?: AbsentPolicy;
  absentGraceMinutes?: number;
  allowServiceChoice?: boolean;
}

/** Modèle de message que le pro envoie en un geste (défaut du code). */
export interface TemplateDef {
  key: string;
  label: string;
  body: string;
}

export interface ProfileDefinition {
  id: QueueProfile;
  /** Nom du profil, tel que l'affichent Réglages et l'onboarding. */
  label: string;
  /** Une ligne qui dit ce qui avance dans la file. */
  tagline: string;
  /** Le client voit-il une position (« N personnes devant vous ») ? */
  usesPosition: boolean;
  /** Un même pro peut-il servir plusieurs tickets à la fois (ponts d'atelier) ? */
  parallel: boolean;
  /** Terminer appelle-t-il automatiquement le suivant ? */
  autoAdvance: boolean;
  /** Étapes dans l'ordre canonique ; vide si le profil n'en a pas. */
  stages: readonly StageDef[];
  /** Étape posée à l'inscription (miroir de `internal.initial_stage`). */
  initialStage: ProfileStage | null;
  numbering: TicketNumbering;
  vocab: ProfileVocab;
  queueDefaults: QueueDefaults;
  /** Prestations (motifs) créées par défaut (conception, § 11.2). */
  defaultServices: readonly string[];
  templates: readonly TemplateDef[];
}

/* ------------------------------------------------------------------ */
/* Détails d'un ticket (colonne `details`, jsonb validé par profil)     */
/* ------------------------------------------------------------------ */

export type RegistrationCountry = 'FR' | 'other';
export type StayChoice = 'away' | 'onsite';
export type DeviceKind = 'phone' | 'tablet' | 'computer' | 'console' | 'watch' | 'other';
export type DeviceAccessory = 'charger' | 'case' | 'sim_removed' | 'memory_card' | 'box';
export type TableSeating = 'any' | 'indoor' | 'terrace';
export type TableNeed = 'highchair' | 'accessible';
export type QuoteDecision = 'accepted' | 'declined';

export interface QuoteDetails {
  amountCents: number;
  label: string;
  sentAt: string;
  decision: QuoteDecision | null;
  decidedAt: string | null;
}

export interface VehicleDetails {
  registration?: string;
  country?: RegistrationCountry;
  model?: string;
  reasonText?: string;
  stay?: StayChoice;
  keys?: boolean;
  readyEta?: string | null;
  quote?: QuoteDetails;
}

export interface DeviceDetails {
  deviceKind?: DeviceKind;
  model?: string;
  reasonText?: string;
  accessories?: DeviceAccessory[];
  readyEta?: string | null;
  quote?: QuoteDetails;
}

export interface TableDetails {
  partySize?: number;
  seating?: TableSeating;
  needs?: TableNeed[];
}

export interface RetailDetails {
  orderRef?: string;
}

/** Union lâche : ce que la base peut renvoyer, tous profils confondus. */
export type EntryDetails = VehicleDetails & DeviceDetails & TableDetails & RetailDetails;

/* ------------------------------------------------------------------ */
/* Options de profil (colonne `queues.profile_options`)                 */
/* ------------------------------------------------------------------ */

export type TvRegistrationMode = 'masked' | 'model_only' | 'none';

export interface ProfileOptions {
  stayChoice?: boolean;
  registrationRequired?: boolean;
  tvRegistration?: TvRegistrationMode;
  quotes?: boolean;
  partyMax?: number;
  tableSizes?: number[];
  /** 0 = immédiat ; null = jamais ; sinon 30 à 240 min. */
  reviewDelayMinutes?: number | null;
  numbering?: boolean;
  sensitive?: boolean;
  review?: boolean;
}

/** Sous-ensemble des options exposé au client (`publicOptions`, 0035). */
export interface PublicProfileOptions {
  partyMax?: number;
  stayChoice?: boolean;
  numbering?: boolean;
  sensitive?: boolean;
  quotes?: boolean;
}

/* ------------------------------------------------------------------ */
/* Clés JSON ajoutées par 0035 (lecture seule pour l'existant)          */
/* ------------------------------------------------------------------ */

/** Horaires du jour dans le fuseau de l'établissement (`internal.today_hours`). */
export interface TodayHours {
  /** « HH:MM » ; null si fermé toute la journée. */
  opensAt: string | null;
  closesAt: string | null;
}

export interface ClientQuote {
  amountCents: number;
  label: string;
  decision: QuoteDecision | null;
}

export interface ProfileClientEntry extends ClientEntry {
  profile: QueueProfile;
  stage: ProfileStage | null;
  stageChangedAt: string | null;
  /** Déjà formaté en SQL (« A-042 », « 0042 ») ; null sans numérotation. */
  ticketNo: string | null;
  /** Les détails de SON ticket ; le devis y est réduit à montant, libellé et décision. */
  details: Omit<EntryDetails, 'quote'> & { quote?: ClientQuote };
  deskLabel: string | null;
  readyEta: string | null;
}

export interface ProfileTicketState extends Omit<TicketState, 'entry' | 'queue' | 'location'> {
  entry: ProfileClientEntry;
  queue: TicketState['queue'] & {
    profile: QueueProfile;
    ticketPrefix: string;
    publicOptions: PublicProfileOptions;
  };
  location: TicketState['location'] & { todayHours: TodayHours | null };
  /** Historique des étapes de CE ticket, lu dans `queue_events`. */
  stages: { stage: ProfileStage; at: string }[];
  /** Autres fiches actives du même appareil (un client, deux véhicules). */
  otherTickets: { id: string; model: string | null; stage: ProfileStage | null }[];
}

export interface ProfileStaffEntry extends StaffEntry {
  stage: ProfileStage | null;
  stageChangedAt: string | null;
  details: EntryDetails;
  ticketNo: string | null;
  registrationKey: string | null;
  /** Un QR de suivi attend d'être scanné ; jamais le hash lui-même. */
  claimPending: boolean;
  deskLabel: string | null;
}

export interface ProfileQueueSnapshot extends Omit<QueueSnapshot, 'queue' | 'serving' | 'called' | 'waiting' | 'parked' | 'staff' | 'counts'> {
  queue: QueueSnapshot['queue'] & {
    profile: QueueProfile;
    profileOptions: ProfileOptions;
    ticketPrefix: string;
  };
  serving: ProfileStaffEntry[];
  called: ProfileStaffEntry[];
  waiting: ProfileStaffEntry[];
  parked: ProfileStaffEntry[];
  staff: (StaffMember & { deskLabel: string | null })[];
  counts: QueueSnapshot['counts'] & {
    byStage?: Partial<Record<ProfileStage, number>>;
    coversWaiting?: number;
    coversSeatedToday?: number;
  };
}

export interface ProfileEntryPoint extends Omit<EntryPoint, 'queue'> {
  queue: (NonNullable<EntryPoint['queue']> & {
    profile: QueueProfile;
    publicOptions: PublicProfileOptions;
  }) | null;
}
