'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { assertPlatformAdmin } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/server/audit';

export type PlateResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

function fail(error: unknown): PlateResult<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[plates]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const createSchema = z.object({
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  queueId: z.string().uuid().nullish(),
  staffId: z.string().uuid().nullish(),
  kind: z.enum(['nfc', 'qr', 'both']).default('both'),
});

/**
 * Crée une plaque : un NFC, un QR et une URL unique. Le quota du plan
 * est vérifié côté base avant création.
 */
export async function createPlate(
  input: z.input<typeof createSchema>,
): Promise<PlateResult<{ code: string; id: string }>> {
  try {
    const parsed = createSchema.parse(input);
    const user = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: location } = await db
      .from('locations').select('id, name')
      .eq('id', parsed.locationId).eq('organization_id', parsed.organizationId).maybeSingle();
    if (!location) throw new AppError('not_found', 'Établissement introuvable.', 404);

    const { data: quota } = await db.rpc('check_org_quota', {
      p_organization_id: parsed.organizationId,
      p_resource: 'plates',
    });
    const q = quota as { allowed: boolean; limit: number; used: number } | null;
    if (q && !q.allowed) {
      throw new AppError(
        'quota',
        `Votre offre est limitée à ${q.limit} plaque${q.limit > 1 ? 's' : ''}. Passez à l'offre supérieure pour en ajouter.`,
        402,
      );
    }

    const { data, error } = await db.rpc('create_plate', {
      p_location_id: parsed.locationId,
      p_label: parsed.label,
      p_queue_id: parsed.queueId ?? null,
      p_staff_id: parsed.staffId ?? null,
      p_kind: parsed.kind,
      p_created_by: user.id,
      p_slug_hint: `${location.name}-${parsed.label}`,
    });
    if (error) throw error;

    const plate = data as { id: string; code: string };
    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'plate.created', targetType: 'plate', targetId: plate.id,
      metadata: { code: plate.code, label: parsed.label },
    });

    return { ok: true, data: plate };
  } catch (error) {
    return fail(error);
  }
}

const updateSchema = z.object({
  organizationId: z.string().uuid(),
  plateId: z.string().uuid(),
  label: z.string().trim().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
  queueId: z.string().uuid().nullish(),
  staffId: z.string().uuid().nullish(),
  kind: z.enum(['nfc', 'qr', 'both']).optional(),
});

export async function updatePlate(
  input: z.input<typeof updateSchema>,
): Promise<PlateResult<{ plateId: string }>> {
  try {
    const parsed = updateSchema.parse(input);
    const user = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const patch: Record<string, unknown> = {};
    if (parsed.label !== undefined) patch.label = parsed.label;
    if (parsed.isActive !== undefined) patch.is_active = parsed.isActive;
    if (parsed.queueId !== undefined) patch.queue_id = parsed.queueId;
    if (parsed.staffId !== undefined) patch.staff_id = parsed.staffId;
    if (parsed.kind !== undefined) patch.kind = parsed.kind;

    const { error } = await db
      .from('plates').update(patch)
      .eq('id', parsed.plateId)
      // Ceinture et bretelles : la plaque doit appartenir à l'organisation
      // dont on vient de vérifier l'appartenance.
      .eq('organization_id', parsed.organizationId);
    if (error) throw error;

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'plate.updated', targetType: 'plate', targetId: parsed.plateId, metadata: patch,
    });
    return { ok: true, data: { plateId: parsed.plateId } };
  } catch (error) {
    return fail(error);
  }
}

const orderSchema = z.object({
  organizationId: z.string().uuid(),
  plateId: z.string().uuid(),
  quantity: z.number().int().min(1).max(500),
  address: z.object({
    name: z.string().trim().min(1).max(120),
    line1: z.string().trim().min(1).max(160),
    line2: z.string().trim().max(160).optional(),
    postalCode: z.string().trim().min(2).max(12),
    city: z.string().trim().min(1).max(80),
    country: z.string().trim().length(2).default('FR'),
  }),
});

/**
 * Demande de plaques physiques. Le produit n'expédie rien lui-même :
 * la demande est enregistrée et traitée depuis l'espace plateforme.
 * On ne prétend pas qu'une commande est passée.
 */
export async function requestPhysicalPlates(
  input: z.input<typeof orderSchema>,
): Promise<PlateResult<{ reference: string }>> {
  try {
    const parsed = orderSchema.parse(input);
    const user = await assertPlatformAdmin();
    const reference = `VT-${Date.now().toString(36).toUpperCase()}`;

    const { error } = await supabaseAdmin()
      .from('plates')
      .update({
        order_status: 'requested',
        order_quantity: parsed.quantity,
        order_reference: reference,
        order_requested_at: new Date().toISOString(),
        shipping_address: parsed.address,
      })
      .eq('id', parsed.plateId)
      .eq('organization_id', parsed.organizationId);
    if (error) throw error;

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'plate.order_requested', targetType: 'plate', targetId: parsed.plateId,
      metadata: { reference, quantity: parsed.quantity },
    });

    return { ok: true, data: { reference } };
  } catch (error) {
    return fail(error);
  }
}

const writeSchema = z.object({
  organizationId: z.string().uuid(),
  plateId: z.string().uuid(),
  writtenUrl: z.string().url().max(2048),
  serialNumber: z.string().trim().max(64).nullish(),
  locked: z.boolean().default(false),
  verified: z.boolean().default(false),
});

/**
 * Enregistre une programmation NFC réellement effectuée dans le
 * navigateur. Le serveur ne peut pas écrire un tag lui-même : il note ce
 * que le navigateur rapporte, avec le numéro de série du tag et le
 * résultat de la relecture de contrôle.
 *
 * `verified` n'est vrai que si le tag a été relu et portait bien l'URL
 * attendue. Une plaque écrite mais non relue est affichée comme telle,
 * jamais comme vérifiée.
 */
export async function recordPlateProgrammed(
  input: z.input<typeof writeSchema>,
): Promise<PlateResult<{ programmedAt: string; verified: boolean; locked: boolean }>> {
  try {
    const parsed = writeSchema.parse(input);
    const user = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data, error } = await db.rpc('record_plate_write', {
      p_organization_id: parsed.organizationId,
      p_plate_id: parsed.plateId,
      p_written_by: user.id,
      p_written_url: parsed.writtenUrl,
      p_nfc_serial: parsed.serialNumber ?? null,
      p_locked: parsed.locked,
      p_verified: parsed.verified,
    });
    if (error) throw error;

    const plate = data as { programmed_at: string; nfc_locked_at: string | null };

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'plate.programmed', targetType: 'plate', targetId: parsed.plateId,
      metadata: {
        verified: parsed.verified,
        locked: parsed.locked,
        serial: parsed.serialNumber ?? null,
      },
    });

    return {
      ok: true,
      data: {
        programmedAt: plate.programmed_at,
        verified: parsed.verified,
        locked: plate.nfc_locked_at != null,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function revalidatePlates(orgSlug: string): Promise<void> {
  revalidatePath(`/app/${orgSlug}/plaques`);
}
