import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PageHeader, Section, EmptyState } from '@/components/Page';
import { formatDate, formatNumber } from '@/lib/format';
import { ACTIVITY_LABEL } from '@/lib/copy';
import { OrganizationActions } from './OrganizationActions';
import { CreateOrganizationV2 } from './CreateOrganizationV2';
import styles from '../admin.module.css';
import v2 from '../admin-v2.module.css';

export const metadata: Metadata = { title: 'Établissements', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; etat?: string }>;
}) {
  const { q, etat } = await searchParams;
  const db = supabaseAdmin();

  let query = db
    .from('organizations')
    .select('id, name, slug, activity, logo_url, status, created_at, suspended_reason')
    .order('created_at', { ascending: false })
    .limit(200);

  if (q) query = query.ilike('name', `%${q}%`);
  if (etat === 'suspendus') query = query.eq('status', 'suspended');
  if (etat === 'actifs') query = query.eq('status', 'active');

  const { data: organizations } = await query;
  const ids = (organizations ?? []).map((o) => o.id);

  const [{ data: locations }, { data: subscriptions }, { data: entries }] = await Promise.all([
    ids.length ? db.from('locations').select('organization_id').in('organization_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? db.from('subscriptions').select('organization_id, status, plans(name)').in('organization_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? db.from('queue_entries').select('organization_id')
      .in('organization_id', ids)
      .gte('joined_at', new Date(Date.now() - 7 * 86_400_000).toISOString()) : Promise.resolve({ data: [] }),
  ]);

  const countBy = (rows: { organization_id: string }[] | null) =>
    (rows ?? []).reduce<Record<string, number>>((acc, row) => {
      acc[row.organization_id] = (acc[row.organization_id] ?? 0) + 1;
      return acc;
    }, {});

  const locationCount = countBy(locations as { organization_id: string }[]);
  const entryCount = countBy(entries as { organization_id: string }[]);
  const subscriptionBy = new Map(
    ((subscriptions ?? []) as { organization_id: string; status: string; plans: { name: string }[] | { name: string } | null }[])
      .map((s) => [s.organization_id, s]),
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title="Établissements"
        description={`${formatNumber(organizations?.length ?? 0)} organisations · identité, exploitation et sécurité`}
        actions={<CreateOrganizationV2 />}
      />

      <form className={styles.controlFilters} method="get">
        <input className="input" name="q" defaultValue={q ?? ''}
          placeholder="Rechercher une organisation" aria-label="Rechercher une organisation" />
        <select className="select" name="etat" defaultValue={etat ?? ''} aria-label="État">
          <option value="">Tous les états</option>
          <option value="actifs">Actifs</option>
          <option value="suspendus">Suspendus</option>
        </select>
        <button type="submit" className="btn btn--solid btn--sm">Filtrer</button>
      </form>

      <Section>
        {(organizations ?? []).length === 0 ? (
          <EmptyState title="Aucun résultat" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Organisation</th>
                  <th scope="col">Activité</th>
                  <th scope="col">Offre</th>
                  <th scope="col">Sites</th>
                  <th scope="col">Clients (7 j)</th>
                  <th scope="col">Inscription</th>
                  <th scope="col">État</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {(organizations ?? []).map((org) => {
                  const subscription = subscriptionBy.get(org.id);
                  const plan = Array.isArray(subscription?.plans) ? subscription?.plans[0] : subscription?.plans;
                  return (
                    <tr key={org.id}>
                      <th scope="row" className={styles.orgName}>
                        <Link href={'/admin/etablissements/' + org.id} className={v2.orgIdentity}>
                          <span className={v2.orgLogo}>
                            {org.logo_url
                              ? <img src={org.logo_url} alt="" />
                              : org.name.slice(0, 2).toUpperCase()}
                          </span>
                          <span className={v2.orgIdentityText}>
                            <strong>{org.name}</strong>
                            <span>/{org.slug}</span>
                          </span>
                        </Link>
                      </th>
                      <td>{ACTIVITY_LABEL[org.activity] ?? org.activity}</td>
                      <td>
                        {plan?.name ?? '—'}
                        {subscription?.status && (
                          <span className="t-micro t-faint"> · {subscription.status}</span>
                        )}
                      </td>
                      <td className="t-num">{locationCount[org.id] ?? 0}</td>
                      <td className="t-num">{formatNumber(entryCount[org.id] ?? 0)}</td>
                      <td>{formatDate(org.created_at)}</td>
                      <td>
                        {org.status === 'active' ? (
                          <span className="chip chip--jade">Actif</span>
                        ) : (
                          <span className="chip chip--brique" title={org.suspended_reason ?? undefined}>
                            Suspendu
                          </span>
                        )}
                      </td>
                      <td>
                        <OrganizationActions
                          organizationId={org.id}
                          name={org.name}
                          suspended={org.status === 'suspended'}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
