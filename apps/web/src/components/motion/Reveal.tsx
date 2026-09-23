'use client';

import { createElement, useEffect, useRef } from 'react';

/**
 * RÉVÉLATION — un contenu qui entre une seule fois dans la vue.
 *
 * Rendu serveur SANS attribut data-reveal : le contenu est visible, avec
 * ou sans JavaScript. Après montage, un IntersectionObserver unique,
 * partagé par tout le module, reçoit l'état initial de chaque élément :
 * seul un élément situé SOUS la fenêtre est « armé » (caché), puis passe
 * à « in » quand il entre dans la vue. Ce qui est déjà visible ou déjà
 * dépassé ne bouge jamais. En mouvement réduit, on ne fait rien.
 *
 * Le CSS (globals.css, §3.12) ne s'applique que dans
 * @media (prefers-reduced-motion: no-preference).
 */

export interface RevealProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'li' | 'article' | 'span' | 'p' | 'ol' | 'ul';
  /** 'rise' (montée de 12 px, défaut), 'slat' (dépliage depuis la gauche) ou 'fade'. */
  variant?: 'rise' | 'slat' | 'fade';
  /** Décalage : --reveal-i (× 60 ms). */
  index?: number;
  /** Part de l'élément visible pour le révéler. Défaut 0.35. */
  threshold?: number;
}

type Registry = { io: IntersectionObserver; seen: WeakSet<Element> };
const registries = new Map<number, Registry>();

function reveal(el: Element) {
  el.setAttribute('data-reveal', 'in');
}

function registryFor(threshold: number): Registry | null {
  if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return null;
  const key = Math.round(threshold * 100) / 100;
  const existing = registries.get(key);
  if (existing) return existing;

  const seen = new WeakSet<Element>();
  const steps = Array.from(new Set([0, 0.05, 0.1, 0.2, key])).sort((a, b) => a - b);
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target;
        const rootH = entry.rootBounds?.height ?? window.innerHeight;
        if (!seen.has(el)) {
          // État initial : on n'arme que ce qui est sous la fenêtre.
          seen.add(el);
          if (!entry.isIntersecting && entry.boundingClientRect.top >= rootH) {
            el.setAttribute('data-reveal', 'armed');
          } else {
            io.unobserve(el);
          }
          continue;
        }
        const enough =
          entry.intersectionRatio >= key - 0.001 || entry.intersectionRect.height >= rootH * 0.2;
        if (entry.isIntersecting && enough) {
          reveal(el);
          io.unobserve(el);
        } else if (!entry.isIntersecting && entry.boundingClientRect.bottom < 0) {
          // Dépassé par un saut d'ancre : on montre sans attendre.
          reveal(el);
          io.unobserve(el);
        }
      }
    },
    { threshold: steps },
  );
  const registry = { io, seen };
  registries.set(key, registry);
  return registry;
}

export function Reveal({
  as = 'div',
  variant = 'rise',
  index,
  threshold = 0.35,
  style,
  children,
  ...rest
}: RevealProps): React.JSX.Element {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const registry = registryFor(threshold);
    if (!registry) return;
    registry.io.observe(el);
    return () => {
      registry.io.unobserve(el);
      registry.seen.delete(el);
    };
  }, [threshold]);

  const mergedStyle =
    index !== undefined
      ? ({ ...style, ['--reveal-i' as string]: index } as React.CSSProperties)
      : style;

  return createElement(
    as,
    {
      ...rest,
      ref,
      style: mergedStyle,
      'data-reveal-variant': variant === 'rise' ? undefined : variant,
    },
    children,
  );
}
