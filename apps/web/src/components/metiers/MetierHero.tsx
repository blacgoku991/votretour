import Link from 'next/link';
import { DropPass } from '@/components/home/DropPass';
import type { MetierPage } from '@/lib/metiers/types';
import { FloorScene } from '@/components/objects/FloorScene';
import styles from './metiers.module.css';

/**
 * LE HÉROS STATIQUE — pour un métier sans séquence 3D (événements : le
 * parcours n'est pas une file qui avance place par place, mais des
 * vagues). Porte le H1 unique de la page. À droite, l'objet du métier :
 * le pass d'accès à usage unique, posé sur le sol devant l'entrée.
 */
export function MetierHero({
  page,
  eyebrow,
  nextId,
}: {
  page: MetierPage;
  eyebrow?: React.ReactNode;
  /** Section suivante, cible du second bouton. */
  nextId: string;
}): React.JSX.Element {
  const isEvent = page.profile === 'event';
  return (
    <section className={styles.hero} aria-labelledby="metier-titre">
      <div className={`shell ${styles.heroInner}`}>
        <div className={styles.heroText}>
          {eyebrow}
          <p className={`t-label ${styles.heroLabel}`}>{page.hero.label}</p>
          <h1 id="metier-titre" className={`t-hero ${styles.heroTitle}`}>
            {page.hero.title}
          </h1>
          <p className={`t-lead ${styles.heroLead}`}>{page.hero.lead}</p>
          <div className={styles.heroActions}>
            <Link href={page.cta.href} className="btn btn--signal btn--lg">
              {page.cta.label}
            </Link>
            <a href={`#${nextId}`} className="btn btn--ghost btn--lg">
              Voir comment
            </a>
          </div>
          <p className={`t-micro t-muted ${styles.heroMicro}`}>
            <span>Sans compte client&nbsp;·</span> <span>Sans application à installer&nbsp;·</span>{' '}
            <span>Sans SMS payant</span>
          </p>
        </div>
        <div className={styles.heroVisual}>
          <span className={`floor-marks ${styles.heroFloor}`} aria-hidden="true" />
          {isEvent ? (
            <div className={styles.heroPass}>
              <DropPass />
            </div>
          ) : (
            <FloorScene
              slats={[
                { id: 's', state: 'serving' },
                { id: 'a', state: 'wait' },
                { id: 'v', state: 'self', label: 'Vous' },
                { id: 'b', state: 'wait' },
              ]}
              seuil={page.signature.seuil}
              spill
              intro
              size="lg"
            />
          )}
          <p className={styles.heroSeuil} aria-hidden="true">
            {page.signature.seuil}
          </p>
        </div>
      </div>
    </section>
  );
}
