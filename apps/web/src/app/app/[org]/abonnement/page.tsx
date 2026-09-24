import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripeConfigured } from '@/server/stripe';
import { PageHeader } from '@/components/Page';
import { FlapText } from '@/components/FlapNumber';
import { formatDate, formatPrice, formatNumber } from '@/lib/format';
import { appClipPublished } from '@/lib/seo/site';
import {
  PUBLIC_PLAN_COLUMNS,
  SETUP_STEPS,
  SETUP_TITLE,
  historyDuration,
  mainPlan,
  parsePublicPlans,
  planAllowances,
} from '@/lib/public-plans';
import { BillingActions } from './BillingActions';
import { TrialFlap } from './TrialFlap';
import styles from './billing.module.css';

export const metadata: Metadata = { title: 'Abonnement', robots: { index: false } };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  trialing: 'Période d’essai',
  active: 'Actif',
  past_due: 'Paiement en retard',
  canceled: 'Résilié',
  incomplete: 'En attente de paiement',
  paused: 'En pause',
};

/** Un abonnement Stripe encore vivant : on n'en propose pas un second (startCheckout le refuse aussi). */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused']);

interface PlanRow {
  code: string; name: string; tagline: string | null;
  max_locations: number; max_staff: number; max_plates: number; max_queues: number;
  history_days: number; price_month_cents: number; currency: string;
}

/**
 * ABONNEMENT.
 *
 * Une seule offre depuis 0043 : aucun choix de pack. La page dit
 *  - l'offre en cours (une ligne de tableau des départs, prix en volet),
 *    l'essai, le renouvellement, et où en sont les frais d'installation :
 *    réglés (date posée par le webhook Stripe) ou dus une fois, avec le
 *    premier mois ;
 *  - la consommation (jauges-rails : remplissage en scaleX, cuivre à 100 %) ;
 *  - tant qu'aucun abonnement Stripe n'est vivant : ce que l'on réglera à
 *    l'activation, ligne à ligne, le total, et le bouton qui ouvre le
 *    paiement. Les montants viennent de l'offre en base : jamais écrits ici ;
 *  - les factures (portail Stripe).
 *
 * ESSAI EN COURS : activer ne le raccourcit pas. startCheckout transmet
 * la fin d'essai à Stripe : l'installation est réglée à l'activation, le
 * premier mois à la fin de l'essai. La page le dit ligne à ligne
 * (« Aujourd'hui », puis la date du premier mois), jamais un total qui
 * laisserait croire que le mois part tout de suite.
 *
 * Les jours d'essai restants sont comptés dans le navigateur, après
 * montage (TrialFlap). Ici, on sait seulement si l'essai court encore
 * (page dynamique, rendue à chaque requête).
 */
export default async function BillingPage({
  params, searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ paiement?: string }>;
}) {
  const { org } = await params;
  const { paiement } = await searchParams;
  // Ouverte aussi à une organisation suspendue : c'est ici qu'elle règle
  // son abonnement ou écrit au support pour rétablir l'accès.
  const access = await requireOrgAccess(org, undefined, { allowSuspended: true });
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();

  const [{ data: subscription }, { data: offers }, counts] = await Promise.all([
    db.from('subscriptions')
      .select('status, billing_interval, current_period_end, trial_ends_at, cancel_at_period_end, stripe_subscription_id, setup_fee_paid_at, plans(*)')
      .eq('organization_id', organizationId).maybeSingle(),
    // L'offre publique, lue comme /tarifs et les pages métier : mêmes
    // colonnes, même filtre, la première dans l'ordre d'affichage.
    db.from('plans').select(PUBLIC_PLAN_COLUMNS.join(', '))
      .eq('is_active', true).eq('is_public', true).order('sort_order'),
    (async () => {
      const [locations, staff, plates, queues] = await Promise.all([
        db.from('locations').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
        db.from('staff').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('is_active', true),
        db.from('plates').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('is_active', true),
        db.from('queues').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
      ]);
      return {
        locations: locations.count ?? 0, staff: staff.count ?? 0,
        plates: plates.count ?? 0, queues: queues.count ?? 0,
      };
    })(),
  ]);

  const planRaw = subscription?.plans;
  const plan = (Array.isArray(planRaw) ? planRaw[0] : planRaw) as PlanRow | undefined;
  const offer = mainPlan(parsePublicPlans(offers));

  const billingEnabled = stripeConfigured();
  const canManage = access.can('billing.manage');
  const status: string = subscription?.status ?? '';
  const statusChip =
    status === 'active' ? 'chip chip--jade'
    : status === 'past_due' ? 'chip chip--brique'
    : 'chip chip--copper';

  const liveStripe = Boolean(subscription?.stripe_subscription_id) && LIVE_STATUSES.has(status);
  const setupPaidAt: string | null = subscription?.setup_fee_paid_at ?? null;
  // Les frais d'installation se règlent une fois, au premier abonnement :
  // dus tant que le webhook n'a pas horodaté leur paiement (même règle que
  // startCheckout).
  const setupDue = Boolean(offer && offer.setup_fee_cents > 0 && !setupPaidAt);
  // Ancienne offre retirée du catalogue, gardée par un abonnement payé.
  const legacy = Boolean(plan && offer && plan.code !== offer.code && liveStripe);
  // Même règle que startCheckout : un essai qui court encore est conservé.
  const trialEndsAt: string | null = subscription?.trial_ends_at ?? null;
  const trialOngoing = status === 'trialing' && trialEndsAt !== null && Date.parse(trialEndsAt) > Date.now();
  const dueToday = offer
    ? (setupDue ? offer.setup_fee_cents : 0) + (trialOngoing ? 0 : offer.price_month_cents)
    : 0;
  const included = appClipPublished()
    ? 'App Clip iPhone, QR, NFC et notifications inclus'
    : 'QR, NFC et notifications inclus';

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Abonnement"
        description="Votre offre, ce qu’elle autorise, et où vous en êtes."
      />

      {paiement === 'ok' && (
        <div className="banner">
          <span className="pip pip--live" />
          <span>Paiement enregistré. Votre abonnement se met à jour dès confirmation par Stripe.</span>
        </div>
      )}
      {paiement === 'annule' && (
        <div className="banner banner--warn">
          <span>Paiement annulé. Rien n’a été prélevé, votre période en cours continue.</span>
        </div>
      )}

      {/* ---------------- Offre en cours ---------------- */}
      <section className={styles.block} aria-labelledby="offre-en-cours">
        <h2 id="offre-en-cours" className={`t-label ${styles.head}`}>Offre en cours</h2>
        <ol className={`rail-list board ${styles.board}`}>
          <li className="is-self">
            <div className={styles.key}>
              <span className="t-board">{plan?.name ?? 'Aucune offre'}</span>
              {status && <span className={statusChip}>{STATUS_LABEL[status] ?? status}</span>}
            </div>
            <div className={styles.planText}>
              <p className={styles.text}>{plan?.tagline ?? 'L’offre Rangvia, tout compris.'}</p>
              {legacy && (
                <p className={styles.included}>
                  Offre retirée du catalogue, maintenue telle quelle pour votre abonnement.
                </p>
              )}
            </div>
            {plan && (
              <p className={styles.price}>
                <FlapText static text={formatPrice(plan.price_month_cents, plan.currency)} size="2rem" />
                <span className={styles.per}>/ mois HT</span>
              </p>
            )}
          </li>

          {status === 'trialing' && subscription?.trial_ends_at && (
            <li>
              <span className={`t-board ${styles.keyMuted}`}>Essai</span>
              <p className={styles.text}>
                Jusqu’au <strong className="t-num">{formatDate(subscription.trial_ends_at)}</strong>.{' '}
                {liveStripe
                  ? 'Votre abonnement est activé : le premier mois sera prélevé à la fin de l’essai.'
                  : 'Aucun moyen de paiement n’est requis avant cette date.'}
              </p>
              <TrialFlap endsAt={subscription.trial_ends_at} />
            </li>
          )}

          {subscription?.current_period_end && status === 'active' && (
            <li>
              <span className={`t-board ${styles.keyMuted}`}>
                {subscription.cancel_at_period_end ? 'Fin' : 'Renouvellement'}
              </span>
              <p className={styles.text}>
                {subscription.cancel_at_period_end ? 'Votre offre prend fin le ' : 'Prochain renouvellement le '}
                <strong className="t-num">{formatDate(subscription.current_period_end)}</strong>.
              </p>
              <span />
            </li>
          )}

          {setupPaidAt && (
            <li>
              <div className={styles.key}>
                <span className={`t-board ${styles.keyMuted}`}>Installation</span>
                <span className="chip chip--jade">Réglée</span>
              </div>
              <p className={styles.text}>
                Réglée le <strong className="t-num">{formatDate(setupPaidAt)}</strong>. Elle ne vous sera plus
                facturée, même si vous résiliez puis revenez.
              </p>
              <span />
            </li>
          )}
        </ol>
      </section>

      {!billingEnabled && (
        <div className="banner banner--warn">
          <span>
            {access.user.isPlatformAdmin
              ? 'Stripe n’est pas configuré sur cette installation : toutes les organisations fonctionnent en période d’essai. Voir SETUP.md, section Stripe, pour activer la facturation.'
              : 'La facturation en ligne n’est pas encore activée : votre période d’essai continue, sans rien à payer.'}
          </span>
        </div>
      )}

      {/* ---------------- Consommation ---------------- */}
      {plan && (
        <section className={styles.block} aria-labelledby="consommation">
          <div>
            <h2 id="consommation" className={`t-label ${styles.head}`}>Votre consommation</h2>
            <p className={styles.desc}>Comptée en direct sur votre organisation ; une jauge cuivre signale une limite atteinte.</p>
          </div>
          <ol className={`rail-list ${styles.usage}`}>
            <UsageRow label="Établissements" used={counts.locations} limit={plan.max_locations} index={0} />
            <UsageRow label="Professionnels" used={counts.staff} limit={plan.max_staff} index={1} />
            <UsageRow label="Plaques actives" used={counts.plates} limit={plan.max_plates} index={2} />
            <UsageRow label="Files" used={counts.queues} limit={plan.max_queues} index={3} />
            <li className={styles.usageRow}>
              <span className={styles.usageLabel}>Historique conservé</span>
              <span className={`t-num ${styles.usageValue}`}>{historyDuration(plan.history_days)}</span>
            </li>
          </ol>
        </section>
      )}

      {/* ---------------- Activation : une offre, un total ---------------- */}
      {offer && !liveStripe && (
        <section className={styles.block} aria-labelledby="activer">
          <div>
            <h2 id="activer" className={`t-label ${styles.head}`}>Activer l’abonnement</h2>
            <p className={styles.desc}>
              Une seule offre, rien à choisir. Voici, ligne à ligne, ce que vous réglerez à l’activation.
            </p>
          </div>
          <ol className={`rail-list board ${styles.board} ${styles.bill}`}>
            <li>
              <span className="t-board">Abonnement</span>
              <div className={styles.planText}>
                <p className={styles.limits}>{planAllowances(offer).join(' · ')}</p>
                <p className={styles.included}>{included}</p>
                {trialOngoing && trialEndsAt && (
                  <p className={styles.included}>
                    Premier mois prélevé à la fin de votre essai, le{' '}
                    <strong className={`t-num ${styles.date}`}>{formatDate(trialEndsAt)}</strong>.
                  </p>
                )}
              </div>
              <p className={styles.price}>
                <FlapText static text={formatPrice(offer.price_month_cents, offer.currency)} size="2rem" />
                <span className={styles.per}>/ mois HT</span>
              </p>
            </li>
            {setupDue && (
              <li>
                <span className="t-board">Installation</span>
                <div className={styles.planText}>
                  <p className={styles.limits}>{SETUP_TITLE}.</p>
                  {/* En colonne, chaque étape sur sa latte : aucun séparateur
                      qui pendrait en fin de ligne au téléphone. */}
                  <ul className={styles.steps}>
                    {SETUP_STEPS.map((step) => <li key={step.key}>{step.key}</li>)}
                  </ul>
                </div>
                <p className={styles.price}>
                  <FlapText static text={formatPrice(offer.setup_fee_cents, offer.currency)} size="2rem" />
                  <span className={styles.per}>HT, une fois</span>
                </p>
              </li>
            )}
            <li className={`is-self ${styles.total}`}>
              <span className="t-board">{trialOngoing ? 'Aujourd’hui' : 'Premier paiement'}</span>
              <p className={styles.text}>
                {trialOngoing && trialEndsAt ? (
                  <>
                    {setupDue ? 'L’installation seule. ' : 'Rien à régler aujourd’hui. '}
                    Votre essai continue&#8239;: {formatPrice(offer.price_month_cents, offer.currency)}&nbsp;HT par mois
                    à partir du <strong className={`t-num ${styles.date}`}>{formatDate(trialEndsAt)}</strong>.
                  </>
                ) : setupDue
                  ? 'Le premier mois et l’installation, sur une seule facture. Ensuite, l’abonnement seul, chaque mois.'
                  : 'Le premier mois. Ensuite, le même montant chaque mois.'}
                {' '}Montants hors taxes, TVA en sus.
              </p>
              <div className={styles.planAside}>
                <p className={styles.price}>
                  <FlapText static text={formatPrice(dueToday, offer.currency)} size="2rem" />
                  <span className={styles.per}>HT</span>
                </p>
                {canManage && billingEnabled && (
                  <BillingActions
                    organizationId={organizationId}
                    planCode={offer.code}
                    hasSubscription={false}
                    billingEnabled={billingEnabled}
                    variant="choose"
                    label="Activer mon abonnement"
                  />
                )}
              </div>
            </li>
          </ol>
        </section>
      )}

      {/* ---------------- Factures ---------------- */}
      {canManage && (
        <section className={styles.block} aria-labelledby="factures">
          <h2 id="factures" className={`t-label ${styles.head}`}>Paiement et factures</h2>
          <ol className={`rail-list board ${styles.board}`}>
            <li>
              <span className={`t-board ${styles.keyMuted}`}>Factures</span>
              <p className={styles.text}>
                Vos factures et votre moyen de paiement sont conservés par Stripe, dans un espace
                sécurisé : téléchargement, historique et changement de carte.
              </p>
              <div className={styles.planAside}>
                <BillingActions
                  organizationId={organizationId}
                  hasSubscription={Boolean(subscription?.stripe_subscription_id)}
                  billingEnabled={billingEnabled}
                />
              </div>
            </li>
          </ol>
        </section>
      )}
    </div>
  );
}

/** Jauge-rail : piste de 2 px, remplissage en scaleX, cuivre à 100 %. */
function UsageRow({ label, used, limit, index }: { label: string; used: number; limit: number; index: number }) {
  const unlimited = limit < 0;
  const ratio = unlimited ? 0 : Math.min(used / Math.max(limit, 1), 1);
  const full = !unlimited && used >= limit && limit > 0;
  const ticks = !unlimited && limit > 1 && limit <= 24 ? limit : 0;
  return (
    <li className={styles.usageRow} data-full={full ? '1' : undefined}>
      <span className={styles.usageLabel}>{label}</span>
      <span className={`t-num ${styles.usageValue}`}>
        {unlimited
          ? <>{formatNumber(used)} <span className={styles.usageOf}>· illimité</span></>
          : <>{formatNumber(used)} <span className={styles.usageOf}>/ {formatNumber(limit)}</span></>}
      </span>
      <span
        className={styles.gauge}
        data-unlimited={unlimited ? '1' : undefined}
        role={unlimited ? undefined : 'meter'}
        aria-label={unlimited ? undefined : label}
        aria-valuemin={unlimited ? undefined : 0}
        aria-valuemax={unlimited ? undefined : limit}
        aria-valuenow={unlimited ? undefined : Math.min(used, limit)}
        aria-hidden={unlimited ? true : undefined}
      >
        {ticks > 0 && (
          <span className={styles.ticks} aria-hidden="true">
            {Array.from({ length: ticks - 1 }, (_, i) => (
              <i key={i} style={{ left: `${((i + 1) / ticks) * 100}%` }} />
            ))}
          </span>
        )}
        {!unlimited && (
          <span
            className={styles.fill}
            style={{ transform: `scaleX(${ratio.toFixed(4)})`, ['--i' as string]: index } as React.CSSProperties}
          />
        )}
      </span>
    </li>
  );
}
