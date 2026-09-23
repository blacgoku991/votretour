import type { Metadata } from 'next';
import Link from 'next/link';
import QRCode from 'qrcode';
import { SiteHeader, SiteFooter } from '@/components/SiteChrome';
import { Reveal } from '@/components/motion/Reveal';
import { Plaque } from '@/components/objects/Plaque';
import { Story } from '@/components/home/story/Story';
import { AppClipPhone } from '@/components/home/AppClipPhone';
import { DropsWaves } from '@/components/home/DropsWaves';
import { DropPass } from '@/components/home/DropPass';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { formatPrice } from '@/lib/format';
import styles from './home.module.css';

export const metadata: Metadata = {
  title: "Rangvia — la file d'attente qui vous laisse partir",
  description:
    "Vos clients approchent leur téléphone d'une plaque Rangvia, rejoignent la file et sortent. Ils voient leur position et reçoivent une notification quand leur tour approche. Sans compte ni application à installer.",
};

// Cette page lit les offres via service_role. Elle doit donc être rendue
// au runtime, jamais pendant le build Docker : on évite ainsi d'injecter
// SUPABASE_SERVICE_ROLE_KEY dans les couches de l'image.
export const dynamic = 'force-dynamic';

/** Tableau des départs « Côté comptoir » (§5.11). */
const COUNTER: Array<{ key: string; text: string }> = [
  {
    key: 'Terminer',
    text: "La file avance, les positions se recalculent, les clients sont prévenus, l'historique s'écrit tout seul.",
  },
  {
    // Virgules plutôt que « · » : la clé peut se couper sans laisser de point orphelin.
    key: 'Absent, décaler, retirer',
    text: "Quelqu'un n'est pas revenu ? Il recule, il attend de côté, ou il sort. Vous pouvez toujours le remettre.",
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
  "Une seule application pour tous les commerces : c'est l'URL de votre plaque qui vous identifie",
  'Notifications natives, avec retour haptique quand la file avance',
  'Fonctionne aussi en QR code, et sur Android via le navigateur',
];

function volume(n: number, singular: string, plural: string, unlimited: string): string {
  if (n < 0) return unlimited;
  return `${n}\u00a0${n > 1 ? plural : singular}`;
}

export default async function HomePage() {
  const [{ data: plans }, qrSvg] = await Promise.all([
    supabaseAdmin()
      .from('plans')
      .select('code, name, tagline, price_month_cents, currency, max_locations, max_staff, max_plates')
      .eq('is_active', true)
      .eq('is_public', true)
      .order('sort_order'),
    // Le QR de l'appel final : un vrai lien vers l'inscription, en SVG.
    QRCode.toString(`${env.siteUrl}/inscription`, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#0B0E13', light: '#0000' },
    }),
  ]);

  return (
    <div className={styles.page}>
      <SiteHeader />

      <main>
        {/* ============ 1. L'histoire : héros, scène collante, six étapes ============ */}
        <Story />

        {/* ============ 2. App Clip ============ */}
        <section id="apres-histoire" className={styles.clip} aria-labelledby="clip-titre" tabIndex={-1}>
          <div className={`shell ${styles.clipInner}`}>
            <div className={styles.clipText}>
              <p className="t-label">Sur iPhone</p>
              <h2 id="clip-titre" className={`t-display ${styles.h2}`}>
                <span className={styles.nowrap}>Rien à installer.</span> Vraiment.
              </h2>
              <p className={`t-body t-muted ${styles.body}`}>
                Votre client approche son iPhone de la plaque : l&apos;App Clip s&apos;ouvre en une
                seconde, sans passer par l&apos;App Store. Il rejoint la file, range son téléphone, et
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

        {/* ============ 3. Côté comptoir : tableau des départs ============ */}
        <section className={styles.counter} aria-labelledby="comptoir-titre">
          <div className="shell">
            <header className={styles.sectionHead}>
              <h2 id="comptoir-titre" className="t-display">
                Côté comptoir, ça tient en un bouton
              </h2>
              <p className={`t-lead ${styles.leadAfter}`}>
                Vous travaillez. Vous n&apos;avez pas le temps de naviguer dans des menus.
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

        {/* ============ 4. Event / Drop ============ */}
        <section id="drops" className={styles.drops} aria-labelledby="drops-titre">
          <div className={`shell ${styles.dropsInner}`}>
            <div className={styles.dropsText}>
              <p className="t-label">Mode Event / Drop</p>
              <h2 id="drops-titre" className={`t-display ${styles.h2}`}>
                Un lancement, 800&nbsp;personnes&nbsp;? <span className={styles.nowrap}>Faites-les</span> entrer
                par vagues.
              </h2>
              <p className={`t-body t-muted ${styles.body}`}>
                Chaque inscrit reçoit un pass d&apos;accès à usage unique. Vous ouvrez les vagues une par
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

        {/* ============ 5. Offres ============ */}
        <section id="offres" className={styles.offers} aria-labelledby="offres-titre">
          <div className="shell">
            <header className={styles.sectionHead}>
              <h2 id="offres-titre" className="t-display">
                Des offres simples
              </h2>
              <p className={`t-lead ${styles.leadAfter}`}>Tout est inclus. Seuls les volumes changent.</p>
            </header>
            <ol className={`rail-list board ${styles.plans}`}>
              {(plans ?? []).map((plan, index) => {
                const featured = index === 1;
                return (
                  <li key={plan.code} className={featured ? 'is-self' : undefined}>
                    <div className={styles.planHead}>
                      <p className={styles.planName}>
                        <span className="t-board">{plan.name}</span>
                        {featured && <span className={`chip chip--signal ${styles.planChip}`}>Le plus choisi</span>}
                      </p>
                      <p className={styles.planPrice}>
                        <span className={`t-num ${styles.planAmount}`}>
                          {formatPrice(plan.price_month_cents, plan.currency)}
                        </span>
                        <span className="t-micro t-muted">/mois HT</span>
                      </p>
                    </div>
                    <p className={`t-body t-muted ${styles.planVolumes}`}>
                      {/* « · » collé au volume qui le précède : jamais en tête de ligne. */}
                      {volume(plan.max_locations, 'établissement', 'établissements', 'Établissements illimités')}
                      {'\u00a0· '}
                      {volume(plan.max_staff, 'professionnel', 'professionnels', 'Professionnels illimités')}
                      {'\u00a0· '}
                      {volume(plan.max_plates, 'plaque', 'plaques', 'Plaques illimitées')}
                    </p>
                    <Link
                      href="/inscription"
                      className={`btn ${featured ? 'btn--signal' : 'btn--ghost'} ${styles.planBtn}`}
                    >
                      Essayer
                    </Link>
                  </li>
                );
              })}
            </ol>
            <div className={styles.plansFoot}>
              <Link href="/tarifs" className={styles.more}>
                Comparer les offres en détail
                <span aria-hidden="true" className={styles.moreSlat} />
              </Link>
              <p className="t-micro t-muted">Période d&apos;essai sans carte bancaire. Résiliable à tout moment.</p>
            </div>
          </div>
        </section>

        {/* ============ 6. Appel final ============ */}
        <section className={styles.cta} aria-labelledby="cta-titre">
          <div className={`shell ${styles.ctaInner}`}>
            <div className={styles.ctaText}>
              <h2 id="cta-titre" className="t-hero">
                Posez une plaque. C&apos;est tout.
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

      <SiteFooter />
    </div>
  );
}
