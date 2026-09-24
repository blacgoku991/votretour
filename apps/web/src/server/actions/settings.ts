'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { toAppError } from '@/lib/errors';
import { assertOrgMembership, assertQueueAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/server/audit';
import { AppError } from '@/lib/errors';
import { hasStages, isQueueProfile } from '@/lib/profiles';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[settings]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

/* ------------------------------------------------------------------
   Établissement
   ------------------------------------------------------------------ */
const locationSchema = z.object({
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  addressLine1: z.string().trim().max(160).nullish(),
  postalCode: z.string().trim().max(12).nullish(),
  city: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(30).nullish(),
  timezone: z.string().trim().max(60).optional(),
  mapsUrl: z.string().trim().url().max(500).nullish().or(z.literal('').transform(() => null)),
  googleReviewUrl: z
    .string().trim().url("Le lien d'avis doit être une URL complète.")
    .startsWith('https://', 'Le lien doit commencer par https://').max(500)
    .nullish().or(z.literal('').transform(() => null)),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  isActive: z.boolean().optional(),
});

export async function updateLocation(
  input: z.input<typeof locationSchema>,
): Promise<Result<{ locationId: string }>> {
  try {
    const parsed = locationSchema.parse(input);
    const { user } = await assertOrgMembership(parsed.organizationId, 'settings.manage');

    const patch: Record<string, unknown> = {};
    const map: Record<string, string> = {
      name: 'name', addressLine1: 'address_line1', postalCode: 'postal_code',
      city: 'city', phone: 'phone', timezone: 'timezone', mapsUrl: 'maps_url',
      googleReviewUrl: 'google_review_url', latitude: 'latitude',
      longitude: 'longitude', isActive: 'is_active',
    };
    for (const [key, column] of Object.entries(map)) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value !== undefined) patch[column] = value;
    }

    const { error } = await supabaseAdmin()
      .from('locations').update(patch)
      .eq('id', parsed.locationId).eq('organization_id', parsed.organizationId);
    if (error) throw error;

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'location.updated', targetType: 'location', targetId: parsed.locationId,
      metadata: { fields: Object.keys(patch) },
    });
    return { ok: true, data: { locationId: parsed.locationId } };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------
   Réglages de file
   ------------------------------------------------------------------ */

/**
 * Durée de vie d'un ticket oublié. 24 h au plus pour une file où l'on
 * attend sur place (barbier, table, guichet) : la borne d'avant, que les
 * barbiers gardent. Jusqu'à 30 jours pour une file à étapes (atelier
 * véhicule, atelier appareil, commandes) : une réparation dure souvent
 * plusieurs jours, et la fiche ne doit pas expirer pendant qu'elle est
 * sur le pont. La base porte la même borne haute (0033).
 */
const ENTRY_TTL_MAX = 1440;
const ENTRY_TTL_MAX_STAGED = 43_200;
const queueSchema = z.object({
  queueId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  mode: z.enum(['shared', 'per_staff']).optional(),
  advanceMode: z.enum(['auto_serve', 'call_next']).optional(),
  askClientName: z.boolean().optional(),
  clientNameRequired: z.boolean().optional(),
  allowStaffChoice: z.boolean().optional(),
  allowServiceChoice: z.boolean().optional(),
  notifyAheadThreshold: z.number().int().min(1).max(10).optional(),
  absentPolicy: z.enum(['hold', 'move_back', 'remove']).optional(),
  absentMoveBackBy: z.number().int().min(1).max(20).optional(),
  absentGraceMinutes: z.number().int().min(0).max(120).optional(),
  maxActiveEntries: z.number().int().min(1).max(500).nullish(),
  entryTtlMinutes: z.number().int().min(15).max(ENTRY_TTL_MAX_STAGED).optional(),
});

/** `profile_options.sensitive` stocké à vrai : ce que lit `join_queue`. */
function isSensitiveQueue(options: unknown): boolean {
  return !!options && typeof options === 'object' && !Array.isArray(options)
    && (options as Record<string, unknown>).sensitive === true;
}

export async function updateQueueSettings(
  input: z.input<typeof queueSchema>,
): Promise<Result<{ queueId: string }>> {
  try {
    const parsed = queueSchema.parse(input);
    const access = await assertQueueAccess(parsed.queueId, 'queue.configure');

    const longTtl = parsed.entryTtlMinutes !== undefined && parsed.entryTtlMinutes > ENTRY_TTL_MAX;
    const asksName = parsed.askClientName === true || parsed.clientNameRequired === true;
    if (longTtl || asksName) {
      const { data: row } = await supabaseAdmin()
        .from('queues').select('profile, profile_options').eq('id', parsed.queueId).maybeSingle();
      const profile = isQueueProfile(row?.profile) ? row.profile : 'walkin';
      if (longTtl && !hasStages(profile)) {
        throw new AppError('validation', 'Une file sans étapes garde ses tickets 24 h au plus.', 422);
      }
      // Données de santé : `join_queue` efface le prénom de toute
      // inscription. Le demander, ou pire l'exiger, fermerait la file à
      // tout patient (« Prénom requis », VT009). La même lecture que la
      // base : la clé `sensitive` STOCKÉE, quel que soit le profil.
      if (asksName && isSensitiveQueue(row?.profile_options)) {
        throw new AppError('validation', 'Données de santé : aucun prénom n’est demandé dans cette file.', 422);
      }
    }

    const map: Record<string, string> = {
      name: 'name', mode: 'mode', advanceMode: 'advance_mode',
      askClientName: 'ask_client_name', clientNameRequired: 'client_name_required',
      allowStaffChoice: 'allow_staff_choice', allowServiceChoice: 'allow_service_choice',
      notifyAheadThreshold: 'notify_ahead_threshold', absentPolicy: 'absent_policy',
      absentMoveBackBy: 'absent_move_back_by', absentGraceMinutes: 'absent_grace_minutes',
      maxActiveEntries: 'max_active_entries', entryTtlMinutes: 'entry_ttl_minutes',
    };
    const patch: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(map)) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value !== undefined) patch[column] = value;
    }

    const { error } = await supabaseAdmin()
      .from('queues').update(patch).eq('id', parsed.queueId);
    if (error) throw error;

    await audit({
      organizationId: access.organizationId, actorUserId: access.user.id,
      action: 'queue.configured', targetType: 'queue', targetId: parsed.queueId,
      metadata: patch,
    });
    return { ok: true, data: { queueId: parsed.queueId } };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------
   Réglages d'organisation (dont la rétention RGPD)
   ------------------------------------------------------------------ */
const orgSettingsSchema = z.object({
  organizationId: z.string().uuid(),
  dataRetentionDays: z.number().int().min(1).max(730).optional(),
  showPeopleAhead: z.boolean().optional(),
  allowClientLeave: z.boolean().optional(),
  sendCompletionReview: z.boolean().optional(),
  notifyAheadThreshold: z.number().int().min(1).max(10).optional(),
  brandAccent: z.enum(['signal', 'copper', 'jade', 'cobalt', 'brique']).optional(),
  supportEmail: z.string().trim().email().max(160).nullish().or(z.literal('').transform(() => null)),
});

export async function updateOrganizationSettings(
  input: z.input<typeof orgSettingsSchema>,
): Promise<Result<{ organizationId: string }>> {
  try {
    const parsed = orgSettingsSchema.parse(input);
    const { user } = await assertOrgMembership(parsed.organizationId, 'settings.manage');

    const map: Record<string, string> = {
      dataRetentionDays: 'data_retention_days',
      showPeopleAhead: 'show_people_ahead',
      allowClientLeave: 'allow_client_leave',
      sendCompletionReview: 'send_completion_review',
      notifyAheadThreshold: 'notify_ahead_threshold',
      brandAccent: 'brand_accent',
      supportEmail: 'support_email',
    };
    const patch: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(map)) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value !== undefined) patch[column] = value;
    }

    const { error } = await supabaseAdmin()
      .from('organization_settings').update(patch)
      .eq('organization_id', parsed.organizationId);
    if (error) throw error;

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'settings.updated', targetType: 'organization',
      targetId: parsed.organizationId, metadata: patch,
    });
    return { ok: true, data: { organizationId: parsed.organizationId } };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------
   Horaires
   ------------------------------------------------------------------ */
const hoursSchema = z.object({
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  days: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    isClosed: z.boolean(),
    opensAt: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
    closesAt: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  })).max(7),
});

export async function updateOpeningHours(
  input: z.input<typeof hoursSchema>,
): Promise<Result<{ days: number }>> {
  try {
    const parsed = hoursSchema.parse(input);
    await assertOrgMembership(parsed.organizationId, 'settings.manage');
    const db = supabaseAdmin();

    await db.from('opening_hours')
      .delete().eq('location_id', parsed.locationId)
      .eq('organization_id', parsed.organizationId);

    if (parsed.days.length > 0) {
      const { error } = await db.from('opening_hours').insert(
        parsed.days.map((day) => ({
          organization_id: parsed.organizationId,
          location_id: parsed.locationId,
          weekday: day.weekday,
          is_closed: day.isClosed,
          opens_at: day.isClosed ? null : (day.opensAt ?? '09:00'),
          closes_at: day.isClosed ? null : (day.closesAt ?? '19:00'),
        })),
      );
      if (error) throw error;
    }
    return { ok: true, data: { days: parsed.days.length } };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------
   Prestations
   ------------------------------------------------------------------ */
const serviceSchema = z.object({
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  durationMinutes: z.number().int().min(1).max(600).nullish(),
  priceCents: z.number().int().min(0).max(1_000_000).nullish(),
  isActive: z.boolean().optional(),
});

export async function upsertService(
  input: z.input<typeof serviceSchema>,
): Promise<Result<{ id: string }>> {
  try {
    const parsed = serviceSchema.parse(input);
    await assertOrgMembership(parsed.organizationId, 'settings.manage');
    const db = supabaseAdmin();

    if (parsed.serviceId) {
      const { error } = await db.from('services').update({
        name: parsed.name,
        duration_minutes: parsed.durationMinutes ?? null,
        price_cents: parsed.priceCents ?? null,
        is_active: parsed.isActive ?? true,
      }).eq('id', parsed.serviceId).eq('organization_id', parsed.organizationId);
      if (error) throw error;
      return { ok: true, data: { id: parsed.serviceId } };
    }

    const { count } = await db.from('services')
      .select('id', { count: 'exact', head: true }).eq('location_id', parsed.locationId);

    const { data, error } = await db.from('services').insert({
      organization_id: parsed.organizationId,
      location_id: parsed.locationId,
      name: parsed.name,
      duration_minutes: parsed.durationMinutes ?? null,
      price_cents: parsed.priceCents ?? null,
      sort_order: count ?? 0,
    }).select('id').single();
    if (error) throw error;
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteService(
  organizationId: string, serviceId: string,
): Promise<Result<{ deleted: boolean }>> {
  try {
    await assertOrgMembership(organizationId, 'settings.manage');
    const { error } = await supabaseAdmin()
      .from('services').update({ is_active: false })
      .eq('id', serviceId).eq('organization_id', organizationId);
    if (error) throw error;
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------
   Établissements supplémentaires
   ------------------------------------------------------------------ */
const newLocationSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  city: z.string().trim().max(80).nullish(),
  queueMode: z.enum(['shared', 'per_staff']).default('shared'),
});

export async function createLocation(
  input: z.input<typeof newLocationSchema>,
): Promise<Result<{ locationId: string; plateCode: string }>> {
  try {
    const parsed = newLocationSchema.parse(input);
    const { user } = await assertOrgMembership(parsed.organizationId, 'settings.manage');
    const db = supabaseAdmin();

    const { data: quota } = await db.rpc('check_org_quota', {
      p_organization_id: parsed.organizationId, p_resource: 'locations',
    });
    const q = quota as { allowed: boolean; limit: number } | null;
    if (q && !q.allowed) {
      return fail(new Error(
        `Votre offre est limitée à ${q.limit} établissement${q.limit > 1 ? 's' : ''}.`,
      ));
    }

    const { data, error } = await db.rpc('create_location', {
      p_organization_id: parsed.organizationId,
      p_name: parsed.name,
      p_activity: null,
      p_address_line1: null,
      p_postal_code: null,
      p_city: parsed.city ?? null,
      p_country_code: 'FR',
      p_timezone: 'Europe/Paris',
      p_google_review_url: null,
      p_queue_mode: parsed.queueMode,
      p_created_by: user.id,
      p_slug_hint: null,
    });
    if (error) throw error;

    const created = data as { location: { id: string }; plate: { code: string } };
    return { ok: true, data: { locationId: created.location.id, plateCode: created.plate.code } };
  } catch (error) {
    return fail(error);
  }
}

export async function revalidateSettings(orgSlug: string): Promise<void> {
  revalidatePath(`/app/${orgSlug}/reglages`);
  revalidatePath(`/app/${orgSlug}/file`);
}
