import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripeConfigured } from '@/server/stripe';
import { PageHeader, Section, Stat } from '@/components/Page';
import { formatNumber, formatPrice, formatDate } from '@/lib/format';
import { PlanEditor } from './PlanEditor';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Offres & abonnements', robots: { index: false } };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  trialing: 'Essai', active: 'Actif', past_due: 'Impayé',
  canceled: 'Résilié', incomplete: 'Incomplet', paused: 'En pause',
};

export default async function AdminPlansPage() {
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

  const mrrCents = rows
    .filter((s) => s.status === 'active')
    .reduce((total, s) => {
      const plan = Array.isArray(s.plans) ? s.plans[0] : s.plans;
      const match = (plans ?? []).find((p) => p.code === plan?.code);
      if (!match) return total;
      return total + (s.billing_interval === 'year'
        ? Math.round(match.price_year_cents / 12)
        : match.price_month_cents);
    }, 0);

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
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

      <div className={styles.statGrid}>
        <Stat accent label="Revenu mensuel récurrent" value={formatPrice(mrrCents)}
          hint="abonnements actifs, annuels ramenés au mois" />
        <Stat label="Abonnements actifs" value={formatNumber(byStatus.active ?? 0)} />
        <Stat label="En période d’essai" value={formatNumber(byStatus.trialing ?? 0)} />
        <Stat label="Impayés" value={formatNumber(byStatus.past_due ?? 0)}
          hint={byStatus.past_due ? 'à relancer' : 'aucun'} />
      </div>

      <Section title="Offres" description="-1 signifie illimité.">
        {(plans ?? []).map((plan) => (
          <PlanEditor key={plan.id} plan={plan as never} />
        ))}
      </Section>

      <Section title="Abonnements">
        <div className={styles.tableWrap}>
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
                        {STATUS_LABEL[subscription.status] ?? subscription.status}
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
        </div>
      </Section>
    </div>
  );
}
