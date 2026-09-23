import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { selectAll } from '@/server/select-all';
import { AdminHero, AdminStat, AdminStats } from '../../AdminKit';
import { ScrollTable } from '../../ScrollTable';
import { formatDate, formatNumber } from '@/lib/format';
import { normalizeStockCode } from '@/lib/plate-stock';
import { StockConsole, type AssignTargets } from './StockConsole';
import adminStyles from '../../admin.module.css';
import styles from './stock.module.css';

interface StockCounts { available: number; assigned: number; void: number }
interface StockSummary {
  totals: StockCounts;
  batches: (StockCounts & { batchId: string })[];
}

export const metadata: Metadata = { title: 'Stock fournisseur', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * STOCK FOURNISSEUR.
 *
 * 1. On génère un lot de liens (100 par exemple) et on l'exporte pour le
 *    fabricant, qui grave les puces NFC et imprime les QR.
 * 2. Les plaques livrées portent chacune un code RV-XXXXX-XXXXX et un
 *    numéro. On en retrouve une par son code, son numéro, ou en
 *    scannant la plaque elle-même, et on l'attribue à une société.
 * 3. Plus tard, une plaque peut changer de société : le lien gravé ne
 *    change jamais.
 *
 * L'accès est vérifié en tête de chaque page du stock — pas seulement
 * par la coque /admin, qu'une requête RSC forgée peut sauter — et
 * revérifié dans chaque action serveur.
 */
export default async function PlateStockPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
  const { code } = await searchParams;
  const initialQuery = code ? (normalizeStockCode(code) ?? code) : '';
  const db = supabaseAdmin();

  const { data: batches, error: batchesError } = await db.from('plate_batches')
    .select('id, label, quantity, kind, supplier_note, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (batchesError) throw batchesError;

  // Les comptes se font en base, et les listes se lisent par pages :
  // PostgREST tronque sans prévenir toute réponse au-delà de 1000 lignes.
  const [summary, organizations, locations, queues, staff] = await Promise.all([
    db.rpc('plate_stock_summary', { p_batch_ids: (batches ?? []).map((b) => b.id) })
      .then(({ data, error }) => {
        if (error) throw error;
        return data as StockSummary;
      }),
    selectAll<{ id: string; name: string; status: string }>((from, to) =>
      db.from('organizations').select('id, name, status').order('name').order('id').range(from, to)),
    selectAll<{ id: string; name: string; city: string | null; organization_id: string; is_active: boolean }>((from, to) =>
      db.from('locations').select('id, name, city, organization_id, is_active').order('name').order('id').range(from, to)),
    selectAll<{ id: string; name: string; location_id: string; is_default: boolean }>((from, to) =>
      db.from('queues').select('id, name, location_id, is_default').order('name').order('id').range(from, to)),
    selectAll<{ id: string; display_name: string; location_id: string }>((from, to) =>
      db.from('staff').select('id, display_name, location_id').eq('is_active', true)
        .order('display_name').order('id').range(from, to)),
  ]);

  const counts = summary.totals;
  const perBatch = new Map(summary.batches.map((b) => [b.batchId, b]));
  const total = counts.available + counts.assigned + counts.void;

  const targets: AssignTargets = {
    organizations: organizations.map((o) => ({ id: o.id, name: o.name, suspended: o.status !== 'active' })),
    locations: locations.map((l) => ({
      id: l.id, name: l.name, city: l.city, organizationId: l.organization_id, active: l.is_active,
    })),
    queues: queues.map((q) => ({ id: q.id, name: q.name, locationId: q.location_id, isDefault: q.is_default })),
    staff: staff.map((s) => ({ id: s.id, name: s.display_name, locationId: s.location_id })),
  };

  return (
    <div className={`shell ${adminStyles.page}`}>
      <AdminHero
        kicker="STOCK"
        title="Stock fournisseur"
        description="Générez les liens à graver, envoyez-les au fabricant, puis attribuez chaque plaque livrée à une société."
      >
        <div className={adminStyles.commandActions}>
          <Link href="/admin/plaques" className="btn btn--ghost btn--sm">Plaques en service</Link>
        </div>
      </AdminHero>

      <AdminStats>
        <AdminStat label="En stock" value={formatNumber(total)} hint="liens générés" />
        <AdminStat
          label="Disponibles" value={formatNumber(counts.available)} hint="prêtes à attribuer"
          tone={counts.available > 0 ? 'live' : 'default'}
        />
        <AdminStat
          label="Attribuées" value={formatNumber(counts.assigned)} hint="en service chez une société"
          tone={counts.assigned > 0 ? 'signal' : 'default'}
        />
        <AdminStat label="Au rebut" value={formatNumber(counts.void)} hint="perdues ou défectueuses" />
      </AdminStats>

      <StockConsole targets={targets} initialQuery={initialQuery} />

      <section className={adminStyles.adminCard}>
        <div className={adminStyles.adminCardHead}>
          <div>
            <span className={adminStyles.cardKicker}>LOTS</span>
            <h2>Lots commandés</h2>
          </div>
        </div>

        {(batches ?? []).length === 0 ? (
          <p className="t-small t-muted">
            Aucun lot pour l’instant. Générez-en un ci-dessus : ses liens seront prêts à envoyer au fabricant.
          </p>
        ) : (
          <ScrollTable label="Lots commandés">
            <table className={`${adminStyles.table} ${adminStyles.stackTable}`}>
              <thead>
                <tr>
                  <th scope="col">Lot</th>
                  <th scope="col">Créé le</th>
                  <th scope="col">Plaques</th>
                  <th scope="col">Disponibles</th>
                  <th scope="col">Attribuées</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {(batches ?? []).map((batch) => {
                  const c = perBatch.get(batch.id) ?? { available: 0, assigned: 0, void: 0 };
                  return (
                    <tr key={batch.id}>
                      <th scope="row" className={adminStyles.stackLead}>
                        <Link href={`/admin/plaques/stock/${batch.id}`} className={styles.batchLink}>
                          {batch.label}
                        </Link>
                        {batch.supplier_note && <span className="t-micro t-faint"> · {batch.supplier_note}</span>}
                      </th>
                      <td data-label="Créé le">{formatDate(batch.created_at)}</td>
                      <td className="t-num" data-label="Plaques">{formatNumber(batch.quantity)}</td>
                      <td className="t-num" data-label="Disponibles">{formatNumber(c.available)}</td>
                      <td className="t-num" data-label="Attribuées">{formatNumber(c.assigned)}</td>
                      <td className={adminStyles.stackActions}>
                        <div className={styles.rowActions}>
                          <a className="btn btn--ghost btn--sm" href={`/api/admin/plate-stock/${batch.id}/export?format=csv`}>CSV</a>
                          <a className="btn btn--ghost btn--sm" href={`/api/admin/plate-stock/${batch.id}/export?format=txt`}>URL</a>
                          <Link className="btn btn--ghost btn--sm" href={`/admin/plaques/stock/${batch.id}/planche`}>Planche QR</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </section>
    </div>
  );
}
