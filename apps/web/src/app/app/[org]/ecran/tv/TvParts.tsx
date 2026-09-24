'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { FlapNumber } from '@/components/FlapNumber';
import type { AnnouncePhase } from './useAnnouncements';
import styles from './tvProfile.module.css';

/**
 * Pièces communes aux écrans de salle par métier : même grammaire que
 * l'écran des barbiers (étiquettes à encoche, grands volets, pied de page
 * avec la consigne), pour que les cinq écrans se reconnaissent.
 */

/**
 * L'heure courante, APRÈS montage seulement (null au rendu serveur) :
 * « prêt depuis 14:32 » dépend du fuseau du téléviseur, et un écart
 * d'hydratation figerait l'écran. Rafraîchie toutes les 20 secondes.
 */
export function useNow(everyMs = 20_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Étiquette de section, à encoche : « — VÉHICULES PRÊTS ». */
export function TvHead({ id, label, note }: { id: string; label: string; note?: ReactNode }) {
  return (
    <div className={styles.head}>
      <h2 id={id} className={`t-label ${styles.headLabel}`}>{label}</h2>
      {note ? <span className={styles.headNote}>{note}</span> : null}
    </div>
  );
}

/**
 * Un compteur en volet, avec son libellé. `tone` : 'signal' réservé à ce
 * que la salle doit voir tout de suite (prêts, appelés).
 */
export function TvStat({
  value,
  label,
  detail,
  size = 168,
  tone = 'bone',
}: {
  value: number;
  label: string;
  detail?: ReactNode;
  /** Hauteur de tuile, en --u. */
  size?: number;
  tone?: 'bone' | 'signal' | 'copper';
}) {
  return (
    <div className={styles.stat} data-tone={tone}>
      <FlapNumber tile value={value} label={`${value} ${label}`} size={`calc(var(--u) * ${size})`} />
      <span className={styles.statText}>
        <span className={styles.statLabel}>{label}</span>
        {detail ? <span className={styles.statDetail}>{detail}</span> : null}
      </span>
    </div>
  );
}

/** Petit compteur en ligne : « Déposés aujourd'hui · 12 ». */
export function TvMini({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.mini}>
      <span className={styles.miniLabel}>{label}</span>
      <strong className={`t-num ${styles.miniValue}`}>{value}</strong>
    </div>
  );
}

/** Le pied : la consigne (avec l'onde NFC) et le compteur du jour. */
export function TvFoot({ hint, today }: { hint: string; today: ReactNode }) {
  return (
    <footer className={styles.foot}>
      <span className={styles.hintLine}>
        <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={styles.nfc}>
          <g stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
            <path d="M14 17.5a9 9 0 0 1 0 13" />
            <path d="M20.5 12a17 17 0 0 1 0 24" />
            <path d="M27 6.5a25 25 0 0 1 0 35" />
          </g>
          <circle cx="8" cy="24" r="3" fill="currentColor" />
        </svg>
        {hint}
      </span>
      <span className={styles.today}>{today}</span>
    </footer>
  );
}

/** Écran sans appel : une phrase, grande, et ce qui va se passer. */
export function TvIdle({ title, line }: { title: string; line: string }) {
  return (
    <div className={styles.idle}>
      <p className={styles.idleTitle}>{title}</p>
      <p className={styles.idleLine}>{line}</p>
    </div>
  );
}

/** « PRÊT », « PRÊTE », « APPELÉ » : la pastille vermillon (ou cuivre). */
export function TvTag({ children, tone = 'signal' }: { children: ReactNode; tone?: 'signal' | 'copper' }) {
  return <span className={styles.tag} data-tone={tone}>{children}</span>;
}

/**
 * L'ANNONCE, en surimpression : un panneau en relief qui monte du sol,
 * tient quelques secondes (la barre vermillon, en bas, dit combien), puis
 * s'efface. Toujours monté : la région `status` annonce le texte aux
 * lecteurs d'écran même quand le panneau n'est pas visible.
 */
export function TvAnnounce({
  phase,
  hold,
  kicker,
  speech,
  children,
}: {
  phase: AnnouncePhase | null;
  hold: number;
  kicker: string;
  /** Phrase complète pour les lecteurs d'écran (« Ticket A-042, guichet 3 »). */
  speech: string | null;
  children: ReactNode;
}) {
  const visible = phase !== null && speech !== null;
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {visible ? speech : ''}
      </p>
      {visible && (
        <div
          className={styles.announce}
          data-phase={phase}
          aria-hidden="true"
          style={{ ['--announce-hold' as string]: `${hold}ms` } as CSSProperties}
        >
          <span className={styles.announceScrim} />
          <div className={styles.announceCard}>
            <span className={`t-label ${styles.announceKicker}`}>{kicker}</span>
            <div className={styles.announceBody}>{children}</div>
            <span className={styles.announceTimer} />
          </div>
        </div>
      )}
    </>
  );
}
