import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ACTIVITY_LABEL } from '@/lib/copy';
import { OrganizationControlPanel } from './OrganizationControlPanel';
import styles from '../../admin.module.css';

export const metadata: Metadata = { title: 'Gérer établissement', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = supabaseAdmin();

  const { data: org } = await db
    .from('organizations')
    .select('id, name, slug, activity, status, logo_url, suspended_reason, created_at, suspended_at')
    .eq('id', id)
    .maybeSingle();

  if (!org) notFound();

  const [
    { data: locations },
    { data: queues },
    { data: staff },
    { data: plates },
    { data: subscription },
    { count: activeEntries },
    { count: completed7d },
    { count: notifications7d },
  ] = await Promise.all([
    db.from('locations').select('id, name, city, is_active').eq('organization_id', id).order('created_at'),
    db.from('queues').select('id, name, status, location_id').eq('organization_id', id).order('created_at'),
    db.from('staff').select('id, display_name, is_active, is_on_break').eq('organization_id', id).order('created_at'),
    db.from('plates').select('id, label, code, is_active, scan_count').eq('organization_id', id).order('created_at'),
    db.from('subscriptions').select('status, current_period_end, stripe_subscription_id, plans(name)').eq('organization_id', id).maybeSingle(),
    db.from('queue_entries').select('id', { count: 'exact', head: true })
      .eq('organization_id', id).in('status', ['waiting','notified','returning','present','next','serving']),
    db.from('queue_entries').select('id', { count: 'exact', head: true })
      .eq('organization_id', id).eq('status', 'completed')
      .gte('completed_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
    db.from('notification_deliveries').select('id', { count: 'exact', head: true })
      .eq('organization_id', id).eq('status', 'sent')
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
  ]);

  const plan = Array.isArray(subscription?.plans) ? subscription?.plans[0] : subscription?.plans;

  return (
    <div className={styles.adminDetail}>
      <header className={styles.detailHero}>
        <div className={styles.detailIdentity}>
          <div className={styles.detailLogo}>
            {org.logo_url
              ? <img src={org.logo_url} alt="" />
              : <span>{org.name.slice(0, 2).toUpperCase()}</span>}
          </div>
          <div>
            <div className={styles.detailEyebrow}>ORGANISATION · /{org.slug}</div>
            <h1>{org.name}</h1>
            <p>
              {ACTIVITY_LABEL[org.activity] ?? org.activity}
              {' · '}créée {formatDateTime(org.created_at)}
            </p>
          </div>
        </div>
        <span className={org.status === 'active' ? 'chip chip--jade' : 'chip chip--brique'}>
          {org.status === 'active' ? 'Active' : 'Suspendue'}
        </span>
      </header>

      <div className={styles.detailStats}>
        <DetailStat label="Clients actifs" value={formatNumber(activeEntries ?? 0)} />
        <DetailStat label="Terminés · 7 j" value={formatNumber(completed7d ?? 0)} />
        <DetailStat label="Notifications · 7 j" value={formatNumber(notifications7d ?? 0)} />
        <DetailStat label="Établissements" value={formatNumber(locations?.length ?? 0)} />
        <DetailStat label="Équipe" value={formatNumber(staff?.filter((s) => s.is_active).length ?? 0)} />
        <DetailStat label="Plaques" value={formatNumber(plates?.length ?? 0)} />
      </div>

      <div className={styles.detailGrid}>
        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>CONTRÔLE</span>
              <h2>Paramètres organisation</h2>
            </div>
          </div>
          <OrganizationControlPanel
            organization={{
              id: org.id,
              name: org.name,
              activity: org.activity,
              status: org.status,
              suspendedReason: org.suspended_reason,
            }}
            activeEntries={activeEntries ?? 0}
            subscription={{
              status: subscription?.status ?? null,
              planName: plan?.name ?? null,
              stripeSubscriptionId: subscription?.stripe_subscription_id ?? null,
              periodEnd: subscription?.current_period_end ?? null,
            }}
          />
        </section>

        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>STRUCTURE</span>
              <h2>Ressources</h2>
            </div>
          </div>
          <div className={styles.resourceList}>
            <Resource label="Établissements" value={locations?.length ?? 0}
              detail={(locations ?? []).map((l) => l.name).join(' · ') || 'Aucun'} />
            <Resource label="Files" value={queues?.length ?? 0}
              detail={(queues ?? []).map((q) => `${q.name} (${q.status})`).join(' · ') || 'Aucune'} />
            <Resource label="Professionnels" value={staff?.length ?? 0}
              detail={(staff ?? []).map((s) => s.display_name).join(' · ') || 'Aucun'} />
            <Resource label="Plaques" value={plates?.length ?? 0}
              detail={(plates ?? []).map((p) => `${p.label} · ${p.scan_count} scans`).join(' · ') || 'Aucune'} />
          </div>
        </section>
      </div>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.detailStat}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Resource({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className={styles.resourceRow}>
      <div>
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
      <span>{value}</span>
    </div>
  );
}
