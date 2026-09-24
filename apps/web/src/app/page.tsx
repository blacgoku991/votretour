import type { Metadata } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';
import { SiteHeader, SiteFooter } from '@/components/SiteChrome';
import { Reveal } from '@/components/motion/Reveal';
import { Plaque } from '@/components/objects/Plaque';
import { Story } from '@/components/home/story/Story';
import { buildHomeStoryCopy } from '@/components/home/story/copy';
import { AppClipPhone } from '@/components/home/AppClipPhone';
import { DropsWaves } from '@/components/home/DropsWaves';
import { DropPass } from '@/components/home/DropPass';
import { MetierRows } from '@/components/metiers/MetierRows';
import { PlansStrip } from '@/components/metiers/PlansStrip';
import { DemoVideo } from '@/components/video/DemoVideo';
import { videoForMetier, type DemoVideoEntry } from '@/components/video/manifest';
import { selectPublishedMetiers } from '@/lib/metiers/select';
import { appClipPublished } from '@/lib/seo/site';
import { getPublicPlans } from '@/lib/public-plans';
import { siteFooterData } from '@/server/founders';
import { env } from '@/lib/env';
import styles from './home.module.css';

export const metadata: Metadata = {
  title: "Rangvia — la file d’attente qui vous laisse partir",
  description:
    "Vos clients approchent leur téléphone d’une plaque Rangvia, rejoignent la file et sortent. Ils voient leur position et reçoivent une notification quand leur tour approche. Sans compte ni application à installer.",
};

// Le pied de page (vitrine des premiers commerces) lit la base via
// service_role : la page est rendue au runtime, jamais pendant le build
// Docker, pour ne pas injecter SUPABASE_SERVICE_ROLE_KEY dans l'image.
// L'offre, elle, se lit avec la clé anon et le cache « plans »
// (getPublicPlans), comme les pages métier.
export const dynamic = 'force-dynamic';

/** Tableau des départs « Côté comptoir » (§5.11). */
const COUNTER: Array<{ key: string; text: string }> = [
  {
    key: 'Terminer',
    text: "La file avance, les positions se recalculent, les clients sont prévenus, l’historique s’écrit tout seul.",
  },
  {
    // Virgules plutôt que « · » : la clé peut se couper sans laisser de point orphelin.
    key: 'Absent, décaler, retirer',
    text: "Quelqu’un n’est pas revenu ? Il recule, il attend de côté, ou il sort. Vous pouvez toujours le remettre.",
  },
  {
    key: 'Seul ou à plusieurs',
    text: 'Une file commune où le prochain part avec le premier disponible, ou une file par professionnel.',
  },
  {
    key: 'Plaques et QR',
    text: 'Générés automatiquement, avec une affiche prête à imprimer. Le tag NFC porte la même URL.',
  },
  {
    key: 'Écran de salle',
    text: 'Un écran au mur affiche la file en grand : qui est au comptoir, et combien attendent.',
  },
  {
    key: 'Avis Google',
    text: 'À la fin du passage, un remerciement et un bouton qui ouvre directement votre fiche.',
  },
  {
    key: 'Plusieurs établissements',
    text: 'Chacun sa file, ses plaques, son équipe et ses statistiques. Un seul tableau de bord.',
  },
];

const APP_CLIP_POINTS = [
  "Une seule application pour tous les commerces : c’est l’URL de votre plaque qui vous identifie",
  'Notifications natives, avec retour haptique quand la file avance',
  'Fonctionne aussi en QR code, et sur Android via le navigateur',
];

/** La vidéo de l'accueil : celle des barbiers, la même scène « Barber House » que l'histoire. */
const HOME_VIDEO_METIER = 'barbiers';

function withoutTeaser(video: DemoVideoEntry | null): DemoVideoEntry | null {
  if (!video) return null;
  const { teaser: _teaser, ...files } = video.files;
  return { ...video, files };
}

/** Cible du lien « Passer l'animation » de l'histoire (`Story`, défaut). */
const AFTER_STORY_ID = 'apres-histoire';

export default async function HomePage() {
  // L'App Clip n'est cité qu'une fois PUBLIÉ sur l'App Store : l'étape 1
  // de l'histoire le dit ou non, et la section App Clip n'existe qu'alors.
  const appClip = appClipPublished();
  const metiers = selectPublishedMetiers();
  // Sans l'aperçu en boucle (teaser) : l'accueil porte déjà la séquence 3D,
  // et rien de la vidéo ne se charge avant le clic, hormis son affiche.
  const video = withoutTeaser(videoForMetier(HOME_VIDEO_METIER));
  // La première section après l'histoire reçoit la cible du lien
  // d'évitement : la vidéo si elle existe, sinon l'App Clip, sinon le comptoir.
  const afterStory: 'video' | 'clip' | 'counter' = video ? 'video' : appClip ? 'clip' : 'counter';
  const skipTarget = (section: typeof afterStory) =>
    afterStory === section ? { id: AFTER_STORY_ID, tabIndex: -1 } : {};

  const [plans, qrSvg, footer] = await Promise.all([
    // L'offre unique (0043), lue comme sur les pages métier : mêmes
    // colonnes, frais d'installation compris, jamais un prix inventé.
    getPublicPlans(),
    // Le QR de l'appel final : un vrai lien vers l'inscription, en SVG.
    QRCode.toString(`${env.siteUrl}/inscription`, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#0B0E13', light: '#0000' },
    }),
    siteFooterData(),
  ]);

  return (
    <div className={styles.page}>
      <SiteHeader />

      <main id="contenu" className={styles.main}>
        {/* ============ 1. L'histoire : héros, scène collante, six étapes ============ */}
        <Story copy={buildHomeStoryCopy({ appClip })} skipTargetId={AFTER_STORY_ID} />

        {/* ============ 2. En vrai, en une minute : la vidéo barbiers ============ */}
        {video && (
          <section className={styles.demo} aria-labelledby="demo-titre" {...skipTarget('video')}>
            <div className="shell">
              <header className={styles.sectionHead}>
                <p className="t-label">En vrai, en une minute</p>
                <h2 id="demo-titre" className={`t-display ${styles.h2}`}>
                  La même file, filmée sur le vrai produit.
                </h2>
                <p className={`t-lead ${styles.leadAfter}`}>
                  Un barbier fictif, un vrai poste, un vrai téléphone&nbsp;: ce que vos clients et vous
                  verrez, sans retouche.
                </p>
              </header>
              <DemoVideo video={video} subject="Barbiers" className={styles.demoVideo} />
            </div>
          </section>
        )}

        {/* ============ 3. App Clip (une fois publié sur l'App Store) ============ */}
        {appClip && (
          <section className={styles.clip} aria-labelledby="clip-titre" {...skipTarget('clip')}>
            <div className={`shell ${styles.clipInner}`}>
              <div className={styles.clipText}>
                <p className="t-label">Sur iPhone</p>
                <h2 id="clip-titre" className={`t-display ${styles.h2}`}>
                  <span className={styles.nowrap}>Rien à installer.</span> Vraiment.
                </h2>
                <p className={`t-body t-muted ${styles.body}`}>
                  Votre client approche son iPhone de la plaque : l’App Clip s’ouvre en une
                  seconde, sans passer par l’App Store. Il rejoint la file, range son téléphone, et
                  reçoit une notification native quand son tour approche.
                </p>
                <ul className={`rail-list ${styles.points}`}>
                  {APP_CLIP_POINTS.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
              <div className={styles.clipVisual}>
                <AppClipPhone />
              </div>
            </div>
          </section>
        )}

        {/* ============ 4. Côté comptoir : tableau des départs ============ */}
        <section className={styles.counter} aria-labelledby="comptoir-titre" {...skipTarget('counter')}>
          <div className="shell">
            <header className={styles.sectionHead}>
              <h2 id="comptoir-titre" className="t-display">
                Côté comptoir, ça tient en un bouton
              </h2>
              <p className={`t-lead ${styles.leadAfter}`}>
                Vous travaillez. Vous n’avez pas le temps de naviguer dans des menus.
              </p>
            </header>
            <ol className={`rail-list board ${styles.board}`}>
              {COUNTER.map((row, i) => (
                <Reveal as="li" variant="rise" index={i} key={row.key} className={i === 0 ? 'is-self' : undefined}>
                  <span className={`t-board ${styles.boardKey}`}>{row.key}</span>
                  <span className="t-body t-muted">{row.text}</span>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ============ 5. Pour votre métier : une ligne par page métier ============ */}
        {metiers.length > 0 && (
          <section className={styles.metiers} aria-labelledby="metiers-titre">
            <div className="shell">
              <header className={styles.metiersHead}>
                <div className={styles.sectionHead}>
                  <p className="t-label">Pour votre métier</p>
                  <h2 id="metiers-titre" className={`t-display ${styles.h2}`}>
                    Chaque comptoir a sa file.
                  </h2>
                  <p className={`t-lead ${styles.leadAfter}`}>
                    Fauteuil, réception, salle, guichet&nbsp;: la même file, avec les mots de votre métier.
                  </p>
                </div>
                <Link href="/pour" className={styles.more}>
                  Tous les métiers
                  <span aria-hidden="true" className={styles.moreSlat} />
                </Link>
              </header>
              <MetierRows pages={metiers} size="md" headingLevel="h3" />
            </div>
          </section>
        )}

        {/* ============ 6. Event / Drop ============ */}
        <section id="drops" className={styles.drops} aria-labelledby="drops-titre">
          <div className={`shell ${styles.dropsInner}`}>
            <div className={styles.dropsText}>
              <p className="t-label">Mode Event / Drop</p>
              <h2 id="drops-titre" className={`t-display ${styles.h2}`}>
                Un lancement, 800&nbsp;personnes&nbsp;? <span className={styles.nowrap}>Faites-les</span> entrer
                par vagues.
              </h2>
              <p className={`t-body t-muted ${styles.body}`}>
                Chaque inscrit reçoit un pass d’accès à usage unique. Vous ouvrez les vagues une par
                une, et un bouton Stock épuisé ferme tout proprement.
              </p>
            </div>
            <div className={styles.dropsPass}>
              <DropPass />
            </div>
            <div className={styles.dropsWaves}>
              <DropsWaves />
            </div>
          </div>
        </section>

        {/* ============ 7. L'offre : le même bandeau que les pages métier ============ */}
        {/* Une seule offre depuis 0043 : l'abonnement ET l'installation, un
            appel à l'essai, « Le détail de l'offre » vers /tarifs. Jamais un
            prix sans ses frais d'installation. */}
        <PlansStrip plans={plans} ctaHref="/inscription" />

        {/* ============ 8. Appel final ============ */}
        <section className={styles.cta} aria-labelledby="cta-titre">
          <div className={`shell ${styles.ctaInner}`}>
            <div className={styles.ctaText}>
              <h2 id="cta-titre" className="t-hero">
                Posez une plaque. C’est tout.
              </h2>
              <p className={`t-lead ${styles.ctaLead}`}>
                Créez votre file en quelques minutes : votre QR code et votre URL NFC sont générés
                immédiatement.
              </p>
              <Link href="/inscription" className={`btn btn--signal btn--lg ${styles.ctaBtn}`}>
                Ouvrir ma file
              </Link>
              <p className="t-micro t-muted">Essai gratuit, sans carte bancaire.</p>
            </div>
            <div className={styles.ctaVisual}>
              <span className={`floor-marks ${styles.ctaFloor}`} aria-hidden="true" />
              <div className={styles.ctaPlaque}>
                <Plaque
                  width={260}
                  pose="none"
                  className={styles.ctaPlaqueObj}
                  qr={<span dangerouslySetInnerHTML={{ __html: qrSvg }} />}
                  caption="Approchez votre téléphone"
                />
              </div>
              <p className={styles.ctaScan}>Scannez pour continuer sur votre téléphone</p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter {...footer} />
    </div>
  );
}
