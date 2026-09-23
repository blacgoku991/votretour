import type { FloorSlatState } from '@/components/objects/FloorScene';

/**
 * La file « À suivre » de l'écran TV, en lattes anonymes.
 *
 * Fonctions pures (aucun DOM) : on compare la liste affichée à la
 * nouvelle liste du snapshot et on en déduit, pour chaque latte, l'état
 * à jouer. Les transitions de FloorScene font le reste :
 *   - la tête qui sort de la liste passe le seuil (Passage, 'passed') ;
 *   - une latte qui sort ailleurs se replie vers le rail ('hidden') ;
 *   - une arrivée naît repliée ('hidden'), puis se déplie ;
 *   - les autres avancent d'un cran (transition de --pos).
 *
 * Aucune donnée personnelle : un numéro de position (« 01 ») et, au plus,
 * des initiales. Jamais de prénom complet ni de numéro de ticket.
 */

export interface TvQueueItem {
  id: string;
  /** Appelé au comptoir (notifié) : latte allumée. */
  called: boolean;
  /** Initiales (au plus), ou null si la personne n'a pas donné de prénom. */
  initials: string | null;
}

export interface TvSlat {
  id: string;
  state: FloorSlatState;
  label: string;
  hint?: string;
  /** Sort de la file : retirée après la fin du Passage ou du repli. */
  leaving?: boolean;
  /** Vient d'arriver : naît repliée, se déplie à l'image suivante. */
  fresh?: boolean;
}

/** Durée après laquelle une latte sortie est retirée (Passage : 620 ms). */
export const TV_LEAVE_MS = 700;
/** Nombre de lattes visibles (FloorScene en accepte 8, dont une qui passe). */
export const TV_MAX_SLATS = 7;

const pad2 = (n: number) => String(n).padStart(2, '0');

function settledState(item: TvQueueItem): FloorSlatState {
  return item.called ? 'serving' : 'wait';
}

function hintOf(item: TvQueueItem): string | undefined {
  if (item.called) return 'Appelé';
  return item.initials ?? undefined;
}

/** Premier rendu (serveur compris) : la file telle quelle, sans animation. */
export function initialSlats(items: TvQueueItem[]): TvSlat[] {
  return items.slice(0, TV_MAX_SLATS).map((item, i) => ({
    id: item.id,
    state: settledState(item),
    label: pad2(i + 1),
    hint: hintOf(item),
  }));
}

/**
 * Nouvelle liste affichée d'après la précédente et le snapshot.
 * `animate` faux (mouvement réduit) : pas de latte sortante ni repliée.
 */
export function reconcileSlats(prev: TvSlat[], items: TvQueueItem[], animate: boolean): TvSlat[] {
  const nextItems = items.slice(0, TV_MAX_SLATS);
  if (!animate) return initialSlats(nextItems);

  const nextIds = new Set(nextItems.map((item) => item.id));
  const staying = prev.filter((slat) => !slat.leaving);
  const firstSurvivor = staying.findIndex((slat) => nextIds.has(slat.id));
  const headCut = firstSurvivor === -1 ? staying.length : firstSurvivor;

  // Sortants : la tête passe le seuil, les autres se replient à leur place.
  const passing: TvSlat[] = [];
  const folding: Array<{ at: number; slat: TvSlat }> = [];
  staying.forEach((slat, index) => {
    if (nextIds.has(slat.id)) return;
    if (index < headCut) passing.push({ ...slat, state: 'passed', leaving: true, fresh: false });
    else folding.push({ at: index - headCut, slat: { ...slat, state: 'hidden', leaving: true, fresh: false } });
  });

  const known = new Set(staying.map((slat) => slat.id));
  const list: TvSlat[] = nextItems.map((item, i) => {
    const isNew = !known.has(item.id);
    return {
      id: item.id,
      state: isNew ? 'hidden' : settledState(item),
      label: pad2(i + 1),
      hint: hintOf(item),
      fresh: isNew,
    };
  });

  // Les lattes qui se replient gardent leur rang pendant le repli.
  for (const { at, slat } of folding) list.splice(Math.min(at, list.length), 0, slat);

  // Les lattes déjà en train de sortir finissent leur mouvement.
  const stillLeaving = prev.filter((slat) => slat.leaving && !nextIds.has(slat.id));
  return [...stillLeaving.filter((s) => s.state === 'passed'), ...passing, ...list, ...stillLeaving.filter((s) => s.state !== 'passed')]
    .slice(0, TV_MAX_SLATS + 1);
}

/** Les arrivées se déplient : 'hidden' → état posé. */
export function unfoldFresh(list: TvSlat[], items: TvQueueItem[]): TvSlat[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  let changed = false;
  const out = list.map((slat) => {
    if (!slat.fresh) return slat;
    const item = byId.get(slat.id);
    changed = true;
    return { ...slat, fresh: false, state: item ? settledState(item) : 'wait' };
  });
  return changed ? out : list;
}

/** Retire les lattes sorties (fin du Passage ou du repli). */
export function dropLeaving(list: TvSlat[]): TvSlat[] {
  return list.some((slat) => slat.leaving) ? list.filter((slat) => !slat.leaving) : list;
}
