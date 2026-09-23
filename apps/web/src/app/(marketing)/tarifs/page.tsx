import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatPrice } from '@/lib/format';
import styles from '../../marketing.module.css';

export const metadata: Metadata = {
  title: 'Tarifs',
  description: "Des offres simples pour une file d'attente virtuelle : App Clip iPhone, QR code, plaque NFC et avis Google inclus.",
};
// Les offres sont lues avec le client serveur privilégié : rendu au runtime
// pour ne jamais injecter SUPABASE_SERVICE_ROLE_KEY pendant le build Docker.
export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const { data: plans } = await supabaseAdmin()
    .from('plans')
    .select('code, name, tagline, description, price_month_cents, price_year_cents, currency, trial_days, max_locations, max_staff, max_plates, max_queues, history_days')
    .eq('is_active', true).eq('is_public', true).order('sort_order');

  return (
    <main className={`shell ${styles.section}`}>
      <div className="stack g3">
        <p className="t-label">Tarifs</p>
        <h1 className="t-display">Une file ouverte, un prix clair</h1>
        <p className={`t-body t-muted ${styles.lead}`}>
          Tout est inclus dans chaque offre : l&apos;App Clip iPhone, le QR code,
          l&apos;URL NFC, les notifications et le lien d&apos;avis Google. Seuls
          les volumes changent.
        </p>
      </div>

      <div className={styles.plans}>
        {(plans ?? []).map((plan, index) => (
          <article key={plan.code} className={`${styles.plan} ${index === 1 ? styles.planHighlight : ''}`}>
            {index === 1 && <span className="chip chip--signal">Le plus choisi</span>}
            <h2 className="t-section">{plan.name}</h2>
            <p className={styles.planPrice}>
              <span className={styles.planAmount}>{formatPrice(plan.price_month_cents, plan.currency)}</span>
              <span className="t-micro t-faint"> /mois HT</span>
            </p>
            <p className="t-micro t-faint">
              ou {formatPrice(plan.price_year_cents, plan.currency)} par an
            </p>
            <p className="t-small t-muted">{plan.description}</p>
            <ul className={styles.planFeatures}>
              <li>{plan.max_locations < 0 ? 'Établissements illimités' : `${plan.max_locations} établissement${plan.max_locations > 1 ? 's' : ''}`}</li>
              <li>{plan.max_staff < 0 ? 'Professionnels illimités' : `${plan.max_staff} professionnels`}</li>
              <li>{plan.max_plates < 0 ? 'Plaques illimitées' : `${plan.max_plates} plaques NFC / QR`}</li>
              <li>{plan.max_queues < 0 ? 'Files illimitées' : `${plan.max_queues} file${plan.max_queues > 1 ? 's' : ''}`}</li>
              <li>{plan.history_days} jours d&apos;historique</li>
              <li>App Clip iPhone, Web Push Android, avis Google</li>
            </ul>
            <Link href="/inscription" className={index === 1 ? 'btn btn--signal btn--block' : 'btn btn--ghost btn--block'}>
              {plan.trial_days} jours d&apos;essai
            </Link>
          </article>
        ))}
      </div>

      <div className={styles.doc}>
        <h2>Ce qui est toujours inclus</h2>
        <ul>
          <li><strong>Aucun SMS.</strong> Les notifications passent par l&apos;App Clip iPhone ou le navigateur : rien à payer à l&apos;unité.</li>
          <li><strong>Aucune application à installer pour vos clients.</strong> Ni compte, ni mot de passe, ni e-mail obligatoire.</li>
          <li><strong>Le temps réel.</strong> Les positions se mettent à jour toutes seules, sur tous les écrans.</li>
          <li><strong>Vos QR et vos affiches.</strong> Générés à la demande, prêts à imprimer.</li>
        </ul>

        <h2>Questions fréquentes</h2>
        <p><strong>Dois-je commander des plaques ?</strong> Non. Un QR imprimé suffit pour démarrer. Si vous voulez des plaques NFC gravées, vous pouvez en faire la demande depuis votre espace : nous revenons vers vous avec un devis avant toute production.</p>
        <p><strong>Et si je change d&apos;offre ?</strong> Le changement est immédiat et le prorata est calculé automatiquement.</p>
        <p><strong>Mes données m&apos;appartiennent-elles ?</strong> Oui. Vous choisissez la durée de conservation ; au-delà, les prénoms de vos clients sont effacés automatiquement.</p>
      </div>
    </main>
  );
}
