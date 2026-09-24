'use client';

import { useEffect, useState } from 'react';
import { FlapNumber } from '@/components/FlapNumber';
import { useReducedMotion } from '@/components/motion/useMotionPreference';
import { Wordmark } from '@/components/Wordmark';
import styles from './onboarding.module.css';

/**
 * LA PROGRESSION, dessinée comme la file.
 *
 * Ordinateur : un rail vertical de lattes libellées (5, ou 4 hors passage
 * au fauteuil, où le choix du mode de file n'a pas lieu d'être). L'étape en cours
 * est la latte vermillon ; une étape validée PASSE (elle se relève comme
 * un volet et s'efface, 420 ms) et laisse une encoche jade. En revenant
 * en arrière, la latte redescend par la même transition.
 *
 * Mobile : un bandeau de 56 px avec le volet compact et un segment par
 * étape.
 *
 * Le volet « n étapes avant votre file » est décoratif (FlapNumber
 * static) : la phrase complète est lue une fois par le lecteur d'écran.
 * Sa fin suit le métier : « avant votre atelier », « avant votre salle ».
 */

export interface RailStep {
  id: string;
  label: string;
}

/** « étapes » au pluriel, « étape » pour 0 ou 1. */
export function stepWord(remaining: number): string {
  return remaining > 1 ? 'étapes' : 'étape';
}

/** Durée de la chute du volet : le mot suit le chiffre, il ne le devance pas. */
const FLAP_MS = 440;

/** Fin de phrase par défaut, celle du parcours d'aujourd'hui. */
const DEFAULT_TARGET = 'avant votre file';

function Remaining({
  remaining, size, compact, target,
}: { remaining: number; size: string; compact?: boolean; target: string }) {
  const reduced = useReducedMotion();
  const [word, setWord] = useState(() => stepWord(remaining));
  useEffect(() => {
    const next = stepWord(remaining);
    const timer = window.setTimeout(() => setWord(next), reduced ? 0 : FLAP_MS);
    return () => window.clearTimeout(timer);
  }, [remaining, reduced]);
  return (
    <p className={compact ? styles.remainingCompact : styles.remaining}>
      <FlapNumber static value={remaining} size={size} label={`${remaining} ${stepWord(remaining)} ${target}`} />
      <span className={styles.remainingText} aria-hidden="true">
        <span>{word}</span> <span>{target}</span>
      </span>
    </p>
  );
}

export function StepRail({
  steps, index, greeting, target = DEFAULT_TARGET,
}: { steps: RailStep[]; index: number; greeting: string; target?: string }) {
  const remaining = steps.length - index;
  return (
    <div className={styles.railBlock}>
      <p className={styles.greeting}>{greeting}</p>
      <Remaining remaining={remaining} size="4.5rem" target={target} />
      <ol className={styles.rail} aria-label="Étapes">
        {steps.map((step, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'todo';
          return (
            <li
              key={step.id}
              className={styles.railItem}
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="sr-only">
                {`Étape ${i + 1} : ${step.label}${state === 'done' ? ' (faite)' : ''}`}
              </span>
              <span className={styles.railNotch} aria-hidden="true" />
              {/* La trace qui reste après le Passage. */}
              <span className={styles.railTrace} aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                  <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {step.label}
              </span>
              <span className={styles.railSlat} aria-hidden="true">
                <span className={styles.railNum}>{i + 1}</span>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Pied de la colonne de progression. « Vos réglages », pas « tout » : il
 * est posé à côté de la grille d'activités, et le métier, lui, n'est pas
 * modifiable par le commerçant (l'équipe Rangvia l'active).
 */
export function RailNote() {
  return <p className={styles.railNote}>Vos réglages restent modifiables ensuite, depuis votre tableau de bord.</p>;
}

export function StepBand({
  steps, index, target = DEFAULT_TARGET,
}: { steps: RailStep[]; index: number; target?: string }) {
  const remaining = steps.length - index;
  return (
    <div className={styles.band}>
      <div className={styles.bandRow}>
        <Remaining remaining={remaining} size="2rem" compact target={target} />
        <Wordmark compact />
      </div>
      <span
        className={styles.segments}
        aria-hidden="true"
        style={{ ['--segments' as string]: steps.length } as React.CSSProperties}
      >
        {steps.map((step, i) => (
          <span
            key={step.id}
            className={styles.segment}
            data-state={i < index ? 'done' : i === index ? 'current' : 'todo'}
          />
        ))}
      </span>
    </div>
  );
}
