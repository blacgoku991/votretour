'use client';

import { useState } from 'react';
import styles from './auth.module.css';

const MIN_LENGTH = 8;

/**
 * Champ mot de passe avec bouton « Afficher / Masquer » dans le champ.
 *
 * `meter` (inscription) : sous le champ, 8 encoches qui s'allument une à
 * une pendant la saisie (opacité d'un calque par encoche, rien d'autre).
 * La règle « 8 caractères minimum » reste écrite et liée au champ par
 * aria-describedby : les lecteurs d'écran l'entendent, les encoches sont
 * décoratives.
 */
export function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  enterKeyHint,
  meter = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  enterKeyHint?: 'go' | 'done' | 'next';
  meter?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const ruleId = `${id}-regle`;
  const filled = Math.min(value.length, MIN_LENGTH);

  return (
    <div className="field">
      <label htmlFor={id}>Mot de passe</label>
      <div className={styles.secret}>
        <input
          id={id}
          className={`input ${styles.input} ${styles.secretInput}`}
          type={visible ? 'text' : 'password'}
          required
          minLength={meter ? MIN_LENGTH : undefined}
          autoComplete={autoComplete}
          enterKeyHint={enterKeyHint}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={meter ? ruleId : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className={styles.reveal}
          aria-controls={id}
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? 'Masquer' : 'Afficher'}
        </button>
      </div>

      {meter && (
        <div className={styles.meter} data-full={filled >= MIN_LENGTH ? '1' : undefined}>
          <span className={styles.notches} aria-hidden="true">
            {Array.from({ length: MIN_LENGTH }, (_, i) => (
              <span key={i} className={styles.notch} data-on={i < filled ? '1' : undefined} />
            ))}
          </span>
          <span id={ruleId} className={styles.rule}>
            8 caractères minimum
          </span>
        </div>
      )}
    </div>
  );
}
