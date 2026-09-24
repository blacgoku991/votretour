import type { FaqContent } from '@/lib/metiers/types';
import { Section } from './parts';
import styles from './metiers.module.css';

/**
 * 9. LA FAQ — des `<details>` natifs : aucune ligne de JavaScript, et
 * chaque réponse reste dans la page pour les robots comme pour la
 * recherche du navigateur.
 *
 * La page passe ICI et à `faqPage()` (JSON-LD) le même tableau : la FAQ
 * balisée est toujours celle qui est affichée.
 */
export function Faq({ items, anchorId }: { items: readonly FaqContent[]; anchorId?: string }): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <Section id="questions" anchorId={anchorId} kicker="Questions" title="Questions fréquentes.">
      <div className={styles.faq}>
        {items.map((item) => (
          <details key={item.q} className={styles.faqItem}>
            <summary className={styles.faqQ}>
              <span>{item.q}</span>
              <span className={styles.faqIcon} aria-hidden="true" />
            </summary>
            <p className={styles.faqA}>{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
