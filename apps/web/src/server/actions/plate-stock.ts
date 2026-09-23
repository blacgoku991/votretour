'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { assertPlatformAdmin } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/server/audit';
import { normalizeStockCode } from '@/lib/plate-stock';

/**
 * STOCK DE PLAQUES FOURNISSEUR — actions du super-admin.
 *
 * Le fabricant reçoit des liens générés à l'avance ; il les grave et les
 * imprime. Une fois les plaques livrées, on attribue chacune à une
 * société. Les règles métier (lien jamais libéré, une seule société à la
 * fois, verrou pendant l'attribution) vivent dans les fonctions SQL de
 * la migration 0017 : ces actions vérifient le rôle, valident l'entrée,
 * appellent la base et journalisent.
 */

export type StockResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

function fail(error: unknown): StockResult<never> {
  const appError = toAppError(error);
  // On journalise l'erreur D'ORIGINE : une fois traduite, une erreur
  // PostgREST imprévue devient « Une erreur est survenue », et le
  // journal serveur ne dirait plus rien d'utile.
  if (appError.status >= 500) console.error('[plate-stock]', error);
  return { ok: false, error: appError.message, code: appError.code };
}

/**
 * Validation qui parle français : sans cela, une erreur Zod remonterait
 * au super-admin sous la forme d'un bloc JSON illisible.
 */
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError('validation', first?.message ?? 'Saisie invalide.', 422);
  }
  return result.data;
}

function revalidateStock(batchId?: string | null) {
  revalidatePath('/admin/plaques/stock');
  if (batchId) revalidatePath(`/admin/plaques/stock/${batchId}`);
  revalidatePath('/admin/plaques');
}

const codeSchema = z
  .string()
  .trim()
  .min(1, 'Saisissez un code de plaque.')
  .max(200)
  .transform((value, ctx) => {
    const code = normalizeStockCode(value);
    if (!code) {
      ctx.addIssue({ code: 'custom', message: 'Ce n’est pas un code de plaque Rangvia (RV-XXXXX-XXXXX).' });
      return z.NEVER;
    }
    return code;
  });

/* ------------------------------------------------------------------ */

const createBatchSchema = z.object({
  label: z.string().trim().min(1, 'Donnez un nom au lot.').max(80),
  quantity: z.coerce.number().int().min(1).max(1000),
  kind: z.enum(['nfc', 'qr', 'both']).default('both'),
  note: z.string().trim().max(500).optional(),
});

export async function adminCreatePlateBatch(
  input: z.input<typeof createBatchSchema>,
): Promise<StockResult<{ batchId: string; quantity: number }>> {
  try {
    const admin = await assertPlatformAdmin();
    const parsed = parse(createBatchSchema, input);

    const { data, error } = await supabaseAdmin().rpc('create_plate_batch', {
      p_label: parsed.label,
      p_quantity: parsed.quantity,
      p_kind: parsed.kind,
      p_note: parsed.note || null,
      p_created_by: admin.id,
    });
    if (error) throw error;

    const batch = data as { id: string; quantity: number };
    await audit({
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'plate_stock.batch_created',
      targetType: 'plate_batch',
      targetId: batch.id,
      metadata: { label: parsed.label, quantity: batch.quantity, kind: parsed.kind },
    });

    revalidateStock(batch.id);
    return { ok: true, data: { batchId: batch.id, quantity: batch.quantity } };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */

export interface StockLookup {
  code: string;
  serial: number;
  status: 'available' | 'assigned' | 'void';
  batchId: string;
  batchLabel: string;
  assignedAt: string | null;
  assignment: {
    plateId: string;
    label: string;
    organizationId: string;
    organizationName: string;
    locationId: string;
    locationName: string;
  } | null;
}

/** Retrouve une plaque par son code (tapé, collé ou lu en NFC) ou son numéro. */
export async function adminFindStockPlate(
  input: { query: string },
): Promise<StockResult<StockLookup>> {
  try {
    await assertPlatformAdmin();
    const query = String(input.query ?? '').trim();
    if (!query) throw new AppError('validation', 'Saisissez un code ou un numéro de plaque.', 422);

    const db = supabaseAdmin();
    const serialMatch = query.replace(/^n[°o]?\s*/i, '').match(/^0*(\d{1,12})$/);
    const code = serialMatch ? null : normalizeStockCode(query);
    if (!serialMatch && !code) {
      throw new AppError('validation', 'Ni un code RV-XXXXX-XXXXX, ni un numéro de plaque.', 422);
    }

    let lookup = db
      .from('plate_stock')
      .select('code, serial, status, batch_id, plate_id, assigned_at, plate_batches(label)');
    lookup = serialMatch ? lookup.eq('serial', Number(serialMatch[1])) : lookup.eq('code', code!);
    const { data: row, error } = await lookup.maybeSingle();
    if (error) throw error;
    if (!row) throw new AppError('not_found', 'Aucune plaque de stock ne porte ce code.', 404);

    const batch = Array.isArray(row.plate_batches) ? row.plate_batches[0] : row.plate_batches;
    let assignment: StockLookup['assignment'] = null;
    if (row.plate_id) {
      const { data: plate } = await db
        .from('plates')
        .select('id, label, organization_id, location_id, organizations(name), locations(name)')
        .eq('id', row.plate_id)
        .maybeSingle();
      if (plate) {
        const org = Array.isArray(plate.organizations) ? plate.organizations[0] : plate.organizations;
        const loc = Array.isArray(plate.locations) ? plate.locations[0] : plate.locations;
        assignment = {
          plateId: plate.id,
          label: plate.label,
          organizationId: plate.organization_id,
          organizationName: org?.name ?? '—',
          locationId: plate.location_id,
          locationName: loc?.name ?? '—',
        };
      }
    }

    return {
      ok: true,
      data: {
        code: row.code,
        serial: row.serial,
        status: row.status as StockLookup['status'],
        batchId: row.batch_id,
        batchLabel: batch?.label ?? '—',
        assignedAt: row.assigned_at,
        assignment,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */

const assignSchema = z.object({
  code: codeSchema,
  locationId: z.string().uuid('Choisissez un établissement.'),
  queueId: z.string().uuid().nullish(),
  staffId: z.string().uuid().nullish(),
  label: z.string().trim().max(60).optional(),
  reassign: z.boolean().default(false),
});

/**
 * Attribue une plaque de stock à un établissement. Avec reassign, une
 * plaque déjà en service change de société : elle quitte l'ancienne
 * avec son historique de scans — le lien gravé, lui, ne change pas.
 */
export async function adminAssignStockPlate(
  input: z.input<typeof assignSchema>,
): Promise<StockResult<{ plateId: string; code: string; organizationId: string }>> {
  try {
    const admin = await assertPlatformAdmin();
    const parsed = parse(assignSchema, input);

    const { data, error } = await supabaseAdmin().rpc('assign_stock_plate', {
      p_code: parsed.code,
      p_location_id: parsed.locationId,
      p_queue_id: parsed.queueId ?? null,
      p_staff_id: parsed.staffId ?? null,
      p_label: parsed.label || null,
      p_assigned_by: admin.id,
      p_reassign: parsed.reassign,
    });
    if (error) throw error;

    const result = data as {
      plateId: string; code: string; serial: number;
      organizationId: string; locationId: string; previousOrganizationId: string | null;
    };

    // Deux lignes d'audit en cas de réattribution : chaque société voit,
    // dans son propre journal, la plaque arriver ou partir.
    if (result.previousOrganizationId) {
      await audit({
        organizationId: result.previousOrganizationId,
        actor: 'platform_admin',
        actorUserId: admin.id,
        action: 'plate_stock.plate_withdrawn',
        targetType: 'plate',
        metadata: { code: result.code, serial: result.serial, movedToOrganizationId: result.organizationId },
      });
    }
    await audit({
      organizationId: result.organizationId,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: result.previousOrganizationId ? 'plate_stock.plate_reassigned' : 'plate_stock.plate_assigned',
      targetType: 'plate',
      targetId: result.plateId,
      metadata: { code: result.code, serial: result.serial, locationId: result.locationId },
    });

    const { data: stock } = await supabaseAdmin()
      .from('plate_stock').select('batch_id').eq('code', result.code).maybeSingle();
    revalidateStock(stock?.batch_id);
    return { ok: true, data: { plateId: result.plateId, code: result.code, organizationId: result.organizationId } };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */

const codeOnlySchema = z.object({ code: codeSchema });

/**
 * Libère une plaque : elle quitte sa société et retourne au stock, prête
 * à être attribuée ailleurs. Son lien reste réservé — le déclencheur
 * plates_return_to_stock s'en charge dans la même transaction que la
 * suppression.
 */
export async function adminReleaseStockPlate(
  input: z.input<typeof codeOnlySchema>,
): Promise<StockResult<{ code: string }>> {
  try {
    const admin = await assertPlatformAdmin();
    const parsed = parse(codeOnlySchema, input);
    const db = supabaseAdmin();

    const { data: stock } = await db
      .from('plate_stock')
      .select('code, serial, status, plate_id, batch_id')
      .eq('code', parsed.code)
      .maybeSingle();
    if (!stock) throw new AppError('not_found', 'Aucune plaque de stock ne porte ce code.', 404);
    if (stock.status !== 'assigned' || !stock.plate_id) {
      throw new AppError('plate_unavailable', 'Cette plaque n’est attribuée à personne.', 409);
    }

    const { data: plate } = await db
      .from('plates').select('id, organization_id, label').eq('id', stock.plate_id).maybeSingle();

    const { error } = await db.from('plates').delete().eq('id', stock.plate_id);
    if (error) throw error;

    if (plate) {
      await audit({
        organizationId: plate.organization_id,
        actor: 'platform_admin',
        actorUserId: admin.id,
        action: 'plate_stock.plate_released',
        targetType: 'plate',
        targetId: plate.id,
        metadata: { code: stock.code, serial: stock.serial, label: plate.label },
      });
    }

    revalidateStock(stock.batch_id);
    return { ok: true, data: { code: stock.code } };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ */

const voidSchema = z.object({ code: codeSchema, void: z.boolean() });

/** Met au rebut une plaque perdue ou défectueuse, ou la rend disponible. */
export async function adminSetStockPlateVoid(
  input: z.input<typeof voidSchema>,
): Promise<StockResult<{ code: string; status: string }>> {
  try {
    const admin = await assertPlatformAdmin();
    const parsed = parse(voidSchema, input);

    const { data, error } = await supabaseAdmin().rpc('set_stock_plate_void', {
      p_code: parsed.code,
      p_void: parsed.void,
    });
    if (error) throw error;
    const result = data as { code: string; serial: number; status: string };

    await audit({
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: parsed.void ? 'plate_stock.plate_voided' : 'plate_stock.plate_restored',
      targetType: 'plate_stock',
      metadata: { code: result.code, serial: result.serial },
    });

    const { data: stock } = await supabaseAdmin()
      .from('plate_stock').select('batch_id').eq('code', result.code).maybeSingle();
    revalidateStock(stock?.batch_id);
    return { ok: true, data: { code: result.code, status: result.status } };
  } catch (error) {
    return fail(error);
  }
}
