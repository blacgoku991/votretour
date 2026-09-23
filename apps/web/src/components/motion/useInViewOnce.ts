'use client';

import { useEffect, useState } from 'react';

/**
 * false jusqu'à ce que l'élément ait été vu une fois (seuil par défaut 0.35).
 * true immédiatement si IntersectionObserver est absent.
 *
 * Un seul setState dans toute la vie du composant : au premier passage.
 */
export function useInViewOnce(
  ref: React.RefObject<Element | null>,
  options?: { threshold?: number; rootMargin?: string },
): boolean {
  const [seen, setSeen] = useState(false);
  const threshold = options?.threshold ?? 0.35;
  const rootMargin = options?.rootMargin ?? '0px';

  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setSeen(true);
      return;
    }
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold, rootMargin]);

  return seen;
}
