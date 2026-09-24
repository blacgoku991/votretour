import Link from 'next/link';
import { FREE_PRICE_LABEL, cheapestPlan, formatPlanPrice, type PublicPlanOffer } from '@/lib/public-plans';
import { MoreLink, Section } from './parts';
import styles from './metiers.module.css';

/**
 * 8. LES OFFRES — lues en base (clé anon, cache « plans »), jamais
 * inventées.
 *
 *  - `null` (base injoignable au build ou à la régénération) : aucun prix,
 *    seulement le lien vers /tarifs ;
 *  - une offre à 0 € s'écrit « Gratuit », seul : jamais « dès Gratuit
 *    HT/mois » ni « Gratuit /mois HT ».
 *
 * Pas de « le plus choisi » : ce serait une statistique que la page ne
 * peut pas prouver.
 */

function volume(n: number, singular: string, plural: string, unlimited: string): string {
  if (n < 0) return unlimited;
  return `${n} ${n > 1 ? plural : singular}`;
}

/** « dès 19 € HT/mois », ou « Gratuit » si l'offre la moins chère l'est. */
export function startingPrice(plans: readonly PublicPlanOffer[]): string | null {
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
  const list = plans ?? [];
  const from = startingPrice(list);

  if (list.length === 0) {
    return (
      <Section
        id="offres"
        anchorId={anchorId}
        kicker="Tarifs"
        title="Des offres simples."
        lead="Tout est inclus dans chaque offre. Les prix sont détaillés sur la page Tarifs."
      >
        <div className={styles.plansFoot}>
          <MoreLink href="/tarifs">Voir les tarifs</MoreLink>
        </div>
      </Section>
    );
  }

  return (
    <Section
      id="offres"
      anchorId={anchorId}
      kicker={from ? `Tarifs · ${from}` : 'Tarifs'}
      title="Des offres simples."
      lead="Tout est inclus. Seuls les volumes changent."
    >
      <ol className={`rail-list board ${styles.plans}`}>
        {list.map((plan) => {
          const price = formatPlanPrice(plan.price_month_cents, plan.currency);
          const free = price === FREE_PRICE_LABEL;
          return (
            <li key={plan.code}>
              <div className={styles.planHead}>
                <p className="t-board">{plan.name}</p>
                <p className={styles.planPrice}>
                  <span className={`t-num ${styles.planAmount}`}>{price}</span>
                  {!free && <span className="t-micro t-muted">/mois HT</span>}
                </p>
              </div>
              <p className={`t-body t-muted ${styles.planVolumes}`}>
                {/* « · » collé au volume qui le précède : jamais en tête de ligne. */}
                {volume(plan.max_locations, 'établissement', 'établissements', 'Établissements illimités')}
                {' · '}
                {volume(plan.max_staff, 'professionnel', 'professionnels', 'Professionnels illimités')}
                {' · '}
                {volume(plan.max_plates, 'plaque', 'plaques', 'Plaques illimitées')}
              </p>
              <Link href={ctaHref} className={`btn btn--ghost ${styles.planBtn}`}>
                {plan.trial_days > 0 ? `Essayer ${plan.trial_days} jours` : 'Commencer'}
                <span className="sr-only">, offre {plan.name}</span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className={styles.plansFoot}>
        <MoreLink href="/tarifs">Comparer les offres en détail</MoreLink>
        <p className="t-micro t-muted">Période d’essai sans carte bancaire. Résiliable à tout moment.</p>
      </div>
    </Section>
  );
}
