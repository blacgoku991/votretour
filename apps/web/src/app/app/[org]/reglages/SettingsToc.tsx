'use client';

import { useEffect, useState } from 'react';
import styles from './settings.module.css';

/**
 * SOMMAIRE DES RÉGLAGES.
 *
 * À partir de 1200 px : un rail collant à gauche (.rail-list) dont
 * l'encoche vermillon suit la section lue (IntersectionObserver, un
 * setState seulement quand la section change, jamais par image).
 * En dessous : une liste « Aller à la section ».
 *
 * Le rendu serveur marque la première section : aucune valeur liée au
 * défilement n'est calculée avant le montage.
 */
export interface TocEntry { id: string; label: string }

export function SettingsTocRail({ entries }: { entries: TocEntry[] }) {
  const active = useActiveSection(entries);
  return (
    <nav className={styles.tocRail} aria-label="Sommaire des réglages">
      <p className={`t-label ${styles.tocTitle}`}>Sommaire</p>
      <ol className={`rail-list ${styles.toc}`}>
        {entries.map((entry, i) => (
          <li key={entry.id} aria-current={entry.id === active ? 'true' : undefined}>
            <a href={`#${entry.id}`} className={styles.tocLink}>
              <span className={styles.tocNum} aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <span>{entry.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SettingsTocSelect({ entries }: { entries: TocEntry[] }) {
  const active = useActiveSection(entries);
  return (
    <div className={styles.tocSelect}>
      <label htmlFor="aller-a" className="t-label">Aller à la section</label>
      <select
        id="aller-a"
        className="select"
        value={active}
        onChange={(e) => {
          const target = document.getElementById(e.target.value);
          if (!target) return;
          const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
          history.replaceState(null, '', `#${e.target.value}`);
        }}
      >
        {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
    </div>
  );
}

/** Section lue : la première dont le haut a franchi la bande de lecture. */
function useActiveSection(entries: TocEntry[]): string {
  const [active, setActive] = useState(entries[0]?.id ?? '');
  const key = entries.map((e) => e.id).join('|');

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const ids = key.split('|').filter(Boolean);
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          if (r.isIntersecting) visible.add(r.target.id);
          else visible.delete(r.target.id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first) setActive((prev) => (prev === first ? prev : first));
      },
      // Bande de lecture : entre 20 % et 35 % de la hauteur de l'écran.
      { rootMargin: '-20% 0px -65% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [key]);

  return active;
}
