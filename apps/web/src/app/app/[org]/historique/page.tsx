import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PageHeader, Section, EmptyState } from '@/components/Page';
import { STAFF_STATUS_LABEL, SOURCE_LABEL } from '@/lib/copy';
import { formatDateTime, formatDuration, initials } from '@/lib/format';
import type { EntryStatus } from '@/lib/types';
import styles from './history.module.css';

export const metadata: Metadata = { title: 'Historique', robots: { index: false } };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const FILTERS = [
  { key: 'tous', label: 'Tous', statuses: null },
  { key: 'termines', label: 'Terminés', statuses: ['completed'] },
  { key: 'absents', label: 'Absents', statuses: ['absent', 'expired'] },
  { key: 'partis', label: 'Partis', statuses: ['cancelled', 'skipped'] },
] as const;

export default async function HistoryPage({
  params, searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ filtre?: string; page?: string }>;
}) {
  const { org } = await params;
  const { filtre, page } = await searchParams;
  const access = await requireOrgAccess(org, 'stats.view');
  const db = supabaseAdmin();

  const filter = FILTERS.find((f) => f.key === filtre) ?? FILTERS[0];
  const pageIndex = Math.max(0, Number(page ?? '0') || 0);

  let query = db
    .from('queue_entries')
    .select('public_id, client_name, status, source, joined_at, service_started_at, completed_at, staff_id, location_id')
    .eq('organization_id', access.organization.organization_id)
    .order('joined_at', { ascending: false })
    .range(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE - 1);

  if (filter.statuses) query = query.in('status', filter.statuses as unknown as string[]);

  const [{ data: entries }, { data: staff }, { data: locations }] = await Promise.all([
    query,
    db.from('staff').select('id, display_name, accent')
      .eq('organization_id', access.organization.organization_id),
    db.from('locations').select('id, name')
      .eq('organization_id', access.organization.organization_id),
  ]);

  const rows = entries ?? [];
  const staffById = new Map((staff ?? []).map((s) => [s.id, s]));
  const locationById = new Map((locations ?? []).map((l) => [l.id, l]));

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Historique"
        description="Tous les passages, dans l’ordre d’arrivée. Les prénoms disparaissent au-delà de votre durée de conservation."
        actions={
          <div className={styles.filters} role="group" aria-label="Filtrer">
            {FILTERS.map((f) => (
              <a key={f.key} href={`/app/${org}/historique?filtre=${f.key}`}
                className={`${styles.filterBtn} ${f.key === filter.key ? styles.filterBtnActive : ''}`}
                aria-current={f.key === filter.key ? 'true' : undefined}>
                {f.label}
              </a>
            ))}
          </div>
        }
      />

      <Section>
        {rows.length === 0 ? (
          <EmptyState
            title="Rien à afficher"
            description="Les passages apparaîtront ici dès que des clients auront rejoint votre file."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col">Arrivée</th>
                  <th scope="col">Attente</th>
                  <th scope="col">Prestation</th>
                  <th scope="col">Professionnel</th>
                  <th scope="col">Origine</th>
                  <th scope="col">Issue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const wait = entry.service_started_at
                    ? (new Date(entry.service_started_at).getTime() - new Date(entry.joined_at).getTime()) / 1000
                    : null;
                  const service = entry.completed_at && entry.service_started_at
                    ? (new Date(entry.completed_at).getTime() - new Date(entry.service_started_at).getTime()) / 1000
                    : null;
                  const member = entry.staff_id ? staffById.get(entry.staff_id) : null;

                  return (
                    <tr key={entry.public_id}>
                      <th scope="row">
                        <span className={styles.client}>
                          <span className={styles.avatar}>{initials(entry.client_name)}</span>
                          <span>
                            {entry.client_name ?? <em className="t-faint">anonymisé</em>}
                            {locationById.size > 1 && (
                              <span className="t-micro t-faint">
                                {' '}· {locationById.get(entry.location_id)?.name}
                              </span>
                            )}
                          </span>
                        </span>
                      </th>
                      <td className="t-num">{formatDateTime(entry.joined_at)}</td>
                      <td className="t-num">{formatDuration(wait)}</td>
                      <td className="t-num">{formatDuration(service)}</td>
                      <td>{member?.display_name ?? '—'}</td>
                      <td>{SOURCE_LABEL[entry.source] ?? entry.source}</td>
                      <td>
                        <StatusChip status={entry.status as EntryStatus} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {(pageIndex > 0 || rows.length === PAGE_SIZE) && (
        <div className={styles.pager}>
          {pageIndex > 0 && (
            <a className="btn btn--ghost btn--sm"
              href={`/app/${org}/historique?filtre=${filter.key}&page=${pageIndex - 1}`}>
              Précédent
            </a>
          )}
          <span className="t-small t-muted">Page {pageIndex + 1}</span>
          {rows.length === PAGE_SIZE && (
            <a className="btn btn--ghost btn--sm"
              href={`/app/${org}/historique?filtre=${filter.key}&page=${pageIndex + 1}`}>
              Suivant
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: EntryStatus }) {
  const className =
    status === 'completed' ? 'chip chip--jade'
    : status === 'absent' || status === 'expired' ? 'chip chip--copper'
    : status === 'cancelled' || status === 'skipped' ? 'chip chip--brique'
    : 'chip';
  return <span className={className}>{STAFF_STATUS_LABEL[status]}</span>;
}
