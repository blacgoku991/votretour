import styles from './DropPass.module.css';

/**
 * Le pass d'accès du mode Event / Drop, en petit et statique.
 *
 * Un billet os à encoches latérales (masque statique). Pas de faux QR :
 * un pictogramme QR au trait, puisque le vrai code est personnel et
 * limité dans le temps.
 */
export function DropPass(): React.JSX.Element {
  return (
    <div className={styles.pass} aria-hidden="true">
      <div className={styles.top}>
        <span className={styles.kind}>Pass d’accès</span>
        <svg
          className={styles.qr}
          viewBox="0 0 40 40"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinejoin="round"
        >
          <rect x="2.2" y="2.2" width="13" height="13" rx="2.5" />
          <rect x="24.8" y="2.2" width="13" height="13" rx="2.5" />
          <rect x="2.2" y="24.8" width="13" height="13" rx="2.5" />
          <path d="M7.2 7.2h3v3h-3zM29.8 7.2h3v3h-3zM7.2 29.8h3v3h-3z" fill="currentColor" stroke="none" />
          <path d="M24.8 24.8h5v5M37.8 24.8v5M24.8 37.8h13M33 32.4v5.4" strokeLinecap="round" />
        </svg>
      </div>
      <p className={styles.wave}>Vague 1</p>
      <span className={styles.perf} />
      <p className={styles.valid}>
        <span className={styles.validDot} />
        Valable 10 min
      </p>
    </div>
  );
}
