'use client';

import { useEffect, useRef } from 'react';
import styles from './admin.module.css';

/**
 * Zone de défilement horizontal d'un tableau admin.
 *
 * - Un fondu apparaît sur le bord où il reste des colonnes à voir : sur
 *   téléphone, on sait tout de suite que le tableau continue.
 * - Quand elle défile, la zone devient atteignable au clavier (région
 *   nommée, tabindex=0) pour se déplacer aux flèches.
 *
 * L'état « reste à droite / à gauche » est posé directement en attribut
 * data-* sur le cadre (au plus une fois par image, et seulement s'il
 * change) : aucun rendu React pendant le défilement.
 */
export function ScrollTable({ label, children }: { label: string; children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    const box = frame.current;
    if (!el || !box) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const max = el.scrollWidth - el.clientWidth;
      const scrollable = max > 1;
      const left = scrollable && el.scrollLeft > 1 ? 'true' : 'false';
      const right = scrollable && max - el.scrollLeft > 1 ? 'true' : 'false';
      if (box.dataset.left !== left) box.dataset.left = left;
      if (box.dataset.right !== right) box.dataset.right = right;
      if (scrollable) {
        if (el.tabIndex !== 0) el.tabIndex = 0;
      } else if (el.hasAttribute('tabindex')) {
        el.removeAttribute('tabindex');
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', schedule);
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={frame} className={styles.scrollFrame} data-left="false" data-right="false">
      <div ref={scroller} className={styles.tableWrap} role="region" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
