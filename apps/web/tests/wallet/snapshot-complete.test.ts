import { beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from './fixtures';

/**
 * completeWalletSnapshot() : ce que wallet_pass_snapshot() (0021) ne livre
 * pas encore, lu à côté. On vérifie les requêtes elles-mêmes (tables,
 * filtres), parce qu'une faute de nom ici ferait sonner « C’est votre
 * tour » pendant un drop, ou taire un rappel après un report.
 */

interface Call { table: string; ops: [string, ...unknown[]][] }
const calls: Call[] = [];
let rows: Record<string, { data: unknown; error: { message: string } | null }> = {};

function builder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args]);
      return chain;
    };
  }
  chain.maybeSingle = async () => rows[table] ?? { data: null, error: null };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (table: string) => builder(table) }),
}));

const { completeWalletSnapshot } = await import('../../src/server/wallet/outbox');

beforeEach(() => {
  calls.length = 0;
  rows = {};
});

describe('completeWalletSnapshot', () => {
  it('drop en cours, dernière remise à zéro et registre du moteur', async () => {
    rows = {
      event_campaigns: { data: { id: 'ev-1' }, error: null },
      queue_entries: { data: { id: 'entry-uuid', notification_status: { ahead_one: 'at_join', your_turn: '2026-09-24T12:05:00+00', bad: 3 } }, error: null },
      queue_events: { data: { created_at: '2026-09-24T12:06:00.123456+00:00' }, error: null },
    };
    const snap = snapshot();
    const out = await completeWalletSnapshot(snap);

    expect(out.queue.runningEventId).toBe('ev-1');
    expect(out.entry.rankResetAt).toBe('2026-09-24T12:06:00.123456+00:00');
    // Seules les chaînes passent : un registre corrompu ne fait rien planter.
    expect(out.entry.engineLedger).toEqual({ ahead_one: 'at_join', your_turn: '2026-09-24T12:05:00+00' });

    const byTable = Object.fromEntries(calls.map((c) => [c.table, c.ops]));
    // Même détection que dispatchQueueNotifications.
    expect(byTable.event_campaigns).toContainEqual(['eq', 'queue_id', snap.queue.id]);
    expect(byTable.event_campaigns).toContainEqual(['in', 'status', ['live', 'paused']]);
    expect(byTable.queue_entries).toContainEqual(['eq', 'public_id', snap.entry.publicId]);
    // Les trois actions du moteur qui vident ses paliers (0008).
    expect(byTable.queue_events).toContainEqual(['eq', 'entry_id', 'entry-uuid']);
    expect(byTable.queue_events).toContainEqual(['in', 'event_type', ['defer', 'absent_move_back', 'restore']]);
    expect(byTable.queue_events).toContainEqual(['order', 'created_at', { ascending: false }]);
    // Aucune colonne de prénom demandée.
    expect(JSON.stringify(calls)).not.toMatch(/client_name/);
  });

  it('rien à compléter : aucune lecture', async () => {
    const snap = snapshot({ queue: { runningEventId: null }, entry: { rankResetAt: null, engineLedger: {} } });
    expect(await completeWalletSnapshot(snap)).toBe(snap);
    expect(calls).toEqual([]);
  });

  it('aucun drop, aucun report : champs nuls, pas absents', async () => {
    rows = { queue_entries: { data: { id: 'entry-uuid', notification_status: {} }, error: null } };
    const out = await completeWalletSnapshot(snapshot());
    expect(out.queue.runningEventId).toBeNull();
    expect(out.entry.rankResetAt).toBeNull();
    expect(out.entry.engineLedger).toEqual({});
  });

  it('lecture en échec : on lève (envoi retardé plutôt qu’une alerte pendant un drop)', async () => {
    rows = { event_campaigns: { data: null, error: { message: 'délai dépassé' } } };
    await expect(completeWalletSnapshot(snapshot())).rejects.toThrow('event_campaigns : délai dépassé');
  });
});
