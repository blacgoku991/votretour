import styles from './barrier.module.css';

/**
 * LA BARRIÈRE — l'objet du mode Event / Drop : un boîtier, un voyant et un
 * bras rayé encre et vermillon qui pivote autour de son moyeu.
 *
 * Dessin SVG statique, compatible serveur. Le bras ne bouge qu'en
 * `transform` (rotation autour du moyeu) et le voyant ne change qu'en
 * opacité : aucune propriété hors compositeur.
 *
 * - `raised` : bras levé (le flux passe) ; sinon baissé.
 * - `lift` : le bras se lève UNE fois au montage (CSS pur, mouvement
 *   permis seulement ; en mouvement réduit, il est directement levé).
 * - `ground` : trait de sol dessiné (à omettre quand un rail CSS sert de sol).
 * - `fork` : fourche de repos au bout du bras (par défaut, suit `ground`).
 *
 * Le voyant est posé sur la face du boîtier, sous le moyeu : le bras ne le
 * masque ni baissé ni levé.
 */

export interface BarrierProps {
  raised?: boolean;
  lift?: boolean;
  ground?: boolean;
  fork?: boolean;
  className?: string;
}

/** Bras : longueur utile 168 unités, rayures de 12 tous les 24. */
const STRIPES = [40, 64, 88, 112, 136, 160];

export function Barrier({ raised = false, lift = false, ground = true, fork = ground, className }: BarrierProps) {
  return (
    <svg
      className={[styles.barrier, className].filter(Boolean).join(' ')}
      viewBox="0 0 200 100"
      aria-hidden="true"
      focusable="false"
      data-raised={raised ? '1' : '0'}
      data-lift={raised && lift ? '1' : undefined}
    >
      {ground && <line className={styles.ground} x1="0" y1="97" x2="200" y2="97" />}

      {/* Fourche de repos : le bras baissé s'y pose. */}
      {fork && (
        <g className={styles.fork}>
          <rect x="182" y="62" width="4" height="34" rx="1" />
          <path d="M177 55 V62 H191 V55" />
        </g>
      )}

      {/* Boîtier et voyant. */}
      <rect className={styles.housing} x="16" y="44" width="22" height="52" rx="3" />
      <circle className={styles.lampOff} cx="27" cy="68" r="3.5" />
      <circle className={styles.lampStop} cx="27" cy="68" r="3.5" />
      <circle className={styles.lampGo} cx="27" cy="68" r="3.5" />
      <rect className={styles.slot} x="21" y="80" width="12" height="2" rx="1" />

      {/* Le bras, qui pivote autour du moyeu (27, 52). */}
      <g className={styles.arm}>
        <rect className={styles.armBody} x="23" y="48" width="170" height="8" rx="4" />
        {STRIPES.map((x) => (
          <polygon
            key={x}
            className={styles.stripe}
            points={`${x + 6},48.6 ${x + 18},48.6 ${x + 12},55.4 ${x},55.4`}
          />
        ))}
      </g>
      <circle className={styles.hub} cx="27" cy="52" r="5" />
      <circle className={styles.hubDot} cx="27" cy="52" r="1.6" />
    </svg>
  );
}
