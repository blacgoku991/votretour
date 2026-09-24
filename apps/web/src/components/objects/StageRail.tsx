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

  // ---- Horizontal -------------------------------------------------
  // Deux régimes, choisis par une requête de conteneur (le rail mesure sa
  // PROPRE largeur, pas celle de l'écran : une fiche étroite sur un grand
  // écran est traitée comme un téléphone) :
  //  - large : chaque étape écrit son nom ; la colonne de l'étape en cours
  //    réserve la largeur de son libellé (jamais de débordement sur les
  //    voisines), les autres se partagent le reste et s'abrègent au besoin ;
  //  - étroit : seuls les jalons restent sur le rail, et une ligne unique
  //    dessous nomme l'étape en cours (« Réparation 5/6 »), sous sa latte,
  //    bornée au rail. Les noms des autres étapes restent lus par les
  //    lecteurs d'écran.
  const index = currentStep ? position - 1 : -1;
  const need = railWidthNeeded(steps, index);
  const tier = RAIL_TIERS.find((t) => t >= need) ?? 'max';
  const columns = steps
    .map((s) => (s.state === 'current' ? 'minmax(max-content, 1fr)' : 'minmax(0, 1fr)'))
    .join(' ');
  // La légende de l'étroit couvre la colonne courante et ses deux voisines ;
  // aux extrémités, elle s'aligne sur le bord pour ne jamais sortir du rail.
  const from = Math.max(1, index);
  const to = Math.min(steps.length, index + 2) + 1;
  const align = index <= 0 ? 'start' : index >= steps.length - 1 ? 'end' : 'center';

  return (
    <div
      className={[styles.hwrap, className].filter(Boolean).join(' ')}
      data-need={tier}
      style={
        {
          ['--steps' as string]: steps.length,
          ['--cols' as string]: columns,
        } as React.CSSProperties
      }
    >
      <ol className={styles.hrail} aria-label={summary}>
        {steps.map((step, i) => (
          <li
            key={step.def.key}
            className={styles.hstep}
            data-state={step.state}
            data-next={steps[i + 1]?.state}
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
      {/* Doublon visuel de l'étape en cours, pour le régime étroit : caché
          aux lecteurs d'écran, qui ont déjà la liste. */}
      <p className={styles.hnow} aria-hidden="true">
        {currentStep ? (
          <span
            className={styles.hnowLabel}
            data-align={align}
            style={{ gridColumn: `${from} / ${to}` }}
          >
            <span className={styles.hnowName}>{currentStep.def.short}</span>
            <span className={styles.hnowCount}>
              {position}/{steps.length}
            </span>
          </span>
        ) : (
          <span className={styles.hnowLabel} data-align="start" style={{ gridColumn: '1 / -1' }}>
            <span className={styles.hnowName}>{steps.length} étapes</span>
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Paliers de largeur (px) des requêtes de conteneur de `StageRail.module.css`.
 * Le rail choisit le premier palier qui loge tous ses libellés ; sous ce
 * palier, il passe en régime étroit. À tenir en phase avec le CSS.
 */
export const RAIL_TIERS = [280, 320, 360, 400, 440, 480, 520, 560, 620, 680] as const;

/**
 * Largeur estimée pour écrire toutes les étapes sans en couper une : la
 * colonne courante réserve son libellé (plus gras), les autres colonnes,
 * égales, doivent loger le plus long des autres libellés, plus 7 px au
 * moins d'air entre deux noms. Mesuré à 12 px en Archivo étroite : ~5,2 px
 * par caractère (5,9 en gras) ; on compte 5,4 et 6,2. Se tromper coûte au
 * pire une abréviation (points de suspension), jamais un chevauchement.
 */
function railWidthNeeded(steps: readonly RailStep[], currentIndex: number): number {
  const label = (s: RailStep) => Array.from(s.def.short).length;
  const others = steps.filter((_, i) => i !== currentIndex);
  const widestOther = Math.max(0, ...others.map(label)) * 5.4 + 10;
  const current = currentIndex >= 0 ? label(steps[currentIndex] as RailStep) * 6.2 + 6 : 0;
  // Une station (24 px) et son halo tiennent toujours dans une colonne.
  return Math.ceil(current + others.length * Math.max(36, widestOther));
}
