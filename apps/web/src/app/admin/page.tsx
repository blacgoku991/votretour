import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { integrationStatus } from '@/lib/env';
import { PageHeader, Section, Stat, SettingRow } from '@/components/Page';
import { formatNumber, relativeTime } from '@/lib/format';
import styles from './admin.module.css';

export const metadata: Metadata = { title: 'Plateforme', robots: { index: false } };
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

  const [{ data: raw }, { data: liveQueues }, { data: errors }] = await Promise.all([
    db.rpc('platform_stats'),
    db.from('queues')
      .select('id, name, status, organizations(name), locations(name)')
      .eq('status', 'open').limit(25),
    db.from('system_errors')
      .select('id, level, source, message, occurrences, last_seen_at')
      .is('resolved_at', null).order('last_seen_at', { ascending: false }).limit(5),
  ]);

  const stats = raw as PlatformStats | null;

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Vue d’ensemble"
        description="L’état de la plateforme en temps réel."
      />

      <div className={styles.statGrid}>
        <Stat accent label="Établissements actifs"
          value={formatNumber(stats?.organizations.active ?? 0)}
          hint={`${formatNumber(stats?.organizations.newThisWeek ?? 0)} cette semaine · ${formatNumber(stats?.organizations.suspended ?? 0)} suspendus`} />
        <Stat label="Dans une file maintenant"
          value={formatNumber(stats?.entries.inQueueNow ?? 0)}
          hint={`${formatNumber(stats?.queues.open ?? 0)} files ouvertes`} />
        <Stat label="Passages terminés (24 h)"
          value={formatNumber(stats?.entries.completed24h ?? 0)}
          hint={`${formatNumber(stats?.entries.active24h ?? 0)} inscriptions`} />
        <Stat label="Notifications (24 h)"
          value={formatNumber(stats?.notifications.sent24h ?? 0)}
          hint={`${formatNumber(stats?.notifications.failed24h ?? 0)} en échec`} />
        <Stat label="Plaques actives"
          value={formatNumber(stats?.plates.active ?? 0)}
          hint={`${formatNumber(stats?.plates.scans7d ?? 0)} scans sur 7 jours`} />
        <Stat label="Incidents ouverts"
          value={formatNumber(stats?.errorsOpen ?? 0)}
          hint={stats?.errorsOpen ? 'à traiter' : 'rien à signaler'} />
      </div>

      {/* ---------------- Intégrations ---------------- */}
      <Section
        title="Intégrations"
        description="Ce qui est réellement branché sur cette installation."
      >
        <SettingRow label="Clé de service Supabase" hint="Nécessaire à toute opération sur les files.">
          <Pill ok={integrations.serviceRole} />
        </SettingRow>
        <SettingRow label="Secret de hachage de session" hint="Poivre appliqué aux jetons d’appareil et aux adresses IP.">
          <Pill ok={integrations.sessionSecret} />
        </SettingRow>
        <SettingRow label="APNs (App Clip iPhone)">
          <Pill ok={integrations.apns} />
        </SettingRow>
        <SettingRow label="Web Push (Android, PWA)">
          <Pill ok={integrations.webPush} />
        </SettingRow>
        <SettingRow label="Stripe" hint="Sans Stripe, toutes les organisations restent en essai.">
          <Pill ok={integrations.stripe} />
        </SettingRow>
        <SettingRow label="Association de domaine Apple" hint="APPLE_APP_ID, pour apple-app-site-association.">
          <Pill ok={integrations.appleAssociation} />
        </SettingRow>
      </Section>

      {/* ---------------- Files ouvertes ---------------- */}
      <Section title="Files ouvertes en ce moment">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Organisation</th>
                <th scope="col">Établissement</th>
                <th scope="col">File</th>
              </tr>
            </thead>
            <tbody>
              {(liveQueues ?? []).length === 0 ? (
                <tr><td colSpan={3}>Aucune file ouverte actuellement.</td></tr>
              ) : (
                (liveQueues ?? []).map((queue) => {
                  const org = Array.isArray(queue.organizations) ? queue.organizations[0] : queue.organizations;
                  const loc = Array.isArray(queue.locations) ? queue.locations[0] : queue.locations;
                  return (
                    <tr key={queue.id}>
                      <th scope="row" className={styles.orgName}>{org?.name ?? '—'}</th>
                      <td>{loc?.name ?? '—'}</td>
                      <td><span className="chip chip--jade">{queue.name}</span></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ---------------- Incidents ---------------- */}
      {(errors ?? []).length > 0 && (
        <Section
          title="Derniers incidents"
          actions={<Link className="btn btn--ghost btn--sm" href="/admin/erreurs">Tout voir</Link>}
        >
          {(errors ?? []).map((error) => (
            <div key={error.id} className={styles.errorRow}>
              <span className={error.level === 'fatal' ? 'chip chip--brique' : 'chip chip--copper'}>
                {error.level}
              </span>
              <div className={styles.errorBody}>
                <p className={styles.errorMessage}>{error.message}</p>
                <p className="t-micro t-faint">
                  {error.source} · {error.occurrences} occurrence{error.occurrences > 1 ? 's' : ''} ·{' '}
                  {relativeTime(error.last_seen_at)}
                </p>
              </div>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Pill({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? 'chip chip--jade' : 'chip chip--brique'}>
      {ok ? 'Configuré' : 'Non configuré'}
    </span>
  );
}
