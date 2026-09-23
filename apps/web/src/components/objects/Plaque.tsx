import styles from './Plaque.module.css';

/**
 * LA PLAQUE — l'objet NFC posé sur le comptoir.
 *
 * Un carreau os de 12 px d'épaisseur : la face (pictogramme NFC, QR,
 * légende, nom gravé) et deux tranches visibles, haute et droite. Sous la
 * scène, une ombre de contact statique, HORS de l'arbre preserve-3d, dont
 * seule l'opacité varie.
 *
 * Poses : 'rest' (posée, de trois quarts), 'front' (de face), 'flat'
 * (couchée, plaque désactivée) et 'none' (le parent pilote --plaque-rx,
 * --plaque-ry et --plaque-rz, par exemple au défilement).
 *
 * Les arcs NFC émettent une onde, une seule fois, quand la plaque ou un
 * de ses ancêtres porte data-nfc="on".
 *
 * Rendu pur, compatible serveur.
 */

export interface PlaqueProps {
  /** px, défaut 220 ; hauteur = 1,25 × largeur. */
  width?: number;
  /** <img src="/api/p/{code}?format=svg" alt=""> ou <span dangerouslySetInnerHTML={{ __html: svg }} /> ; absent → pictogramme NFC agrandi seul. */
  qr?: React.ReactNode;
  /** Défaut « Approchez votre téléphone ». */
  caption?: string;
  /** Nom gravé en bas (facultatif). */
  name?: string;
  /** Défaut 'rest'. */
  pose?: 'rest' | 'front' | 'flat' | 'none';
  /** Se redresse vers 'front' au survol (souris) et au focus, 240 ms. */
  interactive?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function NfcMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <g className={styles.arcs} stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <path className={styles.arc} d="M14 17.5a9 9 0 0 1 0 13" />
        <path className={styles.arc} d="M20.5 12a17 17 0 0 1 0 24" />
        <path className={styles.arc} d="M27 6.5a25 25 0 0 1 0 35" />
      </g>
      {/* L'onde : des copies des arcs, invisibles au repos. */}
      <g className={styles.wave} stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
        <path className={styles.waveArc} d="M14 17.5a9 9 0 0 1 0 13" />
        <path className={styles.waveArc} d="M20.5 12a17 17 0 0 1 0 24" />
        <path className={styles.waveArc} d="M27 6.5a25 25 0 0 1 0 35" />
      </g>
      <circle cx="8" cy="24" r="3" fill="currentColor" />
    </svg>
  );
}

export function Plaque({
  width = 220,
  qr,
  caption = 'Approchez votre téléphone',
  name,
  pose = 'rest',
  interactive = false,
  className,
  style,
}: PlaqueProps): React.JSX.Element {
  const w = Math.max(60, Math.round(width));
  const stageStyle = {
    ...style,
    ['--plaque-w' as string]: `${w}px`,
  } as React.CSSProperties;

  return (
    <span
      className={[styles.stage, interactive ? styles.interactive : '', className].filter(Boolean).join(' ')}
      style={stageStyle}
      data-pose={pose}
      tabIndex={interactive ? 0 : undefined}
    >
      <span className={styles.shadow} aria-hidden="true" />
      <span className={styles.plaque}>
        <span className={styles.edgeTop} aria-hidden="true" />
        <span className={styles.edgeRight} aria-hidden="true" />
        <span className={`${styles.face} ${qr ? '' : styles.faceBare}`}>
          <NfcMark className={styles.nfc} />
          {qr ? <span className={styles.qr}>{qr}</span> : <NfcMark className={styles.nfcLarge} />}
          <span className={styles.caption}>{caption}</span>
          {name && <span className={styles.name}>{name}</span>}
        </span>
      </span>
    </span>
  );
}
