import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripeConfigured } from '@/server/stripe';
import { PageHeader } from '@/components/Page';
import { FlapText } from '@/components/FlapNumber';
import { formatDate, formatPrice, formatNumber } from '@/lib/format';
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

interface PlanRow {
  id?: string; code: string; name: string; tagline: string | null;
  max_locations: number; max_staff: number; max_plates: number; max_queues: number;
  history_days: number; price_month_cents: number; currency: string;
}

function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/** « 3 établissements · 12 professionnels · plaques illimitées · 180 jours d'historique » */
function limitsOf(p: PlanRow): string {
  const text = [
    p.max_locations < 0 ? 'établissements illimités' : `${p.max_locations} ${plural(p.max_locations, 'établissement', 'établissements')}`,
    p.max_staff < 0 ? 'professionnels illimités' : `${p.max_staff} ${plural(p.max_staff, 'professionnel', 'professionnels')}`,
    p.max_plates < 0 ? 'plaques illimitées' : `${p.max_plates} ${plural(p.max_plates, 'plaque', 'plaques')}`,
    `${p.history_days} jours d’historique`,
  ].join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * ABONNEMENT.
 *
 * L'offre en cours est une ligne de tableau des départs (prix en volet),
 * la consommation des jauges-rails (remplissage en scaleX, cuivre à
 * 100 %), les offres et les factures des listes-rails. Aucune valeur
 * relative à l'heure n'est calculée ici : les jours d'essai restants le
 * sont dans le navigateur, après montage (TrialFlap).
 */
export default async function BillingPage({
  params, searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ paiement?: string }>;
}) {
  const { org } = await params;
  const { paiement } = await searchParams;
  const access = await requireOrgAccess(org);
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();

  const [{ data: subscription }, { data: plans }, counts] = await Promise.all([
    db.from('subscriptions')
      .select('status, billing_interval, current_period_end, trial_ends_at, cancel_at_period_end, stripe_subscription_id, plans(*)')
      .eq('organization_id', organizationId).maybeSingle(),
    db.from('plans').select('*').eq('is_active', true).eq('is_public', true).order('sort_order'),
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

  const billingEnabled = stripeConfigured();
  const canManage = access.can('billing.manage');
  const status = subscription?.status ?? '';
  const statusChip =
    status === 'active' ? 'chip chip--jade'
    : status === 'past_due' ? 'chip chip--brique'
    : 'chip chip--copper';

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Abonnement"
        description="Votre offre, ce qu’elle autorise, et où vous en êtes."
      />

      {paiement === 'ok' && (
        <div className="banner">
          <span className="pip pip--live" />
          <span>Paiement enregistré. Votre offre se met à jour dès confirmation par Stripe.</span>
        </div>
      )}
      {paiement === 'annule' && (
        <div className="banner banner--warn">
          <span>Paiement annulé. Votre offre actuelle reste en place.</span>
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
            <p className={styles.text}>{plan?.tagline ?? 'Choisissez une offre ci-dessous.'}</p>
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
                Jusqu’au <strong className="t-num">{formatDate(subscription.trial_ends_at)}</strong>.
                Aucun moyen de paiement n’est requis avant cette date.
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
        </ol>
      </section>

      {!billingEnabled && (
        <div className="banner banner--warn">
          <span>
            Stripe n’est pas configuré sur cette installation : toutes les organisations
            fonctionnent en période d’essai. Voir SETUP.md, section Stripe, pour activer
            la facturation.
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
              <span className={`t-num ${styles.usageValue}`}>{plan.history_days} jours</span>
            </li>
          </ol>
        </section>
      )}

      {/* ---------------- Offres ---------------- */}
      <section className={styles.block} aria-labelledby="offres">
        <div>
          <h2 id="offres" className={`t-label ${styles.head}`}>Les offres</h2>
          <p className={styles.desc}>Changez d’offre à tout moment ; le prorata est géré par Stripe.</p>
        </div>
        <ol className={`rail-list board ${styles.board}`}>
          {((plans ?? []) as PlanRow[]).map((p) => {
            const current = p.code === plan?.code;
            return (
              <li key={p.id ?? p.code} className={current ? 'is-self' : undefined}>
                <div className={styles.key}>
                  <span className="t-board">{p.name}</span>
                  {current && <span className="chip chip--signal">Actuelle</span>}
                </div>
                <div className={styles.planText}>
                  {p.tagline && <p className={styles.text}>{p.tagline}</p>}
                  <p className={styles.limits}>{limitsOf(p)}</p>
                  <p className={styles.included}>App Clip iPhone, QR, NFC et avis Google inclus</p>
                </div>
                <div className={styles.planAside}>
                  <p className={styles.price}>
                    <FlapText static text={formatPrice(p.price_month_cents, p.currency)} size="2rem" />
                    <span className={styles.per}>/ mois HT</span>
                  </p>
                  {canManage && !current && billingEnabled && (
                    <BillingActions
                      organizationId={organizationId}
                      planCode={p.code}
                      hasSubscription={Boolean(subscription?.stripe_subscription_id)}
                      billingEnabled={billingEnabled}
                      variant="choose"
                      label={`Passer à ${p.name}`}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

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
