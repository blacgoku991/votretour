/**
 * « TABLE LIBRE POUR 4 » — quel groupe appeler ?
 *
 * Une règle TRANSPARENTE, que l'hôte peut expliquer au client qui proteste :
 *
 *  1. On propose le premier groupe, dans l'ordre d'arrivée, dont la taille
 *     tient à la table.
 *  2. S'il est bien plus petit que la table (deux couverts de moins ou
 *     davantage : un couple pour une table de six) et qu'un groupe mieux
 *     ajusté attend parmi les trois suivants qui tiennent, celui-ci est
 *     proposé EN ALTERNATIVE, jamais à sa place.
 *
 * L'ordre n'est donc jamais sauté sans un choix explicite de l'hôte : la
 * fonction propose, l'hôte confirme (« Appeler Karim · 4 »).
 *
 * La touche « 8+ » désigne une grande table : tout groupe y tient, et
 * l'ajustement se mesure par rapport à 8.
 */

export interface WaitingGroup {
  id: string;
  partySize: number;
  /** Rang dans la file (plus petit = arrivé plus tôt). */
  order: number;
}

export interface TableKey {
  size: number;
  /** « 8+ » : grande table, sans plafond. */
  plus?: boolean;
}

export interface TableSuggestion<G extends WaitingGroup = WaitingGroup> {
  primary: G;
  /** Groupe mieux ajusté, proposé à côté du premier ; null s'il n'y en a pas. */
  alternative: G | null;
  /** Une phrase pour l'hôte, qui dit pourquoi. */
  reason: string;
}

/** Écart jugé « bien plus petit » : deux couverts vides ou plus. */
export const LOOSE_FIT_GAP = 2;
/** Nombre de groupes suivants examinés pour l'alternative. */
export const LOOKAHEAD = 3;

function fits(group: WaitingGroup, key: TableKey): boolean {
  return group.partySize >= 1 && (key.plus === true || group.partySize <= key.size);
}

/** Couverts vides si ce groupe prend cette table (0 = parfait). */
function gap(group: WaitingGroup, key: TableKey): number {
  return Math.max(0, key.size - group.partySize);
}

function plural(n: number): string {
  return n > 1 ? `${n}\u00a0couverts` : `${n}\u00a0couvert`;
}

/**
 * Propose un groupe pour une table libérée ; null si aucun groupe n'y
 * tient. Les groupes déjà appelés ne doivent pas être passés.
 */
export function suggestTable<G extends WaitingGroup>(key: TableKey, groups: readonly G[]): TableSuggestion<G> | null {
  const candidates = groups
    .filter((g) => Number.isInteger(g.partySize) && fits(g, key))
    .slice()
    .sort((a, b) => a.order - b.order);

  const primary = candidates[0];
  if (!primary) return null;

  const tableLabel = key.plus ? `la grande table (${key.size}\u00a0et plus)` : `une table de ${key.size}`;
  const primaryGap = gap(primary, key);
  if (primaryGap < LOOSE_FIT_GAP) {
    return {
      primary,
      alternative: null,
      reason: `Premier arrivé qui tient à ${tableLabel} : ${plural(primary.partySize)}.`,
    };
  }

  // Parmi les trois suivants, le mieux ajusté ; à écart égal, le premier arrivé.
  let alternative: G | null = null;
  for (const g of candidates.slice(1, 1 + LOOKAHEAD)) {
    const gg = gap(g, key);
    if (gg < primaryGap && (alternative === null || gg < gap(alternative, key))) alternative = g;
  }

  return {
    primary,
    alternative,
    reason: alternative
      ? `Premier arrivé : ${plural(primary.partySize)}. Mieux ajusté juste après : ${plural(alternative.partySize)} pour ${tableLabel}.`
      : `Premier arrivé qui tient à ${tableLabel} : ${plural(primary.partySize)}.`,
  };
}

/** Touches « Table libre pour » à partir des tailles réglées (`tableSizes`). */
export function tableKeys(sizes: readonly number[]): TableKey[] {
  const sorted = [...new Set(sizes)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  return sorted.map((size, i) => ({ size, plus: i === sorted.length - 1 && sorted.length > 1 }));
}
