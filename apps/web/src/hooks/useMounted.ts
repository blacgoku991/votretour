'use client';

import { useEffect, useState } from 'react';

/**
 * Vrai une fois le composant monté dans le navigateur.
 *
 * Sert aux valeurs qui dépendent de l'heure courante — « il y a 2 min »,
 * un compteur de prestation. Le serveur et le navigateur ne les calculent
 * jamais au même instant : « 59 s » rendu côté serveur et « 1 min »
 * une seconde plus tard côté client suffisent à casser l'hydratation.
 * On ne les affiche donc qu'après le montage.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
