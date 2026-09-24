import Link from 'next/link';
import { FloorScene, type FloorSlat } from '@/components/objects/FloorScene';
import type { MetierPage } from '@/lib/metiers/types';
import { MetierRows } from './MetierRows';
import { INDEX_COPY, INDEX_PATH, indexJsonLd, metierSeuil } from './model';
import { Breadcrumb, JsonLd } from './parts';
import styles from './metiers.module.css';

/**
 * L'INDEX `/pour` — « Chaque métier a sa file ».
 *
 * À gauche, le H1 ; à droite, une file de métiers couchée au sol : chaque
 * latte porte un métier publié et le seuil de son comptoir, et la dernière,
 * en pointillé, attend le vôtre. Dessous, le grand tableau des départs,
 * une ligne par métier. Tout vient du registre : un métier non publié
 * n'apparaît nulle part.
 */
export function MetiersIndex({
  pages,
  siteUrl,
  appClip,
}: {
  pages: readonly MetierPage[];
  siteUrl: string;
  appClip: boolean;
}): React.JSX.Element {
  // Sept lattes au plus, plus la place fantôme : FloorScene en dessine huit.
  const slats: FloorSlat[] = [
    ...pages.slice(0, 7).map((p, i) => ({
      id: p.slug,
      state: (i === 0 ? 'serving' : 'wait') as FloorSlat['state'],
      label: p.nav.short,
      hint: metierSeuil(p),
    })),
    { id: 'vous', state: 'ghost', label: 'Votre métier' },
  ];

  return (
    <main id="contenu" className={styles.main}>
      <section className={styles.indexHero} aria-labelledby="metiers-titre">
        <div className={`shell ${styles.indexHeroInner}`}>
          <div className={styles.heroText}>
            <Breadcrumb className={styles.heroCrumbs} items={[{ label: 'Accueil', href: '/' }, { label: 'Métiers' }]} />
            <p className={`t-label ${styles.heroLabel}`}>{INDEX_COPY.label}</p>
            <h1 id="metiers-titre" className={`t-hero ${styles.heroTitle}`}>
              {INDEX_COPY.h1}
            </h1>
            <p className={`t-lead ${styles.heroLead}`}>{INDEX_COPY.lead}</p>
            <div className={styles.heroActions}>
              <a href="#tableau" className="btn btn--signal btn--lg">
                Trouver mon métier
              </a>
              <Link href="/inscription" className="btn btn--ghost btn--lg">
                Ouvrir ma file
              </Link>
            </div>
          </div>
          <div className={`${styles.heroVisual} ${styles.indexVisual}`}>
            <FloorScene
              slats={slats}
              seuil="Comptoir"
              spill
              intro
              size="lg"
              tilt={52}
              turn={7}
              label={`Une file de métiers : ${pages.map((p) => p.nav.label).join(', ')}, puis le vôtre.`}
            />
          </div>
        </div>
      </section>

      <section id="tableau" className={styles.indexBoard} aria-labelledby="tableau-titre" tabIndex={-1}>
        <div className="shell">
          <header className={styles.head}>
            <p className="t-label">
              {pages.length}&nbsp;{pages.length > 1 ? 'métiers' : 'métier'}
            </p>
            <h2 id="tableau-titre" className={`t-display ${styles.h2}`}>
              Choisissez votre comptoir.
            </h2>
          </header>
          <MetierRows pages={pages} size="lg" headingLevel="h3" />
          <p className={`t-body t-muted ${styles.indexFoot}`}>
            Votre métier n’est pas dans la liste&nbsp;? La file fonctionne de la même façon pour tout commerce
            sans rendez-vous.{' '}
            <Link href="/inscription" className={styles.inlineLink}>
              Ouvrez la vôtre
            </Link>
            .
          </p>
        </div>
      </section>
      <JsonLd graph={indexJsonLd(pages, siteUrl, appClip)} />
    </main>
  );
}
