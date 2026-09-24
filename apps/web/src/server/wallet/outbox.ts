import 'server-only';
import { after } from 'next/server';
import { env } from '@/lib/env';
import { buildWalletView } from './view';
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
/** Un traitement bloqué ne retient pas le vidage : le bail le rendra réclamable. */
export const JOB_TIMEOUT_MS = 15_000;
const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 8;

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

async function adminRpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const { data, error } = await supabaseAdmin().rpc(fn, params);
  if (error) throw new Error(`${fn} : ${error.message}`);
  return data as T;
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
    async snapshot(passId) {
      return (await adminRpc<WalletSnapshot | null>('wallet_pass_snapshot', { p_pass_id: passId })) ?? null;
    },
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

const TIMEOUT = Symbol('timeout');

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

async function runJob(provider: WalletProvider, job: ClaimedJob, deps: OutboxDeps): Promise<JobOutcome> {
  try {
    const snap = await deps.snapshot(job.walletPassId);
    if (!snap) {
      // Pass supprimé entre l'enfilement et le traitement (purge) : rien à envoyer.
      await deps.complete(job.id, { error: 'Pass introuvable' });
      return 'done';
    }
    const now = new Date(deps.now());
    const view = buildWalletView(snap, now, { siteUrl: deps.siteUrl });
    const result = await withTimeout(provider.process(job, snap, now, view), JOB_TIMEOUT_MS);
    if (result === TIMEOUT) {
      // On n'écrit rien : la ligne reste « en cours » et redevient
      // réclamable à l'expiration du bail, qui relira l'état courant.
      console.warn('[wallet] traitement trop long', provider.id, job.id);
      return 'timeout';
    }
    if (result.ok) {
      await deps.complete(job.id, completionPayload(result));
      return 'done';
    }
    await deps.fail(job.id, result.error, result.retryAfterSeconds, result.dead);
    return result.haltProvider ? 'halt' : 'failed';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erreur inconnue';
    console.error('[wallet] traitement impossible', provider.id, job.id, message);
    try {
      await deps.fail(job.id, message, retryDelaySeconds(job.attempts), job.attempts >= MAX_ATTEMPTS);
    } catch {
      /* la ligne redeviendra réclamable à l'expiration du bail */
    }
    return 'failed';
  }
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
    ready: [], processed: 0, done: 0, failed: 0, halted: [], budgetExhausted: false, durationMs: 0,
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
      if (deps.now() >= deadline) {
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

      const outcomes = await Promise.all(batch.map((job) => runJob(provider, job, deps)));
      for (const outcome of outcomes) {
        summary.processed += 1;
        if (outcome === 'done') summary.done += 1;
        else summary.failed += 1;
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
