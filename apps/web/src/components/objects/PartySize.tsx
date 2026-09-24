import styles from './PartySize.module.css';

/**
 * LE CHEVALET — le nombre de couverts d'un groupe, posé comme un
 * chevalet de table.
 *
 * Une variation de la latte, pas un nouvel élément : la face avant du
 * chevalet porte le nombre de couverts dans une tuile de volet, le pli
 * forme une tranche en haut, le flanc droit montre l'intérieur dans
 * l'ombre, et une ombre de contact le pose sur la table. Le chiffre est
 * ce qui compte pour l'hôte : il est lu avant le prénom.
 *
 * États : 'waiting' (os ou encre, selon le thème), 'called' (cuivre : le
 * groupe est appelé, l'accueil l'attend) et 'ready' (vermillon : « Votre
 * table est prête », côté client). Au-delà du plafond en ligne : « 8+ ».
 *
 * Rendu pur, sans hook : compatible serveur.
 */

export interface PartySizeProps {
  count: number;
  /** Affiche « N+ » (touche « Table libre pour 8+ »). */
  plus?: boolean;
  /** Prénom gravé sous le nombre (TV, poste de l'hôte), en capitales. */
  name?: string | null;
  /** Défaut 'waiting'. */
  state?: 'waiting' | 'called' | 'ready';
  /** Défaut 'md'. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const STATE_LABEL: Record<NonNullable<PartySizeProps['state']>, string> = {
  waiting: 'en attente',
  called: 'appelé à l’accueil',
  ready: 'table prête',
};

export function PartySize({
  count,
  plus = false,
  name,
  state = 'waiting',
  size = 'md',
  className,
}: PartySizeProps): React.JSX.Element {
  const n = Math.max(1, Math.round(Number.isFinite(count) ? count : 1));
  const digits = `${n}${plus ? '+' : ''}`;
  const unit = n > 1 || plus ? 'couverts' : 'couvert';
  // L'état n'est jamais porté par la seule couleur : il est dit en toutes lettres.
  const label = `${plus ? `${n} couverts ou plus` : `${n} ${unit}`}${name ? `, ${name}` : ''}, ${STATE_LABEL[state]}`;

  return (
    <span
      className={[styles.tent, className].filter(Boolean).join(' ')}
      data-state={state}
      data-size={size}
      role="img"
      aria-label={label}
    >
      <span className={styles.body} aria-hidden="true">
        <span className={styles.side} />
        <span className={styles.face}>
          <span className={styles.number}>
            {Array.from(digits).map((ch, i) => (
              <span key={i} className="flap flap--tile">
                <span className="flap__face flap__rest">{ch}</span>
              </span>
            ))}
          </span>
          <span className={styles.unit}>{unit}</span>
          {name && <span className={styles.name}>{name}</span>}
        </span>
      </span>
      <span className={styles.shadow} aria-hidden="true" />
    </span>
  );
}
