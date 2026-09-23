import styles from './FloorScene.module.css';

/**
 * LE RANG EN RELIEF, statique — la file couchée au sol.
 *
 * Un rail peint, une place marquée par personne (latte avec tranche), et
 * au bout, LE SEUIL vermillon « Comptoir ». Rendu pur, sans état ni effet :
 * compatible serveur, importable depuis un composant client.
 *
 * Les primitives (.scene3d, .world3d, .slot3d…) viennent de globals.css
 * (§3.9) : l'accueil (WP1) utilise exactement les mêmes.
 *
 * Animation : chaque latte est placée par --pos, qui passe par une
 * transition. Une MISE À JOUR de `slats` (mêmes `id`) anime donc l'avance
 * sans autre code (écran TV). Pour jouer le Passage, garder d'abord la
 * latte de tête avec l'état 'passed' (elle se relève et s'efface), puis la
 * retirer du tableau au rendu suivant.
 */

export type FloorSlatState =
  | 'wait'
  | 'serving'
  | 'self'
  | 'kept'
  | 'back'
  | 'turn'
  | 'ghost'
  | 'fallen'
  | 'passed'
  | 'hidden';

export interface FloorSlat {
  id: string;
  state: FloorSlatState;
  label?: string;
  hint?: string;
}

export interface FloorSceneProps {
  /** Index 0 = au comptoir ; 8 au maximum. */
  slats: FloorSlat[];
  /** Degrés, défaut 56, plafonné à 58. */
  tilt?: number;
  /** Degrés, défaut 6 (la tête part vers la droite), |turn| ≤ 9. */
  turn?: number;
  /** true → « Comptoir » ; chaîne → libellé ; défaut true. */
  seuil?: boolean | string;
  /** Flaque de lumière au sol derrière le seuil. Défaut false. */
  spill?: boolean;
  /** Numéros au sol 1…n pour les positions ≥ 1 ; défaut true. */
  positions?: boolean;
  /** Lattes qui se déplient une fois au chargement (CSS pur, décalage 70 ms, no-preference seulement). Défaut false. */
  intro?: boolean;
  /** sm : bandeau de 140 px ; md : 320 px ; lg : height: 100 % du parent. Défaut 'md'. */
  size?: 'sm' | 'md' | 'lg';
  /** Texte pour lecteur d'écran ; sinon aria-hidden="true". */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

const MAX_SLATS = 8;
const PITCH = { sm: 40, md: 52, lg: 60 } as const;

export function FloorScene({
  slats,
  tilt = 56,
  turn = 6,
  seuil = true,
  spill = false,
  positions = true,
  intro = false,
  size = 'md',
  label,
  className,
  style,
}: FloorSceneProps): React.JSX.Element {
  const list = slats.slice(0, MAX_SLATS);
  const safeTilt = Math.min(58, Math.max(0, Number.isFinite(tilt) ? tilt : 56));
  const safeTurn = size === 'sm' ? 0 : Math.min(9, Math.max(-9, Number.isFinite(turn) ? turn : 6));
  const showLabels = size !== 'sm';

  // Position au sol : une latte qui passe reste « au comptoir » (0) pendant
  // qu'elle se relève ; les autres se comptent sans elle.
  let rank = 0;
  const placed = list.map((slat) => {
    if (slat.state === 'passed') return { slat, pos: 0 };
    const pos = rank;
    rank += 1;
    return { slat, pos };
  });
  const rows = Math.max(rank, 3);
  const seuilLabel = seuil === true ? 'Comptoir' : typeof seuil === 'string' ? seuil : null;

  const sceneStyle = {
    ...style,
    ['--pitch' as string]: `${PITCH[size]}px`,
    ['--rows' as string]: rows,
  } as React.CSSProperties;

  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };

  return (
    <div
      className={['scene3d', styles.scene, styles[size], intro ? styles.intro : '', className]
        .filter(Boolean)
        .join(' ')}
      style={sceneStyle}
      data-size={size}
      {...a11y}
    >
      <div
        className={`world3d ${styles.world}`}
        style={{ transform: `rotateX(${safeTilt}deg) rotateZ(${safeTurn}deg)` }}
      >
        <div className="floor3d" />
        {spill && <div className="spill3d" />}
        <div className="rail3d" />
        {positions &&
          Array.from({ length: Math.max(0, rows - 1) }, (_, i) => i + 1).map((n) => (
            <span key={n} className="floorNum" style={{ ['--n' as string]: n } as React.CSSProperties}>
              {n}
            </span>
          ))}
        {seuilLabel !== null && (
          <div className="seuil3d">
            {seuilLabel && <span className="seuil3d__label">{seuilLabel}</span>}
          </div>
        )}
        {placed.map(({ slat, pos }) => (
          <div
            key={slat.id}
            className="slot3d"
            data-state={slat.state}
            style={{ ['--pos' as string]: pos, ['--i' as string]: pos } as React.CSSProperties}
          >
            <span className="slot3d__notch" />
            <div className="slot3d__lift">
              <div className={`slot3d__face ${styles.face}`}>
                {showLabels && (slat.label || slat.hint) ? (
                  <span className={styles.text}>
                    {slat.label && <span className={styles.label}>{slat.label}</span>}
                    {slat.hint && <span className={styles.hint}>{slat.hint}</span>}
                  </span>
                ) : (
                  <span className="slot3d__tick" />
                )}
              </div>
              <div className="slot3d__edge" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
