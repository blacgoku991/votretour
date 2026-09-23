import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { Plaque } from '@/components/objects/Plaque';
import { PricingBoard, type PublicPlan } from './PricingBoard';
import styles from '../../marketing.module.css';

export const metadata: Metadata = {
  title: 'Tarifs',
  description: "Des offres simples pour une file d’attente virtuelle : App Clip iPhone, QR code, plaque NFC et avis Google inclus.",
};
// Les offres sont lues avec le client serveur privilégié : rendu au runtime
// pour ne jamais injecter SUPABASE_SERVICE_ROLE_KEY pendant le build Docker.
export const dynamic = 'force-dynamic';

const INCLUDED = [
  {
    key: 'Aucun SMS',
    text: "Les notifications passent par l’App Clip iPhone ou le navigateur : rien à payer à l’unité.",
  },
  {
    key: 'Aucune application à installer',
    text: 'Pour vos clients : ni compte, ni mot de passe, ni e-mail obligatoire.',
  },
  {
    key: 'Le temps réel',
    text: 'Les positions se mettent à jour toutes seules, sur tous les écrans.',
  },
  {
    key: 'Vos QR et vos affiches',
    text: 'Générés à la demande, prêts à imprimer.',
  },
] as const;

const FAQ = [
  {
    q: 'Dois-je commander des plaques\u202f?',
    a: 'Non. Un QR imprimé suffit pour démarrer. Si vous voulez des plaques NFC gravées, vous pouvez en faire la demande depuis votre espace : nous revenons vers vous avec un devis avant toute production.',
  },
  {
    q: "Faut-il une carte bancaire pour l’essai\u202f?",
    a: "Non. L’essai démarre dès la création de votre file, sans moyen de paiement.",
  },
  {
    q: "Et si je change d’offre\u202f?",
    a: 'Le changement est immédiat et le prorata est calculé automatiquement.',
  },
  {
    q: 'Puis-je résilier à tout moment\u202f?',
    a: "Oui, depuis votre espace. La résiliation prend effet à la fin de la période en cours, et vos données restent accessibles jusqu’à cette date.",
  },
  {
    q: "Mes données m’appartiennent-elles\u202f?",
    a: 'Oui. Vous choisissez la durée de conservation ; au-delà, les prénoms de vos clients sont effacés automatiquement.',
  },
] as const;

export default async function PricingPage() {
  const { data } = await supabaseAdmin()
    .from('plans')
    .select('code, name, tagline, description, price_month_cents, price_year_cents, currency, trial_days, max_locations, max_staff, max_plates, max_queues, history_days')
    .eq('is_active', true).eq('is_public', true).order('sort_order');
  const plans: PublicPlan[] = (data ?? []).map((p) => ({
    code: p.code,
    name: p.name,
    description: p.description,
    price_month_cents: p.price_month_cents,
    price_year_cents: p.price_year_cents,
    currency: p.currency,
    trial_days: p.trial_days,
    max_locations: p.max_locations,
    max_staff: p.max_staff,
    max_plates: p.max_plates,
    max_queues: p.max_queues,
    history_days: p.history_days,
  }));

  return (
    <main id="contenu" className={styles.pricing}>
      <header className={`shell ${styles.intro}`}>
        <p className="t-label">Tarifs</p>
        <h1 className={`t-hero ${styles.introTitle}`}>Une file ouverte, un prix clair</h1>
        <p className={`t-lead ${styles.introLead}`}>
          Tout est inclus dans chaque offre : l’App Clip iPhone, le QR code,
          l’URL NFC, les notifications et le lien d’avis Google. Seuls
          les volumes changent.
        </p>
      </header>

      <section className="shell" aria-label="Offres">
        <PricingBoard plans={plans} />
      </section>

      <section className={`shell ${styles.split}`} aria-labelledby="inclus">
        <div className={styles.splitHead}>
          <p className="t-kicker"><span className="t-kicker__num">01</span> Dans chaque offre</p>
          <h2 id="inclus" className={`t-title ${styles.splitTitle}`}>Ce qui est toujours inclus</h2>
        </div>
        <ol className={`rail-list board ${styles.included}`}>
          {INCLUDED.map((item) => (
            <li key={item.key}>
              <span className="t-board">{item.key}</span>
              <span className={styles.includedText}>{item.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={`shell ${styles.split}`} aria-labelledby="questions">
        <div className={styles.splitHead}>
          <p className="t-kicker"><span className="t-kicker__num">02</span> Avant de vous lancer</p>
          <h2 id="questions" className={`t-title ${styles.splitTitle}`}>Questions fréquentes</h2>
        </div>
        <div className={styles.faq}>
          {FAQ.map((item) => (
            <details key={item.q} className={styles.faqItem}>
              <summary className={styles.faqQ}>
                <span>{item.q}</span>
                <span className={styles.faqIcon} aria-hidden="true" />
              </summary>
              <p className={styles.faqA}>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.final} aria-labelledby="final">
        <span className={`floor-marks ${styles.finalMarks}`} aria-hidden="true" />
        <div className={`shell ${styles.finalInner}`}>
          <div className={styles.finalText}>
            <h2 id="final" className="t-hero">Posez une plaque. C’est tout.</h2>
            <p className="t-lead">
              Créez votre file en quelques minutes : votre QR code et votre URL NFC
              sont générés immédiatement.
            </p>
            <div className={styles.finalActions}>
              <Link href="/inscription" className="btn btn--signal btn--lg">Ouvrir ma file</Link>
              <p className="t-small t-muted">Essai gratuit, sans carte bancaire.</p>
            </div>
          </div>
          <div className={styles.finalObject} aria-hidden="true">
            <span className="floor-marks" />
            <span className={styles.finalPlaque}>
              <Plaque width={200} pose="rest" caption="Approchez votre téléphone" />
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
