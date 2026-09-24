import { Story } from '@/components/home/story/Story';
import { DemoVideo } from '@/components/video/DemoVideo';
import type { DemoVideoEntry } from '@/components/video/manifest';
import type { MetierPage, SectionId } from '@/lib/metiers/types';
import type { PublicPlanOffer } from '@/lib/public-plans';
import { ArgumentsList, CounterBoard, ProblemBoard, SettingsBoard } from './boards';
import { Faq } from './Faq';
import { FinalCta } from './FinalCta';
import { MetierHero } from './MetierHero';
import { MetierRows } from './MetierRows';
import { INDEX_PATH, metierJsonLd, otherMetiers } from './model';
import { Breadcrumb, JsonLd, MoreLink, Section } from './parts';
import { PlansStrip } from './PlansStrip';
import { SignatureSection } from './Signature';
import { metierStoryCopy } from './story-copy';
import styles from './metiers.module.css';

/**
 * LE GABARIT D'UNE PAGE MÉTIER ([SEO § 3.4]) — composant serveur,
 * synchrone : la route lit les données (offres, QR, vidéo, capacités),
 * ce composant ne fait que les poser, dans l'ordre propre au métier
 * (`page.sections`).
 *
 * Un seul H1 : celui du héros (la séquence 3D, ou le héros statique des
 * événements). Toutes les sections portent un H2 ; les éléments d'une
 * section, des H3. Le JavaScript se limite à la séquence (déjà celle de
 * l'accueil), au lecteur vidéo quand il existe et aux révélations des
 * lignes.
 */

export interface MetierPageViewProps {
  page: MetierPage;
  /** Tous les métiers publiés (maillage). */
  all: readonly MetierPage[];
  plans: readonly PublicPlanOffer[] | null;
  qrSvg: string | null;
  video: DemoVideoEntry | null;
  /** Le profil du métier est-il ouvert (voir `profileOpenOnPages`) ? */
  profileOpen: boolean;
  siteUrl: string;
  appClip: boolean;
}

const AFTER_STORY_ID = 'apres-histoire';

export function MetierPageView({
  page,
  all,
  plans,
  qrSvg,
  video,
  profileOpen,
  siteUrl,
  appClip,
}: MetierPageViewProps): React.JSX.Element {
  const storyCopy = metierStoryCopy(page, { enriched: profileOpen });
  const sections = page.sections.filter((id) => {
    if (id === 'story') return storyCopy !== null;
    if (id === 'video') return video !== null;
    return true;
  });
  const crumbs = (
    <Breadcrumb
      className={styles.heroCrumbs}
      items={[{ label: 'Accueil', href: '/' }, { label: 'Métiers', href: INDEX_PATH }, { label: page.nav.label }]}
    />
  );
  const neighbours = otherMetiers(page, all).map((r) => r.page);

  const render = (id: SectionId, anchorId: string | undefined): React.ReactNode => {
    switch (id) {
      case 'story':
        return storyCopy ? <Story key={id} copy={storyCopy} skipTargetId={AFTER_STORY_ID} eyebrow={crumbs} /> : null;
      case 'problem':
        return <ProblemBoard key={id} rows={page.problem} anchorId={anchorId} />;
      case 'signature':
        return <SignatureSection key={id} page={page} profileOpen={profileOpen} anchorId={anchorId} />;
      case 'counter':
        return <CounterBoard key={id} rows={page.counter} anchorId={anchorId} />;
      case 'video':
        return video ? (
          <Section
            key={id}
            id="demo"
            anchorId={anchorId}
            kicker="La démo en vrai"
            title="Filmée sur le vrai produit."
            lead="Un commerce fictif, un vrai poste, un vrai téléphone : ce que vos clients et vous verrez, sans retouche."
          >
            <DemoVideo video={video} subject={page.nav.label} className={styles.video} />
          </Section>
        ) : null;
      case 'settings':
        return <SettingsBoard key={id} rows={page.settings} anchorId={anchorId} />;
      case 'arguments':
        return <ArgumentsList key={id} rows={page.arguments} anchorId={anchorId} />;
      case 'plans':
        return <PlansStrip key={id} plans={plans} ctaHref={page.cta.href} anchorId={anchorId} />;
      case 'faq':
        return <Faq key={id} items={page.faq} anchorId={anchorId} />;
      case 'cta':
        return (
          <FinalCta
            key={id}
            title={page.cta.title}
            lead={page.cta.lead}
            label={page.cta.label}
            href={page.cta.href}
            qrSvg={qrSvg}
            anchorId={anchorId}
          />
        );
      case 'related':
        return neighbours.length > 0 ? (
          <Section
            key={id}
            id="autres-metiers"
            anchorId={anchorId}
            kicker="Autres métiers"
            title="Le même geste, un autre comptoir."
            className={styles.related}
          >
            <MetierRows pages={neighbours} size="md" headingLevel="h3" />
            <div className={styles.plansFoot}>
              <MoreLink href={INDEX_PATH}>Tous les métiers</MoreLink>
            </div>
          </Section>
        ) : null;
      default:
        return null;
    }
  };

  const hasStory = sections[0] === 'story';
  // Première section après la séquence : cible de « Passer l'animation ».
  const firstAfterStory = hasStory ? sections[1] : undefined;
  const firstSectionId = sectionDomId(sections.find((id) => id !== 'story'));

  return (
    <main id="contenu" className={styles.main}>
      {!hasStory && <MetierHero page={page} eyebrow={crumbs} nextId={firstSectionId} />}
      {sections.map((id) => render(id, id === firstAfterStory ? AFTER_STORY_ID : undefined))}
      <JsonLd
        graph={metierJsonLd({
          page,
          siteUrl,
          // Mêmes offres que le bandeau : un balisage de prix n'existe que
          // si la page affiche ces prix.
          plans: plans ? plans.map((p) => ({ priceMonthCents: p.price_month_cents, currency: p.currency, setupFeeCents: p.setup_fee_cents })) : null,
          video,
          appClip,
        })}
      />
    </main>
  );
}

/** L'id du DOM d'une section (celui de `Section` ou du composant dédié). */
function sectionDomId(id: SectionId | undefined): string {
  switch (id) {
    case 'problem':
      return 'probleme';
    case 'counter':
      return 'comptoir';
    case 'settings':
      return 'reglages';
    case 'arguments':
      return 'pourquoi';
    case 'plans':
      return 'offres';
    case 'faq':
      return 'questions';
    case 'cta':
      return 'ouvrir';
    case 'related':
      return 'autres-metiers';
    case 'video':
      return 'demo';
    case 'signature':
    default:
      return 'signature';
  }
}
