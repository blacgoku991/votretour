import { decideAlertFor } from '../alerts';
import { passLifecycle } from '../view';
import type { ClaimedJob, JobResult, WalletSnapshot, WalletView } from '../types';
import type { GoogleResource, GoogleWalletClient } from './client';
import { eventClassId, type GoogleWalletConfig } from './config';
import { GoogleWalletError, isNotificationQuotaError } from './errors';
import {
  buildAlertMessage, classTypeFor, eventClassBody, objectTypeFor, prunedMessages, queueClassBody,
  renderGoogleObject, renderHash, renderScrubPatch, withoutNulls, type EventClassInput,
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
 *     sonneries par 24 h) → addMessage TEXT_AND_NOTIFY ou TEXT, texte de
 *     walletAlertText() ; quota de notifications dépassé → renvoyé en
 *     TEXT ; au-delà de 6 messages, les 5 plus récents sont gardés ;
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
  upsertClass(classId: string, kind: 'queue' | 'event', eventId: string | null): Promise<GoogleClassRow>;
  classSynced(classId: string, result: { hash: string | null; reviewStatus: string | null; error: string | null; dirtyAt: string | null }): Promise<void>;
  /** Marque de l'événement (classe) ; null si l'événement n'existe plus. */
  eventBrand(eventId: string): Promise<EventClassInput | null>;
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
    const reason = configurationReason(error);
    deps.degrade?.(reason);
    deps.report?.(reason, { kind: error.kind, status: error.status });
    return { ok: false, error: `${reason} (${message})`, retryAfterSeconds: 300, dead: true, haltProvider: true };
  }
  if (!error.retryable) {
    deps.report?.(`Google Wallet a refusé une mise à jour : ${message}`, { kind: error.kind, status: error.status, walletPassId: job.walletPassId });
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

/**
 * Pousse une classe chez Google si nécessaire. Jamais synchronisée :
 * insert d'abord (409 → PATCH) ; déjà synchronisée : PATCH d'abord (404 →
 * insert, classe supprimée côté console). Rien si l'empreinte est à jour
 * et la classe propre. Le résultat est inscrit en base, succès ou échec.
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
      deps.report?.(`Classe Google Wallet refusée par Google : ${row.classId}`, { classId: row.classId });
    }
    return reviewStatus;
  } catch (error) {
    await deps.store
      .classSynced(row.classId, { hash: null, reviewStatus: null, error: messageOf(error).slice(0, 1000), dirtyAt: null })
      .catch(() => undefined);
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

export function resetEventClassCache(): void {
  eventClassCache.clear();
}

/**
 * Classe d'un drop, créée ou mise à jour au besoin. `rejected` : Google a
 * refusé la classe, aucun billet ne peut en dépendre (bouton masqué,
 * ligne abandonnée) ; `unavailable` : événement introuvable ou classe d'un
 * autre émetteur (configuration changée).
 */
export async function ensureEventClass(deps: GoogleSyncDeps, eventId: string, signal?: AbortSignal): Promise<EventClassState> {
  const nowMs = deps.now().getTime();
  const cached = eventClassCache.get(eventId);
  if (cached && cached > nowMs) return 'ok';

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
  eventClassCache.set(eventId, nowMs + EVENT_CLASS_TTL_MS);
  return 'ok';
}

export interface ClassSyncSummary {
  synced: number;
  failed: number;
  skipped: number;
  halted: boolean;
}

/**
 * Classes à synchroniser (salies par un changement de marque, jamais
 * envoyées, en erreur depuis 10 min, événement en cours sans classe),
 * appelé chaque minute par le cron AVANT le vidage. Borné en nombre et en
 * temps : le cron coupe à 30 s et le vidage passe après.
 */
export async function syncDirtyClasses(
  deps: GoogleSyncDeps,
  options: { limit?: number; budgetMs?: number } = {},
): Promise<ClassSyncSummary> {
  const summary: ClassSyncSummary = { synced: 0, failed: 0, skipped: 0, halted: false };
  const deadline = deps.now().getTime() + (options.budgetMs ?? 6_000);
  const due = await deps.store.classesDue(options.limit ?? 5);
  const { naming } = deps.config;

  for (const item of due) {
    if (deps.now().getTime() >= deadline) break;
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
        await ensureQueueClass(deps);
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
      await syncClass(deps, row, eventClassBody(expected, brand, deps.config.siteUrl), undefined, true);
      eventClassCache.delete(item.eventId);
      summary.synced += 1;
    } catch (error) {
      summary.failed += 1;
      if (error instanceof GoogleWalletError && error.configuration) {
        const reason = configurationReason(error);
        deps.degrade?.(reason);
        deps.report?.(reason, { kind: error.kind, status: error.status });
        summary.halted = true;
        break;
      }
      console.error('[wallet.google] classe non synchronisée', item.classId ?? item.eventId, messageOf(error));
    }
  }
  return summary;
}

/* ====================================================================
   Objets : insertion au clic (distribution)
   ==================================================================== */

/**
 * Crée l'objet chez Google au moment du clic (avant le JWT léger), puis
 * le déclare « tenu à jour ». Idempotent : 409 → PATCH du contenu courant.
 */
export async function insertObjectAndGoLive(
  deps: GoogleSyncDeps,
  snap: WalletSnapshot,
  view: WalletView,
  signal?: AbortSignal,
): Promise<{ type: ReturnType<typeof objectTypeFor>; id: string; hash: string }> {
  const rendered = renderGoogleObject(snap, view, {
    siteUrl: deps.config.siteUrl,
    rotatingBarcode: deps.config.rotatingBarcode,
    now: deps.now(),
    qrSecret: deps.qrSecret,
  });
  const inserted = await deps.api.insertObject(rendered.type, rendered.insert, signal);
  if (inserted.status === 'exists') await deps.api.patchObject(rendered.type, rendered.id, rendered.patch, signal);
  await deps.store.markLive(snap.pass.id, rendered.hash);
  return { type: rendered.type, id: rendered.id, hash: rendered.hash };
}

/* ====================================================================
   Traitement d'une ligne de la file d'envoi
   ==================================================================== */

interface AlertOutcome {
  notified: boolean;
}

/**
 * Envoie le message d'un moment clé. Idempotent : un envoi rejoué après
 * un délai dépassé retrouve son message sur l'objet (même identifiant)
 * ou reçoit un 409, et ne sonne pas deux fois.
 */
async function sendAlert(
  deps: GoogleSyncDeps,
  job: ClaimedJob,
  snap: WalletSnapshot,
  view: WalletView,
  decision: { kind: NonNullable<WalletView['alertKind']>; notify: boolean },
  signal: AbortSignal,
): Promise<AlertOutcome> {
  const type = objectTypeFor(snap.pass.kind);
  const id = snap.pass.externalId;
  const now = deps.now();
  let message = buildAlertMessage(decision.kind, decision.notify, snap, view, now);

  if (job.attempts > 1) {
    // Nouvel essai : l'envoi précédent a peut-être abouti sans être
    // inscrit. Google n'impose pas l'unicité des identifiants de message :
    // on vérifie nous-mêmes.
    const current = await deps.api.getObject(type, id, signal);
    const messages = Array.isArray(current?.messages) ? (current!.messages as GoogleResource[]) : [];
    const previous = messages.find((m) => m.id === message.id);
    if (previous) return { notified: previous.messageType === 'TEXT_AND_NOTIFY' };
  }

  let added: Awaited<ReturnType<GoogleApi['addMessage']>>;
  try {
    added = await deps.api.addMessage(type, id, message, signal);
  } catch (error) {
    if (!decision.notify || !isNotificationQuotaError(error)) throw error;
    // Quota de Google atteint (3 sonneries par 24 h) : le message reste
    // au dos du pass, sans sonnerie.
    message = { ...message, messageType: 'TEXT' };
    added = await deps.api.addMessage(type, id, message, signal);
  }

  const keep = prunedMessages(added.resource?.messages);
  if (keep) {
    try {
      await deps.api.patchObject(type, id, { messages: keep }, signal);
    } catch (error) {
      // Élagage de confort : jamais bloquant pour l'alerte elle-même.
      console.warn('[wallet.google] élagage des messages impossible', messageOf(error));
    }
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
      const scrub = renderScrubPatch(snap, view);
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
        deps.report?.('Classe d’événement refusée par Google : billets figés', { eventId: snap.event.id });
        return { ok: false, error: 'Classe d’événement refusée par Google', retryAfterSeconds: 0, dead: true };
      }
      if (state === 'unavailable') {
        return { ok: false, error: 'Classe d’événement indisponible', retryAfterSeconds: backoffSeconds(job.attempts, deps.random), dead: job.attempts >= MAX_ATTEMPTS };
      }
    }

    const rendered = renderGoogleObject(snap, view, {
      siteUrl: deps.config.siteUrl,
      rotatingBarcode: deps.config.rotatingBarcode,
      now,
      qrSecret: deps.qrSecret,
    });
    if (rendered.hash !== snap.pass.syncedHash) {
      await deps.api.patchObject(rendered.type, rendered.id, rendered.patch, signal);
    }

    const decision = decideAlertFor('google', snap, view, now);
    const alert = decision ? await sendAlert(deps, job, snap, view, decision, signal) : null;

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
