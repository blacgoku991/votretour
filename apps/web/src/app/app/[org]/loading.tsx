import styles from './loading.module.css';

/**
 * Squelette de chargement.
 *
 * Dessiné comme la file elle-même : un rail et des lattes. Le
 * professionnel reconnaît l'écran avant même qu'il soit chargé.
 */
export default function Loading() {
  return (
    <div className={`shell ${styles.wrap}`} aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement de la file…</span>

      <div className={styles.head}>
        <span className={`skeleton ${styles.title}`} />
        <span className={`skeleton ${styles.sub}`} />
      </div>

      <span className={`skeleton ${styles.card}`} />

      <div className={styles.rang}>
        <span className={styles.rail} />
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`skeleton ${styles.slat}`}
            style={{ width: `${88 - i * 9}%`, animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
