'use client';

import { useEffect, useRef, useState } from 'react';
import { FlapText } from './FlapNumber';
import styles from './Page.module.css';

/**
 * Briques communes aux écrans du tableau de bord (et de l'admin).
 * API conservée ; les props ajoutées sont toutes facultatives.
 */

export function PageHeader({
  title, description, actions, eyebrow,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Étiquette au-dessus du titre (facultative). */
  eyebrow?: string;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        {eyebrow && <p className={`t-label ${styles.eyebrow}`}>{eyebrow}</p>}
        <h1 className="t-title">{title}</h1>
        {description && <p className={styles.headerDesc}>{description}</p>}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}

export function Section({
  title, description, children, actions, bare = false, id,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** Sans panneau : le contenu est posé sur la page (graphiques, bandes KPI). */
  bare?: boolean;
  id?: string;
}) {
  return (
    <section className={styles.section} id={id}>
      {(title || actions) && (
        <div className={styles.sectionHead}>
          <div className={styles.sectionTitles}>
            {title && <h2 className={`t-label ${styles.sectionTitle}`}>{title}</h2>}
            {description && <p className={styles.sectionDesc}>{description}</p>}
          </div>
          {actions && <div className={styles.sectionActions}>{actions}</div>}
        </div>
      )}
      <div className={bare ? styles.sectionBare : styles.sectionBody}>{children}</div>
    </section>
  );
}

/** Ligne de réglage : libellé et aide à gauche, contrôle à droite (dessous sous 640 px). */
export function SettingRow({
  label, hint, children, stacked = false,
}: { label: string; hint?: string; children: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={`${styles.row} ${stacked ? styles.rowStacked : ''}`}>
      <div className={styles.rowText}>
        <p className={styles.rowLabel}>{label}</p>
        {hint && <p className={styles.rowHint}>{hint}</p>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

/** Interrupteur : une glissière — piste en rail, petite latte qui glisse d'un cran. */
export function Toggle({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.toggle}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleKnob} aria-hidden="true" />
    </button>
  );
}

/** Barre de sauvegarde collante, qui monte dès qu'un réglage change. */
export function SaveBar({
  dirty, pending, onSave, onReset, error, saved,
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  onReset?: () => void;
  error?: string | null;
  saved?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(dirty); }, [dirty]);

  if (!visible && !saved && !error) return null;

  const tone = error ? 'error' : saved && !dirty ? 'ok' : 'dirty';

  return (
    <div className={styles.saveBar} data-tone={tone} role="status">
      <span className={styles.saveMark} aria-hidden="true" />
      {error ? (
        <span className={styles.saveError}>{error}</span>
      ) : saved && !dirty ? (
        <span className={styles.saveOk}>Enregistré</span>
      ) : (
        <span className={styles.saveText}>
          <span className={styles.saveLong}>Modifications non enregistrées</span>
          <span className={styles.saveShort}>Non enregistré</span>
        </span>
      )}
      <div className={styles.saveActions}>
        {onReset && dirty && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={onReset}>
            Annuler
          </button>
        )}
        {dirty && (
          <button type="button" className="btn btn--signal btn--sm" onClick={onSave} disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Cellule de bande KPI (`.kpi-band`). La valeur est un volet statique :
 * elle tombe une seule fois, à l'entrée dans la vue, depuis des tirets.
 * Hors d'une `.kpi-band`, la cellule garde son propre contour.
 */
export function Stat({
  label, value, hint, accent, lead,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Encoche vermillon au-dessus de l'étiquette. */
  accent?: boolean;
  /** Chiffre principal de la bande : valeur plus grande (la cellule peut s'étendre). */
  lead?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Rendu serveur et premier rendu client : la valeur, jamais de tirets.
  // Après montage seulement, une cellule encore sous la fenêtre est « armée »
  // (tirets) puis tombe une fois à son entrée dans la vue. Mouvement réduit :
  // jamais armée (lu dans l'effet, pas via un hook qui vaut false à l'hydratation).
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let first = true;
    let wasArmed = false;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (first) {
          first = false;
          if (visible) { io.disconnect(); return; }
          wasArmed = true;
          setArmed(true);
          return;
        }
        if (visible && wasArmed) {
          setArmed(false);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const shown = armed ? placeholder(value) : value;

  return (
    <div
      ref={ref}
      className={`${styles.stat} ${accent ? styles.statAccent : ''} ${lead ? styles.statLead : ''}`}
    >
      <span className={styles.statNotch} aria-hidden="true" />
      <p className="t-label">{label}</p>
      <p className={styles.statValue}>
        <FlapText static text={shown} label={value} stagger={36} />
      </p>
      {hint && <p className={styles.statHint}>{hint}</p>}
    </div>
  );
}

/** « 12 min » → « –– ––– » : chaque caractère tombe depuis un tiret. */
function placeholder(value: string): string {
  return Array.from(value).map((c) => (c === ' ' || c === ' ' || c === ' ' ? c : '–')).join('');
}

/** État vide : un rail, une latte fantôme en pointillés, puis le texte. */
export function EmptyState({
  title, description, action,
}: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyRang} aria-hidden="true">
        <span className={styles.emptyGhost} />
        <span className={styles.emptyTick} />
      </div>
      <div className={styles.emptyText}>
        <p className="t-section">{title}</p>
        {description && <p className={styles.emptyDesc}>{description}</p>}
        {action && <div className={styles.emptyAction}>{action}</div>}
      </div>
    </div>
  );
}
