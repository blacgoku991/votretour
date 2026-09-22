import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripeConfigured } from '@/server/stripe';
import { PageHeader, Section, SettingRow } from '@/components/Page';
import { formatDate, formatPrice, formatNumber } from '@/lib/format';
import { BillingActions } from './BillingActions';
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

function quota(used: number, limit: number): string {
  return limit < 0 ? `${formatNumber(used)} · illimité` : `${formatNumber(used)} / ${formatNumber(limit)}`;
}

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
  const plan = (Array.isArray(planRaw) ? planRaw[0] : planRaw) as
    | { code: string; name: string; tagline: string | null; max_locations: number; max_staff: number; max_plates: number; max_queues: number; history_days: number; price_month_cents: number; currency: string }
    | undefined;

  const billingEnabled = stripeConfigured();

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
      <Section title="Offre en cours">
        <SettingRow
          label={plan?.name ?? 'Aucune offre'}
          hint={plan?.tagline ?? undefined}
        >
          <span className={
            subscription?.status === 'active' ? 'chip chip--jade'
            : subscription?.status === 'past_due' ? 'chip chip--brique'
            : 'chip chip--copper'
          }>
            {STATUS_LABEL[subscription?.status ?? ''] ?? '—'}
          </span>
        </SettingRow>

        {subscription?.status === 'trialing' && subscription.trial_ends_at && (
          <SettingRow label="Fin de l’essai" hint="Aucun moyen de paiement n’est requis avant cette date.">
            <span className="t-num">{formatDate(subscription.trial_ends_at)}</span>
          </SettingRow>
        )}

        {subscription?.current_period_end && subscription.status === 'active' && (
          <SettingRow
            label={subscription.cancel_at_period_end ? 'Prend fin le' : 'Prochain renouvellement'}
          >
            <span className="t-num">{formatDate(subscription.current_period_end)}</span>
          </SettingRow>
        )}

        {access.can('billing.manage') && (
          <div className={styles.actionsRow}>
            <BillingActions
              organizationId={organizationId}
              hasSubscription={Boolean(subscription?.stripe_subscription_id)}
              billingEnabled={billingEnabled}
            />
          </div>
        )}
      </Section>

      {!billingEnabled && (
        <div className="banner banner--warn">
          <span>
            Stripe n’est pas configuré sur cette installation : toutes les organisations
            fonctionnent en période d’essai. Voir SETUP.md, section Stripe, pour activer
            la facturation.
          </span>
        </div>
      )}

      {/* ---------------- Consommation ---------------- */}
      {plan && (
        <Section title="Votre consommation" description="Ce que votre offre autorise, et où vous en êtes.">
          <SettingRow label="Établissements">
            <UsageBar used={counts.locations} limit={plan.max_locations} />
          </SettingRow>
          <SettingRow label="Professionnels">
            <UsageBar used={counts.staff} limit={plan.max_staff} />
          </SettingRow>
          <SettingRow label="Plaques actives">
            <UsageBar used={counts.plates} limit={plan.max_plates} />
          </SettingRow>
          <SettingRow label="Files">
            <UsageBar used={counts.queues} limit={plan.max_queues} />
          </SettingRow>
          <SettingRow label="Historique conservé">
            <span className="t-num">{plan.history_days} jours</span>
          </SettingRow>
        </Section>
      )}

      {/* ---------------- Offres ---------------- */}
      <Section title="Les offres" description="Changez d’offre à tout moment ; le prorata est géré par Stripe.">
        <div className={styles.plans}>
          {(plans ?? []).map((p) => {
            const current = p.code === plan?.code;
            return (
              <article key={p.id} className={`${styles.plan} ${current ? styles.planCurrent : ''}`}>
                <div className={styles.planHead}>
                  <h3 className="t-section">{p.name}</h3>
                  {current && <span className="chip chip--signal">Actuelle</span>}
                </div>
                <p className={styles.planPrice}>
                  <span className={styles.planAmount}>{formatPrice(p.price_month_cents, p.currency)}</span>
                  <span className="t-micro t-faint"> / mois HT</span>
                </p>
                <p className="t-small t-muted">{p.tagline}</p>
                <ul className={styles.planFeatures}>
                  <li>{p.max_locations < 0 ? 'Établissements illimités' : `${p.max_locations} établissement${p.max_locations > 1 ? 's' : ''}`}</li>
                  <li>{p.max_staff < 0 ? 'Professionnels illimités' : `${p.max_staff} professionnels`}</li>
                  <li>{p.max_plates < 0 ? 'Plaques illimitées' : `${p.max_plates} plaques`}</li>
                  <li>{p.history_days} jours d’historique</li>
                  <li>App Clip iPhone, QR, NFC et avis Google inclus</li>
                </ul>
                {access.can('billing.manage') && !current && billingEnabled && (
                  <BillingActions
                    organizationId={organizationId}
                    planCode={p.code}
                    hasSubscription={Boolean(subscription?.stripe_subscription_id)}
                    billingEnabled={billingEnabled}
                    variant="choose"
                  />
                )}
              </article>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  if (limit < 0) {
    return <span className="t-small t-muted">{formatNumber(used)} · illimité</span>;
  }
  const ratio = Math.min(used / Math.max(limit, 1), 1);
  return (
    <span className={styles.usage}>
      <span className={styles.usageTrack}>
        <span
          className={styles.usageFill}
          style={{
            width: `${ratio * 100}%`,
            // La jauge porte la sévérité : accent, puis alerte, puis danger.
            background: ratio >= 1 ? 'var(--brique-500)'
              : ratio >= 0.8 ? 'var(--copper-500)' : 'var(--accent)',
          }}
        />
      </span>
      <span className={`t-num ${styles.usageLabel}`}>{quota(used, limit)}</span>
    </span>
  );
}
