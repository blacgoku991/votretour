'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './Rang.module.css';
import { useReducedMotion } from './motion/useMotionPreference';
import { reconcileRang, settleRang, shiftAt, type RangModel } from './motion/rangTokens';

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

/** Durée du Passage et du dépliage (--dur-3). */
const PASS_MS = 420;
/**
 * Fin du mouvement complet : l'avance démarre 200 ms après le début du
 * Passage (--rang-advance-delay), dure 620 ms (--dur-4), et la dernière
 * latte part avec 8 × 34 ms de décalage. Ce n'est qu'ensuite que les
 * lattes parties quittent le flux : la mise en page ne change qu'une fois.
 */
const SETTLE_MS = 200 + 620 + 8 * 34 + 40;
/** Durée de l'impulsion du rail (--dur-4) + marge. */
const PULSE_MS = 660;

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
  const reduced = useReducedMotion();

  const [model, setModel] = useState<RangModel>(() => ({ tokens: makeTokens(visible), leaving: [] }));
  const [entering, setEntering] = useState<string[]>([]);
  // Image où les lattes parties quittent le flux : les décalages repassent
  // à 0 en même temps, SANS transition, donc sans mouvement visible.
  const [snap, setSnap] = useState(false);
  // 0 au repos ; 1 et 2 alternent pour relancer l'impulsion à chaque avance.
  const [pulse, setPulse] = useState(0);

  // Source de vérité hors des fonctions de mise à jour : l'effet calcule le
  // modèle suivant, puis déclenche les effets de bord dans son propre corps.
  const modelRef = useRef(model);
  const previousAhead = useRef(ahead);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hapticsRef = useRef(haptics);
  hapticsRef.current = haptics;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;

  useEffect(() => {
    const list = timers.current;
    return () => {
      list.forEach(clearTimeout);
      list.clear();
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    };
  }, []);

  useEffect(() => {
    const before = previousAhead.current;
    if (before === ahead) return;
    previousAhead.current = ahead;

    if (ahead < before) {
      onAdvanceRef.current?.(before, ahead);
      setPulse((p) => (p === 1 ? 2 : 1));
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse(0), PULSE_MS);
      // Retour haptique seulement si on le demande (écran client) ; sur
      // iPhone c'est l'App Clip qui déclenche un vrai retour Taptic.
      if (hapticsRef.current && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate?.(ahead === 0 ? [14, 60, 26] : [10]);
        } catch {
          /* certains navigateurs refusent sans geste utilisateur */
        }
      }
    }

    const step = reconcileRang(modelRef.current, visible, makeTokens, reducedRef.current);
    if (step.model === modelRef.current) return;
    modelRef.current = step.model;
    setModel(step.model);

    if (step.added.length > 0) {
      const added = step.added;
      setEntering((e) => [...e, ...added]);
      const t = setTimeout(() => {
        timers.current.delete(t);
        setEntering((e) => e.filter((token) => !added.includes(token)));
      }, PASS_MS);
      timers.current.add(t);
    }

    if (step.removed.length > 0 && !reducedRef.current) {
      // Un seul minuteur, relancé à chaque départ : on ne retire les lattes
      // parties qu'une fois TOUT le mouvement joué.
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        const next = settleRang(modelRef.current);
        if (next === modelRef.current) return;
        modelRef.current = next;
        setModel(next);
        setSnap(true);
      }, SETTLE_MS);
    }
  }, [ahead, visible]);

  // Deux images plus tard, on rend les transitions : les décalages sont
  // déjà à 0, rien ne bouge.
  useEffect(() => {
    if (!snap) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setSnap(false));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [snap]);

  const leavingSet = new Set(model.leaving);
  const slatStyle = (index: number, rank: number): React.CSSProperties => {
    const style: Record<string, string | number> = {
      '--i': Math.min(Math.max(rank, 0), 8),
      '--shift': shiftAt(model, index),
    };
    if (snap) style.transition = 'none';
    return style as React.CSSProperties;
  };

  const rangClass = `rang${relief ? ' rang--relief' : ''}`;
  const selfClass = ghostSelf
    ? `slat slat--ghost ${styles.ghost}`
    : `slat slat--self ${styles.self}`;
  const headClass = headIsServing ? 'slat--serving' : 'slat--head';

  let rank = 0;
  return (
    <div className={styles.wrap}>
      {overflow > 0 && (
        <p className={`t-micro t-muted ${styles.overflow}`}>
          + {overflow} {overflow === 1 ? 'personne' : 'personnes'} plus haut dans la file
        </p>
      )}

      <div className={rangClass} data-pulse={pulse ? String(pulse) : '0'} aria-hidden="true">
        {model.tokens.map((token, index) => {
          if (leavingSet.has(token)) {
            // La latte qui passe garde sa place et son allure de tête.
            return (
              <div
                key={token}
                className={`slat ${isServing ? '' : headClass} slat--leaving`}
                style={slatStyle(index, 0)}
              >
                <span className={isServing ? styles.tick : styles.tickHead} />
              </div>
            );
          }
          const r = rank;
          rank += 1;
          const head = r === 0 && !isServing;
          const base = head ? `slat ${headClass}` : 'slat';
          return (
            <div
              key={token}
              className={entering.includes(token) ? `${base} slat--entering` : base}
              style={slatStyle(index, r)}
            >
              <span className={head ? styles.tickHead : styles.tick} />
            </div>
          );
        })}

        <div className={selfClass} style={slatStyle(model.tokens.length, rank)}>
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
