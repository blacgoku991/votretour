import { describe, expect, it } from 'vitest';
import { suggestTable, tableKeys, type WaitingGroup } from '@/lib/profiles/table-suggest';

/**
 * « Table libre pour 4 » : le premier arrivé qui tient ; une alternative
 * mieux ajustée seulement proposée, jamais imposée.
 */

const g = (id: string, partySize: number, order: number): WaitingGroup => ({ id, partySize, order });

describe('suggestTable', () => {
  it('propose le premier groupe, dans l’ordre d’arrivée, qui tient à la table', () => {
    const groups = [g('karim', 6, 1), g('lea', 4, 2), g('sam', 3, 3)];
    const s = suggestTable({ size: 4 }, groups);
    expect(s?.primary.id).toBe('lea');
    expect(s?.alternative).toBeNull();
  });

  it('suit l’ordre d’arrivée, pas l’ordre du tableau reçu', () => {
    const s = suggestTable({ size: 4 }, [g('tard', 4, 9), g('tot', 4, 1)]);
    expect(s?.primary.id).toBe('tot');
  });

  it('propose en alternative un groupe mieux ajusté parmi les trois suivants', () => {
    const groups = [g('couple', 2, 1), g('trio', 3, 2), g('six', 6, 3), g('cinq', 5, 4), g('six-bis', 6, 5)];
    const s = suggestTable({ size: 6 }, groups);
    expect(s?.primary.id).toBe('couple');
    expect(s?.alternative?.id).toBe('six');
    expect(s?.reason).toMatch(/Mieux ajusté/);
  });

  it('ne regarde pas au-delà des trois suivants', () => {
    const groups = [g('couple', 2, 1), g('a', 2, 2), g('b', 2, 3), g('c', 2, 4), g('six', 6, 5)];
    expect(suggestTable({ size: 6 }, groups)?.alternative).toBeNull();
  });

  it('à écart égal, l’alternative est le premier arrivé', () => {
    const groups = [g('couple', 2, 1), g('cinq-a', 5, 2), g('cinq-b', 5, 3)];
    expect(suggestTable({ size: 6 }, groups)?.alternative?.id).toBe('cinq-a');
  });

  it('pas d’alternative quand le premier est déjà bien ajusté', () => {
    const groups = [g('cinq', 5, 1), g('six', 6, 2)];
    const s = suggestTable({ size: 6 }, groups);
    expect(s?.primary.id).toBe('cinq');
    expect(s?.alternative).toBeNull();
  });

  it('aucun groupe qui tient : null', () => {
    expect(suggestTable({ size: 2 }, [g('six', 6, 1), g('quatre', 4, 2)])).toBeNull();
    expect(suggestTable({ size: 4 }, [])).toBeNull();
  });

  it('« 8+ » : un groupe de 8, ou plus, y tient', () => {
    const s = suggestTable({ size: 8, plus: true }, [g('dix', 10, 1), g('huit', 8, 2)]);
    expect(s?.primary.id).toBe('dix');
    expect(suggestTable({ size: 8, plus: true }, [g('huit', 8, 1)])?.primary.id).toBe('huit');
  });

  it('écarte les tailles invalides', () => {
    expect(suggestTable({ size: 4 }, [g('zero', 0, 1), g('demi', 2.5, 2)])).toBeNull();
  });
});

describe('tableKeys', () => {
  it('trie, dédoublonne, et fait de la plus grande une touche « + »', () => {
    expect(tableKeys([8, 2, 4, 6, 4])).toEqual([
      { size: 2, plus: false },
      { size: 4, plus: false },
      { size: 6, plus: false },
      { size: 8, plus: true },
    ]);
    expect(tableKeys([4])).toEqual([{ size: 4, plus: false }]);
  });
});
