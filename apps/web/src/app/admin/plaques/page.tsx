import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { env } from '@/lib/env';
import { Section, EmptyState } from '@/components/Page';
import { AdminHero } from '../AdminKit';
import { formatNumber } from '@/lib/format';
import { PlateGrid, type AdminPlate } from './PlateGrid';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Plaques', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * PLAQUES — VUE PLATEFORME.
 *
 * Toutes les plaques de tous les établissements, avec leur QR, leur
 * état, et de quoi agir : activer, désactiver, renommer, rattacher à
 * une file, programmer le tag NFC.
 *
 * Le contrôle d'accès est fait côté serveur à trois endroits :
 * requirePlatformAdmin() dans le layout ET en tête de cette page (une
 * requête RSC forgée peut sauter le layout), assertPlatformAdmin() dans
 * chaque action. Aucune vérification n'est laissée au navigateur.
 */

type Filter = 'toutes' | 'actives' | 'inactives' | 'a-programmer' | 'jamais-scannees';

export default async function AdminPlatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; etat?: string; org?: string }>;
}) {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
  const { q, etat, org } = await searchParams;
  const filter = (etat ?? 'toutes') as Filter;
  const db = supabaseAdmin();

  let query = db
    .from('plates')
    .select(`id, code, label, kind, is_active, scan_count, last_scanned_at,
             programmed_at, programmed_count, nfc_serial, nfc_locked_at,
             order_status, order_reference, created_at,
             organization_id, location_id, queue_id`)
    .order('created_at', { ascending: false })
    .limit(300);

  if (q) query = query.or(`label.ilike.%${q}%,code.ilike.%${q}%`);
  if (org) query = query.eq('organization_id', org);
  if (filter === 'actives') query = query.eq('is_active', true);
  if (filter === 'inactives') query = query.eq('is_active', false);
  if (filter === 'a-programmer') query = query.is('programmed_at', null);
  if (filter === 'jamais-scannees') query = query.is('last_scanned_at', null);

  const { data: plates } = await query;
  const rows = (plates ?? []) as AdminPlate[];

  const [{ data: allOrganizations }, { data: locations }, { data: queues }] =
    await Promise.all([
      db.from('organizations').select('id, name, slug, status').order('name').limit(500),
      db.from('locations').select('id, name, city, organization_id').order('name').limit(1000),
      db.from('queues').select('id, name, location_id').order('name').limit(2000),
    ]);

  const active = rows.filter((p) => p.is_active).length;
  const programmed = rows.filter((p) => p.programmed_at).length;
  const scanned = rows.filter((p) => p.last_scanned_at).length;

  return (
    <div className={`shell ${styles.page}`}>
      <AdminHero
        kicker="PLAQUES & NFC"
        title="Plaques"
        description={
          `${formatNumber(rows.length)} plaque${rows.length > 1 ? 's' : ''} · `
          + `${formatNumber(active)} active${active > 1 ? 's' : ''} · `
          + `${formatNumber(programmed)} programmée${programmed > 1 ? 's' : ''} · `
          + `${formatNumber(scanned)} déjà scannée${scanned > 1 ? 's' : ''}`
        }
        stacked
      >
          <form className="row g2" method="get">
            <input
              className="input" name="q" defaultValue={q ?? ''}
              placeholder="Nom ou code" aria-label="Rechercher une plaque"
            />
            <select className="select" name="org" defaultValue={org ?? ''} aria-label="Établissement">
              <option value="">Tous les établissements</option>
              {((allOrganizations ?? []) as { id: string; name: string }[]).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <select className="select" name="etat" defaultValue={filter} aria-label="État">
              <option value="toutes">Toutes</option>
              <option value="actives">Actives</option>
              <option value="inactives">Désactivées</option>
              <option value="a-programmer">Jamais programmées</option>
              <option value="jamais-scannees">Jamais scannées</option>
            </select>
            <button type="submit" className="btn btn--solid btn--sm">Filtrer</button>
          </form>
      </AdminHero>

      <Section>
        {rows.length === 0 ? (
          <EmptyState
            title="Aucune plaque ne correspond"
            description="Changez de filtre, ou videz la recherche."
          />
        ) : (
          <PlateGrid
            plates={rows}
            siteUrl={env.siteUrl}
            organizations={(allOrganizations ?? []) as never}
            locations={(locations ?? []) as never}
            queues={(queues ?? []) as never}
          />
        )}
      </Section>
    </div>
  );
}
