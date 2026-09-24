/**
 * Contrat commun des passes Wallet (Apple et Google).
 *
 * Ce fichier est la frontière entre les lots : W1 (socle), W2 (Apple),
 * W3 (Google), W4 (interface). Il ne contient QUE des types, sans
 * `server-only`, pour que les tests et l'aperçu /design puissent s'en
 * servir sans rien tirer du serveur.
 *
 * Chaîne complète :
 *   wallet_pass_snapshot() (SQL) → WalletSnapshot
 *     → buildWalletView() (pur)  → WalletView  : textes, phase, moment clé
 *       → decideWalletAlert() (pur) : faut-il faire sonner le téléphone ?
 *         → provider.process()   : pass.json + push (Apple), PATCH (Google)
 * Les deux plateformes affichent donc les mêmes mots aux mêmes moments.
 */

import type { EntryStatus, QueueMode, QueueStatus } from '@/lib/types';

export type WalletProviderId = 'apple' | 'google';
export const WALLET_PROVIDERS: readonly WalletProviderId[] = ['apple', 'google'];

export type WalletKind = 'queue' | 'event';

/** Accents d'établissement (organization_settings.brand_accent). */
export type WalletAccent = 'signal' | 'copper' | 'jade' | 'cobalt' | 'brique';
export const WALLET_ACCENTS: readonly WalletAccent[] = ['signal', 'copper', 'jade', 'cobalt', 'brique'];

export type WalletPassState = 'active' | 'final' | 'revoked' | 'scrubbed';
export type WalletHolderState = 'unknown' | 'saved' | 'removed';

/* ====================================================================
   Instantané SQL : forme EXACTE de public.wallet_pass_snapshot()
   (migration 0021, § 9). Horodatages en ISO 8601 (timestamptz → jsonb).
   Jamais de prénom : la fonction ne lit pas client_name.
   ==================================================================== */

export interface WalletSnapshot {
  pass: {
    id: string;
    provider: WalletProviderId;
    kind: WalletKind;
    externalId: string;
    classRef: string;
    state: WalletPassState;
    live: boolean;
    holderState: WalletHolderState;
    versionSeq: number;
    versionAt: string;
    contentHash: string | null;
    syncedHash: string | null;
    lastSyncedAt: string | null;
    /** Registre des moments déjà signalés : { "your_turn": "2026-…" }. */
    alerts: Partial<Record<AlertKind, string>>;
    /** Horodatages des alertes sonores Google (budget 3 / 24 h). */
    notifyLog: string[];
    downloadCount: number;
    finalAt: string | null;
    revokedAt: string | null;
    scrubbedAt: string | null;
    createdAt: string;
  };
  entry: {
    publicId: string;
    status: EntryStatus;
    peopleAhead: number;
    joinedAt: string;
    calledAt: string | null;
    serviceStartedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
    expiredAt: string | null;
    absentAt: string | null;
    /** Numéro humain d'un billet de drop (« A-042 » une fois formaté). */
    eventTicketNumber: number | null;
    /** Professionnel assigné : déjà public sur la page client. */
    staffName: string | null;
    /** Acteur du dernier événement de file qui a mené au statut courant. */
    statusActor: 'staff' | 'client' | 'system' | 'platform_admin' | null;
    /** Type de cet événement (client_leave, cancel, event_sold_out…). */
    statusEvent: string | null;
    statusChangedAt: string | null;
  };
  queue: {
    id: string;
    status: QueueStatus;
    mode: QueueMode;
    notifyAheadThreshold: number;
    entryTtlMinutes: number | null;
  };
  location: {
    id: string;
    name: string;
    slug: string;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    countryCode: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone: string;
    logoUrl: string | null;
    coverUrl: string | null;
    /** Le lien Google lui-même ne sort jamais : seul le lien mesuré /api/client/review/click. */
    hasReviewUrl: boolean;
  };
  organization: {
    id: string;
    name: string;
    logoUrl: string | null;
    brandAccent: string;
    walletEnabled: boolean;
    /** Faux pour les profils de santé par défaut : aucune demande d'avis. */
    sendCompletionReview: boolean;
  };
  event: null | {
    id: string;
    name: string;
    heroTitle: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
    accentHex: string | null;
    rulesText: string | null;
    status: 'draft' | 'live' | 'paused' | 'sold_out' | 'ended';
    startedAt: string | null;
    endedAt: string | null;
    walletQrEnabled: boolean;
  };
  access: null | {
    publicId: string;
    /** Sert UNIQUEMENT à dériver le QR Wallet côté serveur ; ne quitte jamais le serveur. */
    tokenHash: string;
    status: 'issued' | 'redeemed' | 'expired' | 'revoked';
    issuedAt: string;
    validUntil: string;
    graceUntil: string;
    redeemedAt: string | null;
    revokedAt: string | null;
    wave: number | null;
  };
  /** Moments déjà livrés par canal (notification_deliveries, statut 'sent'). */
  deliveredKinds: Partial<Record<string, string[]>>;
  at: string;
}

/* ====================================================================
   Modèle de vue (§ 3.1 du plan)
   ==================================================================== */

export type WalletPhase =
  | 'waiting' | 'soon' | 'one' | 'turn' | 'serving' | 'absent' | 'paused' | 'closed'
  | 'done' | 'left' | 'removed' | 'expired'
  | 'event_waiting' | 'event_access' | 'event_used' | 'event_expired' | 'event_over';

export type AlertKind =
  | 'ahead_two' | 'ahead_one' | 'your_turn' | 'visit_completed' | 'removed'
  | 'event_access' | 'event_sold_out' | 'event_ended';

export const ALERT_KINDS: readonly AlertKind[] = [
  'ahead_two', 'ahead_one', 'your_turn', 'visit_completed', 'removed',
  'event_access', 'event_sold_out', 'event_ended',
];

/**
 * Image du pass : soit un fichier local de MEDIA_ROOT (lu par le serveur,
 * jamais téléchargé depuis une URL arbitraire : pas de SSRF), soit une URL
 * HTTPS externe que seul Google ira chercher lui-même.
 */
export type LocalOrUrl =
  | { kind: 'local'; relativePath: string; publicUrl: string }
  | { kind: 'url'; url: string };

export interface WalletView {
  kind: WalletKind;
  phase: WalletPhase;
  /** « 6 personnes devant vous », « C’est votre tour ». */
  headline: string;
  /** Position affichée ; null hors attente. Au-delà de 20 : { null, « Plus de 20 » }. */
  position: { value: number | null; label: string } | null;
  /** Valeur du champ Apple `etat` / du module Google `statut` : SEUL porteur d'alerte Apple. */
  statusText: string;
  /** Moment clé associé à la phase (null : mise à jour silencieuse). */
  alertKind: AlertKind | null;
  /** État final (réversible pendant 2 h si le moteur remet le ticket en file). */
  final: boolean;
  /** ISO : fin d'affichage actif (Merci + 2 h, grace_until…). */
  archiveAt: string | null;
  /** Apple : voided ; Google : state EXPIRED. */
  voided: boolean;
  googleState: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  times: { joinedAt: string; limitAt?: string; graceUntil?: string; redeemedAt?: string; tz: string };
  event?: { name: string; ticketNumber: string | null; wave: number | null; rules: string | null };
  /** Seulement si un accès est émis, valide, et accepté en Wallet par l'événement. */
  qr: { publicId: string; tokenHash: string; allowWallet: boolean } | null;
  brand: {
    orgName: string; placeName: string; accentHex: string;
    /** Accent d'établissement normalisé (lattes, palette de file). */
    accent: WalletAccent;
    logo: LocalOrUrl | null; cover: LocalOrUrl | null;
    address: string | null; lat: number | null; lng: number | null;
  };
  links: { ticket: string; review: string | null };
  /** Déjà public sur la page client. */
  staffName: string | null;
}

/* ====================================================================
   Fournisseurs
   ==================================================================== */

export interface ProviderStatus {
  ready: boolean;
  /** Raison exacte : affichée dans l'espace super-admin seulement. */
  reason: string | null;
  details?: Record<string, unknown>;
}

/** Ligne réclamée par claim_wallet_outbox(). */
export interface ClaimedJob {
  id: number;
  walletPassId: string;
  provider: WalletProviderId;
  queueId: string;
  job: 'sync' | 'scrub';
  reasons: string[];
  priority: number;
  attempts: number;
  runAfter: string;
  createdAt: string;
}

/**
 * Résultat d'un traitement.
 *  - `ok: true` → complete_wallet_outbox(p_result) : la base inscrit le
 *    registre d'alertes et, si `alertNotified`, LA ligne
 *    notification_deliveries (« envoyée » = acceptée par le fournisseur).
 *  - `ok: false` → fail_wallet_outbox : nouvel essai ou abandon.
 *    `haltProvider` arrête le tour pour ce fournisseur (certificat refusé,
 *    compte de service révoqué) : inutile d'insister sur les autres passes.
 */
export type JobResult =
  | {
      ok: true;
      syncedHash?: string | null;
      live?: boolean;
      holderState?: WalletHolderState;
      alertKind?: AlertKind | null;
      alertNotified?: boolean;
      final?: boolean;
      reopen?: boolean;
      nextRunAfter?: string | null;
      error?: string | null;
    }
  | { ok: false; error: string; retryAfterSeconds: number; dead: boolean; haltProvider?: boolean };

/** Nommage transmis à wallet_issue_pass (dépend de la configuration du fournisseur). */
export type WalletNaming =
  | { provider: 'apple'; passTypeId: string }
  | { provider: 'google'; objectPrefix: string; queueClass: string; eventClassPrefix: string };

/** Réponse de wallet_issue_pass(). */
export interface IssuedWalletPass {
  id: string;
  provider: WalletProviderId;
  externalId: string;
  classRef: string;
  kind: WalletKind;
  state: WalletPassState;
  created: boolean;
  live: boolean;
}

/**
 * Contexte de distribution, préparé par la route commune
 * /api/client/wallet/[provider] : l'identité du demandeur est DÉJÀ
 * vérifiée (session propriétaire du ticket ou cookie rv_event_pass), les
 * limites de débit sont consommées. Le fournisseur n'a plus qu'à émettre
 * le pass (issue, qui revérifie tout en SQL) et à répondre.
 */
export interface DistributeContext {
  request: Request;
  provider: WalletProviderId;
  entryPublicId: string;
  organizationId: string;
  clientSessionId: string | null;
  eventPassPublicId: string | null;
  from: 'entry' | 'pass';
  /** Page d'origine, pour revenir avec ?wallet=indisponible en cas d'échec. */
  returnTo: string;
  now: Date;
  issue(naming: WalletNaming): Promise<IssuedWalletPass>;
  snapshot(passId: string): Promise<WalletSnapshot | null>;
}

export interface WalletProvider {
  id: WalletProviderId;
  /** Mis en cache 5 min par le registre (providers.ts). */
  status(): Promise<ProviderStatus>;
  /** GET /api/client/wallet/[provider]. */
  distribute(ctx: DistributeContext): Promise<Response>;
  /** Traite une ligne de la file d'envoi. `view` est déjà construite par le vidage. */
  process(job: ClaimedJob, snap: WalletSnapshot, now: Date, view: WalletView): Promise<JobResult>;
  /**
   * Tâches de fond appelées chaque minute par le cron, AVANT le vidage et
   * même si le fournisseur n'est pas prêt (Google : créer la classe de
   * file, qui conditionne justement l'état « prêt »). Facultatif.
   */
  maintain?(now: Date): Promise<Record<string, unknown> | void>;
}
