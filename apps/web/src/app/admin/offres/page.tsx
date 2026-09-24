import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { stripeConfigured } from '@/server/stripe';
import { Section } from '@/components/Page';
import { formatNumber, formatPrice, formatDate } from '@/lib/format';
import { PlanEditor, type EditablePlan } from './PlanEditor';
import { SetupTodo, type SetupTodoRow } from './SetupTodo';
import { AdminHero, AdminStat, AdminStats } from '../AdminKit';
import { ScrollTable } from '../ScrollTable';
import { SUBSCRIPTION_STATUS_LABEL, labelOf } from '../labels';
import { monthlyRecurringCents } from '../revenue';
import styles from '../admin.module.css';
import plansStyles from './plans.module.css';

export const metadata: Metadata = { title: 'Offres & abonnements', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminPlansPage() {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
  const db = supabaseAdmin();

  const [{ data: plans }, { data: subscriptions }, { data: todo }] = await Promise.all([
    db.from('plans').select('*').order('sort_order'),
    db.from('subscriptions')
      .select('organization_id, status, billing_interval, current_period_end, trial_ends_at, setup_fee_paid_at, setup_done_at, organizations(name), plans(name, code)')
      .order('created_at', { ascending: false }).limit(200),
    // Installations à faire : frais payés, installation pas encore faite.
    // Lues à part, sans la limite du tableau : aucune ne doit passer à la
    // trappe. Le plus ancien paiement d'abord.
    db.from('subscriptions')
      .select('organization_id, setup_fee_paid_at, organizations(name)')
      .not('setup_fee_paid_at', 'is', null)
      .is('setup_done_at', null)
      .order('setup_fee_paid_at', { ascending: true }),
  ]);

  const todoRows: SetupTodoRow[] = (todo ?? []).map((row) => {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    return {
      organizationId: row.organization_id,
      name: org?.name ?? 'Organisation sans nom',
      paidOn: formatDate(row.setup_fee_paid_at),
    };
  });

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

  // Une offre en vente (0043), les anciennes retirées mais conservées :
  // abonnements, audit et événements Stripe y renvoient.
  const allPlans = (plans ?? []) as EditablePlan[];
  const onSale = allPlans.filter((p) => p.is_active || p.is_public);
  const retired = allPlans.filter((p) => !p.is_active && !p.is_public);
  const subscribersOf = (code: string) => rows.filter((s) => {
    const plan = Array.isArray(s.plans) ? s.plans[0] : s.plans;
    return plan?.code === code;
  }).length;

  return (
    <div className={`shell ${styles.page}`}>
      <AdminHero
        kicker="FACTURATION"
        title="Offres & abonnements"
        description="Le prix, l’installation et les quotas de l’offre se modifient ici : aucun redéploiement n’est nécessaire."
      />

      {!stripeConfigured() && (
        <div className="banner banner--warn">
          <span>
            Stripe n’est pas configuré : les identifiants de tarif ci-dessous ne serviront
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

      <Section
        id="installations"
        title={`Installations à faire${todoRows.length > 0 ? ` · ${todoRows.length}` : ''}`}
        description="Frais d’installation payés, installation pas encore faite par l’équipe. Marquez-la faite une fois le métier activé et les réglages posés avec le commerçant."
      >
        <SetupTodo rows={todoRows} />
      </Section>

      <Section
        title="L’offre"
        description="Une seule offre en vente : l’abonnement mensuel et l’installation, payée une fois au premier abonnement. Prix hors taxes."
      >
        {onSale.map((plan) => (
          <PlanEditor key={plan.id} plan={plan} subscribers={subscribersOf(plan.code)} />
        ))}
        {onSale.length === 0 && (
          <p className={`t-small t-muted ${plansStyles.none}`}>Aucune offre en vente : le site n’affiche aucun prix.</p>
        )}
        {retired.length > 0 && (
          <details className={plansStyles.retiredList}>
            <summary>
              {retired.length} ancienne{retired.length > 1 ? 's' : ''} offre{retired.length > 1 ? 's' : ''} retirée{retired.length > 1 ? 's' : ''},
              conservée{retired.length > 1 ? 's' : ''} pour les abonnements et l’historique
            </summary>
            {retired.map((plan) => (
              <PlanEditor key={plan.id} plan={plan} subscribers={subscribersOf(plan.code)} />
            ))}
          </details>
        )}
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
                <th scope="col">Installation</th>
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
                    <td>
                      {subscription.setup_done_at
                        ? <>Faite le {formatDate(subscription.setup_done_at)}</>
                        : subscription.setup_fee_paid_at
                          ? <>Réglée le {formatDate(subscription.setup_fee_paid_at)} · <strong>à faire</strong></>
                          : <span className="t-muted">À régler</span>}
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
