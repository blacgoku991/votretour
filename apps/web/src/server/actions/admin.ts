'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
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

/* ===================================================================
   PLAQUES — vue plateforme
   ===================================================================
   L'espace plateforme voit et pilote toutes les plaques de tous les
   établissements : c'est ce qui permet de dépanner un commerçant au
   téléphone ou de désactiver une plaque volée sans attendre qu'il le
   fasse lui-même. Chaque geste est journalisé sous l'identité de
   l'administrateur, dans l'organisation concernée.
   =================================================================== */

const adminPlateSchema = z.object({
  plateId: z.string().uuid(),
  label: z.string().trim().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
  kind: z.enum(['nfc', 'qr', 'both']).optional(),
  queueId: z.string().uuid().nullish(),
});

export async function adminUpdatePlate(
  input: z.input<typeof adminPlateSchema>,
): Promise<Result<{ plateId: string }>> {
  try {
    const parsed = adminPlateSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    // On relit la plaque pour connaître son organisation : le journal
    // d'audit doit pointer la bonne, et une file rattachée doit
    // appartenir au même établissement.
    const { data: plate } = await db
      .from('plates')
      .select('id, organization_id, location_id, label')
      .eq('id', parsed.plateId)
      .maybeSingle();
    if (!plate) throw new AppError('not_found', 'Plaque introuvable.', 404);

    const patch: Record<string, unknown> = {};
    if (parsed.label !== undefined) patch.label = parsed.label;
    if (parsed.isActive !== undefined) patch.is_active = parsed.isActive;
    if (parsed.kind !== undefined) patch.kind = parsed.kind;

    if (parsed.queueId !== undefined) {
      if (parsed.queueId) {
        const { data: queue } = await db
          .from('queues').select('id')
          .eq('id', parsed.queueId)
          .eq('location_id', plate.location_id)
          .maybeSingle();
        if (!queue) {
          throw new AppError(
            'invalid_queue',
            "Cette file n'appartient pas à l'établissement de la plaque.",
            400,
          );
        }
      }
      patch.queue_id = parsed.queueId;
    }

    if (Object.keys(patch).length === 0) return { ok: true, data: { plateId: parsed.plateId } };

    const { error } = await db.from('plates').update(patch).eq('id', parsed.plateId);
    if (error) throw error;

    await audit({
      organizationId: plate.organization_id,
      actorUserId: admin.id,
      action: 'plate.updated_by_platform',
      targetType: 'plate',
      targetId: parsed.plateId,
      metadata: { ...patch, plateLabel: plate.label },
    });

    revalidatePath('/admin/plaques');
    return { ok: true, data: { plateId: parsed.plateId } };
  } catch (error) {
    return fail(error);
  }
}

const adminPlateWriteSchema = z.object({
  plateId: z.string().uuid(),
  writtenUrl: z.string().url().max(2048),
  serialNumber: z.string().trim().max(64).nullish(),
  locked: z.boolean().default(false),
  verified: z.boolean().default(false),
});

/**
 * Enregistre une programmation NFC faite depuis l'espace plateforme —
 * typiquement lors de la préparation d'un lot de plaques avant envoi.
 */
export async function adminRecordPlateProgrammed(
  input: z.input<typeof adminPlateWriteSchema>,
): Promise<Result<{ plateId: string; verified: boolean }>> {
  try {
    const parsed = adminPlateWriteSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: plate } = await db
      .from('plates').select('id, organization_id')
      .eq('id', parsed.plateId).maybeSingle();
    if (!plate) throw new AppError('not_found', 'Plaque introuvable.', 404);

    const { error } = await db.rpc('record_plate_write', {
      p_organization_id: plate.organization_id,
      p_plate_id: parsed.plateId,
      p_written_by: admin.id,
      p_written_url: parsed.writtenUrl,
      p_nfc_serial: parsed.serialNumber ?? null,
      p_locked: parsed.locked,
      p_verified: parsed.verified,
    });
    if (error) throw error;

    await audit({
      organizationId: plate.organization_id,
      actorUserId: admin.id,
      action: 'plate.programmed_by_platform',
      targetType: 'plate',
      targetId: parsed.plateId,
      metadata: { verified: parsed.verified, locked: parsed.locked, serial: parsed.serialNumber ?? null },
    });

    revalidatePath('/admin/plaques');
    return { ok: true, data: { plateId: parsed.plateId, verified: parsed.verified } };
  } catch (error) {
    return fail(error);
  }
}


const adminCreatePlateSchema = z.object({
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  kind: z.enum(['nfc', 'qr', 'both']).default('both'),
  queueId: z.string().uuid().nullish(),
});

/** Crée une plaque depuis l'espace plateforme, sans exposer ce réglage au commerçant. */
export async function adminCreatePlate(
  input: z.input<typeof adminCreatePlateSchema>,
): Promise<Result<{ plateId: string; code: string }>> {
  try {
    const parsed = adminCreatePlateSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: location } = await db
      .from('locations')
      .select('id, name, organization_id')
      .eq('id', parsed.locationId)
      .eq('organization_id', parsed.organizationId)
      .maybeSingle();

    if (!location) throw new AppError('not_found', 'Établissement introuvable.', 404);

    const { data, error } = await db.rpc('create_plate', {
      p_location_id: parsed.locationId,
      p_label: parsed.label,
      p_queue_id: parsed.queueId ?? null,
      p_staff_id: null,
      p_kind: parsed.kind,
      p_created_by: admin.id,
      p_slug_hint: `${location.name}-${parsed.label}`,
    });
    if (error) throw error;

    const plate = data as { id: string; code: string };

    await audit({
      organizationId: parsed.organizationId,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'plate.created_by_platform',
      targetType: 'plate',
      targetId: plate.id,
      metadata: { code: plate.code, label: parsed.label, kind: parsed.kind },
    });

    revalidatePath('/admin/plaques');
    return { ok: true, data: { plateId: plate.id, code: plate.code } };
  } catch (error) {
    return fail(error);
  }
}

const adminDeletePlateSchema = z.object({
  plateId: z.string().uuid(),
});

/** Suppression définitive d'une plaque par le super-admin uniquement. */
export async function adminDeletePlate(
  input: z.input<typeof adminDeletePlateSchema>,
): Promise<Result<{ plateId: string }>> {
  try {
    const parsed = adminDeletePlateSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: plate } = await db
      .from('plates')
      .select('id, code, label, organization_id')
      .eq('id', parsed.plateId)
      .maybeSingle();

    if (!plate) throw new AppError('not_found', 'Plaque introuvable.', 404);

    await audit({
      organizationId: plate.organization_id,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'plate.deleted_by_platform',
      targetType: 'plate',
      targetId: plate.id,
      metadata: { code: plate.code, label: plate.label },
    });

    const { error } = await db.from('plates').delete().eq('id', plate.id);
    if (error) throw error;

    await db.from('slug_registry')
      .delete()
      .eq('kind', 'plate')
      .eq('ref_id', plate.id);

    revalidatePath('/admin/plaques');
    return { ok: true, data: { plateId: plate.id } };
  } catch (error) {
    return fail(error);
  }
}


/* ===================================================================
   ORGANISATIONS — contrôle plateforme renforcé
   =================================================================== */

const adminOrgUpdateSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2).max(120).optional(),
  activity: z.enum([
    'barber','hair_salon','nail_bar','beauty','phone_repair','garage',
    'auto_center','shop','aftersales','restaurant','counter',
    'admin_service','health','event','other',
  ]).optional(),
});

export async function adminUpdateOrganization(
  input: z.input<typeof adminOrgUpdateSchema>,
): Promise<Result<{ organizationId: string }>> {
  try {
    const parsed = adminOrgUpdateSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const patch: Record<string, unknown> = {};
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.activity !== undefined) patch.activity = parsed.activity;

    if (Object.keys(patch).length === 0) {
      return { ok: true, data: { organizationId: parsed.organizationId } };
    }

    const { error } = await supabaseAdmin()
      .from('organizations')
      .update(patch)
      .eq('id', parsed.organizationId);
    if (error) throw error;

    await audit({
      organizationId: parsed.organizationId,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'organization.updated_by_platform',
      targetType: 'organization',
      targetId: parsed.organizationId,
      metadata: patch,
    });

    revalidatePath('/admin/etablissements');
    revalidatePath(`/admin/etablissements/${parsed.organizationId}`);
    return { ok: true, data: { organizationId: parsed.organizationId } };
  } catch (error) {
    return fail(error);
  }
}

export async function adminRevokeOrganizationSessions(
  organizationId: string,
): Promise<Result<{ revoked: number }>> {
  try {
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: sessions, error } = await db
      .from('client_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .is('revoked_at', null)
      .select('id');
    if (error) throw error;

    await db.from('notification_subscriptions')
      .update({ is_active: false })
      .eq('organization_id', organizationId)
      .eq('is_active', true);

    await audit({
      organizationId,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'organization.sessions_revoked',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { count: sessions?.length ?? 0 },
    });

    return { ok: true, data: { revoked: sessions?.length ?? 0 } };
  } catch (error) {
    return fail(error);
  }
}

const adminDeleteOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
  confirmationName: z.string().trim().min(1).max(120),
});

export async function adminDeleteOrganization(
  input: z.input<typeof adminDeleteOrganizationSchema>,
): Promise<Result<{ organizationId: string }>> {
  try {
    const parsed = adminDeleteOrganizationSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: organization } = await db
      .from('organizations')
      .select('id, name, slug, status')
      .eq('id', parsed.organizationId)
      .maybeSingle();

    if (!organization) throw new AppError('not_found', 'Organisation introuvable.', 404);
    if (parsed.confirmationName !== organization.name) {
      throw new AppError('confirmation', 'Le nom de confirmation ne correspond pas.', 422);
    }
    if (organization.status !== 'suspended') {
      throw new AppError(
        'safe_delete',
        'Suspendez d’abord l’organisation avant de la supprimer.',
        409,
      );
    }

    const [{ count: activeEntries }, { data: subscription }] = await Promise.all([
      db.from('queue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .in('status', ['waiting','notified','returning','present','next','serving']),
      db.from('subscriptions')
        .select('status, stripe_subscription_id')
        .eq('organization_id', organization.id)
        .maybeSingle(),
    ]);

    if ((activeEntries ?? 0) > 0) {
      throw new AppError('safe_delete', 'Des clients sont encore dans une file active.', 409);
    }
    if (subscription?.stripe_subscription_id && !['canceled','incomplete'].includes(subscription.status)) {
      throw new AppError(
        'safe_delete',
        'Un abonnement Stripe est encore actif. Annulez-le avant la suppression définitive.',
        409,
      );
    }

    // L'audit est écrit AVANT la suppression. audit_logs.organization_id
    // est ON DELETE SET NULL : la preuve reste conservée après suppression.
    await audit({
      organizationId: organization.id,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'organization.deleted_by_platform',
      targetType: 'organization',
      targetId: organization.id,
      metadata: { name: organization.name, slug: organization.slug },
    });

    const { error } = await db.from('organizations').delete().eq('id', organization.id);
    if (error) throw error;

    revalidatePath('/admin', 'layout');
    return { ok: true, data: { organizationId: organization.id } };
  } catch (error) {
    return fail(error);
  }
}
