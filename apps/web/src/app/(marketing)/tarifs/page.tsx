import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { Plaque } from '@/components/objects/Plaque';
import { appClipPublished } from '@/lib/seo/site';
import { PUBLIC_PLAN_COLUMNS, mainPlan, parsePublicPlans } from '@/lib/public-plans';
import { PricingBoard } from './PricingBoard';
import styles from '../../marketing.module.css';
import own from './tarifs.module.css';

// L'App Clip n'est cité qu'une fois PUBLIÉ sur l'App Store
// (NEXT_PUBLIC_APP_CLIP_PUBLIE, figé au build) : avant, on ne promet que
// ce qu'un commerce obtient vraiment en s'inscrivant.
const APP_CLIP = appClipPublished();

// Aucun chiffre ici : le prix vit en base (modifiable dans /admin/offres),
// une description figée le contredirait au premier changement.
export const metadata: Metadata = {
  title: 'Tarifs',
  description: APP_CLIP
    ? 'Une seule offre, tout compris : l’installation de votre métier par l’équipe Rangvia, puis un abonnement mensuel. App Clip iPhone, QR code, plaque NFC et notifications inclus.'
    : 'Une seule offre, tout compris : l’installation de votre métier par l’équipe Rangvia, puis un abonnement mensuel. QR code, plaque NFC et notifications inclus.',
};
// Les offres sont lues avec le client serveur privilégié : rendu au runtime
// pour ne jamais injecter SUPABASE_SERVICE_ROLE_KEY pendant le build Docker.
export const dynamic = 'force-dynamic';

const FAQ = [
  {
    q: 'À quoi servent les frais d’installation ?',
    a: 'À installer Rangvia pour votre métier. Quand vous activez l’abonnement, l’équipe Rangvia active votre métier, règle avec vous horaires, équipe et prestations, et prépare vos QR codes et vos affiches. Ils sont facturés une seule fois, à l’activation. Si vous activez pendant l’essai, celui-ci continue : le premier mois n’est prélevé qu’à sa fin.',
  },
  {
    q: 'Les paie-t-on à nouveau si l’on revient ?',
    a: 'Non. L’installation se règle une fois pour toutes, au premier abonnement de votre commerce. Si vous résiliez puis revenez, vous ne la payez pas une deuxième fois.',
  },
  {
    q: 'Faut-il une carte bancaire pour l’essai ?',
    a: 'Non. L’essai démarre dès la création de votre file, sans moyen de paiement. Vous ne payez rien avant de souscrire l’abonnement.',
  },
  {
    q: 'Les prix sont-ils hors taxes ?',
    a: 'Oui. Tous les prix affichés sur Rangvia sont hors taxes ; la TVA s’y ajoute.',
  },
  {
    q: 'Dois-je commander des plaques ?',
    a: 'Non. Un QR imprimé suffit pour démarrer. Si vous voulez des plaques NFC gravées, vous pouvez en faire la demande depuis votre espace : nous revenons vers vous avec un devis avant toute production.',
  },
  {
    q: 'Puis-je résilier à tout moment ?',
    a: 'Oui, depuis votre espace. La résiliation prend effet à la fin de la période en cours, et vos données restent accessibles jusqu’à cette date.',
  },
  {
    q: 'Mes données m’appartiennent-elles ?',
    a: 'Oui. Vous choisissez la durée de conservation ; au-delà, les prénoms de vos clients sont effacés automatiquement.',
  },
] as const;

export default async function PricingPage() {
  // Les mêmes colonnes que les pages métier (PUBLIC_PLAN_COLUMNS), passées
  // au même filtre : une ligne douteuse ne s'affiche nulle part, et la
  // base injoignable n'affiche aucun prix plutôt qu'un prix faux.
  const { data, error } = await supabaseAdmin()
    .from('plans')
    .select(PUBLIC_PLAN_COLUMNS.join(', '))
    .eq('is_active', true).eq('is_public', true).order('sort_order');
  const plan = error ? null : mainPlan(parsePublicPlans(data));

  return (
    <main id="contenu" className={styles.pricing}>
      <header className={`shell ${styles.intro} ${own.intro}`}>
        <p className="t-label">Tarifs</p>
        <h1 className={`t-hero ${styles.introTitle}`}>Une offre, tout compris.</h1>
        <p className={`t-lead ${styles.introLead}`}>
          L’équipe Rangvia installe votre file et la règle pour votre métier. Ensuite, un seul
          abonnement&nbsp;: {APP_CLIP ? 'l’App Clip iPhone, ' : ''}le QR code, l’URL NFC, les notifications
          et toute votre équipe.
        </p>
        {/* Maillage : le même prix pour tous, et une page par métier pour
            voir ce que la file devient chez soi. */}
        <p className={styles.introLead}>
          <Link href="/pour" className="btn btn--ghost btn--sm">Voir par métier</Link>
        </p>
      </header>

      <section className="shell" aria-label="L’offre Rangvia">
        <PricingBoard plan={plan} appClip={APP_CLIP} />
      </section>

      <section className={`shell ${styles.split} ${own.questions}`} aria-labelledby="questions">
        <div className={styles.splitHead}>
          <p className="t-kicker"><span className="t-kicker__num">03</span> Avant de vous lancer</p>
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
              Essayez votre file dès aujourd’hui, sans carte bancaire. Quand vous activez
              l’abonnement, l’équipe Rangvia l’installe pour votre métier.
            </p>
            <div className={styles.finalActions}>
              <Link href="/inscription" className="btn btn--signal btn--lg">Ouvrir ma file</Link>
              <p className="t-small t-muted">Sans engagement, résiliable à tout moment.</p>
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
