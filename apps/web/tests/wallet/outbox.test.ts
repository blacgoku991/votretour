import { describe, expect, it, vi } from 'vitest';
import {
  CLAIM_FLOOR_MS, JOB_TIMEOUT_MS, MIN_JOB_MS, WalletJobTimeoutError,
  completionPayload, flushWalletOutbox, jobTimeoutMs, retryDelaySeconds, scheduleWalletFlush, toClaimedJob, type OutboxDeps,
} from '../../src/server/wallet/outbox';
import { walletProviders } from '../../src/server/wallet/providers';
import type { ClaimedJob, JobResult, WalletProvider, WalletProviderId } from '../../src/server/wallet/types';
import { SITE, snapshot } from './fixtures';

/**
 * Vidage de la file d'envoi, sans base ni réseau : tout passe par des
 * dépendances simulées. La garantie testée : le Wallet ne gêne jamais la
 * file (budget tenu, fournisseur non prêt ignoré, un pass en panne
 * n'arrête pas les autres, rien ne lève).
 */

function job(id: number, provider: WalletProviderId = 'google'): ClaimedJob {
  return {
    id, walletPassId: `pass-${id}`, provider, queueId: 'q1', job: 'sync', reasons: ['position'],
    priority: 0, attempts: 1, runAfter: '2026-09-24T12:00:00Z', createdAt: '2026-09-24T12:00:00Z',
  };
}

function fakeProvider(id: WalletProviderId, ready: boolean, process: WalletProvider['process']): WalletProvider {
  return {
    id,
    status: async () => ({ ready, reason: ready ? null : 'non construit' }),
    distribute: async () => new Response(null, { status: 404 }),
    process,
  };
}

interface Harness {
  deps: OutboxDeps;
  completed: { id: number; result: Record<string, unknown> }[];
  failed: { id: number; error: string; retry: number; dead: boolean }[];
  claims: { provider: WalletProviderId; queueId: string | null; limit: number }[];
  degraded: string[];
  clock: { t: number };
}

function harness(providers: WalletProvider[], pending: Partial<Record<WalletProviderId, ClaimedJob[]>>, tickMs = 0): Harness {
  const h: Harness = {
    completed: [], failed: [], claims: [], degraded: [], clock: { t: 1_000_000 },
    deps: undefined as unknown as OutboxDeps,
  };
  const queues: Partial<Record<WalletProviderId, ClaimedJob[]>> = structuredClone(pending);
  h.deps = {
    providers: () => providers,
    status: (p) => p.status(),
    claim: async (provider, queueId, limit) => {
      h.claims.push({ provider, queueId, limit });
      const list = queues[provider] ?? [];
      return list.splice(0, limit);
    },
    snapshot: async (passId) => (passId === 'pass-missing' ? null : snapshot({ pass: { id: passId } })),
    complete: async (id, result) => { h.completed.push({ id, result }); },
    fail: async (id, error, retry, dead) => { h.failed.push({ id, error, retry, dead }); },
    degrade: (provider) => { h.degraded.push(provider); },
    now: () => {
      h.clock.t += tickMs;
      return h.clock.t;
    },
    siteUrl: SITE,
  };
  return h;
}

const ok: WalletProvider['process'] = async () => ({ ok: true, syncedHash: 'abcdef0123456789', alertKind: null });

describe('flushWalletOutbox', () => {
  it('fournisseur non prêt : ignoré, ses lignes restent en attente', async () => {
    const h = harness([fakeProvider('apple', false, ok), fakeProvider('google', true, ok)], {
      apple: [job(1, 'apple')], google: [job(2)],
    });
    const summary = await flushWalletOutbox({ budgetMs: 4000 }, h.deps);
    expect(summary.ready).toEqual(['google']);
    expect(h.claims.every((c) => c.provider === 'google')).toBe(true);
    expect(h.completed.map((c) => c.id)).toEqual([2]);
  });

  it('aucun fournisseur prêt : pas un seul appel à la base', async () => {
    const claim = vi.fn();
    const h = harness([fakeProvider('apple', false, ok), fakeProvider('google', false, ok)], {});
    h.deps.claim = claim;
    const summary = await flushWalletOutbox({}, h.deps);
    expect(claim).not.toHaveBeenCalled();
    expect(summary.processed).toBe(0);
  });

  it('les fournisseurs provisoires du lot W1 ne sont pas prêts', async () => {
    const statuses = await Promise.all(walletProviders().map((p) => p.status()));
    expect(statuses.every((s) => s.ready === false)).toBe(true);
  });

  it('l’échec d’un pass n’arrête pas les autres', async () => {
    const process: WalletProvider['process'] = async (j) => {
      if (j.id === 2) throw new Error('Google a répondu 500');
      if (j.id === 3) return { ok: false, error: '429', retryAfterSeconds: 7, dead: false };
      return { ok: true, syncedHash: `hash-${j.id}-0123456`, alertKind: j.id === 4 ? 'ahead_one' : null, alertNotified: j.id === 4 };
    };
    const h = harness([fakeProvider('google', true, process)], { google: [job(1), job(2), job(3), job(4), job(5)] });
    const summary = await flushWalletOutbox({ budgetMs: 4000 }, h.deps);
    expect(summary).toMatchObject({ processed: 5, done: 3, failed: 2 });
    expect(h.completed.map((c) => c.id).sort()).toEqual([1, 4, 5]);
    expect(h.completed.find((c) => c.id === 4)!.result).toEqual({ syncedHash: 'hash-4-0123456', alertKind: 'ahead_one', alertNotified: true });
    expect(h.failed).toEqual([
      { id: 2, error: 'Google a répondu 500', retry: retryDelaySeconds(1), dead: false },
      { id: 3, error: '429', retry: 7, dead: false },
    ]);
  });

  it('pass supprimé entre-temps : ligne soldée sans appel au fournisseur', async () => {
    const process = vi.fn(ok);
    const h = harness([fakeProvider('google', true, process)], { google: [{ ...job(9), walletPassId: 'pass-missing' }] });
    await flushWalletOutbox({}, h.deps);
    expect(process).not.toHaveBeenCalled();
    expect(h.completed).toEqual([{ id: 9, result: { error: 'Pass introuvable' } }]);
  });

  it('budget tenu : arrêt dès qu’il est dépassé, le reste attend le tour suivant', async () => {
    const many = Array.from({ length: 50 }, (_, i) => job(i + 1));
    // Chaque lecture d'horloge avance de 100 ms : le budget de 3 s est vite atteint.
    const h = harness([fakeProvider('google', true, ok)], { google: many }, 100);
    const summary = await flushWalletOutbox({ budgetMs: 3000, limit: 400 }, h.deps);
    expect(summary.budgetExhausted).toBe(true);
    expect(summary.processed).toBeLessThan(50);
    expect(summary.processed).toBeGreaterThan(0);
    // Lots de la taille de la concurrence Google (8) : rien de réclamé sans être traité.
    expect(h.claims.every((c) => c.limit <= 8)).toBe(true);
    expect(h.completed.length + h.failed.length).toBe(summary.processed);
  });

  it('limite respectée et ciblage par file', async () => {
    const h = harness([fakeProvider('apple', true, ok)], { apple: Array.from({ length: 30 }, (_, i) => job(i + 1, 'apple')) });
    const summary = await flushWalletOutbox({ queueId: 'q1', limit: 25 }, h.deps);
    expect(summary.processed).toBe(25);
    expect(h.claims.map((c) => c.limit)).toEqual([20, 5]);
    expect(h.claims.every((c) => c.queueId === 'q1')).toBe(true);
  });

  it('refus du fournisseur (certificat, compte de service) : arrêt du tour et boutons masqués', async () => {
    const process: WalletProvider['process'] = async () =>
      ({ ok: false, error: 'BadCertificate', retryAfterSeconds: 300, dead: false, haltProvider: true } satisfies JobResult);
    const h = harness([fakeProvider('apple', true, process)], { apple: Array.from({ length: 45 }, (_, i) => job(i + 1, 'apple')) });
    const summary = await flushWalletOutbox({ limit: 400 }, h.deps);
    expect(summary.halted).toEqual(['apple']);
    expect(summary.processed).toBe(20);
    expect(h.degraded).toEqual(['apple']);
  });

  it('fin de budget : aucune réclamation dans les dernières secondes', async () => {
    const h = harness([fakeProvider('google', true, ok)], { google: [job(1)] });
    const summary = await flushWalletOutbox({ budgetMs: CLAIM_FLOOR_MS - 1 }, h.deps);
    expect(h.claims).toEqual([]);
    expect(summary).toMatchObject({ processed: 0, budgetExhausted: true });
  });

  it('délai d’un lot borné par le budget restant (pire cas du cron sous 30 s)', () => {
    expect(jobTimeoutMs(0, 20_000)).toBe(JOB_TIMEOUT_MS);
    expect(jobTimeoutMs(10_000, 20_000)).toBe(10_000);
    // En fin de budget, un lot garde au moins le délai d'un appel REST.
    expect(jobTimeoutMs(18_000, 20_000)).toBe(MIN_JOB_MS);
    // Dernière réclamation possible à échéance − CLAIM_FLOOR_MS : 20 − 2 + 8 = 26 s.
    expect(20_000 - CLAIM_FLOOR_MS + jobTimeoutMs(20_000 - CLAIM_FLOOR_MS, 20_000)).toBeLessThanOrEqual(26_000);
  });

  it('envoi réussi mais enregistrement en échec : complete réessayé, jamais fail (pas de seconde sonnerie)', async () => {
    const h = harness([fakeProvider('google', true, ok)], { google: [job(1), job(2)] });
    const attempts: Record<number, number> = {};
    h.deps.complete = async (id, result) => {
      attempts[id] = (attempts[id] ?? 0) + 1;
      if (id === 1 && attempts[id]! < 3) throw new Error('base occupée');
      if (id === 2) throw new Error('base indisponible');
      h.completed.push({ id, result });
    };
    const sleeps: number[] = [];
    h.deps.sleep = async (ms) => { sleeps.push(ms); };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const summary = await flushWalletOutbox({ budgetMs: 4000 }, h.deps);
      expect(attempts).toEqual({ 1: 3, 2: 3 });
      expect(h.completed.map((c) => c.id)).toEqual([1]);
      // Un fail reprogrammerait l'envoi dans 15 s, et l'alerte avec : la
      // ligne attend plutôt l'expiration du bail.
      expect(h.failed).toEqual([]);
      expect(summary).toMatchObject({ done: 1, failed: 1 });
      // Deux lignes en parallèle : 250 ms puis 1 s d'attente chacune.
      expect([...sleeps].sort((a, b) => a - b)).toEqual([250, 250, 1000, 1000]);
    } finally {
      error.mockRestore();
    }
  });

  it('une panne de réclamation ne lève pas', async () => {
    const h = harness([fakeProvider('google', true, ok)], {});
    h.deps.claim = async () => { throw new Error('base indisponible'); };
    await expect(flushWalletOutbox({}, h.deps)).resolves.toMatchObject({ processed: 0 });
  });
});

describe('fournisseur lent', () => {
  /** Laisse s'écouler les microtâches et les minuteries simulées en attente. */
  async function settle() {
    for (let i = 0; i < 10; i += 1) await vi.advanceTimersByTimeAsync(1);
  }

  it('délai dépassé : signal annulé, le vidage rend la main, le résultat tardif est ENREGISTRÉ', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const signals: AbortSignal[] = [];
      const effects: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      // Fournisseur qui n'écoute pas le signal (le pire cas) : il finit par
      // envoyer son alerte, bien après le délai.
      const slow: WalletProvider['process'] = async (j, _snap, _now, _view, signal) => {
        signals.push(signal);
        await gate;
        effects.push(`addMessage TEXT_AND_NOTIFY ${j.id}`);
        return { ok: true, syncedHash: `late-${j.id}-0123456`, alertKind: 'your_turn', alertNotified: true };
      };
      const h = harness([fakeProvider('google', true, slow)], { google: [job(1), job(2)] });
      const flush = flushWalletOutbox({ budgetMs: 20_000 }, h.deps);
      await vi.advanceTimersByTimeAsync(JOB_TIMEOUT_MS);
      const summary = await flush;
      expect(summary).toMatchObject({ processed: 2, timedOut: 2, done: 0 });
      expect(signals.map((sig) => sig.aborted)).toEqual([true, true]);
      expect(signals[0]!.reason).toBeInstanceOf(WalletJobTimeoutError);
      expect(h.completed).toEqual([]);

      // L'envoi aboutit après coup : le registre, le budget et la ligne de
      // notification_deliveries sont écrits (sinon la reprise au bail
      // ferait sonner une seconde fois).
      release();
      await settle();
      expect(effects).toEqual(['addMessage TEXT_AND_NOTIFY 1', 'addMessage TEXT_AND_NOTIFY 2']);
      expect(h.completed.map((c) => c.id).sort()).toEqual([1, 2]);
      expect(h.completed[0]!.result).toMatchObject({ alertKind: 'your_turn', alertNotified: true });
      expect(h.failed).toEqual([]);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('fournisseur qui relaie le signal : annulé, la ligne repart par fail', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const obedient: WalletProvider['process'] = (_j, _snap, _now, _view, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      const h = harness([fakeProvider('google', true, obedient)], { google: [job(1)] });
      const flush = flushWalletOutbox({ budgetMs: 20_000 }, h.deps);
      await vi.advanceTimersByTimeAsync(JOB_TIMEOUT_MS);
      await flush;
      await settle();
      expect(h.completed).toEqual([]);
      expect(h.failed).toEqual([
        { id: 1, error: `Délai de traitement dépassé (${JOB_TIMEOUT_MS} ms)`, retry: retryDelaySeconds(1), dead: false },
      ]);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('délai plus court en fin de budget : le vidage ne déborde que de MIN_JOB_MS', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const never: WalletProvider['process'] = () => new Promise(() => undefined);
      const h = harness([fakeProvider('google', true, never)], { google: [job(1)] });
      // Budget de 3 s : réclamation permise, délai porté à MIN_JOB_MS.
      const flush = flushWalletOutbox({ budgetMs: 3_000 }, h.deps);
      await vi.advanceTimersByTimeAsync(MIN_JOB_MS - 1);
      let finished = false;
      void flush.then(() => { finished = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(flush).resolves.toMatchObject({ timedOut: 1 });
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('outils', () => {
  it('scheduleWalletFlush hors requête : repli sans exception', async () => {
    const h = harness([fakeProvider('google', true, ok)], { google: [job(1)] });
    expect(() => scheduleWalletFlush('q1', h.deps)).not.toThrow();
    await vi.waitFor(() => expect(h.completed.map((c) => c.id)).toEqual([1]));
    expect(h.claims[0]!.queueId).toBe('q1');
  });

  it('scheduleWalletFlush avec les dépendances réelles : aucun fournisseur prêt, aucune erreur', () => {
    expect(() => scheduleWalletFlush('q1')).not.toThrow();
  });

  it('charge utile de fin : seulement les clés renseignées', () => {
    expect(completionPayload({ ok: true, syncedHash: 'h', final: true, alertKind: null, nextRunAfter: undefined }))
      .toEqual({ syncedHash: 'h', final: true });
  });

  it('lignes SQL → ClaimedJob ; attente croissante bornée', () => {
    expect(toClaimedJob({
      id: '12', wallet_pass_id: 'p', provider: 'apple', queue_id: 'q', job: 'scrub', reasons: null,
      priority: 1, attempts: 2, run_after: 'r', created_at: 'c',
    })).toEqual({
      id: 12, walletPassId: 'p', provider: 'apple', queueId: 'q', job: 'scrub', reasons: [],
      priority: 1, attempts: 2, runAfter: 'r', createdAt: 'c',
    });
    expect(retryDelaySeconds(1)).toBe(15);
    expect(retryDelaySeconds(3)).toBe(60);
    expect(retryDelaySeconds(40)).toBe(1800);
  });
});
