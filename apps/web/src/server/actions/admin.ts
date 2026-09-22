'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { toAppError } from '@/lib/errors';
import { assertPlatformAdmin } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/server/audit';
import { setQueueStatus } from '@/server/queue';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[admin]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const suspendSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Indiquez un motif.').max(200),
});

/**
 * Suspension d'une organisation.
 *
 * Suspendre ne détruit rien : on ferme les files (pour que plus personne
 * ne puisse rejoindre) et on bloque l'accès. Les données restent
 * intactes et la réactivation les retrouve telles quelles.
 */
export async function suspendOrganization(
  input: z.input<typeof suspendSchema>,
): Promise<Result<{ organizationId: string; closedQueues: number }>> {
  try {
    const parsed = suspendSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { error } = await db.from('organizations').update({
      status: 'suspended',
      suspended_at: new Date().toISOString(),
      suspended_reason: parsed.reason,
    }).eq('id', parsed.organizationId);
    if (error) throw error;

    // On ferme les files ouvertes : sinon une plaque continuerait
    // d'accepter des clients dans un commerce suspendu.
    const { data: queues } = await db
      .from('queues').select('id')
      .eq('organization_id', parsed.organizationId).neq('status', 'closed');

    for (const queue of queues ?? []) {
      await setQueueStatus({
        queueId: queue.id, status: 'closed',
        actorUserId: admin.id, reason: 'Organisation suspendue',
      }).catch((error) => console.error('[admin] fermeture de file impossible', error));
    }

    await audit({
      organizationId: parsed.organizationId, actor: 'platform_admin', actorUserId: admin.id,
      action: 'organization.suspended', targetType: 'organization',
      targetId: parsed.organizationId, metadata: { reason: parsed.reason },
    });

    return { ok: true, data: { organizationId: parsed.organizationId, closedQueues: queues?.length ?? 0 } };
  } catch (error) {
    return fail(error);
  }
}

export async function reactivateOrganization(
  organizationId: string,
): Promise<Result<{ organizationId: string }>> {
  try {
    const admin = await assertPlatformAdmin();
    const { error } = await supabaseAdmin().from('organizations').update({
      status: 'active', suspended_at: null, suspended_reason: null,
    }).eq('id', organizationId);
    if (error) throw error;

    await audit({
      organizationId, actor: 'platform_admin', actorUserId: admin.id,
      action: 'organization.reactivated', targetType: 'organization', targetId: organizationId,
    });
    return { ok: true, data: { organizationId } };
  } catch (error) {
    return fail(error);
  }
}

const planSchema = z.object({
  planId: z.string().uuid(),
  name: z.string().trim().min(1).max(60).optional(),
  tagline: z.string().trim().max(160).nullish(),
  priceMonthCents: z.number().int().min(0).max(10_000_000).optional(),
  priceYearCents: z.number().int().min(0).max(100_000_000).optional(),
  stripePriceIdMonth: z.string().trim().max(120).nullish(),
  stripePriceIdYear: z.string().trim().max(120).nullish(),
  maxLocations: z.number().int().min(-1).max(10_000).optional(),
  maxStaff: z.number().int().min(-1).max(10_000).optional(),
  maxPlates: z.number().int().min(-1).max(10_000).optional(),
  maxQueues: z.number().int().min(-1).max(10_000).optional(),
  historyDays: z.number().int().min(1).max(3650).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

/** Les tarifs et quotas restent modifiables sans redéploiement. */
export async function updatePlan(
  input: z.input<typeof planSchema>,
): Promise<Result<{ planId: string }>> {
  try {
    const parsed = planSchema.parse(input);
    const admin = await assertPlatformAdmin();

    const map: Record<string, string> = {
      name: 'name', tagline: 'tagline',
      priceMonthCents: 'price_month_cents', priceYearCents: 'price_year_cents',
      stripePriceIdMonth: 'stripe_price_id_month', stripePriceIdYear: 'stripe_price_id_year',
      maxLocations: 'max_locations', maxStaff: 'max_staff', maxPlates: 'max_plates',
      maxQueues: 'max_queues', historyDays: 'history_days',
      isActive: 'is_active', isPublic: 'is_public',
    };
    const patch: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(map)) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value !== undefined) patch[column] = value;
    }

    const { error } = await supabaseAdmin().from('plans').update(patch).eq('id', parsed.planId);
    if (error) throw error;

    await audit({
      actor: 'platform_admin', actorUserId: admin.id, action: 'plan.updated',
      targetType: 'plan', targetId: parsed.planId, metadata: patch,
    });
    return { ok: true, data: { planId: parsed.planId } };
  } catch (error) {
    return fail(error);
  }
}

/** Accorde un dépassement de quota à une organisation, sans changer d'offre. */
export async function setQuotaOverride(
  organizationId: string,
  overrides: Record<string, number>,
): Promise<Result<{ organizationId: string }>> {
  try {
    const admin = await assertPlatformAdmin();
    const { error } = await supabaseAdmin()
      .from('subscriptions').update({ quota_overrides: overrides })
      .eq('organization_id', organizationId);
    if (error) throw error;

    await audit({
      organizationId, actor: 'platform_admin', actorUserId: admin.id,
      action: 'quota.override', targetType: 'organization', targetId: organizationId,
      metadata: overrides,
    });
    return { ok: true, data: { organizationId } };
  } catch (error) {
    return fail(error);
  }
}

export async function resolveSystemError(errorId: number): Promise<Result<{ id: number }>> {
  try {
    const admin = await assertPlatformAdmin();
    const { error } = await supabaseAdmin().from('system_errors').update({
      resolved_at: new Date().toISOString(), resolved_by: admin.id,
    }).eq('id', errorId);
    if (error) throw error;
    return { ok: true, data: { id: errorId } };
  } catch (error) {
    return fail(error);
  }
}

const ticketSchema = z.object({
  ticketId: z.string().uuid(),
  status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(),
  reply: z.string().trim().max(8000).optional(),
});

export async function updateSupportTicket(
  input: z.input<typeof ticketSchema>,
): Promise<Result<{ ticketId: string }>> {
  try {
    const parsed = ticketSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: ticket } = await db
      .from('support_tickets').select('organization_id').eq('id', parsed.ticketId).maybeSingle();
    if (!ticket) throw new Error('Demande introuvable.');

    if (parsed.reply) {
      await db.from('support_messages').insert({
        ticket_id: parsed.ticketId,
        organization_id: ticket.organization_id,
        author_id: admin.id,
        is_staff_reply: true,
        body: parsed.reply,
      });
    }
    if (parsed.status) {
      await db.from('support_tickets').update({
        status: parsed.status,
        resolved_at: parsed.status === 'resolved' ? new Date().toISOString() : null,
      }).eq('id', parsed.ticketId);
    }

    return { ok: true, data: { ticketId: parsed.ticketId } };
  } catch (error) {
    return fail(error);
  }
}

export async function revalidateAdmin(): Promise<void> {
  revalidatePath('/admin', 'layout');
}
