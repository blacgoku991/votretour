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

export default async function AdminHomePage() {
  const db = supabaseAdmin();
  const integrations = integrationStatus();

  const [
    { data: raw },
    { data: liveQueues },
    { data: errors },
    { data: liveEvents },
  ] = await Promise.all([
    db.rpc('platform_stats'),
    db.from('queues')
      .select('id, name, status, organizations(name), locations(name)')
      .eq('status', 'open').limit(20),
    db.from('system_errors')
      .select('id, level, source, message, occurrences, last_seen_at')
      .is('resolved_at', null).order('last_seen_at', { ascending: false }).limit(5),
    db.from('event_campaigns')
      .select('id, name, status, organizations(name), locations(name)')
      .in('status', ['live', 'paused'])
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  const stats = raw as PlatformStats | null;
  const integrationCount = [
    integrations.serviceRole,
    integrations.sessionSecret,
    integrations.apns,
    integrations.webPush,
    integrations.stripe,
    integrations.appleAssociation,
  ].filter(Boolean).length;

  return (
    <div className={styles.page}>
      <section className={styles.controlHero}>
        <div>
          <span className={styles.cardKicker}>RANGVIA CONTROL ROOM</span>
          <h1>Vue plateforme</h1>
          <p>
            Supervision en direct des établissements, files, événements, notifications et incidents.
          </p>
        </div>

        <div className={styles.commandActions}>
          <Link href="/admin/etablissements" className="btn btn--solid">Établissements</Link>
          <Link href="/admin/evenements" className="btn btn--signal">Événements live</Link>
        </div>
      </section>

      <div className={styles.commandStats}>
        <CommandStat
          label="Établissements actifs"
          value={formatNumber(stats?.organizations.active ?? 0)}
          hint={`+${formatNumber(stats?.organizations.newThisWeek ?? 0)} cette semaine`}
          tone="live"
        />
        <CommandStat
          label="Clients en file"
          value={formatNumber(stats?.entries.inQueueNow ?? 0)}
          hint={`${formatNumber(stats?.queues.open ?? 0)} files ouvertes`}
          tone="signal"
        />
        <CommandStat
          label="Passages · 24 h"
          value={formatNumber(stats?.entries.completed24h ?? 0)}
          hint={`${formatNumber(stats?.entries.active24h ?? 0)} inscriptions`}
        />
        <CommandStat
          label="Push envoyés · 24 h"
          value={formatNumber(stats?.notifications.sent24h ?? 0)}
          hint={`${formatNumber(stats?.notifications.failed24h ?? 0)} échec(s)`}
          tone={(stats?.notifications.failed24h ?? 0) > 0 ? 'warn' : 'live'}
        />
        <CommandStat
          label="Scans NFC · 7 j"
          value={formatNumber(stats?.plates.scans7d ?? 0)}
          hint={`${formatNumber(stats?.plates.active ?? 0)} plaques actives`}
        />
        <CommandStat
          label="Incidents ouverts"
          value={formatNumber(stats?.errorsOpen ?? 0)}
          hint={(stats?.errorsOpen ?? 0) > 0 ? 'à traiter' : 'système nominal'}
          tone={(stats?.errorsOpen ?? 0) > 0 ? 'danger' : 'live'}
        />
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
              <h2>Ouvertes maintenant</h2>
            </div>
          </div>
          <div className={styles.liveStack}>
            {(liveQueues ?? []).length === 0 ? (
              <p className="t-small t-muted">Aucune file ouverte.</p>
            ) : (liveQueues ?? []).map((queue) => {
              const org = Array.isArray(queue.organizations) ? queue.organizations[0] : queue.organizations;
              const loc = Array.isArray(queue.locations) ? queue.locations[0] : queue.locations;
              return (
                <div className={styles.liveRow} key={queue.id}>
                  <span className={styles.livePulse} />
                  <div>
                    <strong>{queue.name}</strong>
                    <span>{org?.name ?? '—'} · {loc?.name ?? '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

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
      </div>
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
