import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/Page';
import { formatDateTime, formatNumber } from '@/lib/format';
import { formatSerial, formatStockCode } from '@/lib/plate-stock';
import adminStyles from '../../../admin.module.css';
import styles from '../stock.module.css';

export const metadata: Metadata = { title: 'Lot de plaques', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Filter = 'toutes' | 'disponibles' | 'attribuees' | 'rebut';
const FILTERS: { key: Filter; label: string; status?: string }[] = [
  { key: 'toutes', label: 'Toutes' },
  { key: 'disponibles', label: 'Disponibles', status: 'available' },
  { key: 'attribuees', label: 'Attribuées', status: 'assigned' },
  { key: 'rebut', label: 'Au rebut', status: 'void' },
];
const KIND_LABEL: Record<string, string> = { both: 'NFC + QR', nfc: 'NFC seul', qr: 'QR seul' };

/** Détail d'un lot : chaque plaque, son état, et à qui elle est attribuée. */
export default async function PlateBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ etat?: string }>;
}) {
  const { batchId } = await params;
  const { etat } = await searchParams;
  if (!z.string().uuid().safeParse(batchId).success) notFound();
  const filter = (FILTERS.some((f) => f.key === etat) ? etat : 'toutes') as Filter;

  const db = supabaseAdmin();
  const { data: batch } = await db
    .from('plate_batches')
    .select('id, label, quantity, kind, supplier_note, created_at')
    .eq('id', batchId)
    .maybeSingle();
  if (!batch) notFound();

  let query = db
    .from('plate_stock')
    .select('serial, code, status, plate_id, assigned_at')
    .eq('batch_id', batchId)
    .order('serial');
  const status = FILTERS.find((f) => f.key === filter)?.status;
  if (status) query = query.eq('status', status);
  const { data: rows } = await query;

  const plateIds = (rows ?? []).map((r) => r.plate_id).filter(Boolean) as string[];
  const { data: plates } = plateIds.length
    ? await db.from('plates')
        .select('id, label, scan_count, organizations(name), locations(name)')
        .in('id', plateIds)
    : { data: [] };
  const plateById = new Map(
    ((plates ?? []) as unknown as {
      id: string; label: string; scan_count: number;
      organizations: { name: string } | { name: string }[] | null;
      locations: { name: string } | { name: string }[] | null;
    }[]).map((p) => {
      const org = Array.isArray(p.organizations) ? p.organizations[0] : p.organizations;
      const loc = Array.isArray(p.locations) ? p.locations[0] : p.locations;
      return [p.id, { label: p.label, scans: p.scan_count, org: org?.name ?? '—', loc: loc?.name ?? '—' }];
    }),
  );

  return (
    <div className={`shell ${adminStyles.page}`}>
      <PageHeader
        title={batch.label}
        description={`${formatNumber(batch.quantity)} plaques · ${KIND_LABEL[batch.kind] ?? batch.kind} · créé le ${formatDateTime(batch.created_at)}${batch.supplier_note ? ` · ${batch.supplier_note}` : ''}`}
        actions={
          <div className={styles.batchHead}>
            <a className="btn btn--solid btn--sm" href={`/api/admin/plate-stock/${batch.id}/export?format=csv`}>Télécharger le CSV</a>
            <a className="btn btn--ghost btn--sm" href={`/api/admin/plate-stock/${batch.id}/export?format=txt`}>Liste d&apos;URL</a>
            <Link className="btn btn--ghost btn--sm" href={`/admin/plaques/stock/${batch.id}/planche`}>Planche QR</Link>
            <Link className="btn btn--quiet btn--sm" href="/admin/plaques/stock">Tous les lots</Link>
          </div>
        }
      />

      <section className={adminStyles.adminCard}>
        <nav className={styles.filters} aria-label="Filtrer par état">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === 'toutes' ? `/admin/plaques/stock/${batch.id}` : `/admin/plaques/stock/${batch.id}?etat=${f.key}`}
              className={`btn btn--ghost btn--sm ${filter === f.key ? styles.filterActive : ''}`}
              aria-current={filter === f.key ? 'page' : undefined}
            >
              {f.label}
            </Link>
          ))}
        </nav>

        <div className={adminStyles.tableWrap} style={{ marginTop: 16 }}>
          <table className={adminStyles.table}>
            <thead>
              <tr>
                <th scope="col">N°</th>
                <th scope="col">Code imprimé</th>
                <th scope="col">État</th>
                <th scope="col">Attribuée à</th>
                <th scope="col">Scans</th>
                <th scope="col"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((row) => {
                const plate = row.plate_id ? plateById.get(row.plate_id) : null;
                return (
                  <tr key={row.code}>
                    <td className={`t-num ${styles.mono}`}>{formatSerial(row.serial)}</td>
                    <th scope="row" className={styles.mono}>{formatStockCode(row.code)}</th>
                    <td>
                      {row.status === 'available' && <span className="chip chip--jade">Disponible</span>}
                      {row.status === 'assigned' && <span className="chip chip--signal">Attribuée</span>}
                      {row.status === 'void' && <span className="chip">Au rebut</span>}
                    </td>
                    <td>
                      {plate ? <>{plate.org}<span className="t-micro t-faint"> — {plate.loc} · « {plate.label} »</span></> : <span className="t-faint">—</span>}
                    </td>
                    <td className="t-num">{plate ? formatNumber(plate.scans) : '—'}</td>
                    <td>
                      <Link className="btn btn--ghost btn--sm" href={`/admin/plaques/stock?code=${row.code}`}>
                        {row.status === 'available' ? 'Attribuer' : 'Gérer'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(rows ?? []).length === 0 && <p className="t-small t-muted">Aucune plaque dans cet état.</p>}
      </section>
    </div>
  );
}
