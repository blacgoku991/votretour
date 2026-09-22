import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { notificationCopy } from '@/lib/copy';
import type { NotificationChannel, NotificationKind } from '@/lib/types';
import { sendApns, apnsConfigured } from './apns';
import { sendWebPush, webPushConfigured } from './webpush';

/**
 * Chaîne d'envoi des notifications.
 *
 * Règle de fond : une notification n'est déclarée « envoyée » que si le
 * fournisseur (APNs ou service Push du navigateur) l'a acceptée. Chaque
 * tentative laisse une ligne dans notification_deliveries avec son
 * statut réel. Aucune interface n'affiche « notification envoyée » sur
 * la foi d'un appel de fonction.
 */

interface PendingNotification {
  entry_id: string;
  entry_public_id: string;
  kind: NotificationKind;
  client_session_id: string | null;
  organization_id: string;
  location_id: string;
  client_name: string | null;
  people_ahead: number;
  status: string;
  destination_url?: string | null;
}

interface SubscriptionRow {
  id: string;
  channel: NotificationChannel;
  endpoint: string | null;
  p256dh: string | null;
  auth_secret: string | null;
  device_token: string | null;
  bundle_id: string | null;
  apns_environment: 'sandbox' | 'production' | null;
  invocation_url: string | null;
  expires_at: string | null;
  client_session_id: string;
}

interface LocationInfo {
  id: string;
  name: string;
  slug: string;
  google_review_url: string | null;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  reasons: string[];
}

const EMPTY: DispatchSummary = { claimed: 0, sent: 0, failed: 0, skipped: 0, reasons: [] };

/** Durée de vie d'une notification : au-delà, elle n'a plus de sens. */
function ttlSecondsFor(kind: NotificationKind): number {
  switch (kind) {
    case 'your_turn': return 600;        // 10 min
    case 'ahead_one': return 900;        // 15 min
    case 'ahead_two': return 900;
    case 'visit_completed': return 86_400; // l'avis Google peut attendre
    case 'event_access': return 900;
    case 'event_sold_out': return 3600;
    case 'event_ended': return 3600;
    default: return 1800;
  }
}

function ticketUrl(slug: string, kind: NotificationKind): string {
  return `${env.siteUrl}/e/${slug}?src=push&k=${kind}`;
}

/**
 * Traite toutes les notifications en attente d'une file.
 * La réclamation est atomique côté base : deux appels concurrents ne
 * peuvent pas produire deux fois le même message.
 */
export async function dispatchQueueNotifications(queueId: string): Promise<DispatchSummary> {
  const db = supabaseAdmin();

  const { data, error } = await db.rpc('claim_pending_notifications', { p_queue_id: queueId });
  if (error) {
    console.error('[notifications] réclamation impossible', error);
    return { ...EMPTY, reasons: [error.message] };
  }

  const pending = (data ?? []) as PendingNotification[];
  if (pending.length === 0) return EMPTY;

  return deliverAll(pending);
}

/** Notification ponctuelle sur un ticket (fin de visite, retrait de file). */
export async function dispatchEventEntryNotification(
  entryId: string,
  kind: 'event_access' | 'event_sold_out' | 'event_ended',
  destinationUrl?: string | null,
): Promise<DispatchSummary> {
  const db = supabaseAdmin();

  const { data: claimed, error: claimError } = await db.rpc('claim_entry_notification', {
    p_entry_id: entryId,
    p_kind: kind,
  });
  if (claimError) {
    console.error('[notifications] réclamation event impossible', claimError);
    return { ...EMPTY, reasons: [claimError.message] };
  }
  if (claimed !== true) {
    return { ...EMPTY, skipped: 1, reasons: ['déjà envoyée'] };
  }

  const { data: entry, error } = await db
    .from('queue_entries')
    .select('id, public_id, organization_id, location_id, client_session_id, client_name, people_ahead, status')
    .eq('id', entryId)
    .maybeSingle();

  if (error || !entry) return { ...EMPTY, skipped: 1, reasons: ['ticket introuvable'] };

  return deliverAll([{
    entry_id: entry.id,
    entry_public_id: entry.public_id,
    kind,
    client_session_id: entry.client_session_id,
    organization_id: entry.organization_id,
    location_id: entry.location_id,
    client_name: entry.client_name,
    people_ahead: entry.people_ahead,
    status: entry.status,
    destination_url: destinationUrl ?? null,
  }]);
}

export async function dispatchEntryNotification(
  entryId: string,
  kind: NotificationKind,
): Promise<DispatchSummary> {
  const db = supabaseAdmin();

  const { data: claimed, error: claimError } = await db.rpc('claim_entry_notification', {
    p_entry_id: entryId,
    p_kind: kind,
  });
  if (claimError) {
    console.error('[notifications] réclamation ponctuelle impossible', claimError);
    return { ...EMPTY, reasons: [claimError.message] };
  }
  if (claimed !== true) {
    return { ...EMPTY, skipped: 1, reasons: ['déjà envoyée'] };
  }

  const { data: entry, error } = await db
    .from('queue_entries')
    .select('id, public_id, organization_id, location_id, client_session_id, client_name, people_ahead, status')
    .eq('id', entryId)
    .maybeSingle();

  if (error || !entry) return { ...EMPTY, skipped: 1, reasons: ['ticket introuvable'] };

  return deliverAll([
    {
      entry_id: entry.id,
      entry_public_id: entry.public_id,
      kind,
      client_session_id: entry.client_session_id,
      organization_id: entry.organization_id,
      location_id: entry.location_id,
      client_name: entry.client_name,
      people_ahead: entry.people_ahead,
      status: entry.status,
    },
  ]);
}

async function deliverAll(pending: PendingNotification[]): Promise<DispatchSummary> {
  const db = supabaseAdmin();
  const summary: DispatchSummary = { claimed: pending.length, sent: 0, failed: 0, skipped: 0, reasons: [] };

  const sessionIds = [...new Set(pending.map((p) => p.client_session_id).filter((v): v is string => !!v))];
  const locationIds = [...new Set(pending.map((p) => p.location_id))];

  if (sessionIds.length === 0) {
    summary.skipped = pending.length;
    summary.reasons.push('aucun appareil rattaché (client ajouté au comptoir)');
    return summary;
  }

  const [{ data: subsData }, { data: locData }] = await Promise.all([
    db
      .from('notification_subscriptions')
      .select('id, channel, endpoint, p256dh, auth_secret, device_token, bundle_id, apns_environment, invocation_url, expires_at, client_session_id')
      .in('client_session_id', sessionIds)
      .eq('is_active', true),
    db.from('locations').select('id, name, slug, google_review_url').in('id', locationIds),
  ]);

  const subsBySession = new Map<string, SubscriptionRow[]>();
  for (const sub of (subsData ?? []) as SubscriptionRow[]) {
    const list = subsBySession.get(sub.client_session_id) ?? [];
    list.push(sub);
    subsBySession.set(sub.client_session_id, list);
  }
  const locations = new Map<string, LocationInfo>(
    ((locData ?? []) as LocationInfo[]).map((l) => [l.id, l]),
  );

  const deliveries: Record<string, unknown>[] = [];
  const deactivate: string[] = [];
  const now = Date.now();

  for (const item of pending) {
    const location = locations.get(item.location_id);
    if (!location) {
      summary.skipped += 1;
      continue;
    }

    const subs = (item.client_session_id ? subsBySession.get(item.client_session_id) : undefined) ?? [];
    const usable = subs.filter((s) => !s.expires_at || new Date(s.expires_at).getTime() > now);

    if (usable.length === 0) {
      summary.skipped += 1;
      // On trace le fait qu'aucun canal n'était disponible : c'est ce qui
      // permet à l'interface de dire honnêtement « surveillez l'écran ».
      deliveries.push({
        organization_id: item.organization_id,
        queue_entry_id: item.entry_id,
        entry_public_id: item.entry_public_id,
        kind: item.kind,
        status: 'skipped',
        error: subs.length === 0 ? 'aucun abonnement push actif' : 'abonnements expirés',
        title: null,
        body: null,
      });
      continue;
    }

    const copy = notificationCopy(item.kind, {
      locationName: location.name,
      peopleAhead: item.people_ahead,
      clientName: item.client_name,
    });

    for (const sub of usable) {
      const result = await sendOne(sub, item, location, copy);
      if (result.status === 'sent') summary.sent += 1;
      else if (result.status === 'failed') summary.failed += 1;
      else summary.skipped += 1;
      if (result.deactivate) deactivate.push(sub.id);
      if (result.error) summary.reasons.push(`${sub.channel}: ${result.error}`);
      deliveries.push(result.record);
    }
  }

  if (deliveries.length > 0) {
    const { error } = await db.from('notification_deliveries').insert(deliveries);
    if (error) console.error('[notifications] journalisation impossible', error);
  }

  if (deactivate.length > 0) {
    await db
      .from('notification_subscriptions')
      .update({ is_active: false, last_failure_at: new Date().toISOString() })
      .in('id', deactivate);
  }

  return summary;
}

async function sendOne(
  sub: SubscriptionRow,
  item: PendingNotification,
  location: LocationInfo,
  copy: { title: string; body: string },
): Promise<{
  status: 'sent' | 'failed' | 'skipped';
  deactivate: boolean;
  error?: string;
  record: Record<string, unknown>;
}> {
  const base = {
    organization_id: item.organization_id,
    location_id: item.location_id,
    queue_entry_id: item.entry_id,
    entry_public_id: item.entry_public_id,
    subscription_id: sub.id,
    channel: sub.channel,
    kind: item.kind,
    title: copy.title,
    body: copy.body,
    attempts: 1,
  };

  const reviewUrl = item.kind === 'visit_completed' && location.google_review_url
    ? `${env.siteUrl}/api/client/review/click?entry=${encodeURIComponent(item.entry_public_id)}&source=notification`
    : null;
  const destinationUrl = item.destination_url ?? ticketUrl(location.slug, item.kind);

  /* ---------------- App Clip / application iOS (APNs) ---------------- */
  if (sub.channel === 'apns_appclip' || sub.channel === 'apns_app') {
    if (!apnsConfigured()) {
      return {
        status: 'skipped', deactivate: false, error: 'APNs non configuré',
        record: { ...base, status: 'skipped', error: 'APNs non configuré' },
      };
    }
    if (!sub.device_token || !sub.bundle_id) {
      return {
        status: 'skipped', deactivate: true, error: 'jeton APNs incomplet',
        record: { ...base, status: 'skipped', error: 'jeton APNs incomplet' },
      };
    }

    const result = await sendApns(
      sub.device_token,
      // Le topic est le bundle ID de la cible (App Clip ou app complète).
      sub.bundle_id,
      {
        title: copy.title,
        subtitle: copy.title === location.name ? undefined : location.name,
        body: copy.body,
        // Indispensable pour un App Clip multi-commerces : c'est ce qui
        // route la notification vers la bonne instance.
        targetContentId: sub.invocation_url ?? `${env.siteUrl}/e/${location.slug}`,
        category: item.kind === 'visit_completed' ? 'VISIT_COMPLETED' : 'QUEUE_UPDATE',
        threadId: item.entry_public_id,
        collapseId: `${item.entry_public_id}`,
        interruptionLevel: item.kind === 'your_turn' ? 'time-sensitive' : 'active',
        expiration: Math.floor(Date.now() / 1000) + ttlSecondsFor(item.kind),
        data: {
          kind: item.kind,
          entryId: item.entry_public_id,
          peopleAhead: item.people_ahead,
          locationName: location.name,
          locationSlug: location.slug,
          reviewUrl,
          eventUrl: item.kind.startsWith('event_') ? destinationUrl : null,
        },
      },
      sub.apns_environment ?? env.apns.environment,
    );

    if (result.ok) {
      await touchSuccess(sub.id);
      return {
        status: 'sent', deactivate: false,
        record: { ...base, status: 'sent', http_status: result.status,
                  provider_message_id: result.apnsId, sent_at: new Date().toISOString() },
      };
    }
    await touchFailure(sub.id, result.reason);
    return {
      status: 'failed', deactivate: result.shouldDeactivate, error: result.reason,
      record: { ...base, status: 'failed', http_status: result.status, error: result.reason },
    };
  }

  /* ---------------------- Web Push (Android, PWA) --------------------- */
  if (sub.channel === 'web_push') {
    if (!webPushConfigured()) {
      return {
        status: 'skipped', deactivate: false, error: 'Web Push non configuré',
        record: { ...base, status: 'skipped', error: 'Web Push non configuré' },
      };
    }
    if (!sub.endpoint || !sub.p256dh || !sub.auth_secret) {
      return {
        status: 'skipped', deactivate: true, error: 'abonnement incomplet',
        record: { ...base, status: 'skipped', error: 'abonnement incomplet' },
      };
    }

    const result = await sendWebPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth_secret },
      {
        title: copy.title,
        body: copy.body,
        url: destinationUrl,
        tag: item.entry_public_id,
        kind: item.kind,
        entryId: item.entry_public_id,
        renotify: true,
        requireInteraction: item.kind === 'your_turn',
        actions: reviewUrl
          ? [{ action: 'review', title: 'Laisser un avis Google', url: reviewUrl }]
          : undefined,
      },
      { ttlSeconds: ttlSecondsFor(item.kind), urgency: item.kind === 'your_turn' ? 'high' : 'normal' },
    );

    if (result.ok) {
      await touchSuccess(sub.id);
      return {
        status: 'sent', deactivate: false,
        record: { ...base, status: 'sent', http_status: result.status, sent_at: new Date().toISOString() },
      };
    }
    await touchFailure(sub.id, result.reason);
    return {
      status: 'failed', deactivate: result.shouldDeactivate, error: result.reason,
      record: { ...base, status: 'failed', http_status: result.status, error: result.reason.slice(0, 500) },
    };
  }

  return {
    status: 'skipped', deactivate: false, error: `canal non pris en charge: ${sub.channel}`,
    record: { ...base, status: 'skipped', error: `canal non pris en charge: ${sub.channel}` },
  };
}

async function touchSuccess(subscriptionId: string): Promise<void> {
  await supabaseAdmin()
    .from('notification_subscriptions')
    .update({ last_success_at: new Date().toISOString(), failure_count: 0, last_error: null })
    .eq('id', subscriptionId);
}

async function touchFailure(subscriptionId: string, reason: string): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('notification_subscriptions')
    .select('failure_count')
    .eq('id', subscriptionId)
    .maybeSingle();
  await db
    .from('notification_subscriptions')
    .update({
      failure_count: (data?.failure_count ?? 0) + 1,
      last_failure_at: new Date().toISOString(),
      last_error: reason.slice(0, 500),
    })
    .eq('id', subscriptionId);
}
