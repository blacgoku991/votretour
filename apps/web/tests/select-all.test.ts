import { describe, it, expect } from 'vitest';
import { selectAll, SELECT_PAGE_SIZE } from '../src/server/select-all';

/**
 * PostgREST renvoie au plus 1000 lignes par réponse, quel que soit le
 * .limit() demandé. selectAll doit tout lire, page après page.
 */

function fakeTable(total: number) {
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, total, from + SELECT_PAGE_SIZE);
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null };
  };
  return { calls, page };
}

describe('selectAll', () => {
  it('lit au-delà de 1000 lignes', async () => {
    const table = fakeTable(2350);
    const rows = await selectAll(table.page);
    expect(rows).toHaveLength(2350);
    expect(new Set(rows).size).toBe(2350);
    expect(table.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('s’arrête après une page pleine suivie d’une page vide', async () => {
    const table = fakeTable(1000);
    expect(await selectAll(table.page)).toHaveLength(1000);
    expect(table.calls).toHaveLength(2);
  });

  it('remonte l’erreur au lieu de rendre une liste tronquée', async () => {
    let n = 0;
    const page = async () => (n++ === 0
      ? { data: Array.from({ length: SELECT_PAGE_SIZE }, (_, i) => i), error: null }
      : { data: null, error: new Error('max-rows') });
    await expect(selectAll(page)).rejects.toThrow('max-rows');
  });
});
