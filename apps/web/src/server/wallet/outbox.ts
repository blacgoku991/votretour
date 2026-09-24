import 'server-only';
import { after } from 'next/server';
import { env } from '@/lib/env';
import { buildWalletView } from './view';
import { RANK_RESET_EVENTS } from './alerts';
import { markWalletDegraded, walletProviders, walletStatus } from './providers';
import type {
  ClaimedJob, JobResult, ProviderStatus, WalletProvider, WalletProviderId, WalletSnapshot,
} from './types';

/**
 * Vidage de la file d'envoi Wallet (wallet_outbox).
 *
 * La file est alimentée UNIQUEMENT par des déclencheurs SQL : aucune
 * action applicative ne peut oublier de prévenir le Wallet. Ici, on la
 * vide :
 *  - juste après chaque mutation, par `after()` dans propagate() : APRÈS
 *    la réponse au pro (TERMINER reste instantané) et après les
 *    notifications de la même action (la règle « seulement si aucun autre
 *    canal n'a livré » lit ainsi un journal à jour) ;
 *  - chaque minute par /api/cron/notifications : filet de sécurité, et
 *    transitions différées (« Merci » archivé à +2 h).
 *
 * Une ligne n'est qu'un drapeau de travail : l'état envoyé est relu au
 * moment du traitement (wallet_pass_snapshot), jamais figé à l'enfilement.
 *
 * GARANTIE : une panne Wallet ne fait JAMAIS échouer une action de file.
 * Rien ici ne lève : chaque ligne est isolée (l'échec d'un pass n'arrête
 * pas les autres), chaque fournisseur aussi, et le tout tourne après la
 * réponse. Sans fournisseur prêt, le vidage ne touche même pas la base.
 */

/** Concurrence par fournisseur : 20 flux HTTP/2 APNs, seau de 10 req/s Google. */
const CONCURRENCY: Record<WalletProviderId, number> = { apple: 20, google: 8 };
/** Délai maximal d'un traitement (instantané + fournisseur). */
export const JOB_TIMEOUT_MS = 15_000;
/**
 * Délai minimal accordé à un lot, même en fin de budget : 8 s, le délai
 * d'un appel REST Google (§ 8.1). Un lot n'est réclamé que s'il reste au
 * moins CLAIM_FLOOR_MS de budget. Pire cas du cron (budget 20 s) :
 * 20 − 2 + 8 = 26 s, sous le `curl -m 30` du conteneur cron.
 */
export const MIN_JOB_MS = 8_000;
export const CLAIM_FLOOR_MS = 2_000;
const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 8;
/** Nouvelles tentatives de complete_wallet_outbox après un envoi réussi. */
const COMPLETE_RETRY_MS = [250, 1_000] as const;

export interface WalletFlushOptions {
  /** Seulement les passes de cette file (vidage après une action). */
  queueId?: string | null;
  /** Temps maximal : 4 s après une action, 20 s depuis le cron (curl -m 30). */
  budgetMs?: number;
  /** Nombre maximal de lignes traitées, tous fournisseurs confondus. */
  limit?: number;
}

export interface WalletFlushSummary {
  ready: WalletProviderId[];
  processed: number;
  done: number;
  failed: number;
  /** Traitements abandonnés au délai (leur résultat tardif est encore enregistré). */
  timedOut: number;
  halted: WalletProviderId[];
  budgetExhausted: boolean;
  durationMs: number;
}

/** Accès aux données et à l'horloge : injectables pour les tests (aucun appel réseau). */
export interface OutboxDeps {
  providers(): WalletProvider[];
  status(provider: WalletProvider): Promise<ProviderStatus>;
  claim(provider: WalletProviderId, queueId: string | null, limit: number, leaseSeconds: number): Promise<ClaimedJob[]>;
  snapshot(passId: string): Promise<WalletSnapshot | null>;
  complete(id: number, result: Record<string, unknown>): Promise<void>;
  fail(id: number, error: string, retryAfterSeconds: number, dead: boolean): Promise<void>;
  degrade(provider: WalletProviderId, reason: string): void;
  now(): number;
  /** Attente entre deux tentatives de complete (par défaut setTimeout). */
  sleep?(ms: number): Promise<void>;
  siteUrl: string;
}

interface ClaimRow {
  id: number | string;
  wallet_pass_id: string;
  provider: WalletProviderId;
  queue_id: string;
  job: 'sync' | 'scrub';
  reasons: string[] | null;
  priority: number;
  attempts: number;
  run_after: string;
  created_at: string;
}

async function adminDb() {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  return supabaseAdmin();
}

async function adminRpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await (await adminDb()).rpc(fn, params);
  if (error) throw new Error(`${fn} : ${error.message}`);
  return data as T;
}

/**
 * Complète l'instantané SQL de ce qu'il ne livre pas encore (voir
 * types.ts : queue.runningEventId, entry.rankResetAt, entry.engineLedger).
 * Chaque champ déjà fourni par wallet_pass_snapshot() est gardé tel quel :
 * dès que W0 les livre, cette fonction ne lit plus rien.
 *
 * Une lecture en échec LÈVE (le traitement échoue et sera repris) : mieux
 * vaut un envoi retardé qu'un « C’est votre tour » pendant un drop.
 */
export async function completeWalletSnapshot(snap: WalletSnapshot): Promise<WalletSnapshot> {
  const needEvent = snap.queue.runningEventId === undefined;
  const needEntry = snap.entry.rankResetAt === undefined || snap.entry.engineLedger === undefined;
  if (!needEvent && !needEntry) return snap;
  const db = await adminDb();

  const runningEvent = async (): Promise<string | null> => {
    // Même détection que dispatchQueueNotifications.
    const { data, error } = await db
      .from('event_campaigns')
      .select('id')
      .eq('queue_id', snap.queue.id)
      .in('status', ['live', 'paused'])
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`event_campaigns : ${error.message}`);
    return (data?.id as string | undefined) ?? null;
  };

  const entryLedger = async (): Promise<{ rankResetAt: string | null; engineLedger: Partial<Record<string, string>> }> => {
    const { data: row, error } = await db
      .from('queue_entries')
      .select('id, notification_status')
      .eq('public_id', snap.entry.publicId)
      .maybeSingle();
    if (error) throw new Error(`queue_entries : ${error.message}`);
    if (!row) return { rankResetAt: null, engineLedger: {} };
    const { data: reset, error: resetError } = await db
      .from('queue_events')
      .select('created_at')
      .eq('entry_id', row.id)
      .in('event_type', [...RANK_RESET_EVENTS])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (resetError) throw new Error(`queue_events : ${resetError.message}`);
    const raw = (row.notification_status ?? {}) as Record<string, unknown>;
    const engineLedger: Partial<Record<string, string>> = {};
    for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') engineLedger[key] = value;
    return { rankResetAt: (reset?.created_at as string | undefined) ?? null, engineLedger };
  };

  const [eventId, ledger] = await Promise.all([
    needEvent ? runningEvent() : Promise.resolve(snap.queue.runningEventId ?? null),
    needEntry ? entryLedger() : Promise.resolve(null),
  ]);

  return {
    ...snap,
    queue: { ...snap.queue, runningEventId: eventId },
    entry: {
      ...snap.entry,
      rankResetAt: snap.entry.rankResetAt !== undefined ? snap.entry.rankResetAt : (ledger?.rankResetAt ?? null),
      engineLedger: snap.entry.engineLedger ?? ledger?.engineLedger ?? {},
    },
  };
}

/**
 * Instantané complet d'un pass, pour le vidage ET pour les routes des
 * fournisseurs (distribution, service web Apple) : toujours passer par ici
 * plutôt que d'appeler wallet_pass_snapshot() directement.
 */
export async function loadWalletSnapshot(passId: string): Promise<WalletSnapshot | null> {
  const snap = await adminRpc<WalletSnapshot | null>('wallet_pass_snapshot', { p_pass_id: passId });
  return snap ? completeWalletSnapshot(snap) : null;
}

export function defaultOutboxDeps(): OutboxDeps {
  return {
    providers: walletProviders,
    status: (provider) => walletStatus(provider),
    async claim(provider, queueId, limit, leaseSeconds) {
      const rows = await adminRpc<ClaimRow[] | null>('claim_wallet_outbox', {
        p_provider: provider,
        p_queue_id: queueId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      return (rows ?? []).map(toClaimedJob);
    },
    snapshot: loadWalletSnapshot,
    async complete(id, result) {
      await adminRpc('complete_wallet_outbox', { p_id: id, p_result: result });
    },
    async fail(id, error, retryAfterSeconds, dead) {
      await adminRpc('fail_wallet_outbox', {
        p_id: id,
        p_error: error.slice(0, 1000),
        p_retry_after_seconds: Math.max(1, Math.round(retryAfterSeconds)),
        p_dead: dead,
      });
    },
    degrade: markWalletDegraded,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    siteUrl: env.siteUrl,
  };
}

export function toClaimedJob(row: ClaimRow): ClaimedJob {
  return {
    id: Number(row.id),
    walletPassId: row.wallet_pass_id,
    provider: row.provider,
    queueId: row.queue_id,
    job: row.job,
    reasons: row.reasons ?? [],
    priority: row.priority,
    attempts: row.attempts,
    runAfter: row.run_after,
    createdAt: row.created_at,
  };
}

/** Charge utile de complete_wallet_outbox : seulement les clés renseignées. */
export function completionPayload(result: Extract<JobResult, { ok: true }>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const keys = ['syncedHash', 'live', 'holderState', 'alertKind', 'alertNotified', 'final', 'reopen', 'nextRunAfter', 'error'] as const;
  for (const key of keys) {
    const value = result[key];
    if (value !== undefined && value !== null) payload[key] = value;
  }
  return payload;
}

/** Attente croissante : 15 s, 30 s, 1 min… plafonnée à 30 min. */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(1800, 15 * 2 ** Math.max(0, attempts - 1));
}

/** Délai d'un lot réclamé à `now` : jamais au-delà du budget + MIN_JOB_MS. */
export function jobTimeoutMs(now: number, deadline: number): number {
  return Math.min(JOB_TIMEOUT_MS, Math.max(MIN_JOB_MS, deadline - now));
}

const TIMEOUT = Symbol('timeout');
const MISSING = Symbol('missing');

/** Motif d'annulation transmis au fournisseur par le signal. */
export class WalletJobTimeoutError extends Error {
  constructor(ms: number) {
    super(`Délai de traitement dépassé (${ms} ms)`);
    this.name = 'WalletJobTimeoutError';
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type JobOutcome = 'done' | 'failed' | 'halt' | 'timeout';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'erreur inconnue';
}

/**
 * Après un envoi RÉUSSI, l'enregistrement ne doit pas se perdre : sans lui,
 * ni le registre d'alertes ni le budget Google ne sont écrits, et la ligne
 * repartirait (nouvelle sonnerie). On réessaie donc complete, puis, s'il
 * échoue encore, on n'appelle PAS fail (qui reprogrammerait l'envoi dans
 * 15 s) : la ligne attend l'expiration du bail (60 s). L'envoi rejoué
 * reste sans double sonnerie grâce à l'idempotence des fournisseurs
 * (voir WalletProvider.process dans types.ts).
 */
async function completeReliably(deps: OutboxDeps, job: ClaimedJob, payload: Record<string, unknown>): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.complete(job.id, payload);
      return true;
    } catch (error) {
      const wait = COMPLETE_RETRY_MS[attempt];
      if (wait === undefined) {
        console.error('[wallet] enregistrement impossible après envoi', job.provider, job.id, errorMessage(error));
        return false;
      }
      await sleep(wait);
    }
  }
}

async function failQuietly(deps: OutboxDeps, job: ClaimedJob, message: string): Promise<void> {
  try {
    await deps.fail(job.id, message, retryDelaySeconds(job.attempts), job.attempts >= MAX_ATTEMPTS);
  } catch {
    /* la ligne redeviendra réclamable à l'expiration du bail */
  }
}

/** Enregistre l'issue d'un traitement : complete, fail, ou rien si le bail s'en chargera. */
async function record(
  provider: WalletProvider,
  job: ClaimedJob,
  deps: OutboxDeps,
  result: JobResult | typeof MISSING,
): Promise<JobOutcome> {
  if (result === MISSING) {
    // Pass supprimé entre l'enfilement et le traitement (purge) : rien à envoyer.
    return (await completeReliably(deps, job, { error: 'Pass introuvable' })) ? 'done' : 'failed';
  }
  if (result.ok) {
    return (await completeReliably(deps, job, completionPayload(result))) ? 'done' : 'failed';
  }
  try {
    await deps.fail(job.id, result.error, result.retryAfterSeconds, result.dead);
  } catch {
    /* la ligne redeviendra réclamable à l'expiration du bail */
  }
  return result.haltProvider ? 'halt' : 'failed';
}

async function runJob(provider: WalletProvider, job: ClaimedJob, deps: OutboxDeps, timeoutMs: number): Promise<JobOutcome> {
  const controller = new AbortController();
  const work = (async (): Promise<JobResult | typeof MISSING> => {
    const snap = await deps.snapshot(job.walletPassId);
    if (!snap) return MISSING;
    // Délai déjà dépassé pendant la lecture : on n'envoie plus rien.
    controller.signal.throwIfAborted();
    const now = new Date(deps.now());
    const view = buildWalletView(snap, now, { siteUrl: deps.siteUrl });
    return provider.process(job, snap, now, view, controller.signal);
  })();

  let result: JobResult | typeof MISSING | typeof TIMEOUT;
  try {
    result = await withTimeout(work, timeoutMs);
  } catch (error) {
    console.error('[wallet] traitement impossible', provider.id, job.id, errorMessage(error));
    await failQuietly(deps, job, errorMessage(error));
    return 'failed';
  }

  if (result === TIMEOUT) {
    // On annule (le fournisseur relaie le signal à fetch et à APNs), et on
    // garde la main : si le travail aboutit malgré tout, son résultat réel
    // est enregistré (registre, budget, notification_deliveries) ; s'il
    // échoue ou est annulé, la ligne repart proprement par fail. Sans
    // cette suite, un envoi tardif ferait sonner sans rien inscrire, et
    // la reprise à l'expiration du bail ferait sonner une seconde fois.
    console.warn('[wallet] traitement trop long', provider.id, job.id);
    controller.abort(new WalletJobTimeoutError(timeoutMs));
    void work.then(
      (late) => record(provider, job, deps, late),
      (error: unknown) => failQuietly(deps, job, errorMessage(error)),
    ).catch(() => undefined);
    return 'timeout';
  }

  return record(provider, job, deps, result);
}

export async function flushWalletOutbox(
  options: WalletFlushOptions = {},
  deps: OutboxDeps = defaultOutboxDeps(),
): Promise<WalletFlushSummary> {
  const started = deps.now();
  const budgetMs = Math.max(0, options.budgetMs ?? 4_000);
  const limit = Math.max(1, options.limit ?? 100);
  const deadline = started + budgetMs;
  const summary: WalletFlushSummary = {
    ready: [], processed: 0, done: 0, failed: 0, timedOut: 0, halted: [], budgetExhausted: false, durationMs: 0,
  };

  // Fournisseurs prêts seulement : un fournisseur non prêt laisse ses
  // lignes en attente (la purge finit par les retirer).
  const ready: WalletProvider[] = [];
  for (const provider of deps.providers()) {
    try {
      if ((await deps.status(provider)).ready) ready.push(provider);
    } catch {
      /* état illisible : traité comme non prêt */
    }
  }
  summary.ready = ready.map((p) => p.id);

  for (const provider of ready) {
    let halted = false;
    while (!halted && summary.processed < limit) {
      // Un lot réclamé doit pouvoir finir : pas de réclamation dans les
      // dernières secondes du budget (voir CLAIM_FLOOR_MS).
      if (deadline - deps.now() < CLAIM_FLOOR_MS) {
        summary.budgetExhausted = true;
        break;
      }
      let batch: ClaimedJob[];
      try {
        // Lots de la taille de la concurrence : tout ce qui est réclamé
        // démarre aussitôt, rien ne reste réclamé sans être traité.
        batch = await deps.claim(
          provider.id,
          options.queueId ?? null,
          Math.min(CONCURRENCY[provider.id], limit - summary.processed),
          LEASE_SECONDS,
        );
      } catch (error) {
        console.error('[wallet] réclamation impossible', provider.id, error instanceof Error ? error.message : error);
        break;
      }
      if (batch.length === 0) break;

      // Un délai commun au lot, borné par le budget restant : le vidage
      // ne déborde jamais de plus de MIN_JOB_MS.
      const timeoutMs = jobTimeoutMs(deps.now(), deadline);
      const outcomes = await Promise.all(batch.map((job) => runJob(provider, job, deps, timeoutMs)));
      for (const outcome of outcomes) {
        summary.processed += 1;
        if (outcome === 'done') summary.done += 1;
        else summary.failed += 1;
        if (outcome === 'timeout') summary.timedOut += 1;
        if (outcome === 'halt') halted = true;
      }
    }
    if (halted) {
      // Certificat refusé, compte de service révoqué : inutile d'insister,
      // et plus aucun bouton pendant 5 min.
      summary.halted.push(provider.id);
      deps.degrade(provider.id, 'Envoi refusé par le fournisseur : voir les journaux Wallet.');
    }
  }

  summary.durationMs = deps.now() - started;
  return summary;
}

/**
 * Programme un vidage ciblé après la réponse (propagate). Hors requête
 * (script, test), `after` lève : on lance alors le vidage sans l'attendre.
 * Ne lève JAMAIS.
 */
export function scheduleWalletFlush(queueId: string, deps?: OutboxDeps): void {
  const run = () =>
    flushWalletOutbox({ queueId, budgetMs: 4_000, limit: 100 }, deps ?? defaultOutboxDeps()).then(
      () => undefined,
      (error: unknown) => console.error('[wallet] vidage impossible', error instanceof Error ? error.message : error),
    );
  try {
    after(run);
  } catch {
    void run();
  }
}
