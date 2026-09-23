import { describe, it, expect } from 'vitest';
import {
  dropLeaving, initialSlats, reconcileSlats, unfoldFresh, TV_MAX_SLATS,
  type TvQueueItem, type TvSlat,
} from '../src/app/app/[org]/ecran/tvSlats';

/**
 * L'écran TV est affiché en salle : une erreur s'y voit de loin. Pendant
 * une avance, aucun numéro de position ne doit apparaître deux fois, et
 * une latte qui sort ne doit plus rien afficher (ni numéro, ni initiales).
 */

const item = (id: string, initials: string | null = null, called = false): TvQueueItem => ({ id, initials, called });
const queue = (...ids: string[]) => ids.map((id) => item(id, id.toUpperCase()));

function expectCoherent(slats: TvSlat[]) {
  const labels = slats.map((s) => s.label).filter(Boolean);
  expect(new Set(labels).size, `numéros en double : ${labels.join(', ')}`).toBe(labels.length);
  for (const slat of slats.filter((s) => s.leaving)) {
    expect(slat.label).toBe('');
    expect(slat.hint).toBeUndefined();
  }
}

describe('lattes de l’écran TV', () => {
  const start = initialSlats(queue('a', 'b', 'c', 'd'));

  it('numérote la file de 01 à n', () => {
    expect(start.map((s) => s.label)).toEqual(['01', '02', '03', '04']);
  });

  it.each([
    ['la tête passe', ['b', 'c', 'd']],
    ['une personne au milieu sort', ['a', 'c', 'd']],
    ['sortie et arrivée en même temps', ['b', 'd', 'e']],
    ['deux passent d’un coup', ['c', 'd']],
  ])('%s : aucun numéro en double, les sortants sont muets', (_label, ids) => {
    const next = reconcileSlats(start, queue(...ids), true);
    expectCoherent(next);
    // Les présents sont numérotés dans l’ordre de la file.
    expect(next.filter((s) => !s.leaving).map((s) => s.label)).toEqual(ids.map((_, i) => String(i + 1).padStart(2, '0')));
    // Une fois le mouvement fini, il ne reste que la file.
    const settled = dropLeaving(unfoldFresh(next, queue(...ids)));
    expect(settled.map((s) => s.id)).toEqual(ids);
    expectCoherent(settled);
  });

  it('la tête qui sort passe le seuil, une sortie ailleurs se replie', () => {
    const next = reconcileSlats(start, queue('b', 'd'), true);
    expect(next.find((s) => s.id === 'a')?.state).toBe('passed');
    expect(next.find((s) => s.id === 'c')?.state).toBe('hidden');
  });

  it('en mouvement réduit, la file est remplacée sans latte sortante', () => {
    const next = reconcileSlats(start, queue('c', 'd'), false);
    expect(next.some((s) => s.leaving)).toBe(false);
    expect(next.map((s) => s.label)).toEqual(['01', '02']);
  });

  it('ne dessine jamais plus que la scène n’en accepte', () => {
    const long = queue(...'abcdefghijkl'.split(''));
    const first = initialSlats(long);
    expect(first).toHaveLength(TV_MAX_SLATS);
    const next = reconcileSlats(first, long.slice(2), true);
    expect(next.length).toBeLessThanOrEqual(TV_MAX_SLATS + 1);
    expectCoherent(next);
  });
});
