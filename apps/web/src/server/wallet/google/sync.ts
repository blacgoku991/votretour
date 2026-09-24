import { decideAlertFor } from '../alerts';
import { buildWalletView, passLifecycle } from '../view';
import type { ClaimedJob, JobResult, WalletSnapshot, WalletView } from '../types';
import type { GoogleResource, GoogleWalletClient } from './client';
import { eventClassId, type GoogleWalletConfig } from './config';
import { GoogleWalletError, isNotificationQuotaError } from './errors';
import {
  buildAlertMessage, classTypeFor, eventClassBody, objectTypeFor, prunedMessages, queueClassBody,
  renderGoogleObject, renderHash, renderScrubPatch, withoutNulls, type EventClassInput, type RenderedObject,
} from './objects';

/**
 * Synchronisation Google Wallet : ce que fait le fournisseur Google pour
 * chaque ligne de la file d'envoi, et l'entretien de ses classes.
 *
 * process() — une ligne réclamée, l'instantané et la vue déjà construits :
 *  1. billet de drop : la classe de l'événement existe et n'est pas refusée
 *     (ensureEventClass) ;
 *  2. rendu → empreinte ; PATCH seulement si elle diffère du dernier rendu
 *     livré (dix changements de position au-delà de 20 : zéro appel) ;
 *  3. moment clé : decideAlertFor() (règles communes, budget de 3
 *     sonneries par 24 h) → lecture de l'objet (message déjà là : on ne
 *     renvoie rien), élagage (au plus 6 messages après l'ajout), puis
 *     addMessage TEXT_AND_NOTIFY ou TEXT, texte de walletAlertText() ;
 *     quota de notifications dépassé → renvoyé en TEXT ;
 *  4. cycle de vie : état final, réouverture, archivage différé du
 *     « Merci » (nextRunAfter) ;
 *  5. effacement (job `scrub`) : PATCH qui vide le pass.
 *
 * Aucune fonction ici ne touche directement la base ou le réseau : tout
 * passe par `GoogleSyncDeps` (le fournisseur branche Supabase et le vrai
 * client ; les tests, des doublures).
 */

/* ====================================================================
   Dépendances
   ==================================================================== */

export interface GoogleClassRow {
  classId: string;
  kind: 'queue' | 'event';
  eventId: string | null;
  reviewStatus: string | null;
  syncedHash: string | null;
  dirty: boolean;
  /** Étiquette de salissure à rendre à wallet_google_class_synced (voir 0021). */
  dirtyAt: string | null;
  syncedAt: string | null;
  lastError: string | null;
}

/** Ligne de wallet_google_classes_due : `classId` nul = événement en cours sans classe. */
export type GoogleDueClass = Omit<GoogleClassRow, 'classId'> & { classId: string | null };

export interface GoogleStore {
  classById(classId: string): Promise<GoogleClassRow | null>;
  classByEvent(eventId: string): Promise<GoogleClassRow | null>;
  classesDue(limit: number): Promise<GoogleDueClass[]>;
  /**
   * Classes d'événement propres, en revue chez Google, dont la dernière
   * synchronisation (ou relecture) date d'avant `before` : Google décide
   * de l'approbation plus tard, sans nous prévenir.
   */
  classesUnderReview(before: Date, limit: number): Promise<GoogleClassRow[]>;
  upsertClass(classId: string, kind: 'queue' | 'event', eventId: string | null): Promise<GoogleClassRow>;
  classSynced(classId: string, result: { hash: string | null; reviewStatus: string | null; error: string | null; dirtyAt: string | null }): Promise<void>;
  /** Marque de l'événement (classe) ; null si l'événement n'existe plus. */
  eventBrand(eventId: string): Promise<EventClassInput | null>;
  /** false : pass révoqué, effacé ou disparu entre l'émission et l'insertion. */
  markLive(passId: string, hash: string): Promise<boolean>;
}

/** Sous-ensemble du client REST réellement utilisé (doublure simple en test). */
export type GoogleApi = Pick<
  GoogleWalletClient,
  'insertObject' | 'getObject' | 'patchObject' | 'addMessage' | 'insertClass' | 'getClass' | 'patchClass'
>;

export interface GoogleSyncDeps {
  config: GoogleWalletConfig;
  api: GoogleApi;
  store: GoogleStore;
  now(): Date;
  /** Gigue des nouveaux essais (0 ≤ x < 1). */
  random?(): number;
  /** Erreur à remonter à l'écran super-admin « erreurs » (reportError). */
  report?(message: string, context?: Record<string, unknown>): void;
  /** Compte de service refusé : boutons masqués pendant 5 min. */
  degrade?(reason: string): void;
  /** Secret des QR (tests) ; par défaut SESSION_HASH_SECRET. */
  qrSecret?: string | null;
}

/* ====================================================================
   Règles de nouvel essai
   ==================================================================== */

/** Au-delà, une mise à jour non finale est abandonnée : l'état suivant la remplacera. */
export const MAX_ATTEMPTS = 6;
export const STALE_POSITION_MS = 30 * 60 * 1000;
export const FINAL_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RETRY_SECONDS = 1800;

/** 2^n × 5 s, gigue de ±20 %, plafonnée à 30 min. */
export function backoffSeconds(attempts: number, random: () => number = Math.random): number {
  const base = 5 * 2 ** Math.max(1, Math.min(attempts, 12));
  const jitter = 0.8 + random() * 0.4;
  return Math.min(MAX_RETRY_SECONDS, Math.max(1, Math.round(base * jitter)));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'erreur inconnue';
}

/** Motif lisible par l'exploitant pour une erreur de configuration. */
export function configurationReason(error: GoogleWalletError): string {
  if (error.kind === 'forbidden') {
    return 'Compte de service non autorisé sur l’émetteur (403) : ajoutez-le comme utilisateur « Développeur » dans la Google Pay & Wallet Console.';
  }
  return `Compte de service refusé par Google (${error.status ?? 'jeton'}) : clé révoquée ou invalide.`;
}

/* ====================================================================
   Alertes à l'exploitant, dédoublonnées
   ==================================================================== */

/** Une même alerte (même clé) au plus une fois par heure et par processus. */
export const REPORT_WINDOW_MS = 60 * 60 * 1000;
const reportedUntil = new Map<string, number>();

/**
 * reportError() dédoublonné : une classe refusée ferait sinon une alerte
 * par billet (deux cents pour une vague), et un compte de service refusé
 * une alerte par minute de cron. Le masquage des boutons (degrade), lui,
 * est réappliqué à chaque fois : c'est un état, pas un message.
 */
export function reportOnce(
  deps: Pick<GoogleSyncDeps, 'now' | 'report'>,
  key: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (!deps.report) return;
  const now = deps.now().getTime();
  const until = reportedUntil.get(key);
  if (until !== undefined && until > now) return;
  if (reportedUntil.size >= 500) {
    for (const [k, t] of reportedUntil) if (t <= now) reportedUntil.delete(k);
  }
  reportedUntil.set(key, now + REPORT_WINDOW_MS);
  deps.report(message, context);
}

/** Compte de service refusé : boutons masqués, alerte (une par heure). */
export function configurationRefused(deps: Pick<GoogleSyncDeps, 'now' | 'report' | 'degrade'>, error: GoogleWalletError): string {
  const reason = configurationReason(error);
  deps.degrade?.(reason);
  reportOnce(deps, `configuration:${error.kind}:${error.status ?? '-'}`, reason, { kind: error.kind, status: error.status });
  return reason;
}

/**
 * Échec → JobResult. Classement du § 8.5 du plan :
 *  - 401 persistant / 403 : abandon, arrêt du tour, boutons masqués ;
 *  - 404 (sur PATCH), 400 : abandon et alerte (mauvais émetteur ou
 *    préfixe ; défaut de construction) ;
 *  - 429 / 5xx / réseau / délai : `Retry-After`, sinon 2^n × 5 s avec
 *    gigue, 6 essais ; une mise à jour de position de plus de 30 min est
 *    abandonnée ; une transition FINALE est retentée pendant 24 h.
 */
export function failureResult(
  error: unknown,
  job: Pick<ClaimedJob, 'attempts' | 'createdAt' | 'walletPassId'>,
  view: Pick<WalletView, 'final'>,
  deps: Pick<GoogleSyncDeps, 'now' | 'random' | 'report' | 'degrade'>,
): Extract<JobResult, { ok: false }> {
  const message = messageOf(error);
  if (!(error instanceof GoogleWalletError)) {
    // Erreur inattendue (instantané illisible, bogue) : on réessaie un
    // peu, sans insister indéfiniment.
    return { ok: false, error: message, retryAfterSeconds: backoffSeconds(job.attempts, deps.random), dead: job.attempts >= MAX_ATTEMPTS };
  }
  if (error.configuration) {
    const reason = configurationRefused(deps, error);
    return { ok: false, error: `${reason} (${message})`, retryAfterSeconds: 300, dead: true, haltProvider: true };
  }
  if (!error.retryable) {
    // Un défaut de construction touche d'ordinaire TOUS les passes d'une
    // vague : une alerte par motif et par heure, avec le premier pass.
    reportOnce(deps, `refus:${error.kind}:${error.status ?? '-'}`, `Google Wallet a refusé une mise à jour : ${message}`, {
      kind: error.kind, status: error.status, walletPassId: job.walletPassId,
    });
    return { ok: false, error: message, retryAfterSeconds: 0, dead: true };
  }

  const age = deps.now().getTime() - Date.parse(job.createdAt);
  if (view.final) {
    if (Number.isFinite(age) && age > FINAL_RETRY_WINDOW_MS) {
      return { ok: false, error: `${message} (transition finale abandonnée après 24 h)`, retryAfterSeconds: 0, dead: true };
    }
  } else if ((Number.isFinite(age) && age > STALE_POSITION_MS) || job.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: `${message} (mise à jour périmée : l’état suivant la remplacera)`, retryAfterSeconds: 0, dead: true };
  }
  const retry = error.retryAfterSeconds ?? backoffSeconds(job.attempts, deps.random);
  return { ok: false, error: message, retryAfterSeconds: Math.min(MAX_RETRY_SECONDS, retry), dead: false };
}

/* ====================================================================
   Classes
   ==================================================================== */

export type EventClassState = 'ok' | 'rejected' | 'unavailable';

function reviewStatusOf(resource: GoogleResource | null): string | null {
  const value = resource?.reviewStatus;
  return typeof value === 'string' && value ? value.toUpperCase() : null;
}

export function isRejected(reviewStatus: string | null | undefined): boolean {
  return String(reviewStatus ?? '').toUpperCase() === 'REJECTED';
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted) || (error instanceof GoogleWalletError && error.kind === 'aborted');
}

/**
 * Pousse une classe chez Google si nécessaire. Jamais synchronisée :
 * insert d'abord (409 → PATCH) ; déjà synchronisée : PATCH d'abord (404 →
 * insert, classe supprimée côté console). Rien si l'empreinte est à jour
 * et la classe propre. Le résultat est inscrit en base, succès ou échec,
 * SAUF une annulation par notre propre budget : inscrite comme erreur,
 * elle écarterait la classe pendant 10 min (wallet_google_classes_due)
 * alors que Google n'y est pour rien.
 */
async function syncClass(
  deps: GoogleSyncDeps,
  row: GoogleClassRow,
  body: GoogleResource,
  signal?: AbortSignal,
  force = false,
): Promise<string | null> {
  const type = classTypeFor(row.kind);
  const hash = renderHash(body);
  if (!force && row.syncedAt && !row.dirty && !row.lastError && row.syncedHash === hash) return row.reviewStatus;

  try {
    let resource: GoogleResource | null = null;
    if (!row.syncedAt) {
      const inserted = await deps.api.insertClass(type, withoutNulls(body), signal);
      resource = inserted.status === 'created' ? inserted.resource : await deps.api.patchClass(type, row.classId, body, signal);
    } else {
      try {
        resource = await deps.api.patchClass(type, row.classId, body, signal);
      } catch (error) {
        if (!(error instanceof GoogleWalletError) || error.kind !== 'not_found') throw error;
        resource = (await deps.api.insertClass(type, withoutNulls(body), signal)).resource;
      }
    }
    // Classe Generic : pas de relecture par Google, pas de reviewStatus.
    const reviewStatus = row.kind === 'event' ? (reviewStatusOf(resource) ?? 'UNDER_REVIEW') : null;
    await deps.store.classSynced(row.classId, { hash, reviewStatus, error: null, dirtyAt: row.dirtyAt });
    if (isRejected(reviewStatus)) {
      reportOnce(deps, `classe-refusee:${row.classId}`, `Classe Google Wallet refusée par Google : ${row.classId}`, { classId: row.classId });
    }
    return reviewStatus;
  } catch (error) {
    if (!isAbort(error, signal)) {
      await deps.store
        .classSynced(row.classId, { hash: null, reviewStatus: null, error: messageOf(error).slice(0, 1000), dirtyAt: null })
        .catch(() => undefined);
    }
    throw error;
  }
}

/**
 * La classe Generic de la file, commune à toutes les files. Créée au
 * premier passage du cron ; tant qu'elle n'existe pas chez Google, le
 * fournisseur n'est pas « prêt » et aucun bouton n'apparaît. Resynchronisée
 * d'elle-même si son dessin change (nouvelle empreinte).
 */
export async function ensureQueueClass(deps: GoogleSyncDeps, signal?: AbortSignal): Promise<{ classId: string; created: boolean }> {
  const classId = deps.config.naming.queueClassId;
  const existing = await deps.store.classById(classId);
  const row = existing ?? (await deps.store.upsertClass(classId, 'queue', null));
  const wasSynced = Boolean(row.syncedAt);
  await syncClass(deps, row, queueClassBody(deps.config.naming), signal);
  return { classId, created: !wasSynced };
}

/** Classes d'événement connues « prêtes » dans ce processus : évite une lecture par billet pendant une vague. */
const EVENT_CLASS_TTL_MS = 60_000;
const eventClassCache = new Map<string, number>();
/**
 * Vérifications en cours, par événement : une vague de huit billets dont
 * la classe vient d'être salie ne lance qu'UN PATCH de classe, que les
 * sept autres attendent. La promesse partagée garde le signal du premier
 * appelant : s'il est annulé, les autres échouent avec lui et seront
 * retentés, comme après toute panne passagère.
 */
const eventClassInFlight = new Map<string, Promise<EventClassState>>();

/** État propre au processus (caches, alertes déjà faites) : remis à zéro entre deux tests. */
export function resetGoogleSyncState(): void {
  eventClassCache.clear();
  eventClassInFlight.clear();
  reportedUntil.clear();
}

/**
 * Classe d'un drop, créée ou mise à jour au besoin (vidage de la file
 * d'envoi). `rejected` : Google a refusé la classe, aucun billet ne peut
 * en dépendre (bouton masqué, ligne abandonnée) ; `unavailable` :
 * événement introuvable ou classe d'un autre émetteur (configuration
 * changée).
 */
export function ensureEventClass(deps: GoogleSyncDeps, eventId: string, signal?: AbortSignal): Promise<EventClassState> {
  const cached = eventClassCache.get(eventId);
  if (cached && cached > deps.now().getTime()) return Promise.resolve('ok');
  const pending = eventClassInFlight.get(eventId);
  if (pending) return pending;
  const work = ensureEventClassNow(deps, eventId, signal).finally(() => {
    eventClassInFlight.delete(eventId);
  });
  eventClassInFlight.set(eventId, work);
  return work;
}

async function ensureEventClassNow(deps: GoogleSyncDeps, eventId: string, signal?: AbortSignal): Promise<EventClassState> {
  const expected = eventClassId(deps.config.naming, eventId);
  let row = await deps.store.classByEvent(eventId);
  if (row && row.classId !== expected) return 'unavailable';
  if (row && isRejected(row.reviewStatus) && !row.dirty) return 'rejected';

  if (!row || !row.syncedAt || row.dirty || row.lastError) {
    const brand = await deps.store.eventBrand(eventId);
    if (!brand) return 'unavailable';
    row ??= await deps.store.upsertClass(expected, 'event', eventId);
    const status = await syncClass(deps, row, eventClassBody(expected, brand, deps.config.siteUrl), signal, !row.syncedAt || row.dirty);
    if (isRejected(status)) return 'rejected';
  }
  eventClassCache.set(eventId, deps.now().getTime() + EVENT_CLASS_TTL_MS);
  return 'ok';
}

export type EventClassAtClick = EventClassState | 'missing';

/**
 * Au clic (§ 8.1 du plan) : la classe du drop doit DÉJÀ exister chez
 * Google, et ne pas être refusée. Aucune création ni aucun PATCH ici :
 * le cron la crée dans la minute où le drop démarre (walletOffer ne
 * montre d'ailleurs le bouton qu'à ce moment-là), et une marque modifiée
 * part avec le vidage. Le clic reste ainsi un seul appel Google, loin
 * des 8 s.
 */
export async function eventClassAtClick(deps: Pick<GoogleSyncDeps, 'config' | 'store'>, eventId: string): Promise<EventClassAtClick> {
  const row = await deps.store.classByEvent(eventId);
  if (!row || !row.syncedAt) return 'missing';
  if (row.classId !== eventClassId(deps.config.naming, eventId)) return 'unavailable';
  if (isRejected(row.reviewStatus)) return 'rejected';
  return 'ok';
}

/* ====================================================================
   Entretien (cron, chaque minute, avant le vidage)
   ==================================================================== */

/** Budget de l'entretien : le vidage de TOUS les fournisseurs passe après. */
export const MAINTENANCE_BUDGET_MS = 6_000;
/** Une classe en revue est relue chez Google au plus toutes les 10 min. */
export const REVIEW_RECHECK_MS = 10 * 60 * 1000;

export interface ClassSyncSummary {
  synced: number;
  failed: number;
  skipped: number;
  halted: boolean;
}

interface BudgetOptions {
  /** Borne en temps (horloge de deps.now). */
  budgetMs?: number;
  /**
   * Annulation relayée à CHAQUE appel Google : sans lui, un seul appel
   * lent (8 s, plus 8 s de jeton, plus un nouvel essai sur 401) ferait
   * déborder le budget, et le vidage Apple qui suit en pâtirait.
   * Par défaut : AbortSignal.timeout(budgetMs).
   */
  signal?: AbortSignal;
}

function budgetOf(deps: Pick<GoogleSyncDeps, 'now'>, options: BudgetOptions): { signal: AbortSignal; expired(): boolean } {
  const budgetMs = Math.max(0, options.budgetMs ?? MAINTENANCE_BUDGET_MS);
  const deadline = deps.now().getTime() + budgetMs;
  const signal = options.signal ?? AbortSignal.timeout(Math.max(1, budgetMs));
  return { signal, expired: () => signal.aborted || deps.now().getTime() >= deadline };
}

/**
 * Classes à synchroniser (salies par un changement de marque, jamais
 * envoyées, en erreur depuis 10 min, événement en cours sans classe).
 * Bornée en nombre, et en temps par un signal relayé à chaque appel.
 */
export async function syncDirtyClasses(
  deps: GoogleSyncDeps,
  options: BudgetOptions & { limit?: number } = {},
): Promise<ClassSyncSummary> {
  const summary: ClassSyncSummary = { synced: 0, failed: 0, skipped: 0, halted: false };
  const { signal, expired } = budgetOf(deps, options);
  const due = await deps.store.classesDue(options.limit ?? 5);
  const { naming } = deps.config;

  for (const item of due) {
    if (expired()) break;
    try {
      if (item.kind === 'queue') {
        if (item.classId !== naming.queueClassId) {
          // Autre émetteur ou autre préfixe (configuration changée) : on
          // le dit une fois, la ligne revient au plus toutes les 10 min.
          if (item.classId) {
            await deps.store.classSynced(item.classId, { hash: null, reviewStatus: null, error: 'Classe d’un autre émetteur ou préfixe', dirtyAt: null });
          }
          summary.skipped += 1;
          continue;
        }
        await ensureQueueClass(deps, signal);
        summary.synced += 1;
        continue;
      }

      if (!item.eventId) {
        summary.skipped += 1;
        continue;
      }
      const expected = eventClassId(naming, item.eventId);
      if (item.classId && item.classId !== expected) {
        await deps.store.classSynced(item.classId, { hash: null, reviewStatus: null, error: 'Classe d’un autre émetteur ou préfixe', dirtyAt: null });
        summary.skipped += 1;
        continue;
      }
      const brand = await deps.store.eventBrand(item.eventId);
      if (!brand) {
        summary.skipped += 1;
        continue;
      }
      const row: GoogleClassRow = item.classId
        ? { ...item, classId: item.classId }
        : await deps.store.upsertClass(expected, 'event', item.eventId);
      await syncClass(deps, row, eventClassBody(expected, brand, deps.config.siteUrl), signal, true);
      eventClassCache.delete(item.eventId);
      summary.synced += 1;
    } catch (error) {
      summary.failed += 1;
      if (isAbort(error, signal)) break;
      if (error instanceof GoogleWalletError && error.configuration) {
        configurationRefused(deps, error);
        summary.halted = true;
        break;
      }
      console.error('[wallet.google] classe non synchronisée', item.classId ?? item.eventId, messageOf(error));
    }
  }
  return summary;
}

export interface ReviewSummary {
  checked: number;
  changed: number;
  failed: number;
}

/**
 * Relit chez Google les classes d'événement encore « en revue ». Google
 * approuve ou refuse une classe PLUS TARD, sans rien nous envoyer : sans
 * cette relecture, un refus resterait « UNDER_REVIEW » en base (bouton
 * montré, carte super-admin « en revue » pour toujours). Toutes les
 * 10 min par classe au plus : wallet_google_class_synced remet synced_at
 * à maintenant, et la marque en attente (dirty_at) est préservée.
 */
export async function refreshReviewedClasses(
  deps: GoogleSyncDeps,
  options: BudgetOptions & { limit?: number } = {},
): Promise<ReviewSummary> {
  const summary: ReviewSummary = { checked: 0, changed: 0, failed: 0 };
  const { signal, expired } = budgetOf(deps, options);
  const before = new Date(deps.now().getTime() - REVIEW_RECHECK_MS);
  const rows = await deps.store.classesUnderReview(before, options.limit ?? 3);

  for (const row of rows) {
    if (expired()) break;
    if (row.kind !== 'event' || !row.eventId) continue;
    const previous = String(row.reviewStatus ?? '').toUpperCase();
    try {
      const resource = await deps.api.getClass(classTypeFor('event'), row.classId, signal);
      summary.checked += 1;
      if (!resource) {
        // Supprimée côté console : l'erreur la ramène dans les classes
        // dues dans 10 min, et syncClass la recrée (PATCH 404 → insert).
        await deps.store.classSynced(row.classId, { hash: null, reviewStatus: null, error: 'Classe introuvable chez Google', dirtyAt: null });
        eventClassCache.delete(row.eventId);
        summary.changed += 1;
        continue;
      }
      const status = reviewStatusOf(resource) ?? 'UNDER_REVIEW';
      await deps.store.classSynced(row.classId, { hash: null, reviewStatus: status, error: null, dirtyAt: row.dirtyAt });
      if (status !== previous) {
        summary.changed += 1;
        eventClassCache.delete(row.eventId);
        if (isRejected(status)) {
          reportOnce(deps, `classe-refusee:${row.classId}`, `Classe Google Wallet refusée par Google : ${row.classId}`, { classId: row.classId, eventId: row.eventId });
        }
      }
    } catch (error) {
      summary.failed += 1;
      if (isAbort(error, signal)) break;
      if (error instanceof GoogleWalletError && error.configuration) {
        configurationRefused(deps, error);
        break;
      }
      console.error('[wallet.google] relecture de classe impossible', row.classId, messageOf(error));
    }
  }
  return summary;
}

/**
 * Entretien complet, sous UN budget et UN signal : classe de file, classes
 * salies, puis relecture des classes en revue. Jamais d'exception : le
 * cron enchaîne sur le vidage quoi qu'il arrive.
 */
export async function runGoogleMaintenance(
  deps: GoogleSyncDeps,
  options: BudgetOptions = {},
): Promise<Record<string, unknown>> {
  const budgetMs = Math.max(0, options.budgetMs ?? MAINTENANCE_BUDGET_MS);
  const deadline = deps.now().getTime() + budgetMs;
  const signal = options.signal ?? AbortSignal.timeout(Math.max(1, budgetMs));
  const remaining = () => Math.max(0, deadline - deps.now().getTime());
  const outcome: Record<string, unknown> = {};

  try {
    const queue = await ensureQueueClass(deps, signal);
    outcome.queueClass = queue.created ? 'créée' : 'à jour';
  } catch (error) {
    outcome.queueClass = { error: messageOf(error) };
    if (error instanceof GoogleWalletError && error.configuration) {
      configurationRefused(deps, error);
      return outcome;
    }
    if (isAbort(error, signal)) return outcome;
  }

  try {
    const classes = await syncDirtyClasses(deps, { limit: 5, budgetMs: remaining(), signal });
    outcome.classes = classes;
    if (classes.halted || signal.aborted || remaining() === 0) return outcome;
    outcome.review = await refreshReviewedClasses(deps, { limit: 3, budgetMs: remaining(), signal });
  } catch (error) {
    // Lecture SQL en échec (registre des classes) : dit au rapport du cron.
    outcome.error = messageOf(error);
  }
  return outcome;
}

/* ====================================================================
   Objets : insertion au clic (distribution)
   ==================================================================== */

function renderFor(deps: GoogleSyncDeps, snap: WalletSnapshot, view: WalletView, now: Date): RenderedObject {
  return renderGoogleObject(snap, view, {
    siteUrl: deps.config.siteUrl,
    rotatingBarcode: deps.config.rotatingBarcode,
    now,
    qrSecret: deps.qrSecret,
  });
}

/**
 * Rattrapage après « tenu à jour ». Entre l'instantané du clic et
 * wallet_google_mark_live (l'insertion peut durer jusqu'à 8 s), les
 * déclencheurs n'enfilent rien pour ce pass (`live` encore faux) : un
 * changement du ticket survenu pendant l'insertion serait perdu jusqu'au
 * suivant. On relit donc l'instantané une fois le pass tenu à jour, et
 * l'on pousse le contenu s'il a changé. Tout changement ultérieur passe
 * par la file d'envoi. Au mieux : un échec ici laisse le lien valable.
 *
 * Limite : une ALERTE manquée (le client appelé pendant l'insertion)
 * n'est pas rattrapée ici, faute de pouvoir l'inscrire au registre ; il
 * faut que wallet_google_mark_live enfile une synchronisation (demande
 * faite à l'orchestrateur, migration 0021).
 */
async function catchUpAfterLive(
  deps: GoogleSyncDeps,
  passId: string,
  liveHash: string,
  reread: () => Promise<WalletSnapshot | null>,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const fresh = await reread();
    if (!fresh || !fresh.pass.live || (fresh.pass.state !== 'active' && fresh.pass.state !== 'final')) return liveHash;
    const now = deps.now();
    const again = renderFor(deps, fresh, buildWalletView(fresh, now, { siteUrl: deps.config.siteUrl }), now);
    if (again.hash === liveHash) return liveHash;
    await deps.api.patchObject(again.type, again.id, again.patch, signal);
    return (await deps.store.markLive(passId, again.hash)) ? again.hash : liveHash;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn('[wallet.google] rattrapage après insertion impossible', messageOf(error));
    return liveHash;
  }
}

/**
 * Crée l'objet chez Google au moment du clic (avant le JWT léger), puis
 * le déclare « tenu à jour ». Idempotent : 409 → PATCH du contenu courant.
 * `reread` : relecture de l'instantané pour rattraper un changement
 * survenu pendant l'insertion (voir catchUpAfterLive).
 *
 * Pass révoqué ou effacé entre l'émission et l'insertion (mark_live
 * répond false) : personne ne tiendrait l'objet à jour ni ne l'effacerait.
 * On le vide sur-le-champ, au mieux, et la distribution échoue : aucun
 * lien servi.
 */
export async function insertObjectAndGoLive(
  deps: GoogleSyncDeps,
  snap: WalletSnapshot,
  view: WalletView,
  signal?: AbortSignal,
  reread?: () => Promise<WalletSnapshot | null>,
): Promise<{ type: ReturnType<typeof objectTypeFor>; id: string; hash: string }> {
  const rendered = renderFor(deps, snap, view, deps.now());
  const inserted = await deps.api.insertObject(rendered.type, rendered.insert, signal);
  if (inserted.status === 'exists') await deps.api.patchObject(rendered.type, rendered.id, rendered.patch, signal);

  if (!(await deps.store.markLive(snap.pass.id, rendered.hash))) {
    const scrub = renderScrubPatch(snap, view, { siteUrl: deps.config.siteUrl });
    await deps.api.patchObject(scrub.type, scrub.id, scrub.patch, signal).catch(() => undefined);
    throw new Error('Pass révoqué ou effacé pendant l’émission : aucun lien servi');
  }

  const hash = reread ? await catchUpAfterLive(deps, snap.pass.id, rendered.hash, reread, signal) : rendered.hash;
  return { type: rendered.type, id: rendered.id, hash };
}

/* ====================================================================
   Traitement d'une ligne de la file d'envoi
   ==================================================================== */

interface AlertOutcome {
  notified: boolean;
}

/**
 * Envoie le message d'un moment clé. Idempotent : l'objet est relu AVANT
 * CHAQUE envoi, et un message de même identifiant déjà présent n'est pas
 * renvoyé. Pas seulement au nouvel essai d'une même ligne : quand un
 * addMessage dépasse son délai, Google a pu l'accepter sans que la
 * réponse revienne, et la ligne est close dès qu'une autre attend pour
 * ce pass (fail_wallet_outbox) ; la ligne suivante repart à attempts = 1.
 * Google n'imposant pas l'unicité des identifiants de message, seule
 * cette lecture évite une seconde sonnerie. Les alertes sont rares (moins
 * de six par pass) : la lecture ne coûte presque rien.
 *
 * La même lecture sert à élaguer AVANT l'ajout : au plus 6 messages au
 * dos une fois le nouveau posé.
 */
async function sendAlert(
  deps: GoogleSyncDeps,
  snap: WalletSnapshot,
  view: WalletView,
  decision: { kind: NonNullable<WalletView['alertKind']>; notify: boolean },
  signal: AbortSignal,
): Promise<AlertOutcome> {
  const type = objectTypeFor(snap.pass.kind);
  const id = snap.pass.externalId;
  const now = deps.now();
  let message = buildAlertMessage(decision.kind, decision.notify, snap, view, now);

  const current = await deps.api.getObject(type, id, signal);
  const list = current?.messages;
  const messages = Array.isArray(list) ? (list as GoogleResource[]) : [];
  const previous = messages.find((m) => m.id === message.id);
  if (previous) return { notified: previous.messageType === 'TEXT_AND_NOTIFY' };

  const keep = prunedMessages(messages, 1);
  if (keep) {
    try {
      await deps.api.patchObject(type, id, { messages: keep }, signal);
    } catch (error) {
      // Élagage de confort : jamais bloquant pour l'alerte elle-même.
      if (signal.aborted) throw error;
      console.warn('[wallet.google] élagage des messages impossible', messageOf(error));
    }
  }

  try {
    await deps.api.addMessage(type, id, message, signal);
  } catch (error) {
    if (!decision.notify || !isNotificationQuotaError(error)) throw error;
    // Quota de Google atteint (3 sonneries par 24 h) : le message reste
    // au dos du pass, sans sonnerie. Journalisé à chaque fois, motif
    // compris : la recette (§ 20) doit confirmer le nom exact de
    // l'erreur, et la fréquence de ces bascules se mesure dans les logs.
    const e = error as GoogleWalletError;
    console.warn('[wallet.google] quota de notifications : message renvoyé en TEXT', JSON.stringify({
      kind: decision.kind, status: e.status, reason: e.reason, message: e.message.slice(0, 200),
    }));
    message = { ...message, messageType: 'TEXT' };
    await deps.api.addMessage(type, id, message, signal);
  }
  return { notified: message.messageType === 'TEXT_AND_NOTIFY' };
}

export async function processGoogleJob(
  deps: GoogleSyncDeps,
  job: ClaimedJob,
  snap: WalletSnapshot,
  now: Date,
  view: WalletView,
  signal: AbortSignal,
): Promise<JobResult> {
  try {
    if (job.job === 'scrub') {
      const scrub = renderScrubPatch(snap, view, { siteUrl: deps.config.siteUrl });
      try {
        await deps.api.patchObject(scrub.type, scrub.id, scrub.patch, signal);
      } catch (error) {
        // Objet jamais créé chez Google : il n'y a rien à effacer.
        if (!(error instanceof GoogleWalletError) || error.kind !== 'not_found') throw error;
      }
      return { ok: true, syncedHash: scrub.hash };
    }

    // Plus rien à tenir à jour (effacé, révoqué, jamais créé) : la ligne se clôt.
    if (snap.pass.state === 'revoked' || snap.pass.state === 'scrubbed' || !snap.pass.live) {
      return { ok: true, error: 'Pass non tenu à jour : rien à envoyer' };
    }

    if (snap.pass.kind === 'event' && snap.event) {
      const state = await ensureEventClass(deps, snap.event.id, signal);
      if (state === 'rejected') {
        // Une alerte par classe et par heure, pas une par billet.
        reportOnce(deps, `classe-refusee-billets:${snap.event.id}`, 'Classe d’événement refusée par Google : billets figés', { eventId: snap.event.id });
        return { ok: false, error: 'Classe d’événement refusée par Google', retryAfterSeconds: 0, dead: true };
      }
      if (state === 'unavailable') {
        return { ok: false, error: 'Classe d’événement indisponible', retryAfterSeconds: backoffSeconds(job.attempts, deps.random), dead: job.attempts >= MAX_ATTEMPTS };
      }
    }

    const rendered = renderFor(deps, snap, view, now);
    if (rendered.hash !== snap.pass.syncedHash) {
      await deps.api.patchObject(rendered.type, rendered.id, rendered.patch, signal);
    }

    const decision = decideAlertFor('google', snap, view, now);
    const alert = decision ? await sendAlert(deps, snap, view, decision, signal) : null;

    return {
      ok: true,
      syncedHash: rendered.hash,
      alertKind: decision?.kind ?? null,
      alertNotified: alert?.notified ?? false,
      ...passLifecycle(view, snap.pass, now),
    };
  } catch (error) {
    return failureResult(error, job, view, deps);
  }
}
