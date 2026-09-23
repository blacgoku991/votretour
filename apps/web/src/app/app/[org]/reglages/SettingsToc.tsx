'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './settings.module.css';

/**
 * SOMMAIRE DES RÉGLAGES.
 *
 * À partir de 1200 px : un rail collant à gauche (.rail-list) dont
 * l'encoche vermillon suit la section lue (positions lues dans un rAF,
 * un setState seulement quand la section change, jamais par image).
 * En dessous : une liste « Aller à la section ».
 *
 * Le rendu serveur marque la première section : aucune valeur liée au
 * défilement n'est calculée avant le montage.
 */
export interface TocEntry { id: string; label: string }

export function SettingsTocRail({ entries }: { entries: TocEntry[] }) {
  const [active, pick] = useActiveSection(entries);
  return (
    <nav className={styles.tocRail} aria-label="Sommaire des réglages">
      <p className={`t-label ${styles.tocTitle}`}>Sommaire</p>
      <ol className={`rail-list ${styles.toc}`}>
        {entries.map((entry, i) => (
          <li key={entry.id} aria-current={entry.id === active ? 'true' : undefined}>
            <a
              href={`#${entry.id}`}
              className={styles.tocLink}
              // pointerdown libère le choix précédent ; le clic fixe le nouveau.
              onClick={() => pick(entry.id)}
            >
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
  const [active, pick] = useActiveSection(entries);
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
          pick(e.target.value);
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

/**
 * Section lue : la DERNIÈRE dont le haut est passé au-dessus de 35 % de
 * la hauteur de l'écran ; tout en bas de page, la dernière entrée.
 * Lecture des positions dans un rAF déclenché par un écouteur passif,
 * setState seulement quand la section change. Un choix explicite (clic
 * dans le sommaire, liste) s'affiche tout de suite et tient pendant le
 * défilement qu'il provoque, jusqu'à la prochaine action de l'utilisateur.
 */
function useActiveSection(entries: TocEntry[]): [string, (id: string) => void] {
  const [active, setActive] = useState(entries[0]?.id ?? '');
  const pinned = useRef(false);
  const key = entries.map((e) => e.id).join('|');

  useEffect(() => {
    const ids = key.split('|').filter(Boolean);
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (pinned.current) return;
      const doc = document.documentElement;
      let current = ids[0];
      if (window.scrollY + window.innerHeight >= doc.scrollHeight - 4) {
        current = ids[ids.length - 1];
      } else {
        const line = window.innerHeight * 0.35;
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top <= line) current = id;
        }
      }
      if (current) setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const release = () => { pinned.current = false; };
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener('scroll', onScroll, opts);
    window.addEventListener('resize', onScroll, opts);
    for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) {
      window.addEventListener(t, release, opts);
    }
    onScroll();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) {
        window.removeEventListener(t, release);
      }
    };
  }, [key]);

  const pick = useCallback((id: string) => {
    pinned.current = true;
    setActive(id);
  }, []);

  return [active, pick];
}
