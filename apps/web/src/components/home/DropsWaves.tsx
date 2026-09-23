'use client';

import { Fragment, useRef } from 'react';
import { useInViewOnce } from '@/components/motion/useInViewOnce';
import { useReducedMotion } from '@/components/motion/useMotionPreference';
import styles from './DropsWaves.module.css';

/**
 * LES VAGUES — le mode Event / Drop en une image.
 *
 * Un rail, trois groupes de dix personnes et, devant chaque groupe, une
 * barrière. À l'entrée dans la vue, la première barrière se lève, la
 * vague 1 avance vers l'entrée et son contour passe au vermillon. Une
 * seule fois ; en mouvement réduit, l'état final directement.
 *
 * Horizontal à partir de 720 px, vertical en dessous : c'est la grille
 * qui change, on ne fait jamais tourner le composant.
 */

const WAVES = [3, 2, 1] as const;

function Barrier({ n }: { n: number }) {
  const id = `barriere-rayures-${n}`;
  return (
    <svg className={styles.barrier} data-n={n} viewBox="0 0 106 44" width="106" height="44" aria-hidden="true">
      <defs>
        <pattern id={id} width="14" height="6" patternUnits="userSpaceOnUse" patternTransform="skewX(-35)">
          <rect width="7" height="6" fill="var(--accent)" />
          <rect x="7" width="7" height="6" fill="var(--ink-1000)" />
        </pattern>
      </defs>
      <rect className={styles.post} x="0" y="4" width="6" height="40" rx="2" />
      <g className={styles.arm}>
        <rect x="3" y="4" width="100" height="6" rx="3" fill={`url(#${id})`} />
      </g>
      <circle className={styles.pivot} cx="3" cy="7" r="3.5" />
    </svg>
  );
}

export function DropsWaves(): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useInViewOnce(ref, { threshold: 0.5 });
  const reduced = useReducedMotion();
  const open = seen || reduced;

  return (
    <div ref={ref} className={styles.waves} data-open={open ? '1' : '0'} aria-hidden="true">
      <div className={styles.track}>
        {WAVES.map((n) => (
          <Fragment key={n}>
            <div className={styles.group} data-wave={n}>
              <span className={styles.outline} />
              {n === 1 && <span className={styles.outlineOn} />}
              <span className={`t-label ${styles.label}`}>
                <span data-l="wait">Vague {n}</span>
                {n === 1 && <span data-l="go">Vague 1 · entrez</span>}
              </span>
              <span className={styles.slats}>
                {Array.from({ length: 10 }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </div>
            <Barrier n={n} />
          </Fragment>
        ))}
        <span className={`t-label ${styles.entry}`}>Entrée</span>
      </div>
    </div>
  );
}
