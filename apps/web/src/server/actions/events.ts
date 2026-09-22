'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { audit } from '@/server/audit';
import { assertQueueAccess } from '@/server/auth';
import { propagate, setQueueStatus } from '@/server/queue';
import { dispatchEventEntryNotification } from '@/server/notifications/dispatch';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';
import { hashEventPassToken, verifyEventPassSignature } from '@/lib/event-pass';

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[events]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const createSchema = z.object({
  queueId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  waveSize: z.number().int().min(1).max(200).default(10),
  passValidMinutes: z.number().int().min(1).max(120).default(10),
  graceMinutes: z.number().int().min(0).max(60).default(5),
  publicNote: z.string().trim().max(500).nullish(),
});

export async function createEventCampaign(
  input: z.input<typeof createSchema>,
): Promise<Result<{ eventId: string }>> {
  try {
    const parsed = createSchema.parse(input);
    const access = await assertQueueAccess(parsed.queueId, 'queue.configure');
    const db = supabaseAdmin();

    const { data, error } = await db.from('event_campaigns').insert({
      organization_id: access.organizationId,
      location_id: access.locationId,
      queue_id: parsed.queueId,
      name: parsed.name,
      wave_size: parsed.waveSize,
      pass_valid_minutes: parsed.passValidMinutes,
      grace_minutes: parsed.graceMinutes,
      public_note: parsed.publicNote ?? null,
      created_by: access.user.id,
    }).select('id').single();

    if (error || !data) throw error ?? new Error('Création impossible.');

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: 'event.created',
      targetType: 'event',
      targetId: data.id,
      metadata: {
        name: parsed.name,
        waveSize: parsed.waveSize,
        passValidMinutes: parsed.passValidMinutes,
        graceMinutes: parsed.graceMinutes,
      },
    });

    revalidatePath('/app', 'layout');
    return { ok: true, data: { eventId: data.id } };
  } catch (error) {
    return fail(error);
  }
}

const stateSchema = z.object({
  eventId: z.string().uuid(),
  action: z.enum(['start', 'pause', 'resume', 'sold_out', 'end']),
});

async function readEvent(eventId: string) {
  const { data, error } = await supabaseAdmin()
    .from('event_campaigns')
    .select('id, queue_id, organization_id, location_id, name, status, locations(slug)')
    .eq('id', eventId)
    .maybeSingle();
  if (error || !data) throw new AppError('not_found', 'Événement introuvable.', 404);
  return data;
}

export async function changeEventState(
  input: z.input<typeof stateSchema>,
): Promise<Result<{ status: string; notified: number }>> {
  try {
    const parsed = stateSchema.parse(input);
    const event = await readEvent(parsed.eventId);
    const access = await assertQueueAccess(event.queue_id, 'queue.operate');
    await enforceRateLimit(
      `event-state:${access.user.id}`,
      LIMITS.staffAction.max,
      LIMITS.staffAction.window,
    );

    const db = supabaseAdmin();

    if (parsed.action === 'start' || parsed.action === 'resume') {
      const { error } = await db.from('event_campaigns').update({
        status: 'live',
        started_at: parsed.action === 'start' ? new Date().toISOString() : undefined,
        ended_at: null,
      }).eq('id', event.id);
      if (error) throw error;

      await setQueueStatus({
        queueId: event.queue_id,
        status: 'open',
        actorUserId: access.user.id,
        reason: null,
      });

      await audit({
        organizationId: access.organizationId,
        actorUserId: access.user.id,
        action: parsed.action === 'start' ? 'event.started' : 'event.resumed',
        targetType: 'event',
        targetId: event.id,
      });

      revalidatePath('/app', 'layout');
      return { ok: true, data: { status: 'live', notified: 0 } };
    }

    if (parsed.action === 'pause') {
      const { error } = await db.from('event_campaigns')
        .update({ status: 'paused' })
        .eq('id', event.id)
        .in('status', ['live', 'paused']);
      if (error) throw error;

      await audit({
        organizationId: access.organizationId,
        actorUserId: access.user.id,
        action: 'event.paused',
        targetType: 'event',
        targetId: event.id,
      });

      revalidatePath('/app', 'layout');
      return { ok: true, data: { status: 'paused', notified: 0 } };
    }

    const reason = parsed.action === 'sold_out' ? 'sold_out' : 'ended';
    const { data, error } = await db.rpc('close_event_campaign', {
      p_event_id: event.id,
      p_actor_user_id: access.user.id,
      p_reason: reason,
    });
    if (error) throw error;

    const affected = (data ?? []) as { entry_id: string; entry_public_id: string }[];
    const locationRelation = Array.isArray(event.locations) ? event.locations[0] : event.locations;
    const locationSlug = locationRelation?.slug ?? '';
    let notified = 0;
    const kind = parsed.action === 'sold_out' ? 'event_sold_out' as const : 'event_ended' as const;

    for (const row of affected) {
      const summary = await dispatchEventEntryNotification(
        row.entry_id,
        kind,
        `${env.siteUrl}/e/${locationSlug}`,
      );
      notified += summary.sent;
    }

    await propagate(event.queue_id);

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: parsed.action === 'sold_out' ? 'event.sold_out' : 'event.ended',
      targetType: 'event',
      targetId: event.id,
      metadata: { affected: affected.length, notificationsSent: notified },
    });

    revalidatePath('/app', 'layout');
    return {
      ok: true,
      data: { status: parsed.action === 'sold_out' ? 'sold_out' : 'ended', notified },
    };
  } catch (error) {
    return fail(error);
  }
}

const waveSchema = z.object({
  eventId: z.string().uuid(),
  count: z.number().int().min(1).max(200).optional(),
});

export async function callEventWave(
  input: z.input<typeof waveSchema>,
): Promise<Result<{ issued: number; notificationsSent: number; failed: number }>> {
  try {
    const parsed = waveSchema.parse(input);
    const event = await readEvent(parsed.eventId);
    const access = await assertQueueAccess(event.queue_id, 'queue.operate');

    await enforceRateLimit(
      `event-wave:${access.user.id}`,
      LIMITS.staffAction.max,
      LIMITS.staffAction.window,
    );

    const { data, error } = await supabaseAdmin().rpc('issue_event_wave', {
      p_event_id: event.id,
      p_actor_user_id: access.user.id,
      p_count: parsed.count ?? null,
    });
    if (error) throw error;

    const issued = (data ?? []) as {
      entry_id: string;
      entry_public_id: string;
      pass_public_id: string;
      raw_token: string;
      valid_until: string;
      grace_until: string;
    }[];

    let notificationsSent = 0;
    let failed = 0;

    for (const row of issued) {
      // Le bearer token n'est présent qu'ici et dans l'URL remise au client.
      // La base ne possède que son SHA-256.
      const passUrl = `${env.siteUrl}/pass/${encodeURIComponent(row.raw_token)}`;
      const summary = await dispatchEventEntryNotification(
        row.entry_id,
        'event_access',
        passUrl,
      );
      notificationsSent += summary.sent;
      failed += summary.failed;
    }

    await propagate(event.queue_id);

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: 'event.wave_called',
      targetType: 'event',
      targetId: event.id,
      metadata: { requested: parsed.count ?? null, issued: issued.length, notificationsSent, failed },
    });

    revalidatePath('/app', 'layout');
    return { ok: true, data: { issued: issued.length, notificationsSent, failed } };
  } catch (error) {
    return fail(error);
  }
}

const redeemSchema = z.object({
  passId: z.string().regex(/^[0-9A-Za-z]{12,32}$/),
  slot: z.number().int().positive(),
  signature: z.string().min(16).max(64),
});

export async function redeemEventPass(
  input: z.input<typeof redeemSchema>,
): Promise<Result<{ status: string; clientName?: string | null; redeemedAt?: string | null }>> {
  try {
    const parsed = redeemSchema.parse(input);
    const db = supabaseAdmin();
    const { data: pass } = await db
      .from('event_access_passes')
      .select('token_hash, event_id, event_campaigns(queue_id, organization_id)')
      .eq('public_id', parsed.passId)
      .maybeSingle();

    if (!pass) {
      throw new AppError('not_found', 'Laisser-passer introuvable.', 404);
    }

    const tokenHash = pass.token_hash;
    if (!verifyEventPassSignature(tokenHash, parsed.slot, parsed.signature)) {
      throw new AppError('invalid_pass', 'Ce QR a expiré. Demandez au client de rouvrir son laisser-passer.', 409);
    }

    const eventRelation = Array.isArray(pass?.event_campaigns)
      ? pass?.event_campaigns[0]
      : pass?.event_campaigns;

    if (!eventRelation?.queue_id) {
      throw new AppError('not_found', 'Laisser-passer introuvable.', 404);
    }

    const access = await assertQueueAccess(eventRelation.queue_id, 'queue.operate');

    await enforceRateLimit(
      `event-redeem:${access.user.id}`,
      LIMITS.staffAction.max,
      LIMITS.staffAction.window,
    );

    const { data, error } = await db.rpc('redeem_event_pass', {
      p_token_hash: tokenHash,
      p_actor_user_id: access.user.id,
    });
    if (error) throw error;

    const result = data as {
      status: string;
      queueId?: string;
      clientName?: string | null;
      redeemedAt?: string | null;
      passPublicId?: string;
    };

    if (result.queueId) await propagate(result.queueId);

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: 'event.pass_checked',
      targetType: 'event_pass',
      targetId: result.passPublicId ?? null,
      metadata: { result: result.status },
    });

    return {
      ok: true,
      data: {
        status: result.status,
        clientName: result.clientName ?? null,
        redeemedAt: result.redeemedAt ?? null,
      },
    };
  } catch (error) {
    return fail(error);
  }
}
