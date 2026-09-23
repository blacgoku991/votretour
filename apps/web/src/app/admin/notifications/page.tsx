import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { formatNumber, relativeTime } from '@/lib/format';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Notifications', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; canal?: string }>;
}) {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
  const { statut, canal } = await searchParams;
  const db = supabaseAdmin();
  const since24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  let query = db
    .from('notification_deliveries')
    .select(`
      id, status, channel, kind, http_status, error, attempts,
      created_at, sent_at, organization_id,
      organizations(name)
    `)
    .order('created_at', { ascending: false })
    .limit(300);

  if (statut) query = query.eq('status', statut);
  if (canal) query = query.eq('channel', canal);

  const [
    { data: deliveries },
    { count: sent24h },
    { count: failed24h },
    { count: queued24h },
    { data: subscriptions },
  ] = await Promise.all([
    query,
    db.from('notification_deliveries').select('id', { count: 'exact', head: true })
      .eq('status', 'sent').gte('created_at', since24h),
    db.from('notification_deliveries').select('id', { count: 'exact', head: true })
      .eq('status', 'failed').gte('created_at', since24h),
    db.from('notification_deliveries').select('id', { count: 'exact', head: true })
      .eq('status', 'queued').gte('created_at', since24h),
    db.from('notification_subscriptions')
      .select('channel, is_active')
      .eq('is_active', true),
  ]);

  const total = (sent24h ?? 0) + (failed24h ?? 0);
  const successRate = total > 0 ? Math.round(((sent24h ?? 0) / total) * 100) : 100;
  const activeByChannel = (subscriptions ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.channel] = (acc[row.channel] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className={styles.page}>
      <div className={styles.controlHero}>
        <div>
          <span className={styles.cardKicker}>DELIVERY CENTER</span>
          <h1>Notifications</h1>
          <p>APNs, App Clip, application iOS et Web Push avec preuves d’envoi réelles.</p>
        </div>

        <form className={styles.controlFilters} method="get">
          <select className="select" name="statut" defaultValue={statut ?? ''}>
            <option value="">Tous les statuts</option>
            <option value="sent">Envoyées</option>
            <option value="failed">Échecs</option>
            <option value="queued">En attente</option>
          </select>
          <select className="select" name="canal" defaultValue={canal ?? ''}>
            <option value="">Tous les canaux</option>
            <option value="web_push">Web Push</option>
            <option value="apns_appclip">APNs App Clip</option>
            <option value="apns_app">APNs App</option>
            <option value="fcm">FCM</option>
          </select>
          <button className="btn btn--solid btn--sm" type="submit">Filtrer</button>
        </form>
      </div>

      <div className={styles.commandStats}>
        <DeliveryStat label="Réussite · 24 h" value={successRate + '%'} tone={successRate >= 98 ? 'live' : 'warn'} />
        <DeliveryStat label="Envoyées · 24 h" value={formatNumber(sent24h ?? 0)} tone="live" />
        <DeliveryStat label="Échecs · 24 h" value={formatNumber(failed24h ?? 0)} tone={(failed24h ?? 0) ? 'danger' : 'live'} />
        <DeliveryStat label="En attente" value={formatNumber(queued24h ?? 0)} />
        <DeliveryStat label="Web Push actifs" value={formatNumber(activeByChannel.web_push ?? 0)} />
        <DeliveryStat label="APNs actifs" value={formatNumber((activeByChannel.apns_app ?? 0) + (activeByChannel.apns_appclip ?? 0))} />
      </div>

      <section className={styles.adminCard}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Quand</th>
                <th>Organisation</th>
                <th>Canal</th>
                <th>Type</th>
                <th>État</th>
                <th>HTTP</th>
                <th>Tentatives</th>
                <th>Erreur</th>
              </tr>
            </thead>
            <tbody>
              {(deliveries ?? []).map((delivery) => {
                const org = Array.isArray(delivery.organizations)
                  ? delivery.organizations[0]
                  : delivery.organizations;
                return (
                  <tr key={delivery.id}>
                    <td>{relativeTime(delivery.sent_at ?? delivery.created_at)}</td>
                    <td>{org?.name ?? '—'}</td>
                    <td>{delivery.channel ?? '—'}</td>
                    <td>{delivery.kind}</td>
                    <td>
                      <span className={
                        delivery.status === 'sent'
                          ? 'chip chip--jade'
                          : delivery.status === 'failed'
                            ? 'chip chip--brique'
                            : 'chip chip--copper'
                      }>
                        {delivery.status}
                      </span>
                    </td>
                    <td>{delivery.http_status ?? '—'}</td>
                    <td className="t-num">{delivery.attempts}</td>
                    <td title={delivery.error ?? undefined}>
                      {delivery.error ? delivery.error.slice(0, 90) : '—'}
                    </td>
                  </tr>
                );
              })}
              {(deliveries ?? []).length === 0 && (
                <tr><td colSpan={8} className="t-muted">Aucune livraison.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DeliveryStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'live' | 'warn' | 'danger';
}) {
  return (
    <div className={styles.commandStat} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>supervision réelle</small>
    </div>
  );
}
