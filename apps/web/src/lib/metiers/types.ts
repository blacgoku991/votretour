/**
 * Types du REGISTRE DES MÉTIERS — le contenu des pages `/pour/[metier]`.
 *
 * Une page métier est une promesse faite à un professionnel qui ne nous
 * connaît pas encore. Elle ne dit donc que ce qu'il trouvera en créant son
 * compte AUJOURD'HUI. Tout bloc qui dépend d'une fonctionnalité pas encore
 * ouverte à tous déclare `requires` : il n'est rendu que si la capacité
 * est livrée (`lib/metiers/capabilities.ts`). S'il porte un `fallback`,
 * c'est la version « vraie aujourd'hui » qui s'affiche à sa place.
 *
 * Deux familles de types :
 *  - le REGISTRE (`Metier`), écrit une fois, avec ses conditions ;
 *  - la PAGE (`MetierPage`), produite par `renderable()` (select.ts) :
 *    plus aucune condition, seulement du texte à afficher. Un composant
 *    de page ne reçoit que ce second type : il ne peut pas, par
 *    inadvertance, afficher un bloc conditionné.
 */

import type { ProfileCapability } from '@/lib/profiles/capabilities';
import type { ActivityType, ProfileOptions, QueueProfile } from '@/lib/profiles/types';

/* ------------------------------------------------------------------ */
/* Capacités                                                            */
/* ------------------------------------------------------------------ */

/**
 * Capacités du produit d'aujourd'hui (walkin et événements), vérifiées
 * une à une dans le code. La liste des capacités LIVRÉES est `CORE`
 * (capabilities.ts) : un nom qui figure ici sans figurer dans `CORE`
 * désigne une fonctionnalité qui existe dans le moteur mais pas encore en
 * libre-service (voir le commentaire de `CORE`).
 */
export type CoreCapability =
  | 'core.join_qr_nfc'
  | 'core.position_live'
  | 'core.web_push'
  | 'core.back_button'
  | 'core.client_leave'
  | 'core.absent_policy'
  | 'core.walkin'
  | 'core.per_staff'
  | 'core.staff_choice'
  | 'core.service_choice'
  | 'core.staff_break'
  | 'core.queue_pause'
  | 'core.call_next'
  | 'core.expiry'
  | 'core.tv_screen'
  | 'core.google_review'
  | 'core.stats'
  | 'core.history'
  | 'core.multi_location'
  | 'core.retention_purge'
  | 'core.multi_queue'
  | 'core.capacity_cap'
  | 'core.service_on_board'
  | 'events.waves'
  | 'events.single_use_pass'
  | 'events.scan'
  | 'events.sold_out';

/** Canaux conditionnés par une publication extérieure (App Store). */
export type ChannelCapability = 'channel.app_clip';

export type Capability = CoreCapability | ProfileCapability | ChannelCapability;

/** Une capacité, ou plusieurs (toutes requises). */
export type Requirement = Capability | readonly Capability[];

/* ------------------------------------------------------------------ */
/* Blocs conditionnés                                                   */
/* ------------------------------------------------------------------ */

/** Bloc vrai aujourd'hui, sans condition. */
export type Plain<T> = T & { requires?: undefined; fallback?: undefined };

/**
 * Bloc conditionné. Sans `fallback`, il disparaît tant que la capacité
 * n'est pas livrée ; avec, sa version « vraie aujourd'hui » le remplace.
 * Le repli est du contenu simple : il ne peut pas être lui-même
 * conditionné (une promesse ne se cache pas derrière une autre).
 */
export type Conditional<T> = T & { requires: Requirement; fallback?: T };

export type Gated<T> = Plain<T> | Conditional<T>;

/**
 * Emplacement FIXE (une des six étapes de la séquence, la scène, l'appel
 * final) : s'il est conditionné, il DOIT avoir un repli. La séquence 3D
 * suppose six étapes, jamais cinq.
 */
export type Slot<T> = Plain<T> | (T & { requires: Requirement; fallback: T });

/* ------------------------------------------------------------------ */
/* Contenu                                                              */
/* ------------------------------------------------------------------ */

/** Une ligne de « tableau des départs » : un mot-clé, une phrase. */
export interface RowContent {
  key: string;
  text: string;
}

/**
 * Une ligne « Côté comptoir » : `key` est la TOUCHE telle qu'elle est
 * écrite dans le produit (vocabulaire du profil ou poste d'aujourd'hui),
 * vérifiée par `metiers-vocab.test.ts`.
 */
export interface CounterContent {
  key: string;
  text: string;
}

export interface CounterSection {
  rows: readonly Gated<CounterContent>[];
}

export interface FaqContent {
  q: string;
  a: string;
}

/** Une étape de la séquence 3D (`Story`), comme sur l'accueil. */
export interface StepContent {
  kicker: string;
  title: string;
  body: string;
  benefit: string;
  /** Vignette d'état : ce que lit le client à ce moment-là. */
  state: string;
  /** Vignette en contour (place gardée) plutôt que pleine. */
  outline?: boolean;
}

/**
 * Habillage de la scène (séquence 3D et visuels). Ces textes sont posés
 * en variables CSS (`content: var(--…)`) : ni `\`, ni retour à la ligne,
 * ni `;` (vérifié par test).
 */
export interface SceneContent {
  /** Commerce FICTIF affiché dans la scène (« Garage des Tilleuls »). */
  place: string;
  /** Libellé vermillon du seuil (« Fauteuil », « Réception », « Salle »). */
  seuil: string;
  /** La touche du pro dans la scène (« Terminer », « Prêt · prévenir »). */
  proKey: string;
  /** Panneau pro : avant l'appui, puis après. */
  proLabels: { current: string; currentName: string; next: string; nextName: string };
  /** Prénom fictif du client suivi par la séquence. */
  clientName: string;
  /** Indices des lattes (« Votre place », « Place gardée »…). */
  slotHints: { self: string; kept: string; back: string; turn: string; ghost: string; next: string };
}

export type StorySteps = readonly [
  Slot<StepContent>, Slot<StepContent>, Slot<StepContent>,
  Slot<StepContent>, Slot<StepContent>, Slot<StepContent>,
];

export interface StoryContent {
  scene: SceneContent;
  steps: StorySteps;
}

/**
 * Visuel signature, rendu par un composant serveur sans JavaScript
 * (`components/metiers/signatures/*`, lot S3). Le registre ne donne que
 * le genre et les libellés ; la forme appartient au design.
 */
export type SignatureKind = 'chairs' | 'counter' | 'workshop' | 'tables' | 'guichets' | 'waves';

export interface SignatureLane {
  label: string;
  hint?: string;
}

export interface SignatureContent {
  kind: SignatureKind;
  /** Titre court de la section (« Trois fauteuils, trois files »). */
  title: string;
  /** Une phrase qui dit ce que montre le visuel, vraie aujourd'hui. */
  caption: string;
  seuil: string;
  lanes: readonly SignatureLane[];
}

/* ------------------------------------------------------------------ */
/* Réglages conseillés : des colonnes RÉELLES                           */
/* ------------------------------------------------------------------ */

/** Colonnes de `queues` réglables depuis l'écran Réglages d'aujourd'hui. */
export type QueueColumn =
  | 'mode'
  | 'advance_mode'
  | 'ask_client_name'
  | 'client_name_required'
  | 'allow_staff_choice'
  | 'allow_service_choice'
  | 'notify_ahead_threshold'
  | 'absent_policy'
  | 'absent_move_back_by'
  | 'entry_ttl_minutes'
  | 'ticket_prefix';

export type OrganizationSettingColumn = 'data_retention_days' | 'allow_client_leave' | 'send_completion_review';

export type EventCampaignColumn = 'wave_size' | 'pass_valid_minutes' | 'grace_minutes';

export type SettingValue = string | number | boolean | null | readonly number[];

/**
 * Référence exacte d'un réglage : table et colonne, ou clé de
 * `queues.profile_options` pour un profil donné. La valeur conseillée est
 * vérifiée par test contre le vrai schéma (zod des options, contraintes
 * SQL, choix proposés par l'écran Réglages).
 */
export type SettingRef =
  | { source: 'queues'; column: QueueColumn; value?: SettingValue }
  | { source: 'organization_settings'; column: OrganizationSettingColumn; value?: SettingValue }
  | { source: 'locations'; column: 'google_review_url' }
  | { source: 'event_campaigns'; column: EventCampaignColumn; value?: SettingValue }
  | { source: 'staff'; column: 'desk_label'; value?: SettingValue }
  | { source: 'profile_options'; profile: QueueProfile; key: keyof ProfileOptions; value: SettingValue };

export interface SettingContent {
  /** Libellé tel que l'écran Réglages l'affiche (« Prévenir à partir de »). */
  label: string;
  /** Valeur conseillée, en clair (« 2 personnes »). */
  value: string;
  /** Pourquoi, pour CE métier. */
  text: string;
  ref: SettingRef;
}

export interface SettingsSection {
  rows: readonly Gated<SettingContent>[];
}

/* ------------------------------------------------------------------ */
/* Le métier                                                            */
/* ------------------------------------------------------------------ */

export type SectionId =
  | 'story'
  | 'problem'
  | 'signature'
  | 'counter'
  | 'video'
  | 'settings'
  | 'arguments'
  | 'plans'
  | 'faq'
  | 'cta'
  | 'related';

/**
 * Intention de recherche visée ([SEO § 2]). Aucun volume n'est avancé :
 * la liste se valide dans Keyword Planner puis Search Console.
 */
export interface SearchIntent {
  /** Requête principale : elle guide le titre et le H1. */
  primary: string;
  /** Variantes : H2 et questions. */
  variants: readonly string[];
  /** Requêtes « de problème » : la section Le problème. */
  problems: readonly string[];
}

export interface CtaContent {
  /** Texte du bouton (« Ouvrir ma file »). */
  label: string;
  /** Titre de l'appel final. */
  title: string;
  /** Phrase sous le titre. */
  lead: string;
}

export interface Metier {
  /** Segment d'URL : `/pour/<slug>`. */
  slug: string;
  /** Codes `activity_type` couverts ; le premier sert à `?activite=`. */
  activities: readonly [ActivityType, ...ActivityType[]];
  /**
   * `false` : ni route, ni sitemap, ni lien. Le contenu reste typé et
   * testé, prêt à publier.
   */
  published: boolean;
  /** Date (AAAA-MM-JJ) de dernière révision du TEXTE : c'est le `lastModified` du sitemap. */
  updatedAt: string;
  nav: { label: string; short: string };
  intent: SearchIntent;
  /**
   * Titre et description NE DÉPENDENT d'aucune capacité : l'URL, le titre
   * et le H1 d'une page restent les mêmes quand elle s'enrichit.
   */
  seo: { title: string; description: string; ogTitle: string; ogKicker: string };
  hero: { label: string; title: string; lead: string };
  /** `null` : pas de séquence 3D (événements : héros statique). */
  story: Slot<StoryContent> | null;
  /** Trois scènes vécues, au présent, SANS AUCUN CHIFFRE. */
  problem: readonly RowContent[];
  signature: Slot<SignatureContent>;
  /**
   * Côté comptoir et réglages : la liste ENTIÈRE change quand le profil du
   * métier ouvre (les touches d'un atelier ne sont pas celles d'une file
   * de réception). D'où un emplacement à repli, dont chaque ligne peut
   * encore porter sa propre condition (le devis, par exemple).
   */
  counter: Slot<CounterSection>;
  settings: Slot<SettingsSection>;
  arguments: readonly Gated<RowContent>[];
  faq: readonly Gated<FaqContent>[];
  cta: Slot<CtaContent>;
  /** Ordre des sections, propre au métier. */
  sections: readonly SectionId[];
  /** Slugs des métiers voisins, pour le maillage. */
  related: readonly string[];
}

/* ------------------------------------------------------------------ */
/* La page rendue                                                       */
/* ------------------------------------------------------------------ */

export interface StoryCopy {
  scene: SceneContent;
  steps: readonly [StepContent, StepContent, StepContent, StepContent, StepContent, StepContent];
}

export interface RelatedLink {
  slug: string;
  label: string;
  short: string;
  href: string;
}

/**
 * Une page métier prête à afficher : conditions résolues, typographie
 * française appliquée (espaces insécables, apostrophes courbes).
 */
export interface MetierPage {
  slug: string;
  /** `/pour/<slug>` */
  path: string;
  activities: readonly ActivityType[];
  /** Profil que le métier utilise quand il est ouvert (`ACTIVITY_PROFILE`). */
  profile: QueueProfile;
  updatedAt: string;
  nav: { label: string; short: string };
  seo: { title: string; description: string; ogTitle: string; ogKicker: string };
  hero: { label: string; title: string; lead: string };
  story: StoryCopy | null;
  problem: readonly RowContent[];
  signature: SignatureContent;
  counter: readonly CounterContent[];
  settings: readonly SettingContent[];
  arguments: readonly RowContent[];
  faq: readonly FaqContent[];
  cta: CtaContent & { href: string };
  sections: readonly SectionId[];
  /** Voisins PUBLIÉS seulement, dans l'ordre du registre. */
  related: readonly RelatedLink[];
}
