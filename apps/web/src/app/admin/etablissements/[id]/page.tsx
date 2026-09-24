import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import { ACTIVITY_LABEL } from '@/lib/copy';
import { OrganizationControlPanelV2 } from './OrganizationControlPanelV2';
import { TVManagementPanel } from './TVManagementPanel';
import { MetierPanel } from './MetierPanel';
import { isQueueProfile } from '@/lib/profiles';
import styles from '../../admin.module.css';
import v2 from '../../admin-v2.module.css';

export const metadata: Metadata = { title: 'Gérer établissement', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
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
    { data: orgSettings },
    { data: events },
    { data: displayDevices },
    { count: activeEntries },
    { count: completed7d },
    { count: notifications7d },
    { data: activeRows },
  ] = await Promise.all([
    db.from('locations').select(`
      id, name, slug, address_line1, address_line2, postal_code, city,
      country_code, phone, timezone, google_review_url, maps_url,
      logo_url, cover_url, is_active
    `).eq('organization_id', id).order('created_at'),
    db.from('queues').select('id, name, status, location_id, profile, profile_options, ticket_prefix').eq('organization_id', id).order('created_at'),
    db.from('staff').select('id, display_name, is_active, is_on_break').eq('organization_id', id).order('created_at'),
    db.from('plates').select('id, label, code, is_active, scan_count').eq('organization_id', id).order('created_at'),
    db.from('subscriptions').select('status, current_period_end, stripe_subscription_id, plans(name)').eq('organization_id', id).maybeSingle(),
    db.from('organization_settings').select(`
      default_locale, data_retention_days, ask_client_name, client_name_required,
      allow_client_leave, show_people_ahead, show_estimated_wait,
      notify_ahead_threshold, send_completion_review, brand_accent,
      support_email, privacy_url, terms_url
    `).eq('organization_id', id).maybeSingle(),
    db.from('event_campaigns')
      .select('id, name, status, location_id, queue_id, accent_hex')
      .eq('organization_id', id)
      .order('created_at', { ascending: false }),
    db.from('display_devices')
      .select('id, name, status, location_id, queue_id, event_id, paired_at, last_seen_at, revoked_at')
      .eq('organization_id', id)
      .order('paired_at', { ascending: false }),
    db.from('queue_entries').select('id', { count: 'exact', head: true })
      .eq('organization_id', id).in('status', ['waiting','notified','returning','present','next','serving']),
    db.from('queue_entries').select('id', { count: 'exact', head: true })
      .eq('organization_id', id).eq('status', 'completed')
      .gte('completed_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
    db.from('notification_deliveries').select('id', { count: 'exact', head: true })
      .eq('organization_id', id).eq('status', 'sent')
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
    // Tickets en cours par file : un changement de métier exige une file
    // vide (VT017). Seul l'identifiant de la file est lu, aucune donnée
    // de client.
    db.from('queue_entries').select('queue_id')
      .eq('organization_id', id).in('status', ['waiting','notified','returning','present','next','serving']),
  ]);

  const plan = Array.isArray(subscription?.plans) ? subscription?.plans[0] : subscription?.plans;

  const activeByQueue = new Map<string, number>();
  for (const row of (activeRows ?? []) as { queue_id: string }[]) {
    activeByQueue.set(row.queue_id, (activeByQueue.get(row.queue_id) ?? 0) + 1);
  }
  const locationName = new Map((locations ?? []).map((l) => [l.id as string, l.name as string]));

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

        <div className={v2.detailToolbar}>
          <Link className="btn btn--ghost btn--sm" href={'/app/' + org.slug + '/file'}>
            Espace commerce
          </Link>
          <Link className="btn btn--signal btn--sm" href={'/ecran/' + org.slug} target="_blank">
            Ouvrir écran TV
          </Link>
          <span className={org.status === 'active' ? 'chip chip--jade' : 'chip chip--brique'}>
            {org.status === 'active' ? 'Active' : 'Suspendue'}
          </span>
        </div>
      </header>

      <div className={styles.detailStats}>
        <DetailStat label="Clients actifs" value={formatNumber(activeEntries ?? 0)} />
        <DetailStat label="Terminés · 7 j" value={formatNumber(completed7d ?? 0)} />
        <DetailStat label="Notifications · 7 j" value={formatNumber(notifications7d ?? 0)} />
        <DetailStat label="Établissements" value={formatNumber(locations?.length ?? 0)} />
        <DetailStat label="Équipe" value={formatNumber(staff?.filter((s) => s.is_active).length ?? 0)} />
        <DetailStat label="Plaques" value={formatNumber(plates?.length ?? 0)} />
        <DetailStat
          label="Écrans TV"
          value={formatNumber(displayDevices?.filter((device) => device.status === 'active').length ?? 0)}
        />
      </div>

      {/* Le métier de chaque file : attribué ici, et seulement ici. */}
      <section className={styles.adminCard} aria-labelledby="metier-titre">
        <div className={styles.adminCardHead}>
          <div>
            <span className={styles.cardKicker}>MÉTIER</span>
            <h2 id="metier-titre">Interface par file</h2>
          </div>
          <span className="chip">Attribué par l’équipe Rangvia</span>
        </div>
        <MetierPanel
          organizationId={org.id}
          activity={org.activity}
          activityLabel={ACTIVITY_LABEL[org.activity] ?? org.activity}
          queues={(queues ?? []).map((queue) => ({
            id: queue.id,
            name: queue.name,
            locationName: locationName.get(queue.location_id) ?? 'Établissement',
            status: queue.status,
            profile: isQueueProfile(queue.profile) ? queue.profile : 'walkin',
            profileOptions: queue.profile_options ?? {},
            ticketPrefix: typeof queue.ticket_prefix === 'string' ? queue.ticket_prefix : 'A',
            activeCount: activeByQueue.get(queue.id) ?? 0,
          }))}
        />
      </section>

      <section className={styles.adminCard}>
        <div className={styles.adminCardHead}>
          <div>
            <span className={styles.cardKicker}>CONTROL CENTER</span>
            <h2>Configuration complète</h2>
          </div>
        </div>

        <OrganizationControlPanelV2
          organization={{
            id: org.id,
            name: org.name,
            activity: org.activity,
            status: org.status,
            logoUrl: org.logo_url,
            suspendedReason: org.suspended_reason,
          }}
          settings={{
            defaultLocale: orgSettings?.default_locale ?? 'fr',
            dataRetentionDays: orgSettings?.data_retention_days ?? 30,
            askClientName: orgSettings?.ask_client_name ?? true,
            clientNameRequired: orgSettings?.client_name_required ?? false,
            allowClientLeave: orgSettings?.allow_client_leave ?? true,
            showPeopleAhead: orgSettings?.show_people_ahead ?? true,
            showEstimatedWait: orgSettings?.show_estimated_wait ?? false,
            notifyAheadThreshold: orgSettings?.notify_ahead_threshold ?? 2,
            sendCompletionReview: orgSettings?.send_completion_review ?? true,
            brandAccent: orgSettings?.brand_accent ?? 'signal',
            supportEmail: orgSettings?.support_email ?? null,
            privacyUrl: orgSettings?.privacy_url ?? null,
            termsUrl: orgSettings?.terms_url ?? null,
          }}
          locations={(locations ?? []).map((location) => ({
            id: location.id,
            name: location.name,
            slug: location.slug,
            addressLine1: location.address_line1,
            addressLine2: location.address_line2,
            postalCode: location.postal_code,
            city: location.city,
            countryCode: location.country_code,
            phone: location.phone,
            timezone: location.timezone,
            googleReviewUrl: location.google_review_url,
            mapsUrl: location.maps_url,
            logoUrl: location.logo_url,
            coverUrl: location.cover_url,
            isActive: location.is_active,
          }))}
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
            <span className={styles.cardKicker}>DISPLAY FLEET</span>
            <h2>Écrans TV & kiosques</h2>
          </div>
          <span className="chip chip--jade">
            {displayDevices?.filter((device) => device.status === 'active').length ?? 0} actif(s)
          </span>
        </div>

        <TVManagementPanel
          organizationId={org.id}
          organizationSlug={org.slug}
          locations={(locations ?? []).map((location) => ({
            id: location.id,
            name: location.name,
            city: location.city,
          }))}
          queues={(queues ?? []).map((queue) => ({
            id: queue.id,
            name: queue.name,
            locationId: queue.location_id,
            status: queue.status,
          }))}
          events={(events ?? []).map((event) => ({
            id: event.id,
            name: event.name,
            status: event.status,
            locationId: event.location_id,
            queueId: event.queue_id,
            accentHex: event.accent_hex ?? '#FF4B1F',
          }))}
          devices={(displayDevices ?? []).map((device) => ({
            id: device.id,
            name: device.name,
            status: device.status,
            locationId: device.location_id,
            queueId: device.queue_id,
            eventId: device.event_id,
            pairedAt: device.paired_at,
            lastSeenAt: device.last_seen_at,
            revokedAt: device.revoked_at,
          }))}
        />
      </section>

      <div className={styles.detailGrid}>
        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>EXPLOITATION</span>
              <h2>Files & équipe</h2>
            </div>
          </div>
          <div className={styles.resourceList}>
            <Resource label="Files" value={queues?.length ?? 0}
              detail={(queues ?? []).map((q) => `${q.name} (${q.status})`).join(' · ') || 'Aucune'} />
            <Resource label="Professionnels" value={staff?.length ?? 0}
              detail={(staff ?? []).map((s) => s.display_name).join(' · ') || 'Aucun'} />
          </div>
        </section>

        <section className={styles.adminCard}>
          <div className={styles.adminCardHead}>
            <div>
              <span className={styles.cardKicker}>HARDWARE</span>
              <h2>Plaques & accès</h2>
            </div>
          </div>
          <div className={styles.resourceList}>
            <Resource label="Plaques" value={plates?.length ?? 0}
              detail={(plates ?? []).map((p) => `${p.label} · ${p.scan_count} scans`).join(' · ') || 'Aucune'} />
            <Resource label="Établissements" value={locations?.length ?? 0}
              detail={(locations ?? []).map((l) => l.name).join(' · ') || 'Aucun'} />
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
