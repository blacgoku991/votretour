import styles from './Wordmark.module.css';

/**
 * La marque : trois lattes accrochées à un rail, la dernière en signal.
 * C'est la file vue de côté, réduite à son minimum — le même vocabulaire
 * que l'écran client, en format logo.
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={styles.mark} aria-label="VotreTour">
      <svg
        width="26" height="26" viewBox="0 0 26 26" fill="none"
        className={styles.glyph} aria-hidden="true"
      >
        {/* le rail */}
        <rect x="1" y="3" width="2" height="20" rx="1" fill="currentColor" opacity="0.32" />
        {/* les lattes : elles raccourcissent, la file avance */}
        <rect x="7" y="4"  width="18" height="4" rx="2" fill="currentColor" opacity="0.28" />
        <rect x="7" y="11" width="13" height="4" rx="2" fill="currentColor" opacity="0.46" />
        <rect x="7" y="18" width="9"  height="4" rx="2" className={styles.signal} />
        {/* les encoches */}
        <rect x="3" y="5.2"  width="4" height="1.6" rx="0.8" fill="currentColor" opacity="0.32" />
        <rect x="3" y="12.2" width="4" height="1.6" rx="0.8" fill="currentColor" opacity="0.32" />
        <rect x="3" y="19.2" width="4" height="1.6" rx="0.8" className={styles.signal} />
      </svg>
      {!compact && (
        <span className={styles.text}>
          Votre<span className={styles.tour}>Tour</span>
        </span>
      )}
    </span>
  );
}
