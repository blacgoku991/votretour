import styles from './loading.module.css';

/**
 * Chargement du tableau de bord.
 *
 * Même géométrie que la File : en-tête, trois compteurs, le bloc « En
 * cours » de 180 px, puis le rail et ses lattes qui se déplient
 * (.loading-slats). Le professionnel reconnaît son écran avant même qu'il
 * soit chargé. Aucune donnée, aucune heure : rendu identique partout.
 */
export default function Loading() {
  return (
    <div className={`shell ${styles.wrap}`} aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement…</span>

      <div className={styles.head} aria-hidden="true">
        <div className={styles.headText}>
          <span className={`skeleton ${styles.where}`} />
          <span className={`skeleton ${styles.title}`} />
        </div>
        <span className={`skeleton ${styles.seg}`} />
      </div>

      <div className={styles.counters} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={styles.counter}>
            <span className={`skeleton ${styles.num}`} />
            <span className={`skeleton ${styles.label}`} />
          </span>
        ))}
      </div>

      <div className={styles.columns} aria-hidden="true">
        <div className={styles.lane}>
          <span className={`skeleton ${styles.stopLabel}`} />
          <span className={`skeleton ${styles.serving}`} />
          <span className={`skeleton ${styles.stopLabel}`} />
          <div className="loading-slats">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className={styles.side}>
          <span className={`skeleton ${styles.stopLabel}`} />
          <span className={`skeleton ${styles.field}`} />
          <span className={`skeleton ${styles.field}`} />
        </div>
      </div>
    </div>
  );
}
