'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './Rang.module.css';

/**
 * LE RANG — la représentation visuelle de la file.
 *
 * Un rail vertical, et une latte accrochée dessus par personne. La latte
 * du client est deux fois plus haute et porte la couleur de signal.
 *
 * Quand quelqu'un passe, on ne remplace pas un nombre : la latte du haut
 * se rétracte vers le rail, une impulsion descend le long du rail, et
 * tout le reste avance d'un cran. Le client VOIT sa place avancer.
 *
 * Contrainte de confidentialité qui a façonné le composant : on ne sait
 * rien des autres personnes (ni prénom, ni identifiant). On fabrique donc
 * des jetons locaux stables, uniquement pour que React anime les bonnes
 * lattes au lieu de tout redessiner.
 */

let counter = 0;
const nextToken = () => `s${(counter += 1)}`;
const makeTokens = (n: number) => Array.from({ length: Math.max(0, n) }, nextToken);

export interface RangProps {
  /** Nombre de personnes devant. */
  ahead: number;
  /** Prénom affiché sur la latte du client (facultatif). */
  selfLabel?: string | null;
  /** Texte secondaire sur la latte du client. */
  selfHint?: string | null;
  /** Le client est en prestation : la file est derrière lui. */
  isServing?: boolean;
  /** Quelqu'un est effectivement au comptoir en ce moment. */
  headIsServing?: boolean;
  /** Nombre maximum de lattes dessinées avant de condenser. */
  maxSlats?: number;
  onAdvance?: (from: number, to: number) => void;
}

export function Rang({
  ahead,
  selfLabel,
  selfHint,
  isServing = false,
  headIsServing = false,
  maxSlats = 9,
  onAdvance,
}: RangProps) {
  const visible = Math.min(Math.max(0, ahead), maxSlats);
  const overflow = Math.max(0, ahead - maxSlats);

  const [tokens, setTokens] = useState<string[]>(() => makeTokens(visible));
  const [leaving, setLeaving] = useState<string[]>([]);
  const [pulse, setPulse] = useState(false);
  const previousAhead = useRef(ahead);
  const timers = useRef<ReturnType<typeof setTimeout>[] | null>(null);

  useEffect(() => {
    timers.current = [];
    return () => {
      timers.current?.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const before = previousAhead.current;
    if (before === ahead) return;
    previousAhead.current = ahead;

    if (ahead < before) {
      onAdvance?.(before, ahead);
      setPulse(true);
      // Retour haptique sur Android ; sur iPhone c'est l'App Clip qui
      // déclenche un vrai retour Taptic côté natif.
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate?.(ahead === 0 ? [14, 60, 26] : [10]);
        } catch {
          /* certains navigateurs refusent sans geste utilisateur */
        }
      }
      const t = setTimeout(() => setPulse(false), 640);
      timers.current?.push(t);
    }

    setTokens((current) => {
      if (visible > current.length) {
        return [...current, ...makeTokens(visible - current.length)];
      }
      if (visible < current.length) {
        const removedCount = current.length - visible;
        const removed = current.slice(0, removedCount);
        setLeaving(removed);
        const t = setTimeout(() => {
          setTokens((c) => c.slice(removedCount));
          setLeaving([]);
        }, 420);
        timers.current?.push(t);
        return current;
      }
      return current;
    });
  }, [ahead, visible, onAdvance]);

  const rows = tokens.filter((token) => !leaving.includes(token));

  return (
    <div className={styles.wrap}>
      {overflow > 0 && (
        <p className={`t-micro t-faint ${styles.overflow}`}>
          + {overflow} {overflow === 1 ? 'personne' : 'personnes'} plus haut dans la file
        </p>
      )}

      <div className="rang" data-pulse={pulse ? '1' : '0'} aria-hidden="true">
        {leaving.map((token) => (
          <div key={token} className="slat slat--leaving" />
        ))}

        {rows.map((token, index) => (
          <div
            key={token}
            className={
              index === 0 && !isServing
                ? `slat ${headIsServing ? 'slat--serving' : 'slat--head'}`
                : 'slat'
            }
            style={{ animationDelay: `${Math.min(index, 6) * 34}ms` }}
          >
            <span className={index === 0 && !isServing ? styles.tickHead : styles.tick} />
          </div>
        ))}

        <div className={`slat slat--self ${styles.self}`}>
          <span className={styles.selfDot} />
          <span className={styles.selfText}>
            <span className={styles.selfName}>{selfLabel || 'Vous'}</span>
            {selfHint && <span className={styles.selfHint}>{selfHint}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
