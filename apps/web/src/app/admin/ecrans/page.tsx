import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { formatNumber, relativeTime } from '@/lib/format';
import { AdminHero, AdminStat, AdminStats } from '../AdminKit';
import { ScrollTable } from '../ScrollTable';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Écrans TV', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminDisplaysPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; etat?: string }>;
}) {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
  const { q, etat } = await searchParams;
  const db = supabaseAdmin();
  const onlineSince = new Date(Date.now() - 2 * 60_000).toISOString();

  let query = db
    .from('display_devices')
    .select(`
      id, name, status, organization_id, location_id, queue_id, event_id,
      paired_at, last_seen_at, revoked_at,
      organizations(name),
      locations(name, city),
      queues(name),
      event_campaigns(name, status)
    `)
    .order('paired_at', { ascending: false })
    .limit(300);

  if (etat === 'actifs') query = query.eq('status', 'active');
  if (etat === 'revoques') query = query.eq('status', 'revoked');

  const { data: devices } = await query;
  const all = devices ?? [];
  const filtered = q?.trim()
    ? all.filter((device) => {
        const org = Array.isArray(device.organizations) ? device.organizations[0] : device.organizations;
        const location = Array.isArray(device.locations) ? device.locations[0] : device.locations;
        return [device.name, org?.name, location?.name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q.toLowerCase()));
      })
    : all;

  const online = all.filter((device) =>
    device.status === 'active' && device.last_seen_at && device.last_seen_at >= onlineSince,
  ).length;
  const active = all.filter((device) => device.status === 'active').length;
  const revoked = all.filter((device) => device.status === 'revoked').length;

  return (
    <div className={`shell ${styles.page}`}>
      <AdminHero
        kicker="PARC D’ÉCRANS"
        title="Écrans TV"
        description="État, appairage et affectation de tous les écrans Rangvia."
      >
        <form className={styles.controlFilters} method="get">
          <input
            className="input" name="q" defaultValue={q ?? ''}
            placeholder="Nom, établissement…" aria-label="Rechercher un écran"
          />
          <select className="select" name="etat" defaultValue={etat ?? ''} aria-label="État">
            <option value="">Tous</option>
            <option value="actifs">Actifs</option>
            <option value="revoques">Révoqués</option>
          </select>
          <button className="btn btn--solid btn--sm" type="submit">Filtrer</button>
        </form>
      </AdminHero>

      <AdminStats>
        <AdminStat label="Écrans actifs" value={formatNumber(active)} hint="appairés et autorisés" />
        <AdminStat
          label="En ligne" value={formatNumber(online)} hint="signal depuis moins de 2 min"
          tone={online > 0 ? 'live' : 'default'}
        />
        <AdminStat
          label="Hors ligne" value={formatNumber(Math.max(0, active - online))} hint="actifs mais silencieux"
          tone={active - online > 0 ? 'warn' : 'default'}
        />
        <AdminStat label="Révoqués" value={formatNumber(revoked)} hint="accès retiré" />
      </AdminStats>

      <section className={styles.adminCard}>
        <ScrollTable label="Écrans TV">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Écran</th>
                <th scope="col">État</th>
                <th scope="col">Organisation</th>
                <th scope="col">Établissement</th>
                <th scope="col">File</th>
                <th scope="col">Événement</th>
                <th scope="col">Dernier signal</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((device) => {
                const org = Array.isArray(device.organizations) ? device.organizations[0] : device.organizations;
                const location = Array.isArray(device.locations) ? device.locations[0] : device.locations;
                const queue = Array.isArray(device.queues) ? device.queues[0] : device.queues;
                const event = Array.isArray(device.event_campaigns) ? device.event_campaigns[0] : device.event_campaigns;
                const isOnline = Boolean(
                  device.status === 'active'
                  && device.last_seen_at
                  && device.last_seen_at >= onlineSince,
                );

                return (
                  <tr key={device.id}>
                    <th scope="row" className={styles.orgName}>{device.name}</th>
                    <td>
                      <span className={
                        device.status === 'revoked'
                          ? 'chip chip--brique'
                          : isOnline
                            ? 'chip chip--jade'
                            : 'chip'
                      }>
                        {device.status === 'revoked' ? 'Révoqué' : isOnline ? 'En ligne' : 'Hors ligne'}
                      </span>
                    </td>
                    <td>{org?.name ?? '—'}</td>
                    <td>{location?.name ?? '—'}{location?.city ? ' · ' + location.city : ''}</td>
                    <td>{queue?.name ?? '—'}</td>
                    <td>{event?.name ?? '—'}</td>
                    <td>{device.last_seen_at ? relativeTime(device.last_seen_at) : 'Jamais'}</td>
                    <td>
                      <Link
                        className="btn btn--ghost btn--sm"
                        href={'/admin/etablissements/' + device.organization_id}
                      >
                        Gérer
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="t-muted">Aucun écran.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollTable>
      </section>
    </div>
  );
}
