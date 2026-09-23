'use client';

import { useEffect, useState } from 'react';
import styles from './settings.module.css';

const POSITIONS = [1, 2, 3, 4, 5] as const;
/** Largeur d'une latte et écart, en px : la géométrie du repère en dépend. */
const W = 44;
const G = 6;
const TRACK = POSITIONS.length * W + (POSITIONS.length - 1) * G;

/**
 * « PRÉVENIR À PARTIR DE » — un mini-rang de 5 lattes.
 *
 * Le comptoir est à gauche ; la latte n° k est la place où il reste k
 * personnes devant. Un repère vermillon marque le réglage et glisse
 * d'une latte à l'autre (transform seul). La zone prévenue (1 … N) est
 * soulignée sur le rail par un trait qui s'étire en scaleX.
 *
 * De vrais boutons radio (masqués) portent la valeur : clavier et
 * lecteurs d'écran fonctionnent sans code en plus.
 */
export function ThresholdRang({
  value, disabled, onChange,
}: { value: number; disabled?: boolean; onChange: (value: number) => void }) {
  // Affichage optimiste : le repère part tout de suite, la valeur du
  // serveur reprend la main au rafraîchissement.
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  const n = Math.min(5, Math.max(1, local));

  return (
    <fieldset className={styles.thr} disabled={disabled}>
      <legend className="sr-only">Prévenir à partir de combien de personnes devant</legend>
      <div className={styles.thrSlats}>
        <span
          className={styles.thrMarker}
          aria-hidden="true"
          style={{ transform: `translateX(${(n - 1) * (W + G)}px)` }}
        />
        {POSITIONS.map((k) => (
          <label key={k} className={styles.thrSlat} data-zone={k <= n ? '1' : undefined}>
            <input
              type="radio"
              className="sr-only"
              name="prevenir-a-partir-de"
              value={k}
              checked={k === n}
              onChange={() => { setLocal(k); onChange(k); }}
            />
            <span className={styles.thrNum}>{k}</span>
            <span className="sr-only">{k === 1 ? ' personne devant' : ' personnes devant'}</span>
          </label>
        ))}
      </div>
      <div className={styles.thrRail} aria-hidden="true">
        <span
          className={styles.thrZone}
          style={{ transform: `scaleX(${((n * (W + G) - G) / TRACK).toFixed(3)})` }}
        />
      </div>
      <p className={styles.thrCaption} aria-hidden="true">
        <span className={styles.thrCounter}>Comptoir</span>
        <span>
          1<sup>re</sup> notification à {n} personne{n > 1 ? 's' : ''} devant
        </span>
      </p>
    </fieldset>
  );
}
