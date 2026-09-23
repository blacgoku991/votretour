import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { integrationStatus } from '@/lib/env';
import { formatNumber, relativeTime } from '@/lib/format';
import styles from './admin.module.css';

export const metadata: Metadata = { title: 'Control Room', robots: { index: false } };
export const dynamic = 'force-dynamic';

interface PlatformStats {
  organizations: { total: number; active: number; suspended: number; newThisWeek: number };
  locations: number;
  staff: number;
  plates: { total: number; active: number; scans7d: number };
  queues: { total: number; open: number };
  entries: { active24h: number; completed24h: number; inQueueNow: number };
  notifications: { sent24h: number; failed24h: number; byChannel: Record<string, number> };
  subscriptions: Record<string, number>;
  errorsOpen: number;
}

type DailyPoint = {
  label: string;
  completed: number;
  notifications: number;
};

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q: rawQuery } = await searchParams;
  const q = rawQuery?.trim() ?? '';
  const db = supabaseAdmin();
  const integrations = integrationStatus();
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const since24h = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const onlineSince = new Date(Date.now() - 2 * 60_000).toISOString();

  const [
    { data: raw },
    { data: liveQueues },
    { data: errors },
    { data: liveEvents },
    { data: subscriptions },
    { data: displays },
    { data: auditRows },
    { data: activeEntries },
    searchOrganizations,
    searchEvents,
    searchPlates,
  ] = await Promise.all([
    db.rpc('platform_stats'),
    db.from('queues')
      .select('id, name, status, organizations(name), locations(name)')
      .eq('status', 'open')
      .limit(20),
    db.from('system_errors')
      .select('id, level, source, message, occurrences, last_seen_at')
      .is('resolved_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(6),
    db.from('event_campaigns')
      .select('id, name, status, organization_id, organizations(name), locations(name)')
      .in('status', ['live', 'paused'])
      .order('created_at', { ascending: false })
      .limit(12),
    db.from('subscriptions')
      .select('status, billing_interval, organizations(id, name), plans(name, price_month_cents, price_year_cents)')
      .in('status', ['active', 'trialing', 'past_due']),
    db.from('display_devices')
      .select('id, name, status, last_seen_at, organization_id, organizations(name), locations(name)')
      .eq('status', 'active')
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .limit(60),
    db.from('audit_logs')
      .select('id, action, actor, actor_label, created_at, organizations(name)')
      .order('created_at', { ascending: false })
      .limit(8),
    db.from('queue_entries')
      .select('id, status, joined_at, organizations(name), queues(name)')
      .in('status', ['waiting', 'notified', 'returning', 'present', 'next', 'serving'])
      .order('joined_at', { ascending: true })
      .limit(12),
    q.length >= 2
      ? db.from('organizations')
          .select('id, name, slug, status, activity')
          .ilike('name', '%' + q + '%')
          .limit(8)
      : Promise.resolve({ data: [] }),
    q.length >= 2
      ? db.from('event_campaigns')
          .select('id, name, status, organization_id, organizations(name)')
          .ilike('name', '%' + q + '%')
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
    q.length >= 2
      ? db.from('plates')
          .select('id, label, code, is_active, organization_id, organizations(name)')
          .ilike('label', '%' + q + '%')
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
  ]);

  const stats = raw as PlatformStats | null;

  const points = await Promise.all(
    Array.from({ length: 7 }, async (_, offset) => {
      const day = new Date(dayStart);
      day.setDate(day.getDate() - (6 - offset));
      const next = new Date(day);
      next.setDate(next.getDate() + 1);

      const [{ count: completed }, { count: sent }] = await Promise.all([
        db.from('queue_entries')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('completed_at', day.toISOString())
          .lt('completed_at', next.toISOString()),
        db.from('notification_deliveries')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'sent')
          .gte('sent_at', day.toISOString())
          .lt('sent_at', next.toISOString()),
      ]);

      return {
        label: day.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
        completed: completed ?? 0,
        notifications: sent ?? 0,
      } satisfies DailyPoint;
    }),
  );

  const integrationCount = [
    integrations.serviceRole,
    integrations.sessionSecret,
    integrations.apns,
    integrations.webPush,
    integrations.stripe,
    integrations.appleAssociation,
  ].filter(Boolean).length;

  const mrrCents = (subscriptions ?? []).reduce((total, subscription) => {
    if (!['active', 'trialing'].includes(subscription.status)) return total;
    const plan = Array.isArray(subscription.plans) ? subscription.plans[0] : subscription.plans;
    if (!plan) return total;
    return total + (
      subscription.billing_interval === 'year'
        ? Math.round((plan.price_year_cents ?? 0) / 12)
        : (plan.price_month_cents ?? 0)
    );
  }, 0);

  const onlineDisplays = (displays ?? []).filter((display) =>
    display.last_seen_at && display.last_seen_at >= onlineSince,
  ).length;

  const notificationTotal24h =
    (stats?.notifications.sent24h ?? 0) + (stats?.notifications.failed24h ?? 0);
  const notificationSuccess =
    notificationTotal24h > 0
      ? Math.round(((stats?.notifications.sent24h ?? 0) / notificationTotal24h) * 100)
      : 100;

  const searchedOrganizations = searchOrganizations.data ?? [];
  const searchedEvents = searchEvents.data ?? [];
  const searchedPlates = searchPlates.data ?? [];

  return (
    <div className={styles.page}>
      <section className={styles.controlHero}>
        <div>
          <span className={styles.cardKicker}>RANGVIA CONTROL ROOM</span>
          <h1>Vue plateforme</h1>
          <p>
            Exploitation, revenus, files, événements, écrans, notifications et incidents au même endroit.
          </p>
        </div>

        <div className={styles.heroTools}>
          <form className={styles.globalSearch} method="get">
            <input
              className="input"
              name="q"
              defaultValue={q}
              placeholder="Rechercher établissement ou événement…"
              aria-label="Recherche globale"
            />
            <button className="btn btn--solid btn--sm" type="submit">Rechercher</button>
          </form>

          <div className={styles.commandActions}>
            <Link href="/admin/etablissements" className="btn btn--solid">Établissements</Link>
            <Link href="/admin/evenements" className="btn btn--signal">Événements live</Link>
          </div>
        </div>
      </section>

      {q.length >= 2 && (
        <section className={styles.searchResults}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>RECHERCHE GLOBALE</span>
              <h2>Résultats pour « {q} »</h2>
            </div>
            <Link href="/admin" className="btn btn--quiet btn--sm">Effacer</Link>
          </div>

          <div className={styles.searchGrid}>
            <div>
              <span className={styles.searchGroupLabel}>Établissements</span>
              <div className={styles.liveStack}>
                {searchedOrganizations.length === 0
                  ? <p className="t-small t-muted">Aucun établissement.</p>
                  : searchedOrganizations.map((organization) => (
                    <Link
                      key={organization.id}
                      href={'/admin/etablissements/' + organization.id}
                      className={styles.searchRow}
                    >
                      <div>
                        <strong>{organization.name}</strong>
                        <span>/{organization.slug} · {organization.activity}</span>
                      </div>
                      <span className={organization.status === 'active' ? 'chip chip--jade' : 'chip chip--brique'}>
                        {organization.status}
                      </span>
                    </Link>
                  ))}
              </div>
            </div>

            <div>
              <span className={styles.searchGroupLabel}>Événements</span>
              <div className={styles.liveStack}>
                {searchedEvents.length === 0
                  ? <p className="t-small t-muted">Aucun événement.</p>
                  : searchedEvents.map((event) => {
                    const org = Array.isArray(event.organizations) ? event.organizations[0] : event.organizations;
                    return (
                      <Link key={event.id} href="/admin/evenements" className={styles.searchRow}>
                        <div>
                          <strong>{event.name}</strong>
                          <span>{org?.name ?? '—'}</span>
                        </div>
                        <span className="chip">{event.status}</span>
                      </Link>
                    );
                  })}
              </div>
            </div>

            <div>
              <span className={styles.searchGroupLabel}>Plaques & NFC</span>
              <div className={styles.liveStack}>
                {searchedPlates.length === 0
                  ? <p className="t-small t-muted">Aucune plaque.</p>
                  : searchedPlates.map((plate) => {
                    const org = Array.isArray(plate.organizations) ? plate.organizations[0] : plate.organizations;
                    return (
                      <Link key={plate.id} href="/admin/plaques" className={styles.searchRow}>
                        <div>
                          <strong>{plate.label}</strong>
                          <span>{org?.name ?? '—'} · {plate.code}</span>
                        </div>
                        <span className={plate.is_active ? 'chip chip--jade' : 'chip'}>
                          {plate.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className={styles.commandStats}>
        <CommandStat
          label="Établissements actifs"
          value={formatNumber(stats?.organizations.active ?? 0)}
          hint={'+' + formatNumber(stats?.organizations.newThisWeek ?? 0) + ' cette semaine'}
          tone="live"
        />
        <CommandStat
          label="Clients en file"
          value={formatNumber(stats?.entries.inQueueNow ?? 0)}
          hint={formatNumber(stats?.queues.open ?? 0) + ' files ouvertes'}
          tone="signal"
        />
        <CommandStat
          label="Passages · 24 h"
          value={formatNumber(stats?.entries.completed24h ?? 0)}
          hint={formatNumber(stats?.entries.active24h ?? 0) + ' inscriptions'}
        />
        <CommandStat
          label="MRR estimé"
          value={(mrrCents / 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €'}
          hint={(subscriptions ?? []).filter((subscription) => subscription.status === 'active').length + ' abonnements actifs'}
          tone="signal"
        />
        <CommandStat
          label="Push réussis · 24 h"
          value={notificationSuccess + '%'}
          hint={formatNumber(stats?.notifications.failed24h ?? 0) + ' échec(s)'}
          tone={notificationSuccess >= 98 ? 'live' : notificationSuccess >= 90 ? 'warn' : 'danger'}
        />
        <CommandStat
          label="Écrans en ligne"
          value={formatNumber(onlineDisplays)}
          hint={formatNumber(displays?.length ?? 0) + ' appareils actifs'}
          tone={onlineDisplays > 0 ? 'live' : 'default'}
        />
        <CommandStat
          label="Scans NFC · 7 j"
          value={formatNumber(stats?.plates.scans7d ?? 0)}
          hint={formatNumber(stats?.plates.active ?? 0) + ' plaques actives'}
        />
        <CommandStat
          label="Incidents ouverts"
          value={formatNumber(stats?.errorsOpen ?? 0)}
          hint={(stats?.errorsOpen ?? 0) > 0 ? 'à traiter' : 'système nominal'}
          tone={(stats?.errorsOpen ?? 0) > 0 ? 'danger' : 'live'}
        />
      </div>

      <div className={styles.analyticsGrid}>
        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>ACTIVITÉ · 7 JOURS</span>
              <h2>Passages terminés</h2>
            </div>
            <strong className={styles.metricTotal}>
              {formatNumber(points.reduce((sum, point) => sum + point.completed, 0))}
            </strong>
          </div>
          <DailyBars points={points} metric="completed" />
        </section>

        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>DELIVERY · 7 JOURS</span>
              <h2>Notifications envoyées</h2>
            </div>
            <strong className={styles.metricTotal}>
              {formatNumber(points.reduce((sum, point) => sum + point.notifications, 0))}
            </strong>
          </div>
          <DailyBars points={points} metric="notifications" />
        </section>
      </div>

      <div className={styles.commandGrid}>
        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>LIVE</span>
              <h2>Événements en cours</h2>
            </div>
            <Link href="/admin/evenements" className="btn btn--ghost btn--sm">Tout gérer</Link>
          </div>

          <div className={styles.liveStack}>
            {(liveEvents ?? []).length === 0 ? (
              <p className="t-small t-muted">Aucun événement actif.</p>
            ) : (liveEvents ?? []).map((event) => {
              const org = Array.isArray(event.organizations) ? event.organizations[0] : event.organizations;
              const location = Array.isArray(event.locations) ? event.locations[0] : event.locations;
              return (
                <div className={styles.liveRow} key={event.id}>
                  <span className={event.status === 'live' ? styles.livePulse : styles.pausePulse} />
                  <div>
                    <strong>{event.name}</strong>
                    <span>{org?.name ?? '—'} · {location?.name ?? '—'}</span>
                  </div>
                  <span className="chip">{event.status === 'live' ? 'Live' : 'Pause'}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>INFRA</span>
              <h2>État des intégrations</h2>
            </div>
            <span className="chip chip--jade">{integrationCount}/6</span>
          </div>

          <div className={styles.integrationGrid}>
            <Integration name="Supabase service" ok={integrations.serviceRole} />
            <Integration name="Secret sessions" ok={integrations.sessionSecret} />
            <Integration name="APNs / App Clip" ok={integrations.apns} />
            <Integration name="Web Push" ok={integrations.webPush} />
            <Integration name="Stripe" ok={integrations.stripe} />
            <Integration name="Apple association" ok={integrations.appleAssociation} />
          </div>
        </section>
      </div>

      <div className={styles.commandGrid}>
        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>FILES</span>
              <h2>Clients actifs maintenant</h2>
            </div>
            <span className="chip">{activeEntries?.length ?? 0}</span>
          </div>
          <div className={styles.liveStack}>
            {(activeEntries ?? []).length === 0 ? (
              <p className="t-small t-muted">Aucun client en file.</p>
            ) : (activeEntries ?? []).map((entry) => {
              const org = Array.isArray(entry.organizations) ? entry.organizations[0] : entry.organizations;
              const queue = Array.isArray(entry.queues) ? entry.queues[0] : entry.queues;
              return (
                <div className={styles.liveRow} key={entry.id}>
                  <span className={entry.status === 'serving' ? styles.livePulse : styles.pausePulse} />
                  <div>
                    <strong>{org?.name ?? '—'}</strong>
                    <span>{queue?.name ?? '—'} · {entry.status} · {relativeTime(entry.joined_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>DISPLAY FLEET</span>
              <h2>Écrans TV</h2>
            </div>
            <span className="chip chip--jade">{onlineDisplays} en ligne</span>
          </div>

          <div className={styles.liveStack}>
            {(displays ?? []).slice(0, 8).map((display) => {
              const org = Array.isArray(display.organizations) ? display.organizations[0] : display.organizations;
              const location = Array.isArray(display.locations) ? display.locations[0] : display.locations;
              const online = Boolean(display.last_seen_at && display.last_seen_at >= onlineSince);
              return (
                <div className={styles.liveRow} key={display.id}>
                  <span className={online ? styles.livePulse : styles.offlinePulse} />
                  <div>
                    <strong>{display.name}</strong>
                    <span>{org?.name ?? '—'} · {location?.name ?? '—'}</span>
                  </div>
                  <span className={online ? 'chip chip--jade' : 'chip'}>
                    {online ? 'En ligne' : 'Hors ligne'}
                  </span>
                </div>
              );
            })}
            {(displays ?? []).length === 0 && (
              <p className="t-small t-muted">Aucun écran appairé.</p>
            )}
          </div>
        </section>
      </div>

      <div className={styles.commandGrid}>
        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>SÉCURITÉ & SYSTÈME</span>
              <h2>Derniers incidents</h2>
            </div>
            <Link href="/admin/erreurs" className="btn btn--ghost btn--sm">Voir tout</Link>
          </div>

          <div className={styles.liveStack}>
            {(errors ?? []).length === 0 ? (
              <div className={styles.nominal}>✓ Aucun incident ouvert</div>
            ) : (errors ?? []).map((error) => (
              <div className={styles.incidentRow} key={error.id}>
                <span className={error.level === 'fatal' ? 'chip chip--brique' : 'chip chip--copper'}>
                  {error.level}
                </span>
                <div>
                  <strong>{error.message}</strong>
                  <span>
                    {error.source} · {error.occurrences} occurrence(s) · {relativeTime(error.last_seen_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>AUDIT</span>
              <h2>Activité plateforme</h2>
            </div>
            <Link href="/admin/journal" className="btn btn--ghost btn--sm">Journal complet</Link>
          </div>

          <div className={styles.liveStack}>
            {(auditRows ?? []).map((row) => {
              const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
              return (
                <div className={styles.auditRow} key={row.id}>
                  <div>
                    <strong>{row.action}</strong>
                    <span>
                      {org?.name ?? 'Plateforme'} · {row.actor_label ?? row.actor} · {relativeTime(row.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className={styles.adminCard}>
        <div className={styles.adminCardHead}>
          <div>
            <span className={styles.cardKicker}>FILES OUVERTES</span>
            <h2>Exploitation actuelle</h2>
          </div>
        </div>
        <div className={styles.queueOverview}>
          {(liveQueues ?? []).map((queue) => {
            const org = Array.isArray(queue.organizations) ? queue.organizations[0] : queue.organizations;
            const loc = Array.isArray(queue.locations) ? queue.locations[0] : queue.locations;
            return (
              <div className={styles.queueOverviewItem} key={queue.id}>
                <span className={styles.livePulse} />
                <div>
                  <strong>{queue.name}</strong>
                  <span>{org?.name ?? '—'} · {loc?.name ?? '—'}</span>
                </div>
              </div>
            );
          })}
          {(liveQueues ?? []).length === 0 && (
            <p className="t-small t-muted">Aucune file ouverte.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function DailyBars({
  points,
  metric,
}: {
  points: DailyPoint[];
  metric: 'completed' | 'notifications';
}) {
  const max = Math.max(1, ...points.map((point) => point[metric]));
  return (
    <div className={styles.barChart}>
      {points.map((point) => {
        const value = point[metric];
        const height = Math.max(value > 0 ? 10 : 2, Math.round((value / max) * 100));
        return (
          <div className={styles.barColumn} key={point.label}>
            <div className={styles.barValue}>{formatNumber(value)}</div>
            <div className={styles.barTrack}>
              <div className={styles.barFill} style={{ height: height + '%' }} />
            </div>
            <span>{point.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function CommandStat({
  label, value, hint, tone = 'default',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'live' | 'signal' | 'warn' | 'danger';
}) {
  return (
    <div className={styles.commandStat} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function Integration({ name, ok }: { name: string; ok: boolean }) {
  return (
    <div className={styles.integration}>
      <i className={ok ? styles.integrationOk : styles.integrationBad} />
      <span>{name}</span>
      <strong>{ok ? 'OK' : 'À configurer'}</strong>
    </div>
  );
}
