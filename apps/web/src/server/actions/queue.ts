'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import {
  addWalkin, getQueueSnapshot, setQueueStatus, staffAction,
  type StaffAction, STAFF_ACTIONS,
} from '@/server/queue';
import { assertEntryAccess, assertQueueAccess, getStaffRecord } from '@/server/auth';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';
import { audit } from '@/server/audit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { QueueSnapshot, QueueStatus } from '@/lib/types';

/**
 * Actions serveur du tableau de bord.
 *
 * Chacune revérifie, à chaque appel :
 *   1. que l'utilisateur est connecté ;
 *   2. qu'il appartient bien à l'organisation propriétaire de la file ;
 *   3. que son rôle l'autorise à cette opération.
 *
 * Rien n'est déduit de l'URL ni d'un état côté navigateur.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

function fail(error: unknown): ActionResult<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[action]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const entryActionSchema = z.object({
  entryId: z.string().regex(/^[0-9a-zA-Z]{8,32}$/),
  action: z.enum(STAFF_ACTIONS as unknown as [StaffAction, ...StaffAction[]]),
  options: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Fait avancer la file. C'est l'action la plus utilisée du produit :
 * un seul geste du professionnel déclenche la transition, le recalcul
 * de toutes les positions, la diffusion temps réel, les notifications
 * et l'écriture de l'historique.
 */
export async function advanceEntry(input: {
  entryId: string;
  action: StaffAction;
  options?: Record<string, unknown>;
}): Promise<ActionResult<{ snapshot: QueueSnapshot | null; notifications: { sent: number; failed: number; skipped: number } }>> {
  try {
    const parsed = entryActionSchema.parse(input);
    const access = await assertEntryAccess(parsed.entryId, 'queue.operate');

    await enforceRateLimit(
      `staff:${access.user.id}`, LIMITS.staffAction.max, LIMITS.staffAction.window,
    );

    // Si le compte connecté correspond à une fiche employé, l'action lui
    // est attribuée : c'est ce qui permet à deux barbiers de servir en
    // parallèle sans se marcher dessus.
    const { data: queue } = await supabaseAdmin()
      .from('queues').select('location_id').eq('id', access.queueId).maybeSingle();
    const staff = queue ? await getStaffRecord(access.user.id, queue.location_id) : null;

    const result = await staffAction({
      entryPublicId: parsed.entryId,
      action: parsed.action,
      actorUserId: access.user.id,
      actorStaffId: staff?.id ?? null,
      options: parsed.options,
    });

    const snapshot = await getQueueSnapshot(result.queueId);
    return {
      ok: true,
      data: {
        snapshot,
        notifications: {
          sent: result.notifications.sent,
          failed: result.notifications.failed,
          skipped: result.notifications.skipped,
        },
      },
    };
  } catch (error) {
    return fail(error);
  }
}

const walkinSchema = z.object({
  queueId: z.string().uuid(),
  name: z.string().trim().min(1, 'Indiquez un prénom.').max(40),
  staffId: z.string().uuid().nullish(),
  serviceId: z.string().uuid().nullish(),
});

/** Ajoute quelqu'un au comptoir (client sans téléphone, appel entrant…). */
export async function addWalkinEntry(
  input: z.input<typeof walkinSchema>,
): Promise<ActionResult<{ snapshot: QueueSnapshot | null }>> {
  try {
    const parsed = walkinSchema.parse(input);
    const access = await assertQueueAccess(parsed.queueId, 'queue.operate');
    await enforceRateLimit(`staff:${access.user.id}`, LIMITS.staffAction.max, LIMITS.staffAction.window);

    await addWalkin({
      queueId: parsed.queueId,
      clientName: parsed.name,
      staffId: parsed.staffId ?? null,
      serviceId: parsed.serviceId ?? null,
      actorUserId: access.user.id,
    });

    return { ok: true, data: { snapshot: await getQueueSnapshot(parsed.queueId) } };
  } catch (error) {
    return fail(error);
  }
}

const statusSchema = z.object({
  queueId: z.string().uuid(),
  status: z.enum(['open', 'paused', 'closed']),
  reason: z.string().trim().max(120).nullish(),
});

export async function changeQueueStatus(
  input: z.input<typeof statusSchema>,
): Promise<ActionResult<{ snapshot: QueueSnapshot | null }>> {
  try {
    const parsed = statusSchema.parse(input);
    const access = await assertQueueAccess(parsed.queueId, 'queue.operate');

    await setQueueStatus({
      queueId: parsed.queueId,
      status: parsed.status as QueueStatus,
      actorUserId: access.user.id,
      reason: parsed.reason ?? null,
    });

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: `queue.${parsed.status}`,
      targetType: 'queue',
      targetId: parsed.queueId,
      metadata: { reason: parsed.reason ?? null },
    });

    return { ok: true, data: { snapshot: await getQueueSnapshot(parsed.queueId) } };
  } catch (error) {
    return fail(error);
  }
}

/** Rafraîchissement complet de l'écran (temps réel, retour de veille). */
export async function fetchQueueSnapshot(
  queueId: string,
): Promise<ActionResult<{ snapshot: QueueSnapshot | null }>> {
  try {
    if (!z.string().uuid().safeParse(queueId).success) {
      throw new AppError('validation', 'File invalide.', 422);
    }
    await assertQueueAccess(queueId, 'queue.operate');
    return { ok: true, data: { snapshot: await getQueueSnapshot(queueId) } };
  } catch (error) {
    return fail(error);
  }
}

const breakSchema = z.object({
  staffId: z.string().uuid(),
  onBreak: z.boolean(),
});

/** Met un professionnel en pause : il cesse de recevoir des clients. */
export async function toggleStaffBreak(
  input: z.input<typeof breakSchema>,
): Promise<ActionResult<{ staffId: string; onBreak: boolean }>> {
  try {
    const parsed = breakSchema.parse(input);
    const db = supabaseAdmin();
    const { data: staff } = await db
      .from('staff').select('organization_id, location_id').eq('id', parsed.staffId).maybeSingle();
    if (!staff) throw new AppError('not_found', 'Professionnel introuvable.', 404);

    const { data: queue } = await db
      .from('queues').select('id').eq('location_id', staff.location_id).limit(1).maybeSingle();
    if (queue) await assertQueueAccess(queue.id, 'queue.operate');

    await db.from('staff').update({ is_on_break: parsed.onBreak }).eq('id', parsed.staffId);
    return { ok: true, data: { staffId: parsed.staffId, onBreak: parsed.onBreak } };
  } catch (error) {
    return fail(error);
  }
}

const noteSchema = z.object({
  entryId: z.string().regex(/^[0-9a-zA-Z]{8,32}$/),
  note: z.string().trim().max(280),
});

export async function setEntryNote(
  input: z.input<typeof noteSchema>,
): Promise<ActionResult<{ snapshot: QueueSnapshot | null }>> {
  try {
    const parsed = noteSchema.parse(input);
    const access = await assertEntryAccess(parsed.entryId, 'queue.operate');
    const result = await staffAction({
      entryPublicId: parsed.entryId,
      action: 'note',
      actorUserId: access.user.id,
      options: { note: parsed.note },
    });
    return { ok: true, data: { snapshot: await getQueueSnapshot(result.queueId) } };
  } catch (error) {
    return fail(error);
  }
}

/** Force une revalidation de page après un changement de configuration. */
export async function revalidateOrg(orgSlug: string): Promise<void> {
  revalidatePath(`/app/${orgSlug}`, 'layout');
}
