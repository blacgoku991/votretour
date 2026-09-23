import 'server-only';

/**
 * PostgREST plafonne chaque réponse à max-rows lignes (1000 en
 * production, comme chez Supabase). Un .limit() plus grand ne lève pas
 * ce plafond : la liste serait tronquée, sans la moindre erreur.
 *
 * selectAll lit donc par pages de 1000, jusqu'à une page incomplète.
 * La requête passée doit avoir un ordre stable (terminer par l'id),
 * sinon deux pages peuvent se chevaucher.
 */
export const SELECT_PAGE_SIZE = 1000;

export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxRows = 50_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += SELECT_PAGE_SIZE) {
    const { data, error } = await page(from, from + SELECT_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < SELECT_PAGE_SIZE) break;
  }
  return rows;
}
