import { MASK_CHAR, displayRegistration, maskRegistration, maskedTail } from '@/lib/profiles/registration';
import type { RegistrationCountry } from '@/lib/profiles/types';
import styles from './Immatriculation.module.css';

/**
 * L'IMMATRICULATION — une vraie plaque française, dessinée.
 *
 * Proportions de la plaque réelle (520 × 110 mm), fond blanc qui RESTE
 * blanc en thème sombre (c'est un objet, pas une surface d'interface),
 * bande bleue à gauche avec l'eurobande simplifiée (cercle de 12 étoiles
 * et « F »), bande bleue à droite laissée VIDE : on ne connaît pas le
 * département choisi par le client, et les logos régionaux sont des
 * marques. Caractères en Archivo très étroite, comme le gabarit SIV, en
 * encre (jamais de noir pur). Une tranche d'os de 3 px sous la plaque :
 * elle est en relief, comme les lattes.
 *
 * Masquage : seuls les trois derniers caractères restent lisibles. Les
 * autres deviennent des pastilles creusées qui gardent la place exacte du
 * caractère : la plaque garde sa silhouette, mais ne se lit plus. Une
 * valeur déjà masquée par le serveur (`display_snapshot`, pour la TV) est
 * reconnue et affichée telle quelle : l'immatriculation complète n'a
 * jamais à quitter le serveur.
 *
 * Plaque étrangère (`country="other"`) : unie, sans bande, texte brut.
 *
 * Rendu pur, sans hook : utilisable dans un composant serveur (pages
 * métier, étiquette imprimable) comme dans un écran client.
 */

export interface ImmatriculationProps {
  /** Saisie, forme d'affichage (`AB-123-CD`) ou forme déjà masquée (`••-••3-CD`). */
  value: string;
  /** Défaut 'FR'. */
  country?: RegistrationCountry;
  /** Ne laisse lisibles que les trois derniers caractères. */
  masked?: boolean;
  /** lg : client et TV ; md : fiche du pro ; sm : listes. Défaut 'md'. */
  size?: 'sm' | 'md' | 'lg';
  /** Largeur en px, à la place de `size` (la hauteur suit : 110/520). */
  width?: number;
  className?: string;
}

const STAR_COUNT = 12;

/** Étoile à cinq branches centrée en (cx, cy), de rayon extérieur r. */
function starPath(cx: number, cy: number, r: number): string {
  const inner = r * 0.42;
  const pts: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Les douze étoiles, calculées une fois au chargement du module (valeurs fixes, identiques serveur et client). */
const STARS = Array.from({ length: STAR_COUNT }, (_, i) => {
  const a = (i * 2 * Math.PI) / STAR_COUNT;
  return starPath(10 + 6.4 * Math.sin(a), 10 - 6.4 * Math.cos(a), 1.45);
}).join('');

function EuroBand() {
  return (
    <span className={styles.band} aria-hidden="true">
      <svg className={styles.stars} viewBox="0 0 20 20" focusable="false">
        <path d={STARS} />
      </svg>
      <span className={styles.bandLetter}>F</span>
    </span>
  );
}

type Glyph = { kind: 'char'; ch: string } | { kind: 'mask' } | { kind: 'sep'; ch: string };

function glyphsOf(text: string): Glyph[] {
  return Array.from(text).map((c): Glyph => {
    if (c === MASK_CHAR) return { kind: 'mask' };
    if (/[A-Z0-9]/i.test(c)) return { kind: 'char', ch: c };
    return { kind: 'sep', ch: c };
  });
}

export function Immatriculation({
  value,
  country = 'FR',
  masked = false,
  size = 'md',
  width,
  className,
}: ImmatriculationProps): React.JSX.Element {
  const alreadyMasked = value.includes(MASK_CHAR);
  const display = alreadyMasked ? value : displayRegistration(value, country);
  const shown = masked && !alreadyMasked ? maskRegistration(display) : display;
  const isMasked = shown.includes(MASK_CHAR);
  const label = isMasked
    ? `Immatriculation masquée, se terminant par ${maskedTail(shown)}`
    : `Immatriculation ${display}`;
  const foreign = country === 'other';
  const glyphs = glyphsOf(shown);

  // Largeur « optique » du texte, en caractères : un séparateur compte
  // pour un demi-caractère. Au-delà de la largeur d'une plaque SIV
  // (AB-123-CD ≈ 8,1), les caractères rétrécissent pour ne jamais toucher
  // les bandes : « 1234 AB 75 » ou une plaque étrangère longue.
  const optical = glyphs.reduce((sum, g) => sum + (g.kind === 'sep' ? (g.ch === ' ' ? 0.45 : 0.55) : 1), 0);
  const fit = Math.min(1, (foreign ? 9.6 : 8.2) / Math.max(1, optical));

  const style = {
    ['--reg-fit' as string]: fit.toFixed(3),
    ...(width ? { ['--reg-w' as string]: `${Math.max(96, Math.round(width))}px` } : {}),
  } as React.CSSProperties;

  return (
    <span
      className={[styles.plate, className].filter(Boolean).join(' ')}
      data-size={width ? undefined : size}
      data-country={foreign ? 'other' : 'fr'}
      role="img"
      aria-label={label}
      style={style}
    >
      <span className={styles.face}>
        {!foreign && <EuroBand />}
        <span className={styles.chars} aria-hidden="true">
          {glyphs.map((g, i) =>
            g.kind === 'char' ? (
              <span key={i} className={styles.ch}>{g.ch}</span>
            ) : g.kind === 'mask' ? (
              <span key={i} className={`${styles.ch} ${styles.mask}`}>
                <span className={styles.maskDot} />
              </span>
            ) : g.ch === ' ' ? (
              <span key={i} className={styles.space} />
            ) : (
              <span key={i} className={styles.sep}>{g.ch}</span>
            ),
          )}
        </span>
        {!foreign && <span className={`${styles.band} ${styles.bandRight}`} aria-hidden="true" />}
      </span>
    </span>
  );
}
