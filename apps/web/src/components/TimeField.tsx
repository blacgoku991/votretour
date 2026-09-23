'use client';

import styles from './TimeField.module.css';

/**
 * L'HEURE EN 24 H — deux listes (heures 00 à 23, minutes), affichées
 * « 09 h 00 ». Remplace <input type="time">, qui affichait « 09:00 AM »
 * selon la langue du navigateur. Aucune dépendance à la langue.
 *
 * Renvoie toujours 'HH:MM', le même format que l'ancien champ.
 */

export interface TimeFieldProps {
  /** 'HH:MM' ou 'HH:MM:SS' (on ignore les secondes). */
  value: string;
  /** Renvoie toujours 'HH:MM' (même format que l'ancien input type=time). */
  onChange: (value: string) => void;
  /** Défaut 15 ; une minute existante hors pas est ajoutée à la liste. */
  minuteStep?: 5 | 15 | 30;
  disabled?: boolean;
  /** Porté par la liste des heures (pour <label htmlFor>). */
  id?: string;
  /** Ex. « Ouverture du lundi » ; les deux listes portent « … — heures » / « … — minutes ». */
  'aria-label'?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, h) => pad2(h));

function parse(value: string): { h: string; m: string } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value?.trim() ?? '');
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h: pad2(h), m: pad2(m) };
}

export function TimeField({
  value,
  onChange,
  minuteStep = 15,
  disabled = false,
  id,
  'aria-label': ariaLabel,
}: TimeFieldProps): React.JSX.Element {
  const parsed = parse(value);
  const h = parsed?.h ?? '';
  const m = parsed?.m ?? '';

  const minutes: string[] = [];
  for (let v = 0; v < 60; v += minuteStep) minutes.push(pad2(v));
  if (m && !minutes.includes(m)) {
    minutes.push(m);
    minutes.sort();
  }

  const base = ariaLabel ?? 'Heure';

  return (
    <span className={styles.timeField} data-disabled={disabled ? '1' : undefined}>
      <select
        id={id}
        className={`select ${styles.select}`}
        value={h}
        disabled={disabled}
        aria-label={`${base} — heures`}
        onChange={(e) => onChange(`${e.target.value}:${m || '00'}`)}
      >
        {!parsed && (
          <option value="" disabled>
            --
          </option>
        )}
        {HOURS.map((hh) => (
          <option key={hh} value={hh}>
            {hh}
          </option>
        ))}
      </select>
      <span className={styles.sep} aria-hidden="true">
        h
      </span>
      <select
        className={`select ${styles.select}`}
        value={m}
        disabled={disabled}
        aria-label={`${base} — minutes`}
        onChange={(e) => onChange(`${h || '00'}:${e.target.value}`)}
      >
        {!parsed && (
          <option value="" disabled>
            --
          </option>
        )}
        {minutes.map((mm) => (
          <option key={mm} value={mm}>
            {mm}
          </option>
        ))}
      </select>
    </span>
  );
}
