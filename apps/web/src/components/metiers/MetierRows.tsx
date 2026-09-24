import Link from 'next/link';
import type { MetierPage } from '@/lib/metiers/types';
import { metierSeuil } from './model';
import { FlapIndex } from './parts';
import styles from './metiers.module.css';

/**
 * LE TABLEAU DES MÉTIERS — une ligne par métier, comme un tableau des
 * départs : le numéro en volets, le métier, sa promesse, et en bout de
 * ligne son SEUIL vermillon (« Fauteuil », « Réception », « Salle »…),
 * qui s'allume au survol et au focus (translation de 2 px et opacité :
 * CSS seulement). Sur téléphone, chaque ligne devient une carte pleine
 * largeur.
 *
 * Sert à l'index `/pour` (grand) et au maillage en bas de chaque page
 * métier (compact). Les liens sont de vrais <a> : le maillage se lit
 * sans JavaScript.
 */
export function MetierRows({
  pages,
  size = 'lg',
  headingLevel = 'h2',
}: {
  pages: readonly MetierPage[];
  size?: 'lg' | 'md';
  /** Niveau du nom de chaque métier dans le plan de la page. */
  headingLevel?: 'h2' | 'h3';
}): React.JSX.Element {
  const Heading = headingLevel;
  return (
    <ol className={styles.rows} data-size={size}>
      {pages.map((page, i) => (
        <li key={page.slug} className={styles.rowItem}>
          <Link href={page.path} className={styles.row}>
            <FlapIndex n={i + 1} className={styles.rowNum} />
            <Heading className={`t-board ${styles.rowLabel}`}>{page.nav.label}</Heading>
            <span className={styles.rowPromise}>{page.seo.ogTitle}</span>
            <span className={styles.rowSeuil} aria-hidden="true">
              <span className={styles.rowSeuilLabel}>{metierSeuil(page)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
