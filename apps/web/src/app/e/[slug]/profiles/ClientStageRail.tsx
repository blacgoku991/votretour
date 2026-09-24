import { formatTime } from '@/lib/format';
import { stageRailSteps, type RailStep } from '@/lib/profiles/stage-rail';
import type { ProfileStage, QueueProfile, StageTone } from '@/lib/profiles/types';
import railStyles from '@/components/objects/StageRail.module.css';

/**
 * LE RAIL D'ÉTAPES DU CLIENT — la lecture verticale de `StageRail`
 * (`components/objects/`), avec UNE chose en plus : la latte courante
 * peut dire autre chose que le nom de l'étape.
 *
 * Pourquoi : l'étape « Devis à valider » ne change qu'au geste du garage.
 * Entre l'accord du client et ce geste, la latte en relief, cuivre,
 * continuerait d'écrire « Devis à valider » juste au-dessus de « Devis
 * accepté » : le client lirait qu'il doit encore valider ce qu'il vient
 * d'accepter. Ici, la latte courante dit « Devis accepté · l'atelier
 * reprend la main », en ardoise (ce n'est plus au client d'agir).
 *
 * Même dessin au pixel que `StageRail` : mêmes classes (son module CSS),
 * même logique d'états (`stageRailSteps`), mêmes annonces. Dès que
 * `StageRail` accepte `currentLabel` et `currentTone` (demande au lot P1),
 * ce composant redevient un simple appel à `StageRail`.
 */

const STATE_WORD: Record<RailStep['state'], string> = {
  done: 'passée',
  current: 'en cours',
  upcoming: 'à venir',
  skipped: 'sautée',
};

export function ClientStageRail({
  profile,
  current,
  history,
  timeZone,
  currentLabel,
  currentTone,
}: {
  profile: QueueProfile;
  current: ProfileStage | null;
  history?: readonly { stage: ProfileStage; at: string }[] | null;
  timeZone?: string;
  /** Remplace le libellé de la latte courante (« Devis accepté · … »). */
  currentLabel?: string | null;
  /** Remplace sa teinte (ardoise quand la main repasse à l'atelier). */
  currentTone?: StageTone | null;
}): React.JSX.Element | null {
  const steps = stageRailSteps(profile, current, { history, compact: true });
  if (steps.length === 0) return null;

  const currentStep = steps.find((s) => s.state === 'current');
  const position = currentStep ? steps.indexOf(currentStep) + 1 : 0;
  const currentWord = currentLabel ?? currentStep?.def.client;
  const summary = currentStep
    ? `Étapes : ${currentWord}, ${position} sur ${steps.length}`
    : 'Étapes du suivi';
  const time = (at: string | null) => (at ? formatTime(at, timeZone) : null);

  return (
    <ol className={railStyles.vrail} aria-label={summary}>
      {steps.map((step) => {
        const t = time(step.at);
        const isCurrent = step.state === 'current';
        return (
          <li
            key={step.def.key}
            className={railStyles.vstep}
            data-state={step.state}
            data-tone={isCurrent && currentTone ? currentTone : step.def.tone}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className={railStyles.vslat}>
              {step.state === 'done' && (
                <svg className={railStyles.check} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M5 10.5 8.5 14 15 6.5" />
                </svg>
              )}
              <span className={railStyles.vlabel}>{isCurrent ? currentWord : step.def.short}</span>
              {t && step.state === 'done' && <span className={railStyles.vtime}>{t}</span>}
              {t && isCurrent && <span className={railStyles.vsince}>depuis {t}</span>}
              <span className="sr-only">, {STATE_WORD[step.state]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
