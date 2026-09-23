'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FlapText } from '@/components/FlapNumber';
import styles from '../../marketing.module.css';

/**
 * Tableau des offres : une ligne par offre, accrochée au rail (jamais des
 * cartes). La bascule Mensuel / Annuel fait TOMBER les prix (volet à
 * palettes) ; le texte lu par les lecteurs d'écran est le prix complet.
 */

export interface PublicPlan {
  code: string;
  name: string;
  description: string | null;
  price_month_cents: number;
  price_year_cents: number;
  currency: string;
  trial_days: number;
  max_locations: number;
  max_staff: number;
  max_plates: number;
  max_queues: number;
  history_days: number;
}

type Period = 'month' | 'year';

/** Mois offerts par l'annuel, calculés d'après les prix (jamais écrits en dur). */
export function monthsOffered(plan: Pick<PublicPlan, 'price_month_cents' | 'price_year_cents'>): number {
  const { price_month_cents: m, price_year_cents: y } = plan;
  if (!(m > 0) || !(y > 0)) return 0;
  const n = Math.floor(12 - y / m + 1e-9);
  return n >= 1 ? n : 0;
}

function priceParts(cents: number, currency: string) {
  const digits = cents % 100 === 0 ? 0 : 2;
  const parts = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).formatToParts(cents / 100);
  // Un tableau à palettes ne groupe pas les milliers : « 1290 », pas « 1 290 ».
  const amount = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(cents / 100);
  const symbol = parts.find((p) => p.type === 'currency')?.value ?? currency;
  const full = parts.map((p) => p.value).join('').replace(/\s+/g, '\u00a0').trim();
  return { amount, symbol, full };
}

function limits(plan: PublicPlan): string[] {
  const n = (v: number, one: string, many: string, unlimited: string) =>
    v < 0 ? unlimited : `${v} ${v > 1 ? many : one}`;
  return [
    n(plan.max_locations, 'établissement', 'établissements', 'Établissements illimités'),
    n(plan.max_staff, 'professionnel', 'professionnels', 'Professionnels illimités'),
    n(plan.max_plates, 'plaque NFC / QR', 'plaques NFC / QR', 'Plaques illimitées'),
    n(plan.max_queues, 'file', 'files', 'Files illimitées'),
    `${plan.history_days} jour${plan.history_days > 1 ? 's' : ''} d'historique`,
  ];
}

export function PricingBoard({ plans }: { plans: PublicPlan[] }) {
  const [period, setPeriod] = useState<Period>('month');

  const bestOffer = Math.max(0, ...plans.map(monthsOffered));

  return (
    <div className={styles.board}>
      <div className={styles.boardBar}>
        <div className="seg" role="group" aria-label="Période de facturation">
          <button type="button" aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>
            Mensuel
          </button>
          <button type="button" aria-pressed={period === 'year'} onClick={() => setPeriod('year')}>
            Annuel
          </button>
        </div>
        {bestOffer >= 1 && (
          <p className={styles.boardNote}>
            À l&apos;année : jusqu&apos;à {bestOffer} mois offert{bestOffer > 1 ? 's' : ''}
          </p>
        )}
      </div>

      <ol className={`rail-list ${styles.plans}`}>
        {plans.map((plan, index) => {
          const featured = index === 1;
          const cents = period === 'month' ? plan.price_month_cents : plan.price_year_cents;
          const price = priceParts(cents, plan.currency);
          const yearly = priceParts(plan.price_year_cents, plan.currency);
          const offered = monthsOffered(plan);
          // Une ligne garde le même nombre de cases pour les deux périodes :
          // le prix ne change pas de largeur quand il tombe (19 → 190 : la
          // case vide de gauche reçoit le chiffre des centaines).
          const cells = Math.max(
            priceParts(plan.price_month_cents, plan.currency).amount.length,
            yearly.amount.length,
          );
          const unit = period === 'month' ? '/mois HT' : '/an HT';
          const spoken = `${price.full} ${period === 'month' ? 'par mois' : 'par an'}, hors taxes`;
          return (
            <li key={plan.code} className={`${styles.plan} ${featured ? `is-self ${styles.planFeatured}` : ''}`}>
              <div className={styles.planHead}>
                <h2 className={styles.planName}>
                  <span className="t-board">{plan.name}</span>
                  {featured && <span className={`chip chip--signal ${styles.planChip}`}>Le plus choisi</span>}
                </h2>
                <p className={styles.price}>
                  <FlapText
                    static
                    fixed
                    tile
                    text={price.amount.padStart(cells, ' ')}
                    label={spoken}
                    size="2.5rem"
                    stagger={36}
                  />
                  <span className={styles.priceUnit} aria-hidden="true">
                    <span className={styles.priceSymbol}>{price.symbol}</span>
                    <span className={styles.pricePer}>{unit}</span>
                  </span>
                </p>
                <p className={styles.priceNote}>
                  {period === 'year' ? (
                    offered >= 1 ? (
                      <span className={styles.offered}>soit {offered} mois offert{offered > 1 ? 's' : ''}</span>
                    ) : (
                      <span>Facturé une fois par an</span>
                    )
                  ) : plan.price_year_cents > 0 ? (
                    <span>ou {yearly.full} par an</span>
                  ) : (
                    <span>Sans engagement</span>
                  )}
                </p>
              </div>

              <div className={styles.planBody}>
                {plan.description && <p className={styles.planDesc}>{plan.description}</p>}
                <ul className={styles.limits}>
                  {limits(plan).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className={styles.planAction}>
                <Link
                  href="/inscription"
                  className={featured ? 'btn btn--signal' : 'btn btn--ghost'}
                >
                  {plan.trial_days} jours d&apos;essai
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
