'use client';

import { useEffect, useRef } from 'react';

/**
 * LE MOTEUR DE DÉFILEMENT — le seul du site.
 *
 * Le défilement natif reste maître : on n'intercepte rien, on ne lisse
 * rien. On lit la mise en page UNE fois par mesure (montage,
 * redimensionnement, polices prêtes, chargement), jamais par image. À
 * chaque image, `frame` reçoit scrollY et les mesures en cache, et n'écrit
 * que des styles ou des attributs.
 *
 * Aucun setState ici : le hook ne provoque aucun rendu React.
 */

export interface DriverViewport {
  w: number;
  h: number;
}

export interface ScrollDriverOptions<M> {
  /** Élément observé : l'écoute n'est active que lorsqu'il est proche de l'écran (IntersectionObserver, rootMargin '200px 0px'). */
  target: React.RefObject<Element | null>;
  /** Lit la mise en page (getBoundingClientRect + scrollY → coordonnées DOCUMENT). Appelé au montage, sur ResizeObserver (anti-rebond 100 ms), sur document.fonts.ready et sur 'load'. Jamais dans la boucle d'images. */
  measure: () => M;
  /** Appelé dans un requestAnimationFrame quand scrollY a changé ou après une nouvelle mesure. N'écrit que des styles ou attributs ; ne lit JAMAIS la mise en page. */
  frame: (scrollY: number, measures: M, viewport: DriverViewport) => void;
  /** false : rien n'est attaché (mouvement réduit, par exemple). Défaut : true. */
  enabled?: boolean;
}

/** Variation de hauteur seule en deçà de laquelle on ignore un redimensionnement (barre d'adresse mobile). */
const HEIGHT_ONLY_TOLERANCE = 120;
const RESIZE_DEBOUNCE = 100;

export function useScrollDriver<M>(options: ScrollDriverOptions<M>): void {
  const { target, enabled = true } = options;
  // Les callbacks vivent dans des refs : pas de réabonnement à chaque rendu.
  const measureRef = useRef(options.measure);
  const frameRef = useRef(options.frame);
  measureRef.current = options.measure;
  frameRef.current = options.frame;

  useEffect(() => {
    if (!enabled) return;
    const el = target.current;
    if (!el || typeof window === 'undefined') return;

    let measures: M | null = null;
    let viewport: DriverViewport = { w: window.innerWidth, h: window.innerHeight };
    let raf = 0;
    let lastY = Number.NaN;
    let dirty = true;
    let active = true; // actif tant qu'on ne sait pas le contraire
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const tick = () => {
      raf = 0;
      if (disposed || measures === null) return;
      const y = window.scrollY;
      if (!dirty && y === lastY) return;
      dirty = false;
      lastY = y;
      frameRef.current(y, measures, viewport);
    };

    const schedule = () => {
      if (raf || disposed) return;
      raf = window.requestAnimationFrame(tick);
    };

    const remeasure = () => {
      if (disposed) return;
      viewport = { w: window.innerWidth, h: window.innerHeight };
      measures = measureRef.current();
      dirty = true;
      schedule();
    };

    const onScroll = () => {
      if (active) schedule();
    };

    // Première mesure et première image : gère une position restaurée.
    remeasure();

    window.addEventListener('scroll', onScroll, { passive: true });

    // Ne travaille que lorsque la cible est proche de l'écran.
    let io: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          const was = active;
          active = entry.isIntersecting;
          // En sortant, une dernière image fixe l'état de bord (t = 0 ou t = max).
          if (active !== was) {
            dirty = true;
            schedule();
          }
        },
        { rootMargin: '200px 0px' },
      );
      io.observe(el);
    }

    // Redimensionnement : anti-rebond, et on ignore la barre d'adresse mobile.
    let lastW = window.innerWidth;
    let lastH = window.innerHeight;
    let ro: ResizeObserver | null = null;
    if ('ResizeObserver' in window) {
      let first = true;
      ro = new ResizeObserver(() => {
        if (first) {
          // Le premier rappel est synchrone avec l'observation : déjà mesuré.
          first = false;
          return;
        }
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          resizeTimer = null;
          const w = window.innerWidth;
          const h = window.innerHeight;
          const heightOnly = w === lastW && Math.abs(h - lastH) < HEIGHT_ONLY_TOLERANCE;
          lastW = w;
          if (heightOnly) {
            // La mise en page du document a pu changer (contenu chargé) : on
            // re-mesure quand même si ce n'est pas la fenêtre qui a bougé.
            if (h === lastH) remeasure();
            return;
          }
          lastH = h;
          remeasure();
        }, RESIZE_DEBOUNCE);
      });
      ro.observe(el);
      ro.observe(document.documentElement);
    }

    // Les polices et les images peuvent décaler la mise en page.
    const onLoad = () => remeasure();
    window.addEventListener('load', onLoad);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(() => remeasure()).catch(() => undefined);

    return () => {
      disposed = true;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('load', onLoad);
      io?.disconnect();
      ro?.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [enabled, target]);
}
