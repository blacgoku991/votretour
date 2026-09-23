'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './Rang.module.css';

/**
 * LE RANG — la représentation visuelle de la file.
 *
 * Un rail vertical, et une latte accrochée dessus par personne. La latte
 * du client est deux fois plus haute et porte la couleur de signal (texte
 * encre sur vermillon, 5,9:1).
 *
 * Quand quelqu'un passe, on ne remplace pas un nombre : la latte du haut
 * PASSE (elle se relève comme un volet autour de son bord côté seuil, puis
 * s'efface), une impulsion remonte le rail, et tout le reste avance d'un
 * cran, de la tête vers la queue. Le client VOIT sa place avancer.
 *
 * Contrainte de confidentialité qui a façonné le composant : on ne sait
 * rien des autres personnes (ni prénom, ni identifiant). On fabrique donc
 * des jetons locaux stables, uniquement pour que React anime les bonnes
 * lattes au lieu de tout redessiner.
 */

let counter = 0;
const nextToken = () => `s${(counter += 1)}`;
const makeTokens = (n: number) => Array.from({ length: Math.max(0, n) }, nextToken);

/** Durée du Passage (--dur-3). */
const PASS_MS = 420;

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
  /** Retour haptique (navigator.vibrate) quand la file avance. Défaut : FALSE. Seul /e/[slug] le passe à true. */
  haptics?: boolean;
  /** Épaisseur suggérée (ombre dure de 2 px, classe .rang--relief). Défaut : true. */
  relief?: boolean;
  /** Dernière latte fantôme en pointillés (aperçu « Votre place »). Défaut : false. */
  ghostSelf?: boolean;
}

export function Rang({
  ahead,
  selfLabel,
  selfHint,
  isServing = false,
  headIsServing = false,
  maxSlats = 9,
  onAdvance,
  haptics = false,
  relief = true,
  ghostSelf = false,
}: RangProps) {
  const visible = Math.min(Math.max(0, ahead), maxSlats);
  const overflow = Math.max(0, ahead - maxSlats);

  const [tokens, setTokens] = useState<string[]>(() => makeTokens(visible));
  const [leaving, setLeaving] = useState<string[]>([]);
  const [entering, setEntering] = useState<string[]>([]);
  // Après un Passage, les lattes restantes repartent d'un cran plus bas et
  // glissent vers leur nouvelle place (FLIP, transform seulement).
  const [settle, setSettle] = useState(0);
  const [pulse, setPulse] = useState(0);
  const previousAhead = useRef(ahead);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const hapticsRef = useRef(haptics);
  hapticsRef.current = haptics;

  useEffect(() => {
    const list = timers.current;
    return () => {
      list.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const before = previousAhead.current;
    if (before === ahead) return;
    previousAhead.current = ahead;

    if (ahead < before) {
      onAdvance?.(before, ahead);
      setPulse((p) => p + 1);
      // Retour haptique seulement si on le demande (écran client) ; sur
      // iPhone c'est l'App Clip qui déclenche un vrai retour Taptic.
      if (hapticsRef.current && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate?.(ahead === 0 ? [14, 60, 26] : [10]);
        } catch {
          /* certains navigateurs refusent sans geste utilisateur */
        }
      }
      const t = setTimeout(() => setPulse(0), 640);
      timers.current.push(t);
    }

    setTokens((current) => {
      if (visible > current.length) {
        const added = makeTokens(visible - current.length);
        setEntering(added);
        const t = setTimeout(() => setEntering([]), PASS_MS);
        timers.current.push(t);
        return [...current, ...added];
      }
      if (visible < current.length) {
        const removedCount = current.length - visible;
        const removed = current.slice(0, removedCount);
        setLeaving(removed);
        const t = setTimeout(() => {
          setTokens((c) => c.slice(removedCount));
          setLeaving([]);
          setSettle(removedCount);
        }, PASS_MS);
        timers.current.push(t);
        return current;
      }
      return current;
    });
  }, [ahead, visible, onAdvance]);

  // Deux images plus tard, on retire le décalage : la transition CSS de
  // transform fait glisser chaque latte d'un cran (décalage de 34 ms).
  useEffect(() => {
    if (!settle) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setSettle(0));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [settle]);

  const rows = tokens.filter((token) => !leaving.includes(token));
  const settleStyle = (index: number): React.CSSProperties =>
    settle
      ? ({
          ['--i' as string]: Math.min(index, 8),
          transform: `translateY(calc(var(--step) * ${settle}))`,
          transition: 'none',
        } as React.CSSProperties)
      : ({ ['--i' as string]: Math.min(index, 8) } as React.CSSProperties);

  const rangClass = `rang${relief ? ' rang--relief' : ''}`;
  const selfClass = ghostSelf
    ? `slat slat--ghost ${styles.ghost}`
    : `slat slat--self ${styles.self}`;

  return (
    <div className={styles.wrap}>
      {overflow > 0 && (
        <p className={`t-micro t-faint ${styles.overflow}`}>
          + {overflow} {overflow === 1 ? 'personne' : 'personnes'} plus haut dans la file
        </p>
      )}

      <div className={rangClass} data-pulse={pulse ? '1' : '0'} aria-hidden="true">
        {leaving.map((token) => (
          <div key={token} className="slat slat--leaving" />
        ))}

        {rows.map((token, index) => {
          const head = index === 0 && !isServing;
          const base = head ? `slat ${headIsServing ? 'slat--serving' : 'slat--head'}` : 'slat';
          return (
            <div
              key={token}
              className={entering.includes(token) ? `${base} slat--entering` : base}
              style={settleStyle(index)}
            >
              <span className={head ? styles.tickHead : styles.tick} />
            </div>
          );
        })}

        <div className={selfClass} style={settleStyle(rows.length)}>
          {!ghostSelf && <span className={styles.selfDot} />}
          <span className={styles.selfText}>
            <span className={styles.selfName}>{selfLabel || (ghostSelf ? 'Votre place' : 'Vous')}</span>
            {selfHint && <span className={styles.selfHint}>{selfHint}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
