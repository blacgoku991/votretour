'use client';

import { useEffect, useState } from 'react';
import styles from '../../marketing.module.css';

export interface TocItem {
  id: string;
  num: string;
  title: string;
}

/**
 * Sommaire collant des pages légales (≥ 1024 px) : l'entrée de la section
 * en cours de lecture devient la latte vermillon.
 *
 * Un seul IntersectionObserver, bande de lecture à 40 % du haut de l'écran
 * (rootMargin '-40% 0px -55% 0px'). En haut de page, la première entrée
 * est active (la section 01 n'a pas encore atteint la bande) ; l'état n'est mis à jour qu'au changement de section, jamais par image.
 */
export function LegalToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    // On observe la SECTION entière (le titre porte l'id) : en remontant,
    // la section redevient active dès que son texte passe la bande.
    const owner = new Map<Element, string>();
    items.forEach((item) => {
      const heading = document.getElementById(item.id);
      if (heading) owner.set(heading.closest('section') ?? heading, item.id);
    });
    if (owner.size === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).map((e) => owner.get(e.target));
        const id = hit[hit.length - 1];
        if (id) setActive(id);
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0 },
    );
    owner.forEach((_, el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav className={styles.tocAside} aria-label="Sommaire">
      <p className="t-label">Sommaire</p>
      <ol className={`rail-list ${styles.tocList}`}>
        {items.map((item) => (
          <li key={item.id} aria-current={active === item.id ? 'true' : undefined}>
            <a href={`#${item.id}`} className={styles.tocLink}>
              <span className={styles.tocNum}>{item.num}</span>
              <span>{item.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
