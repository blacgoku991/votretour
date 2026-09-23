/**
 * Géométrie pure de l'aperçu des vagues (sans DOM) : 30 mini-lattes
 * regroupées toutes les `taille de vague` lattes. Tout est exprimé en
 * décalages verticaux (px) appliqués en `transform` par le composant.
 */

/** Nombre de lattes de l'aperçu. */
export const PREVIEW_SLATS = 30;
/** Pas entre deux lattes d'une même vague. */
export const PREVIEW_PITCH = 11;
/** Hauteur d'une mini-latte. */
export const PREVIEW_SLAT_H = 7;
/** Écart entre deux vagues : borné pour tenir dans la hauteur fixe. */
const GAP_MIN = 4;
const GAP_MAX = 18;
/** Hauteur disponible au-delà des 30 lattes à pas fixe. */
const GAP_BUDGET = 116;

export interface WaveGroup {
  /** Indice de la vague (0 = première). */
  index: number;
  /** Nombre de lattes de l'aperçu dans cette vague. */
  count: number;
  /** Haut de la première latte (px). */
  top: number;
  /** Hauteur de l'accolade, du haut de la première latte au bas de la dernière (px). */
  height: number;
}

export interface WaveLayout {
  size: number;
  groups: WaveGroup[];
  /** Décalage vertical de chaque latte. */
  slats: number[];
  /** Hauteur totale occupée (px). */
  height: number;
}

/** Taille de vague exploitable : entier ≥ 1 (une saisie vide ou absurde donne 1). */
export function safeWaveSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(200, Math.round(value)));
}

/** Plus grande hauteur possible de l'aperçu (une vague par latte). */
export const PREVIEW_MAX_HEIGHT =
  (PREVIEW_SLATS - 1) * PREVIEW_PITCH + (PREVIEW_SLATS - 1) * GAP_MIN + PREVIEW_SLAT_H;

export function waveLayout(rawSize: number): WaveLayout {
  const size = safeWaveSize(rawSize);
  const groupCount = Math.ceil(PREVIEW_SLATS / size);
  const gap = groupCount > 1
    ? Math.max(GAP_MIN, Math.min(GAP_MAX, GAP_BUDGET / (groupCount - 1)))
    : 0;

  const slats: number[] = [];
  for (let i = 0; i < PREVIEW_SLATS; i += 1) {
    const group = Math.floor(i / size);
    slats.push(Math.round((i * PREVIEW_PITCH + group * gap) * 10) / 10);
  }

  const groups: WaveGroup[] = [];
  for (let g = 0; g < groupCount; g += 1) {
    const first = g * size;
    const last = Math.min(PREVIEW_SLATS, first + size) - 1;
    const top = slats[first] ?? 0;
    const bottom = (slats[last] ?? 0) + PREVIEW_SLAT_H;
    groups.push({ index: g, count: last - first + 1, top, height: bottom - top });
  }

  const height = (slats[PREVIEW_SLATS - 1] ?? 0) + PREVIEW_SLAT_H;
  return { size, groups, slats, height };
}
