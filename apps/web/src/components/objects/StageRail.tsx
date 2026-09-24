import { formatTime } from '@/lib/format';
import { stageRailSteps, type RailStep } from '@/lib/profiles/stage-rail';
import type { ProfileStage, QueueProfile } from '@/lib/profiles/types';
import styles from './StageRail.module.css';

/**
 * LE RAIL D'ÉTAPES — où en est le véhicule, l'appareil ou la commande.
 *
 * Deux lectures du même objet :
 *
 *  - HORIZONTAL (fiche du pro) : un rail de 2 px, des stations en
 *    pastilles de 8 px, la station courante en latte miniature teintée.
 *    Se lit d'un coup d'œil sur un poste d'atelier.
 *  - VERTICAL (écran du client) : le Rang lui-même, dont les lattes sont
 *    les étapes. Passées : en os, estompées, avec leur heure (« Reçu ·
 *    08:42 »). En cours : en relief, portant le verbe (« En réparation »).
 *    À venir : en pointillé. Seule « Prêt » passe au vermillon ; le devis
 *    est cuivre (il attend le client), la pièce ardoise (elle attend un
 *    fournisseur), l'atelier cobalt (il travaille).
 *
 * Le chemin n'est pas linéaire : avec l'historique, une étape sautée n'est
 * jamais dessinée comme faite (`lib/profiles/stage-rail.ts`).
 *
 * Rendu pur, sans hook : compatible serveur.
 */

export interface StageRailProps {
  profile: QueueProfile;
  current: ProfileStage | null;
  /** Passages dans chaque étape (`ticket_state.stages`). */
  history?: readonly { stage: ProfileStage; at: string }[] | null;
  /** Défaut 'horizontal'. */
  orientation?: 'horizontal' | 'vertical';
  /** Masque les détours non empruntés. Défaut : vrai en vertical (client), faux sinon. */
  compact?: boolean;
  /** Fuseau de l'établissement, pour les heures. */
  timeZone?: string;
  className?: string;
}

const STATE_WORD: Record<RailStep['state'], string> = {
  done: 'passée',
  current: 'en cours',
  upcoming: 'à venir',
  skipped: 'sautée',
};

export function StageRail({
  profile,
  current,
  history,
  orientation = 'horizontal',
  compact,
  timeZone,
  className,
}: StageRailProps): React.JSX.Element | null {
  const vertical = orientation === 'vertical';
  const steps = stageRailSteps(profile, current, { history, compact: compact ?? vertical });
  if (steps.length === 0) return null;

  const currentStep = steps.find((s) => s.state === 'current');
  const position = currentStep ? steps.indexOf(currentStep) + 1 : 0;
  const summary = currentStep
    ? `Étapes : ${currentStep.def.client}, ${position} sur ${steps.length}`
    : 'Étapes du suivi';
  const time = (at: string | null) => (at ? formatTime(at, timeZone) : null);

  if (vertical) {
    return (
      <ol className={[styles.vrail, className].filter(Boolean).join(' ')} aria-label={summary}>
        {steps.map((step) => {
          const t = time(step.at);
          const isCurrent = step.state === 'current';
          return (
            <li
              key={step.def.key}
              className={styles.vstep}
              data-state={step.state}
              data-tone={step.def.tone}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className={styles.vslat}>
                {step.state === 'done' && (
                  <svg className={styles.check} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M5 10.5 8.5 14 15 6.5" />
                  </svg>
                )}
                <span className={styles.vlabel}>{isCurrent ? step.def.client : step.def.short}</span>
                {t && step.state === 'done' && <span className={styles.vtime}>{t}</span>}
                {t && isCurrent && <span className={styles.vsince}>depuis {t}</span>}
                <span className="sr-only">, {STATE_WORD[step.state]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol
      className={[styles.hrail, className].filter(Boolean).join(' ')}
      aria-label={summary}
      style={{ ['--steps' as string]: steps.length } as React.CSSProperties}
    >
      {steps.map((step) => (
        <li
          key={step.def.key}
          className={styles.hstep}
          data-state={step.state}
          data-tone={step.def.tone}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span className={styles.station} aria-hidden="true" />
          <span className={styles.hlabel}>
            {step.def.short}
            <span className="sr-only">, {STATE_WORD[step.state]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
