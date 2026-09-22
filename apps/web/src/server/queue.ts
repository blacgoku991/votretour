import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toAppError, AppError } from '@/lib/errors';
import type {
  ClientEntry, EntryPoint, EntrySource, PublicQueueState,
  QueueSnapshot, QueueStatus, StaffEntry, TicketState,
} from '@/lib/types';
import { broadcastQueueState, broadcastTicketEvent } from './realtime';
import { dispatchEntryNotification, dispatchQueueNotifications } from './notifications/dispatch';

/**
 * Service de file : la seule porte d'entrée applicative vers le moteur
 * PostgreSQL.
 *
 * Chaque mutation suit invariablement la même séquence :
 *   1. appel de la fonction SQL (transaction atomique, verrou de file)
 *   2. diffusion du nouvel état public à tous les clients connectés
 *   3. envoi des notifications que la base vient de réclamer
 *
 * L'ordre compte : on ne notifie jamais avant que la transition soit
 * réellement committée, et l'écran se met à jour avant la notification.
 */

async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc(fn, params);
  if (error) throw toAppError(error);
  return data as T;
}

/* ====================================================================
   Lecture
   ==================================================================== */

export async function resolveEntryPoint(slug: string): Promise<EntryPoint | null> {
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(clean)) return null;
  const data = await rpc<EntryPoint | null>('resolve_entry_point', { p_slug: clean });
  return data ?? null;
}

export async function getQueueSnapshot(queueId: string): Promise<QueueSnapshot | null> {
  return (await rpc<QueueSnapshot | null>('queue_snapshot', { p_queue_id: queueId })) ?? null;
}

export async function getPublicQueueState(queueId: string): Promise<PublicQueueState | null> {
  return (await rpc<PublicQueueState | null>('public_queue_state', { p_queue_id: queueId })) ?? null;
}

export async function getTicketState(
  entryPublicId: string,
  clientSessionId: string,
): Promise<TicketState | null> {
  return (
    (await rpc<TicketState | null>('ticket_state', {
      p_entry_public_id: entryPublicId,
      p_client_session_id: clientSessionId,
    })) ?? null
  );
}

/** Retrouve le ticket en cours d'un appareil : reprise de session. */
export async function findActiveTicket(clientSessionId: string): Promise<TicketState | null> {
  return (
    (await rpc<TicketState | null>('find_active_ticket', {
      p_client_session_id: clientSessionId,
    })) ?? null
  );
}

/* ====================================================================
   Propagation après mutation
   ==================================================================== */

/**
 * Diffuse l'état et envoie les notifications dues.
 * Ni la diffusion ni l'envoi ne peuvent faire échouer la mutation : elle
 * est déjà committée. En cas de panne d'un canal, les clients gardent
 * leur repli par interrogation et le journal d'envoi porte la trace.
 */
export async function propagate(queueId: string): Promise<{
  state: PublicQueueState | null;
  notifications: Awaited<ReturnType<typeof dispatchQueueNotifications>>;
}> {
  let state: PublicQueueState | null = null;
  try {
    state = await getPublicQueueState(queueId);
    if (state) await broadcastQueueState(state);
  } catch (error) {
    console.error('[queue] diffusion impossible', error);
  }

  let notifications = { claimed: 0, sent: 0, failed: 0, skipped: 0, reasons: [] as string[] };
  try {
    notifications = await dispatchQueueNotifications(queueId);
  } catch (error) {
    console.error('[queue] notifications impossibles', error);
  }

  return { state, notifications };
}

/* ====================================================================
   Mutations client
   ==================================================================== */

export interface JoinQueueInput {
  queueId: string;
  clientSessionId: string;
  clientName?: string | null;
  staffId?: string | null;
  serviceId?: string | null;
  source?: EntrySource;
  plateId?: string | null;
}

export async function joinQueue(input: JoinQueueInput): Promise<{
  entry: ClientEntry;
  rejoined: boolean;
  queueId: string;
}> {
  const result = await rpc<{ entry: ClientEntry; rejoined: boolean; queueId: string }>('join_queue', {
    p_queue_id: input.queueId,
    p_client_session_id: input.clientSessionId,
    p_client_name: input.clientName ?? null,
    p_staff_id: input.staffId ?? null,
    p_service_id: input.serviceId ?? null,
    p_source: input.source ?? 'qr',
    p_plate_id: input.plateId ?? null,
  });

  if (!result.rejoined) {
    await propagate(input.queueId);
  }
  return result;
}

export type ClientAction = 'leave' | 'returning' | 'present';

export async function clientAction(
  entryPublicId: string,
  clientSessionId: string,
  action: ClientAction,
): Promise<{ entry: ClientEntry; queueId: string }> {
  const result = await rpc<{ entry: ClientEntry; queueId: string }>('client_queue_action', {
    p_entry_public_id: entryPublicId,
    p_client_session_id: clientSessionId,
    p_action: action,
  });

  await propagate(result.queueId);
  if (action === 'leave') {
    await broadcastTicketEvent(result.queueId, entryPublicId, 'cancelled');
  }
  return result;
}

/* ====================================================================
   Mutations professionnelles
   ==================================================================== */

export type StaffAction =
  | 'complete' | 'start_serving' | 'call' | 'mark_present' | 'mark_absent'
  | 'defer' | 'remove' | 'restore' | 'cancel' | 'assign_staff' | 'note';

export const STAFF_ACTIONS: readonly StaffAction[] = [
  'complete', 'start_serving', 'call', 'mark_present', 'mark_absent',
  'defer', 'remove', 'restore', 'cancel', 'assign_staff', 'note',
];

export interface StaffActionResult {
  entry: StaffEntry;
  promoted: StaffEntry | null;
  queueId: string;
  organizationId: string;
  locationId: string;
  notifications: { claimed: number; sent: number; failed: number; skipped: number };
}

export async function staffAction(params: {
  entryPublicId: string;
  action: StaffAction;
  actorUserId?: string | null;
  actorStaffId?: string | null;
  options?: Record<string, unknown>;
}): Promise<StaffActionResult> {
  if (!STAFF_ACTIONS.includes(params.action)) {
    throw new AppError('invalid_action', 'Action inconnue.', 400);
  }

  const result = await rpc<Omit<StaffActionResult, 'notifications'>>('staff_queue_action', {
    p_entry_public_id: params.entryPublicId,
    p_action: params.action,
    p_actor_user_id: params.actorUserId ?? null,
    p_actor_staff_id: params.actorStaffId ?? null,
    p_options: params.options ?? {},
  });

  const { notifications } = await propagate(result.queueId);

  // Fin de passage : on remercie le client et on lui propose l'avis
  // Google de CET établissement. Le ticket n'est plus actif, donc cette
  // notification-là ne passe pas par le balayage de file.
  let extra = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  if (params.action === 'complete') {
    const entryId = await internalIdFor(params.entryPublicId);
    if (entryId) {
      const summary = await dispatchEntryNotification(entryId, 'visit_completed');
      extra = summary;
    }
    await broadcastTicketEvent(result.queueId, params.entryPublicId, 'completed');
  } else if (params.action === 'remove' || params.action === 'cancel') {
    const entryId = await internalIdFor(params.entryPublicId);
    if (entryId) {
      const summary = await dispatchEntryNotification(entryId, 'removed');
      extra = summary;
    }
    await broadcastTicketEvent(result.queueId, params.entryPublicId, 'removed');
  } else if (params.action === 'call') {
    await broadcastTicketEvent(result.queueId, params.entryPublicId, 'called');
  }

  return {
    ...result,
    notifications: {
      claimed: notifications.claimed + extra.claimed,
      sent: notifications.sent + extra.sent,
      failed: notifications.failed + extra.failed,
      skipped: notifications.skipped + extra.skipped,
    },
  };
}

async function internalIdFor(entryPublicId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('queue_entries')
    .select('id')
    .eq('public_id', entryPublicId)
    .maybeSingle();
  return data?.id ?? null;
}

export async function addWalkin(params: {
  queueId: string;
  clientName: string;
  staffId?: string | null;
  serviceId?: string | null;
  actorUserId?: string | null;
  actorStaffId?: string | null;
}): Promise<{ entry: StaffEntry; queueId: string }> {
  const result = await rpc<{ entry: StaffEntry; queueId: string }>('add_walkin', {
    p_queue_id: params.queueId,
    p_client_name: params.clientName,
    p_staff_id: params.staffId ?? null,
    p_service_id: params.serviceId ?? null,
    p_actor_user_id: params.actorUserId ?? null,
    p_actor_staff_id: params.actorStaffId ?? null,
  });
  await propagate(params.queueId);
  return result;
}

export async function setQueueStatus(params: {
  queueId: string;
  status: QueueStatus;
  actorUserId?: string | null;
  reason?: string | null;
}): Promise<{ queueId: string; status: QueueStatus; pauseReason: string | null; activeCount: number }> {
  const result = await rpc<{
    queueId: string; status: QueueStatus; pauseReason: string | null; activeCount: number;
  }>('set_queue_status', {
    p_queue_id: params.queueId,
    p_status: params.status,
    p_actor_user_id: params.actorUserId ?? null,
    p_reason: params.reason ?? null,
  });
  await propagate(params.queueId);
  return result;
}

/* ====================================================================
   Maintenance
   ==================================================================== */

/** Expire les tickets oubliés, puis rafraîchit les files concernées. */
export async function expireStaleEntries(): Promise<{ queues: number; expired: number }> {
  const rows = await rpc<{ queue_id: string; expired: number }[]>('expire_stale_entries', {});
  let expired = 0;
  for (const row of rows ?? []) {
    expired += row.expired;
    await propagate(row.queue_id);
  }
  return { queues: rows?.length ?? 0, expired };
}

export async function purgeExpiredData(): Promise<Record<string, unknown>> {
  return rpc<Record<string, unknown>>('purge_expired_data', {});
}
