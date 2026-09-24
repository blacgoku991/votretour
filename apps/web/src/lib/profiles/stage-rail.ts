/**
 * État de chaque station du rail d'étapes — logique pure, testée à part
 * du dessin (`components/objects/StageRail.tsx`).
 *
 * Le chemin d'un atelier n'est PAS linéaire : un devis ou une pièce
 * peuvent être sautés, « Prêt » peut revenir en réparation. On ne dessine
 * donc jamais comme « faite » une étape par laquelle le ticket n'est pas
 * passé, quand l'historique le dit :
 *
 *  - `done`     : étape passée (vue dans l'historique, ou, sans historique,
 *                 simplement située avant l'étape courante) ;
 *  - `current`  : l'étape en cours ;
 *  - `upcoming` : à venir ;
 *  - `skipped`  : étape située avant l'étape courante, mais absente de
 *                 l'historique (un devis qui n'a pas eu lieu).
 *
 * En mode `compact` (vue client), les étapes sautées disparaissent, et
 * les détours facultatifs à venir aussi : on n'annonce pas un devis au
 * client d'un garage qui n'en fera peut-être pas.
 */

import { getProfile } from './index';
import type { ProfileStage, QueueProfile, StageDef } from './types';

export type RailStepState = 'done' | 'current' | 'upcoming' | 'skipped';

export interface RailStep {
  def: StageDef;
  state: RailStepState;
  /** Dernière entrée dans cette étape (ISO), si l'historique la connaît. */
  at: string | null;
}

export interface RailOptions {
  history?: readonly { stage: ProfileStage; at: string }[] | null;
  compact?: boolean;
}

export function stageRailSteps(
  profile: QueueProfile,
  current: ProfileStage | null | undefined,
  { history, compact = false }: RailOptions = {},
): RailStep[] {
  const { stages, initialStage } = getProfile(profile);
  const currentIndex = stages.findIndex((s) => s.key === current);
  const lastAt = new Map<ProfileStage, string>();
  for (const h of history ?? []) lastAt.set(h.stage, h.at);
  const knowsHistory = (history?.length ?? 0) > 0;

  const steps = stages.map((def, i): RailStep => {
    const at = lastAt.get(def.key) ?? null;
    let state: RailStepState;
    if (i === currentIndex) state = 'current';
    else if (currentIndex < 0 || i > currentIndex) state = 'upcoming';
    // L'étape initiale est posée à l'inscription, sans événement : elle
    // est forcément passée.
    else if (!knowsHistory || at !== null || def.key === initialStage) state = 'done';
    else state = 'skipped';
    return { def, state, at };
  });

  if (!compact) return steps;
  return steps.filter(
    (s) => s.state === 'current' || s.state === 'done' || (s.state === 'upcoming' && !s.def.optional),
  );
}
