import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatNumber } from '@/lib/format';
import { AdminEventsTable } from './AdminEventsTable';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Événements', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; etat?: string }>;
}) {
  const { q, etat } = await searchParams;
  const db = supabaseAdmin();

  let query = db
    .from('event_campaigns')
    .select(`
      id, name, status, wave_size, pass_valid_minutes, grace_minutes,
      started_at, ended_at, created_at, organization_id, queue_id,
      organizations(name, slug),
      locations(name, city)
    `)
    .order('created_at', { ascending: false })
    .limit(300);

  if (q) query = query.ilike('name', `%${q}%`);
  if (etat) query = query.eq('status', etat);

  const { data: events } = await query;
  const ids = (events ?? []).map((e) => e.id);

  const { data: passes } = ids.length
    ? await db.from('event_access_passes').select('event_id, status').in('event_id', ids)
    : { data: [] as { event_id: string; status: string }[] };

  const rows = (events ?? []).map((event) => {
    const eventPasses = (passes ?? []).filter((pass) => pass.event_id === event.id);
    const org = Array.isArray(event.organizations) ? event.organizations[0] : event.organizations;
    const location = Array.isArray(event.locations) ? event.locations[0] : event.locations;

    return {
      id: event.id,
      name: event.name,
      status: event.status,
      waveSize: event.wave_size,
      passValidMinutes: event.pass_valid_minutes,
      graceMinutes: event.grace_minutes,
      startedAt: event.started_at,
      endedAt: event.ended_at,
      createdAt: event.created_at,
      organizationId: event.organization_id,
      queueId: event.queue_id,
      organizationName: org?.name ?? '—',
      organizationSlug: org?.slug ?? '',
      locationName: location?.name ?? '—',
      city: location?.city ?? null,
      issued: eventPasses.filter((p) => p.status === 'issued').length,
      redeemed: eventPasses.filter((p) => p.status === 'redeemed').length,
      expired: eventPasses.filter((p) => p.status === 'expired').length,
      revoked: eventPasses.filter((p) => p.status === 'revoked').length,
    };
  });

  return (
    <div className={styles.page}>
      <div className={styles.controlHero}>
        <div>
          <span className={styles.cardKicker}>OPERATIONS LIVE</span>
          <h1>Événements & Drops</h1>
          <p>{formatNumber(rows.length)} événements visibles sur la plateforme.</p>
        </div>

        <form className={styles.controlFilters} method="get">
          <input className="input" name="q" defaultValue={q ?? ''} placeholder="Rechercher un événement" />
          <select className="select" name="etat" defaultValue={etat ?? ''}>
            <option value="">Tous les états</option>
            <option value="draft">Brouillons</option>
            <option value="live">En direct</option>
            <option value="paused">En pause</option>
            <option value="sold_out">Stock épuisé</option>
            <option value="ended">Terminés</option>
          </select>
          <button className="btn btn--solid btn--sm" type="submit">Filtrer</button>
        </form>
      </div>

      <AdminEventsTable events={rows} />
    </div>
  );
}
