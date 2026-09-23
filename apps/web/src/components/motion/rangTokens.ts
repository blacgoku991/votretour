/**
 * Réconciliation des jetons du Rang : fonctions pures, sans DOM, testées
 * (tests/motion.test.ts).
 *
 * Le Rang ne connaît personne : il fabrique des jetons locaux stables pour
 * que React anime les bonnes lattes. Une latte qui PASSE garde sa place dans
 * le flux (aucun décalage de mise en page) jusqu'à la fin du mouvement ; elle
 * est alors retirée PAR IDENTITÉ, jamais par position.
 *
 * Invariant : `tokens` = [...jetons qui partent, ...jetons présents]. Les
 * départs se font toujours par la tête de file.
 */

export interface RangModel {
  /** Tous les jetons dessinés, dans l'ordre de la file (tête d'abord). */
  readonly tokens: readonly string[];
  /** Jetons en train de passer : encore dans le flux, plus comptés. */
  readonly leaving: readonly string[];
}

export interface RangStep {
  model: RangModel;
  /** Jetons ajoutés en queue (ils se déplient). */
  added: string[];
  /** Jetons qui viennent de commencer leur Passage (ou retirés d'emblée). */
  removed: string[];
}

/** Jetons encore dans la file (ceux qui ne partent pas). */
export function presentTokens(model: RangModel): string[] {
  const gone = new Set(model.leaving);
  return model.tokens.filter((t) => !gone.has(t));
}

/**
 * Amène le modèle à `visible` lattes présentes.
 * - Plus de lattes : on en ajoute en queue.
 * - Moins : les premières lattes PRÉSENTES partent (on ne recompte jamais un
 *   jeton déjà en partance). Avec `immediate` (mouvement réduit), elles sont
 *   retirées tout de suite, sans Passage.
 */
export function reconcileRang(
  model: RangModel,
  visible: number,
  make: (n: number) => string[],
  immediate = false,
): RangStep {
  const target = Math.max(0, Math.floor(visible));
  const present = presentTokens(model);

  if (target > present.length) {
    const added = make(target - present.length);
    return { model: { tokens: [...model.tokens, ...added], leaving: model.leaving }, added, removed: [] };
  }

  if (target < present.length) {
    const removed = present.slice(0, present.length - target);
    if (immediate) {
      const gone = new Set(removed);
      return {
        model: { tokens: model.tokens.filter((t) => !gone.has(t)), leaving: model.leaving },
        added: [],
        removed,
      };
    }
    return { model: { tokens: model.tokens, leaving: [...model.leaving, ...removed] }, added: [], removed };
  }

  return { model, added: [], removed: [] };
}

/** Fin du mouvement : les jetons partis quittent le flux, par identité. */
export function settleRang(model: RangModel): RangModel {
  if (model.leaving.length === 0) return model;
  return { tokens: presentTokens(model), leaving: [] };
}

/**
 * Décalage (en crans, ≤ 0) d'une latte à l'index `index` du flux : chaque
 * latte qui part AVANT elle lui laisse une place à prendre. La latte qui
 * part garde donc la sienne (0 pour la tête), les suivantes montent.
 */
export function shiftAt(model: RangModel, index: number): number {
  const gone = new Set(model.leaving);
  let shift = 0;
  for (let i = 0; i < index && i < model.tokens.length; i += 1) {
    if (gone.has(model.tokens[i] as string)) shift -= 1;
  }
  return shift;
}
