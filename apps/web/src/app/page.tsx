import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveRangDemo } from '@/components/LiveRangDemo';
import { SiteHeader, SiteFooter } from '@/components/SiteChrome';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatPrice } from '@/lib/format';
import styles from './marketing.module.css';

export const metadata: Metadata = {
  title: "VotreTour — la file d'attente qui vous laisse partir",
  description:
    "Vos clients approchent leur téléphone d'une plaque, rejoignent la file et sortent. Ils voient combien de personnes sont devant eux et reçoivent une notification quand c'est leur tour. Sans compte, sans application à installer, sans SMS.",
};

export const revalidate = 3600;

const STEPS = [
  {
    kicker: 'Le client',
    title: 'Approche son téléphone',
    body: "Une plaque NFC sur le comptoir, ou un QR code. Sur iPhone, l'App Clip s'ouvre tout seul. Rien à installer, aucun compte à créer.",
  },
  {
    kicker: 'Puis il sort',
    title: 'Et voit sa place avancer',
    body: "Une seule information à l'écran : combien de personnes sont devant lui. Pas de numéro de ticket, pas de temps estimé qu'on ne peut pas tenir.",
  },
  {
    kicker: 'Vous',
    title: 'Appuyez sur Terminer',
    body: "Toute la file avance, les positions se recalculent, et les bonnes personnes sont prévenues. Un seul geste, entre deux clients.",
  },
];

export default async function HomePage() {
  const { data: plans } = await supabaseAdmin()
    .from('plans')
    .select('code, name, tagline, price_month_cents, currency, max_locations, max_staff, max_plates')
    .eq('is_active', true).eq('is_public', true).order('sort_order');

  return (
    <div className={styles.page}>
      <SiteHeader />

      {/* ================= HÉROS ================= */}
      <section className={styles.hero}>
        <span className={styles.heroRails} aria-hidden="true" />
        <div className={`shell ${styles.heroInner}`}>
          <div className={styles.heroText}>
            <p className="t-label">File d&apos;attente virtuelle</p>
            <h1 className={styles.heroTitle}>
              Vos clients n&apos;attendent plus debout.
            </h1>
            <p className={styles.heroLead}>
              Ils approchent leur téléphone de la plaque, rejoignent la file et
              sortent. Ils voient combien de personnes sont devant eux, et reçoivent
              une notification quand c&apos;est leur tour.
            </p>
            <div className={styles.heroActions}>
              <Link href="/inscription" className="btn btn--signal btn--lg">
                Ouvrir ma file
              </Link>
              <Link href="#comment" className="btn btn--ghost btn--lg">
                Comment ça marche
              </Link>
            </div>
            <p className="t-micro t-faint">
              Sans compte client · Sans application à installer · Sans SMS payant
            </p>
          </div>

          {/* La démonstration EST le produit : la file avance vraiment. */}
          <div className={styles.heroDemo}>
            <LiveRangDemo />
          </div>
        </div>
      </section>

      {/* ================= COMMENT ================= */}
      <section id="comment" className={`shell ${styles.section}`}>
        <h2 className="t-title">Trois gestes, et c&apos;est tout</h2>
        <div className={styles.steps}>
          {STEPS.map((step, index) => (
            <article key={step.title} className={styles.step}>
              <span className={styles.stepIndex} aria-hidden="true">{index + 1}</span>
              <p className="t-label">{step.kicker}</p>
              <h3 className="t-section">{step.title}</h3>
              <p className="t-small t-muted">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ================= APP CLIP ================= */}
      <section className={styles.dark}>
        <div className={`shell ${styles.darkInner}`}>
          <div className={styles.darkText}>
            <p className="t-label">Sur iPhone</p>
            <h2 className="t-title">Un vrai App Clip. Pas une page web déguisée.</h2>
            <p className="t-body t-muted">
              Votre client approche son iPhone de la plaque : l&apos;App Clip
              s&apos;ouvre en une seconde, sans passer par l&apos;App Store. Il
              rejoint la file, range son téléphone, et reçoit une notification
              native quand son tour approche.
            </p>
            <ul className={styles.checks}>
              <li>Une seule application pour tous les commerces — c&apos;est l&apos;URL de votre plaque qui vous identifie</li>
              <li>Notifications natives, avec retour haptique quand la file avance</li>
              <li>Fonctionne aussi en QR code, et sur Android via le navigateur</li>
            </ul>
          </div>
          <div className={styles.darkVisual} aria-hidden="true">
            <PhoneMock />
          </div>
        </div>
      </section>

      {/* ================= POUR VOUS ================= */}
      <section className={`shell ${styles.section}`}>
        <h2 className="t-title">Côté comptoir, ça tient en un bouton</h2>
        <p className={`t-body t-muted ${styles.lead}`}>
          Vous travaillez. Vous n&apos;avez pas le temps de naviguer dans des menus.
        </p>
        <div className={styles.features}>
          <Feature title="Terminer" body="Un geste : la file avance, les positions se recalculent, les clients sont prévenus, l'historique est écrit." />
          <Feature title="Absent, décaler, retirer" body="Quelqu'un n'est pas revenu ? Vous choisissez : il recule, il attend de côté, ou il sort. Vous pouvez toujours le remettre." />
          <Feature title="Seul ou à plusieurs" body="Une file commune où le prochain part avec le premier disponible, ou une file par professionnel. Au choix." />
          <Feature title="Plaques et QR" body="Générés automatiquement, avec une affiche prête à imprimer. Le tag NFC porte la même URL." />
          <Feature title="Avis Google" body="À la fin du passage, le client reçoit un remerciement et un bouton qui ouvre directement votre fiche." />
          <Feature title="Plusieurs établissements" body="Chacun sa file, ses plaques, son équipe et ses statistiques. Un seul tableau de bord." />
        </div>
      </section>

      {/* ================= TARIFS ================= */}
      <section className={`shell ${styles.section}`} id="tarifs">
        <h2 className="t-title">Des offres simples</h2>
        <div className={styles.plans}>
          {(plans ?? []).map((plan, index) => (
            <article key={plan.code} className={`${styles.plan} ${index === 1 ? styles.planHighlight : ''}`}>
              {index === 1 && <span className="chip chip--signal">Le plus choisi</span>}
              <h3 className="t-section">{plan.name}</h3>
              <p className={styles.planPrice}>
                <span className={styles.planAmount}>{formatPrice(plan.price_month_cents, plan.currency)}</span>
                <span className="t-micro t-faint"> /mois HT</span>
              </p>
              <p className="t-small t-muted">{plan.tagline}</p>
              <ul className={styles.planFeatures}>
                <li>{plan.max_locations < 0 ? 'Établissements illimités' : `${plan.max_locations} établissement${plan.max_locations > 1 ? 's' : ''}`}</li>
                <li>{plan.max_staff < 0 ? 'Professionnels illimités' : `${plan.max_staff} professionnels`}</li>
                <li>{plan.max_plates < 0 ? 'Plaques illimitées' : `${plan.max_plates} plaques`}</li>
                <li>App Clip, QR, NFC et avis Google inclus</li>
              </ul>
              <Link href="/inscription" className={index === 1 ? 'btn btn--signal btn--block' : 'btn btn--ghost btn--block'}>
                Essayer
              </Link>
            </article>
          ))}
        </div>
        <p className="t-micro t-faint">
          Période d&apos;essai sans carte bancaire. Résiliable à tout moment.
        </p>
      </section>

      {/* ================= APPEL ================= */}
      <section className={styles.cta}>
        <div className={`shell ${styles.ctaInner}`}>
          <h2 className="t-display">Posez une plaque. C&apos;est tout.</h2>
          <p className="t-body t-muted">
            Créez votre file en quelques minutes : votre QR code et votre URL NFC
            sont générés immédiatement.
          </p>
          <Link href="/inscription" className="btn btn--signal btn--lg">
            Ouvrir ma file
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <article className={styles.feature}>
      <span className={styles.featureSlat} aria-hidden="true" />
      <h3 className="t-section">{title}</h3>
      <p className="t-small t-muted">{body}</p>
    </article>
  );
}

/** Maquette de téléphone dessinée en CSS : pas d'image à charger. */
function PhoneMock() {
  return (
    <div className={styles.phone}>
      <div className={styles.phoneScreen}>
        <div className={styles.phoneHeader}>
          <span className={styles.phoneLogo} />
          <span className={styles.phoneTitle} />
        </div>
        <div className={styles.phoneCount}>
          <span className={styles.phoneNumber}>2</span>
          <span className={styles.phoneLabel}>personnes devant vous</span>
        </div>
        <div className={styles.phoneRang}>
          <span className={styles.phoneRail} />
          <span className={styles.phoneSlat} />
          <span className={styles.phoneSlat} />
          <span className={styles.phoneSelf} />
        </div>
        <span className={styles.phoneButton} />
      </div>
    </div>
  );
}
