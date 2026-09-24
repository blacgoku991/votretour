'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/components/motion/useMotionPreference';

/**
 * L'ANNONCE — ce qui vient d'être appelé passe un instant au premier plan.
 *
 * Une salle d'attente ne regarde pas l'écran en continu : elle lève les
 * yeux quand quelque chose bouge. Chaque NOUVEL appel (numéro au guichet,
 * véhicule prêt, table prête, commande prête) occupe donc l'écran quelques
 * secondes, puis rend la place au tableau.
 *
 * Règles :
 *  - rien n'est annoncé au chargement : l'écran qu'on allume ne rejoue pas
 *    les appels déjà faits ;
 *  - « nouveau » = absent de l'instantané précédent. Un véhicule repassé
 *    en réparation puis de nouveau prêt est donc réannoncé, à raison ;
 *  - les annonces se suivent, jamais ne se chevauchent. S'il en attend
 *    plusieurs, chacune dure moins longtemps ; au-delà de trois en attente,
 *    les plus anciennes sont abandonnées (le tableau les montre déjà) ;
 *  - mouvement réduit : l'annonce apparaît et disparaît sans glisser.
 *
 * Phases (attribut data-phase, CSS en transform et opacity seulement) :
 * `enter` (posée hors champ, une image), `shown`, `leave`.
 */

export type AnnouncePhase = 'enter' | 'shown' | 'leave';

/** Durée d'une annonce seule, et quand d'autres attendent derrière elle. */
export const ANNOUNCE_HOLD_MS = 6500;
export const ANNOUNCE_HOLD_BUSY_MS = 3800;
export const ANNOUNCE_LEAVE_MS = 520;
const MAX_PENDING = 3;

interface State<T> {
  pending: T[];
  current: T | null;
  phase: AnnouncePhase | null;
  /** Durée de l'annonce en cours (la barre de progression la lit). */
  hold: number;
}

export interface Announcement<T> {
  current: T | null;
  phase: AnnouncePhase | null;
  hold: number;
}

/**
 * `items` : les appels en cours, dans l'ordre où les annoncer (le plus
 * ancien d'abord). `keyOf` : identité stable (identifiant public du ticket).
 */
export function useAnnouncements<T>(items: readonly T[], keyOf: (item: T) => string): Announcement<T> {
  const reduced = useReducedMotion();
  const [state, setState] = useState<State<T>>({ pending: [], current: null, phase: null, hold: ANNOUNCE_HOLD_MS });

  const signature = items.map(keyOf).join('|');
  // Clés vues à l'instantané précédent ; le premier rendu les pose toutes :
  // rien n'est annoncé au chargement.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(items.map(keyOf));
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;

  useEffect(() => {
    const current = itemsRef.current;
    const previous = seen.current ?? new Set<string>();
    const fresh = current.filter((item) => !previous.has(keyRef.current(item)));
    seen.current = new Set(current.map((item) => keyRef.current(item)));
    if (fresh.length === 0) return;
    setState((s) => ({ ...s, pending: [...s.pending, ...fresh].slice(-MAX_PENDING) }));
  }, [signature]);

  // File d'attente : la suivante entre dès que la place est libre.
  useEffect(() => {
    if (state.current !== null || state.pending.length === 0) return;
    const [next, ...rest] = state.pending;
    if (next === undefined) return;
    setState({
      pending: rest,
      current: next,
      phase: reduced ? 'shown' : 'enter',
      hold: rest.length > 0 ? ANNOUNCE_HOLD_BUSY_MS : ANNOUNCE_HOLD_MS,
    });
  }, [state.current, state.pending, reduced]);

  // enter → shown : deux images, pour que la position de départ soit peinte
  // avant la transition.
  useEffect(() => {
    if (state.phase !== 'enter') return;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setState((s) => (s.phase === 'enter' ? { ...s, phase: 'shown' } : s)));
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [state.phase]);

  // shown → leave → fin. Une annonce qui en a d'autres derrière elle
  // raccourcit (la durée est fixée à son entrée).
  useEffect(() => {
    if (state.phase === 'shown') {
      const timer = window.setTimeout(() => {
        setState((s) => (reduced ? { ...s, current: null, phase: null } : { ...s, phase: 'leave' }));
      }, state.hold);
      return () => window.clearTimeout(timer);
    }
    if (state.phase === 'leave') {
      const timer = window.setTimeout(() => setState((s) => ({ ...s, current: null, phase: null })), ANNOUNCE_LEAVE_MS);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [state.phase, state.hold, reduced]);

  return { current: state.current, phase: state.phase, hold: state.hold };
}
