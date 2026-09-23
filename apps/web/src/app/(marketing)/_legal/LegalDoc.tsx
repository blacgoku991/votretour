import { LegalToc, type TocItem } from './LegalToc';
import styles from '../../marketing.module.css';

export interface LegalSection {
  /** Ancre du titre (h2). */
  id: string;
  title: string;
  body: React.ReactNode;
}

/**
 * Gabarit des pages légales : lecture sur 68ch, titres numérotés « 01 »,
 * sommaire collant sur ordinateur, <details> « Sommaire » en mobile.
 * Composant serveur ; seul le suivi de la section courante est client.
 */
export function LegalDoc({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: React.ReactNode;
  sections: LegalSection[];
}) {
  const items: TocItem[] = sections.map((s, i) => ({
    id: s.id,
    num: String(i + 1).padStart(2, '0'),
    title: s.title,
  }));

  return (
    <main className={`shell ${styles.legal}`}>
      <header className={styles.legalHead}>
        <p className="t-label">Document légal</p>
        <h1 className={`t-display ${styles.legalTitle}`}>{title}</h1>
        <p className={styles.legalIntro}>{intro}</p>
      </header>

      <div className={styles.legalGrid}>
        <LegalToc items={items} />

        <details className={styles.tocDetails}>
          <summary className={styles.tocSummary}>
            <span className="t-label">Sommaire</span>
            <span className={styles.faqIcon} aria-hidden="true" />
          </summary>
          <ol className={`rail-list ${styles.tocList}`}>
            {items.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className={styles.tocLink}>
                  <span className={styles.tocNum}>{item.num}</span>
                  <span>{item.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </details>

        <article className={styles.article}>
          {sections.map((section, i) => (
            <section key={section.id} className={styles.section} aria-labelledby={section.id}>
              <h2 id={section.id} className={styles.sectionTitle}>
                <span className={styles.sectionNum} aria-hidden="true">{items[i]?.num}</span>
                <span>{section.title}</span>
              </h2>
              <div className={styles.prose}>{section.body}</div>
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
