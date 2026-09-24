import Link from 'next/link';
import {
  FREE_PRICE_LABEL,
  SETUP_TITLE,
  cheapestPlan,
  formatPlanPrice,
  mainPlan,
  monthlyPriceLabel,
  planAllowances,
  type PublicPlanOffer,
} from '@/lib/public-plans';
import { MoreLink, Section } from './parts';
import styles from './metiers.module.css';

/**
 * 8. L'OFFRE — lue en base (clé anon, cache « plans »), jamais inventée.
 *
 * Depuis 0043, Rangvia se vend en UNE offre : un abonnement mensuel et des
 * frais d'installation payés une fois. Le bandeau montre donc deux lignes
 * au tableau des départs — l'abonnement (en tête, l'encoche vermillon),
 * puis l'installation — et un seul appel à l'essai. Pas de grille de
 * packs, pas de « le plus choisi ».
 *
 *  - `null` (base injoignable au build ou à la régénération) : aucun prix,
 *    seulement le lien vers /tarifs ;
 *  - une offre à 0 € s'écrit « Gratuit », seul : jamais « dès Gratuit
 *    HT/mois » ni « Gratuit /mois HT » ;
 *  - l'offre affichée est la première offre publique (`mainPlan`) : la
 *    même que /tarifs.
 */

/**
 * « dès 19 € HT/mois » quand plusieurs offres sont publiques, « 59,90 €
 * HT/mois » quand il n'y en a qu'une (le cas depuis 0043), « Gratuit » si
 * l'offre concernée l'est.
 */
export function startingPrice(plans: readonly PublicPlanOffer[]): string | null {
  if (plans.length === 1) return monthlyPriceLabel(plans[0]!);
  const cheapest = cheapestPlan(plans);
  if (!cheapest) return null;
  const price = formatPlanPrice(cheapest.price_month_cents, cheapest.currency);
  return price === FREE_PRICE_LABEL ? FREE_PRICE_LABEL : `dès ${price} HT/mois`;
}

export function PlansStrip({
  plans,
  ctaHref,
  anchorId,
}: {
  plans: readonly PublicPlanOffer[] | null;
  /** Inscription avec le métier présélectionné (`?activite=`). */
  ctaHref: string;
  anchorId?: string;
}): React.JSX.Element {
  const plan = mainPlan(plans);

  if (!plan) {
    return (
      <Section
        id="offres"
        anchorId={anchorId}
        kicker="Tarifs"
        title="Une offre, tout compris."
        lead="Une installation, puis un seul abonnement. Les prix sont détaillés sur la page Tarifs."
      >
        <div className={styles.plansFoot}>
          <MoreLink href="/tarifs">Voir les tarifs</MoreLink>
        </div>
      </Section>
    );
  }

  const price = formatPlanPrice(plan.price_month_cents, plan.currency);
  const free = price === FREE_PRICE_LABEL;
  const setup = plan.setup_fee_cents > 0 ? formatPlanPrice(plan.setup_fee_cents, plan.currency) : null;

  return (
    <Section
      id="offres"
      anchorId={anchorId}
      kicker={`Tarifs · ${monthlyPriceLabel(plan)}`}
      title="Une offre, tout compris."
      lead={setup
        ? 'Une installation faite pour vous, une fois, puis un seul abonnement pour toute votre équipe.'
        : 'Un seul abonnement, pour toute votre équipe.'}
    >
      <ol className={`rail-list board ${styles.plans}`}>
        <li className="is-self">
          <div className={styles.planHead}>
            <p className="t-board">Abonnement</p>
            <p className={styles.planPrice}>
              <span className={`t-num ${styles.planAmount}`}>{price}</span>
              {!free && <span className="t-micro t-muted">/mois HT</span>}
            </p>
          </div>
          <p className={`t-body t-muted ${styles.planVolumes}`}>
            {/* « · » collé au volume qui le précède : jamais en tête de ligne. */}
            {planAllowances(plan).join(' · ')}
          </p>
        </li>
        {setup && (
          <li>
            <div className={styles.planHead}>
              <p className="t-board">Installation</p>
              <p className={styles.planPrice}>
                <span className={`t-num ${styles.planAmount}`}>{setup}</span>
                <span className="t-micro t-muted">HT, une fois</span>
              </p>
            </div>
            <p className={`t-body t-muted ${styles.planVolumes}`}>
              {SETUP_TITLE}. Réglée une seule fois, avec le premier mois.
            </p>
          </li>
        )}
      </ol>
      <div className={styles.plansFoot}>
        <div className="row wrap g6">
          <Link href={ctaHref} className={`btn btn--signal ${styles.planBtn}`}>
            {plan.trial_days > 0 ? `Essayer ${plan.trial_days} jours` : 'Ouvrir ma file'}
          </Link>
          <MoreLink href="/tarifs">Le détail de l’offre</MoreLink>
        </div>
        <p className="t-micro t-muted">Essai sans carte bancaire. Sans engagement, résiliable à tout moment.</p>
      </div>
    </Section>
  );
}
