import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { stripeConfigured } from '@/server/stripe';
import { Section } from '@/components/Page';
import { formatNumber, formatPrice, formatDate } from '@/lib/format';
import { PlanEditor } from './PlanEditor';
import { AdminHero, AdminStat, AdminStats } from '../AdminKit';
import { ScrollTable } from '../ScrollTable';
import { SUBSCRIPTION_STATUS_LABEL, labelOf } from '../labels';
import { monthlyRecurringCents } from '../revenue';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Offres & abonnements', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
  const db = supabaseAdmin();

  const [{ data: plans }, { data: subscriptions }] = await Promise.all([
    db.from('plans').select('*').order('sort_order'),
    db.from('subscriptions')
      .select('organization_id, status, billing_interval, current_period_end, trial_ends_at, organizations(name), plans(name, code)')
      .order('created_at', { ascending: false }).limit(200),
  ]);

  const rows = subscriptions ?? [];
  const byStatus = rows.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  // Même calcul que le tableau de bord (revenue.ts) : les essais ne
  // comptent pas.
  const mrrCents = monthlyRecurringCents(rows.map((s) => {
    const plan = Array.isArray(s.plans) ? s.plans[0] : s.plans;
    const match = (plans ?? []).find((p) => p.code === plan?.code);
    return {
      status: s.status,
      billing_interval: s.billing_interval,
      priceMonthCents: match?.price_month_cents,
      priceYearCents: match?.price_year_cents,
    };
  }));

  return (
    <div className={`shell ${styles.page}`}>
      <AdminHero
        kicker="FACTURATION"
        title="Offres & abonnements"
        description="Les tarifs et quotas sont modifiables ici : aucun redéploiement n’est nécessaire."
      />

      {!stripeConfigured() && (
        <div className="banner banner--warn">
          <span>
            Stripe n’est pas configuré : les identifiants de tarif ci-dessous ne serviront
            qu’une fois STRIPE_SECRET_KEY renseignée.
          </span>
        </div>
      )}

      <AdminStats>
        <AdminStat
          label="MRR estimé" value={formatPrice(mrrCents)} tone="signal"
          hint="abonnements actifs, annuels ramenés au mois"
        />
        <AdminStat
          label="Abonnements actifs" value={formatNumber(byStatus.active ?? 0)} hint="payants"
          tone={(byStatus.active ?? 0) > 0 ? 'live' : 'default'}
        />
        <AdminStat
          label="En période d’essai" value={formatNumber(byStatus.trialing ?? 0)}
          hint="non comptés dans le MRR"
        />
        <AdminStat
          label="Impayés" value={formatNumber(byStatus.past_due ?? 0)}
          hint={byStatus.past_due ? 'à relancer' : 'aucun'}
          tone={byStatus.past_due ? 'danger' : 'default'}
        />
      </AdminStats>

      <Section title="Offres" description="-1 signifie illimité.">
        {(plans ?? []).map((plan) => (
          <PlanEditor key={plan.id} plan={plan as never} />
        ))}
      </Section>

      <Section title="Abonnements">
        <ScrollTable label="Abonnements">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Organisation</th>
                <th scope="col">Offre</th>
                <th scope="col">État</th>
                <th scope="col">Période</th>
                <th scope="col">Échéance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((subscription) => {
                const org = Array.isArray(subscription.organizations)
                  ? subscription.organizations[0] : subscription.organizations;
                const plan = Array.isArray(subscription.plans)
                  ? subscription.plans[0] : subscription.plans;
                return (
                  <tr key={subscription.organization_id}>
                    <th scope="row" className={styles.orgName}>{org?.name ?? '—'}</th>
                    <td>{plan?.name ?? '—'}</td>
                    <td>
                      <span className={
                        subscription.status === 'active' ? 'chip chip--jade'
                        : subscription.status === 'past_due' ? 'chip chip--brique'
                        : 'chip chip--copper'
                      }>
                        {labelOf(SUBSCRIPTION_STATUS_LABEL, subscription.status)}
                      </span>
                    </td>
                    <td>{subscription.billing_interval === 'year' ? 'Annuel' : 'Mensuel'}</td>
                    <td>
                      {formatDate(subscription.current_period_end ?? subscription.trial_ends_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollTable>
      </Section>
    </div>
  );
}
