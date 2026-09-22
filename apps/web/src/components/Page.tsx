'use client';

import { useEffect, useState } from 'react';
import styles from './Page.module.css';

/** Briques communes aux écrans du tableau de bord. */

export function PageHeader({
  title, description, actions,
}: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <h1 className="t-title">{title}</h1>
        {description && <p className="t-small t-muted">{description}</p>}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}

export function Section({
  title, description, children, actions,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      {(title || actions) && (
        <div className={styles.sectionHead}>
          <div>
            {title && <h2 className="t-label">{title}</h2>}
            {description && <p className={`t-small t-muted ${styles.sectionDesc}`}>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

/** Ligne de réglage : libellé + explication à gauche, contrôle à droite. */
export function SettingRow({
  label, hint, children, stacked = false,
}: { label: string; hint?: string; children: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={`${styles.row} ${stacked ? styles.rowStacked : ''}`}>
      <div className={styles.rowText}>
        <p className={styles.rowLabel}>{label}</p>
        {hint && <p className="t-micro t-faint">{hint}</p>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

/** Interrupteur : une latte qui glisse d'un cran. */
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
      className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleKnob} />
    </button>
  );
}

/** Barre de sauvegarde qui apparaît dès qu'un réglage change. */
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

  return (
    <div className={styles.saveBar} role="status">
      {error ? (
        <span className={styles.saveError}>{error}</span>
      ) : saved && !dirty ? (
        <span className={styles.saveOk}>Enregistré</span>
      ) : (
        <span className="t-small t-muted">Modifications non enregistrées</span>
      )}
      <div className="row g2">
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

/** Tuile de statistique. */
export function Stat({
  label, value, hint, accent,
}: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`${styles.stat} ${accent ? styles.statAccent : ''}`}>
      <p className="t-label">{label}</p>
      <p className={styles.statValue}>{value}</p>
      {hint && <p className="t-micro t-faint">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  title, description, action,
}: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark} aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="currentColor">
          <rect x="4" y="8" width="2.4" height="24" rx="1.2" opacity="0.35" />
          <rect x="11" y="9" width="24" height="5" rx="2.5" opacity="0.22" />
          <rect x="11" y="18" width="17" height="5" rx="2.5" opacity="0.16" />
          <rect x="11" y="27" width="11" height="5" rx="2.5" opacity="0.1" />
        </svg>
      </span>
      <p className="t-section">{title}</p>
      {description && <p className="t-small t-muted">{description}</p>}
      {action}
    </div>
  );
}
