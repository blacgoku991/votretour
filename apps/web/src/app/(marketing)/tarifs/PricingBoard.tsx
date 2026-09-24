import Link from 'next/link';
import { FlapNumber, FlapText } from '@/components/FlapNumber';
import {
  FREE_PRICE_LABEL,
  SETUP_STEPS,
  SETUP_TITLE,
  formatPlanPrice,
  planAllowances,
  type PublicPlanOffer,
} from '@/lib/public-plans';
import styles from './tarifs.module.css';

/**
 * L'OFFRE UNIQUE (0043) : 59,90 € HT par mois, plus 149 € HT
 * d'installation, une fois. Plus de packs, plus de bascule mensuel/annuel,
 * plus de « le plus choisi » : une seule ligne au départ, en tête de file.
 *
 * Deux colonnes :
 *  - le TICKET : le prix en volets (les tuiles du tableau des départs),
 *    la latte des frais d'installation, l'appel à l'essai ;
 *  - le DÉTAIL : ce que comprend l'installation (SETUP_STEPS, la même
 *    promesse que les pages métier et l'espace Abonnement), puis ce que
 *    comprend l'abonnement, tiré des quotas RÉELS de l'offre.
 *
 * Composant serveur : aucun JavaScript propre (les volets sont statiques,
 * rendus au serveur). Chaque prix est lu en toutes lettres par les
 * lecteurs d'écran (« 59,90 € par mois, hors taxes »), une seule fois.
 */

/** Toujours inclus, sans supplément : ce que l'abonnement ne facture jamais à l'unité. */
function included(appClip: boolean) {
  return [
    {
      key: 'Aucun SMS',
      text: appClip
        ? 'Les notifications passent par l’App Clip iPhone ou le navigateur : rien à payer à l’unité.'
        : 'Les notifications passent par le navigateur du téléphone : rien à payer à l’unité.',
    },
    {
      key: 'Aucune application',
      text: 'Pour vos clients : ni compte, ni mot de passe, ni e‑mail obligatoire.',
    },
    {
      key: 'Le temps réel',
      text: 'Les positions se mettent à jour toutes seules, sur tous les écrans.',
    },
  ] as const;
}

/**
 * Montant découpé pour les tuiles : les euros par groupes de milliers
 * (« 1 290 » → deux groupes), les centimes à part (« 90 », ou `null`
 * pour un montant rond), et le texte complet (« 59,90 € »).
 */
export function priceParts(cents: number, currency: string) {
  const units = Math.floor(cents / 100);
  const rest = cents % 100;
  const groups = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
    .format(units).split(/\s+/).filter(Boolean);
  const symbol = new Intl.NumberFormat('fr-FR', { style: 'currency', currency })
    .formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  return {
    groups,
    decimals: rest === 0 ? null : String(rest).padStart(2, '0'),
    symbol,
    full: formatPlanPrice(cents, currency),
  };
}

/** Des tuiles de chiffres, décoratives : le prix est lu une fois, en toutes lettres, par l'appelant. */
function Tiles({ digits, first }: { digits: string; first: boolean }) {
  return <FlapNumber static tile value={Number(digits)} pad={first ? 1 : digits.length} label="" size="1em" />;
}

/**
 * Le prix en volets, comme sur un tableau des départs : les euros en
 * grandes tuiles (un groupe par tranche de milliers), les centimes en
 * petites tuiles hissées en exposant, l'unité dessous. Un seul texte lu.
 */
function PriceTiles({ cents, currency, spoken, unit }: {
  cents: number; currency: string; spoken: string; unit: string;
}) {
  const { groups, decimals, symbol } = priceParts(cents, currency);
  return (
    <p className={styles.price}>
      <span className="sr-only">{spoken}</span>
      <span className={styles.priceTiles} aria-hidden="true">
        {groups.map((group, i) => <Tiles key={`g${groups.length - 1 - i}`} digits={group} first={i === 0} />)}
      </span>
      <span className={styles.priceSide} aria-hidden="true">
        {decimals && (
          <span className={styles.priceCents}>
            <span className={styles.priceComma}>,</span>
            <FlapText static fixed tile text={decimals} label="" size="1em" />
          </span>
        )}
        <span className={styles.priceUnit}>
          <span className={styles.priceSymbol}>{symbol}</span>
          <span className={styles.pricePer}>{unit}</span>
        </span>
      </span>
    </p>
  );
}

export function PricingBoard({ plan, appClip }: { plan: PublicPlanOffer | null; appClip: boolean }) {
  // Base injoignable ou aucune offre publique : jamais de prix inventé.
  if (!plan) {
    return (
      <div className={styles.empty}>
        <p className="t-board">Tarifs momentanément indisponibles</p>
        <p className="t-small t-muted">
          Les prix n’ont pas pu être lus. Réessayez dans un instant, ou créez votre file&nbsp;: l’essai ne demande
          aucun moyen de paiement.
        </p>
      </div>
    );
  }

  const monthly = priceParts(plan.price_month_cents, plan.currency);
  const free = formatPlanPrice(plan.price_month_cents, plan.currency) === FREE_PRICE_LABEL;
  const setup = plan.setup_fee_cents > 0 ? priceParts(plan.setup_fee_cents, plan.currency) : null;
  const allowances = planAllowances(plan);
  const trial = plan.trial_days;

  return (
    <div className={styles.offer}>
      {/* ------------------------------------------------ Le ticket */}
      <div className={styles.ticket}>
        <p className={styles.ticketHead}>
          <span className="t-label">L’offre</span>
          <span className={`t-board ${styles.ticketName}`}>{plan.name}</span>
        </p>

        {free ? (
          <p className={styles.price}>
            <span className={styles.priceFree}>{FREE_PRICE_LABEL}</span>
          </p>
        ) : (
          <PriceTiles
            cents={plan.price_month_cents}
            currency={plan.currency}
            spoken={`${monthly.full} par mois, hors taxes`}
            unit="/mois HT"
          />
        )}

        {setup && (
          <p className={styles.setup}>
            <span className={styles.setupPlus} aria-hidden="true">+</span>
            <span className="sr-only">{`plus ${setup.full} hors taxes de frais d’installation, payés une fois`}</span>
            <span className={styles.setupTiles} aria-hidden="true">
              {setup.groups.map((group, i) => (
                <Tiles key={`g${setup.groups.length - 1 - i}`} digits={group} first={i === 0} />
              ))}
              {setup.decimals && <FlapText static fixed tile text={`,${setup.decimals}`} label="" size="1em" />}
            </span>
            <span className={styles.setupText} aria-hidden="true">
              <span className={styles.setupAmount}>{setup.symbol}&nbsp;HT d’installation</span>
              <span className={styles.setupOnce}>une fois, avec le premier mois</span>
            </span>
          </p>
        )}

        <div className={styles.ticketActions}>
          <Link href="/inscription" className="btn btn--signal btn--lg">
            {trial > 0 ? `Essayer ${trial} jours` : 'Ouvrir ma file'}
          </Link>
          <ul className={styles.terms}>
            {trial > 0 && <li>Essai sans carte bancaire</li>}
            <li>Sans engagement</li>
            <li>Résiliable à tout moment</li>
          </ul>
        </div>
      </div>

      {/* ------------------------------------------------ Le détail */}
      <div className={styles.detail}>
        {setup && (
          <section className={styles.group} aria-labelledby="installation">
            <header className={styles.groupHead}>
              <h2 id="installation" className={styles.groupTitle}>
                <span className="t-kicker__num" aria-hidden="true">01</span>
                <span className="t-board">L’installation</span>
              </h2>
              <p className={styles.groupPrice}>{setup.full}&nbsp;HT, une fois</p>
            </header>
            <p className={styles.groupLead}>{SETUP_TITLE}.</p>
            <ol className={`rail-list ${styles.steps}`}>
              {SETUP_STEPS.map((step, i) => (
                <li key={step.key} style={{ ['--i' as string]: i } as React.CSSProperties}>
                  <span className={styles.stepKey}>{step.key}</span>
                  <span className={styles.stepText}>{step.text}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className={styles.group} aria-labelledby="abonnement">
          <header className={styles.groupHead}>
            <h2 id="abonnement" className={styles.groupTitle}>
              <span className="t-kicker__num" aria-hidden="true">{setup ? '02' : '01'}</span>
              <span className="t-board">L’abonnement</span>
            </h2>
            <p className={styles.groupPrice}>
              {free ? FREE_PRICE_LABEL : <>{monthly.full}&nbsp;HT par mois</>}
            </p>
          </header>
          <p className={styles.groupLead}>Tout compris, pour toute votre équipe.</p>
          <ul className={`rail-list ${styles.steps}`}>
            {allowances.map((line, i) => (
              <li key={line} className={styles.allowance} style={{ ['--i' as string]: i + 3 } as React.CSSProperties}>
                <span className={styles.stepKey}>{line}</span>
              </li>
            ))}
            {included(appClip).map((item, i) => (
              <li key={item.key} style={{ ['--i' as string]: i + 3 + allowances.length } as React.CSSProperties}>
                <span className={styles.stepKey}>{item.key}</span>
                <span className={styles.stepText}>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
