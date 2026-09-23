import { FloorScene, type FloorSlat } from '@/components/objects/FloorScene';
import { Plaque } from '@/components/objects/Plaque';
import styles from './auth.module.css';

/**
 * Panneaux --floor de droite (≥ 1024 px). Rendus serveur, statiques ;
 * seules les lattes se déplient une fois au chargement (CSS, mouvement
 * permis seulement).
 */

/** Le sol en relief pleine hauteur, avec une légende et une nature morte facultatives. */
export function FloorPanel({
  slats,
  spill = false,
  still,
  caption,
}: {
  slats: FloorSlat[];
  spill?: boolean;
  /** Premier plan, en bas à gauche (la Plaque). */
  still?: React.ReactNode;
  /** Légende en .t-story, en bas du panneau. */
  caption?: string;
}) {
  return (
    <div className={styles.floorPanel} data-legend={still || caption ? '1' : undefined}>
      <FloorScene size="lg" slats={slats} spill={spill} intro className={styles.floorScene} />
      {(still || caption) && (
        <div className={styles.legend}>
          {still && <div className={styles.still} aria-hidden="true">{still}</div>}
          {caption && <p className={`t-story ${styles.caption}`}>{caption}</p>}
        </div>
      )}
    </div>
  );
}

/** Connexion : la file vous attend au sol ; au premier plan, la plaque posée. */
export function LoginPanel() {
  return (
    <FloorPanel
      spill
      slats={[
        { id: 'c0', state: 'serving' },
        { id: 'c1', state: 'wait' },
        { id: 'c2', state: 'wait' },
        { id: 'c3', state: 'self', label: 'Vous', hint: 'Votre file vous attend' },
      ]}
      still={<Plaque width={170} pose="rest" />}
      caption={'Un seul bouton au comptoir\u00a0: Terminer.'}
    />
  );
}

const JOURNEY = [
  { n: 1, label: 'Votre compte', hint: 'Maintenant' },
  { n: 2, label: 'Votre établissement', hint: 'Ensuite' },
  { n: 3, label: 'Votre plaque est prête', hint: 'Enfin' },
] as const;

/** Inscription : le parcours en trois lattes, et la plaque qui attend d'exister. */
export function SignupPanel() {
  return (
    <div className={styles.journey}>
      <div className={styles.journeyBody}>
        <p className="t-label">Votre parcours</p>
        <ol className={`rail-list ${styles.steps}`}>
          {JOURNEY.map((step) => (
            <li
              key={step.n}
              className={step.n === 1 ? `is-self ${styles.step}` : styles.step}
              aria-current={step.n === 1 ? 'step' : undefined}
            >
              <span className={styles.stepSlat}>
                <span className={styles.stepText}>
                  <span className={styles.stepNum}>{step.n}</span>
                  <span aria-hidden="true" className={styles.stepDot}>·</span>
                  <span>{step.label}</span>
                </span>
                <span className={styles.stepHint}>{step.hint}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* La plaque n'existe pas encore : sa silhouette en pointillés. */}
        <div className={styles.ghostWrap} aria-hidden="true">
          <span className={styles.ghostRail} />
          <span className={styles.ghostLink} />
          <span className={styles.ghostPlaque}>
            <svg className={styles.ghostNfc} viewBox="0 0 48 48" fill="none">
              <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="3 4">
                <path d="M14 17.5a9 9 0 0 1 0 13" />
                <path d="M20.5 12a17 17 0 0 1 0 24" />
                <path d="M27 6.5a25 25 0 0 1 0 35" />
              </g>
              <circle cx="8" cy="24" r="2.6" fill="currentColor" />
            </svg>
            <span className={styles.ghostLabel}>Votre plaque</span>
          </span>
        </div>
      </div>

      <p className={`t-label ${styles.trial}`}>Essai gratuit · sans carte bancaire</p>
    </div>
  );
}
