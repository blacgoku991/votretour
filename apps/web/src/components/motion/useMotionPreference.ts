'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Préférences de mouvement, lues sans jamais créer d'écart d'hydratation :
 * le rendu serveur et le premier rendu client valent toujours `false`.
 */

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

const getSnapshot = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;

const getServerSnapshot = (): boolean => false;

/** false côté serveur et pendant l'hydratation (useSyncExternalStore avec getServerSnapshot = () => false), puis suit matchMedia('(prefers-reduced-motion: reduce)'). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Appareil modeste, lu APRÈS montage : (navigator.hardwareConcurrency ?? 8) <= 4 && ((navigator as { deviceMemory?: number }).deviceMemory ?? 4) <= 2. false au rendu serveur. */
export function useLiteDevice(): boolean {
  const [lite, setLite] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const cores = navigator.hardwareConcurrency ?? 8;
    const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
    setLite(cores <= 4 && memory <= 2);
  }, []);
  return lite;
}
