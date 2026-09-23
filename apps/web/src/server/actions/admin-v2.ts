'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { assertPlatformAdmin } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/server/audit';
import { generateTvPairCode, hashTvPairCode } from '@/server/tv-kiosk';

export type AdminV2Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

function fail(error: unknown): AdminV2Result<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[admin-v2]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const optionalUrl = z.union([
  z.string().trim().url('URL invalide.'),
  z.literal(''),
  z.null(),
]).optional();

const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.literal(''), z.null()]).optional();

const activitySchema = z.enum([
  'barber','hair_salon','nail_bar','beauty','phone_repair','garage',
  'auto_center','shop','aftersales','restaurant','counter',
  'admin_service','health','event','other',
]);

const brandAccentSchema = z.enum(['signal','copper','jade','cobalt','brique']);

const createEventSchema = z.object({
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  queueId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  waveSize: z.number().int().min(1).max(200).default(10),
  passValidMinutes: z.number().int().min(1).max(120).default(10),
  graceMinutes: z.number().int().min(0).max(60).default(5),
  publicNote: optionalText(500),
  heroTitle: optionalText(140),
  logoUrl: optionalUrl,
  coverUrl: optionalUrl,
  accentHex: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).default('#FF4B1F'),
  rulesText: optionalText(2400),
  qrLabel: optionalText(120),
  startNow: z.boolean().default(false),
});

export async function adminCreateEventCampaign(
  input: z.input<typeof createEventSchema>,
): Promise<AdminV2Result<{ eventId: string; status: string }>> {
  try {
    const parsed = createEventSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: queue } = await db
      .from('queues')
      .select('id, organization_id, location_id, name')
      .eq('id', parsed.queueId)
      .eq('organization_id', parsed.organizationId)
      .eq('location_id', parsed.locationId)
      .maybeSingle();

    if (!queue) {
      throw new AppError(
        'invalid_queue',
        'La file sélectionnée ne correspond pas à cet établissement.',
        400,
      );
    }

    const status = parsed.startNow ? 'live' : 'draft';
    const now = parsed.startNow ? new Date().toISOString() : null;

    const { data: event, error } = await db
      .from('event_campaigns')
      .insert({
        organization_id: parsed.organizationId,
        location_id: parsed.locationId,
        queue_id: parsed.queueId,
        name: parsed.name,
        status,
        wave_size: parsed.waveSize,
        pass_valid_minutes: parsed.passValidMinutes,
        grace_minutes: parsed.graceMinutes,
        public_note: parsed.publicNote || null,
        hero_title: parsed.heroTitle || null,
        logo_url: parsed.logoUrl || null,
        cover_url: parsed.coverUrl || null,
        accent_hex: parsed.accentHex,
        rules_text: parsed.rulesText || null,
        qr_label: parsed.qrLabel || null,
        created_by: admin.id,
        started_at: now,
      })
      .select('id')
      .single();

    if (error || !event) throw error ?? new Error('Création impossible.');

    if (parsed.startNow) {
      await db
        .from('queues')
        .update({ status: 'open', closed_reason: null })
        .eq('id', parsed.queueId);
    }

    await audit({
      organizationId: parsed.organizationId,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'event.created_by_platform',
      targetType: 'event',
      targetId: event.id,
      metadata: {
        name: parsed.name,
        locationId: parsed.locationId,
        queueId: parsed.queueId,
        waveSize: parsed.waveSize,
        passValidMinutes: parsed.passValidMinutes,
        graceMinutes: parsed.graceMinutes,
        accentHex: parsed.accentHex,
        branded: Boolean(parsed.logoUrl || parsed.coverUrl || parsed.heroTitle),
        startNow: parsed.startNow,
      },
    });

    revalidatePath('/admin/evenements');
    revalidatePath('/admin');
    return { ok: true, data: { eventId: event.id, status } };
  } catch (error) {
    return fail(error);
  }
}

const updateEventSchema = z.object({
  eventId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  waveSize: z.number().int().min(1).max(200),
  passValidMinutes: z.number().int().min(1).max(120),
  graceMinutes: z.number().int().min(0).max(60),
  publicNote: optionalText(500),
  heroTitle: optionalText(140),
  logoUrl: optionalUrl,
  coverUrl: optionalUrl,
  accentHex: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/),
  rulesText: optionalText(2400),
  qrLabel: optionalText(120),
});

export async function adminUpdateEventCampaign(
  input: z.input<typeof updateEventSchema>,
): Promise<AdminV2Result<{ eventId: string }>> {
  try {
    const parsed = updateEventSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: event } = await db
      .from('event_campaigns')
      .select('id, organization_id, status')
      .eq('id', parsed.eventId)
      .maybeSingle();

    if (!event) throw new AppError('not_found', 'Événement introuvable.', 404);
    if (['sold_out', 'ended'].includes(event.status)) {
      throw new AppError(
        'event_closed',
        'Un événement terminé ne peut plus être reconfiguré.',
        409,
      );
    }

    const patch = {
      name: parsed.name,
      wave_size: parsed.waveSize,
      pass_valid_minutes: parsed.passValidMinutes,
      grace_minutes: parsed.graceMinutes,
      public_note: parsed.publicNote || null,
      hero_title: parsed.heroTitle || null,
      logo_url: parsed.logoUrl || null,
      cover_url: parsed.coverUrl || null,
      accent_hex: parsed.accentHex,
      rules_text: parsed.rulesText || null,
      qr_label: parsed.qrLabel || null,
    };

    const { error } = await db.from('event_campaigns').update(patch).eq('id', event.id);
    if (error) throw error;

    await audit({
      organizationId: event.organization_id,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'event.updated_by_platform',
      targetType: 'event',
      targetId: event.id,
      metadata: patch,
    });

    revalidatePath('/admin/evenements');
    revalidatePath('/admin');
    return { ok: true, data: { eventId: event.id } };
  } catch (error) {
    return fail(error);
  }
}

const createOrganizationV2Schema = z.object({
  name: z.string().trim().min(2).max(120),
  activity: activitySchema.default('other'),
  locationName: z.string().trim().min(1).max(120),
  queueMode: z.enum(['shared','per_staff']).default('shared'),
  planCode: z.enum(['starter','pro','business']).default('starter'),
  logoUrl: optionalUrl,
  locationLogoUrl: optionalUrl,
  coverUrl: optionalUrl,
  addressLine1: optionalText(160),
  postalCode: optionalText(20),
  city: optionalText(100),
  phone: optionalText(40),
  googleReviewUrl: optionalUrl,
  mapsUrl: optionalUrl,
  brandAccent: brandAccentSchema.default('signal'),
  supportEmail: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
});

export async function adminCreateOrganizationV2(
  input: z.input<typeof createOrganizationV2Schema>,
): Promise<AdminV2Result<{ organizationId: string; slug: string }>> {
  try {
    const parsed = createOrganizationV2Schema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data, error } = await db.rpc('provision_organization', {
      p_user_id: admin.id,
      p_org_name: parsed.name,
      p_activity: parsed.activity,
      p_location_name: parsed.locationName,
      p_queue_mode: parsed.queueMode,
      p_plan_code: parsed.planCode,
    });
    if (error || !data) throw error ?? new Error('Création impossible.');

    const result = data as {
      organization?: { id?: string; slug?: string };
      location?: { id?: string };
      queue?: { id?: string };
      plate?: { id?: string };
    };

    const organizationId = result.organization?.id;
    const slug = result.organization?.slug;
    const locationId = result.location?.id;
    if (!organizationId || !slug || !locationId) {
      throw new AppError('internal', 'Création incomplète.', 500);
    }

    const [{ error: orgError }, { error: locationError }, { error: settingsError }] =
      await Promise.all([
        db.from('organizations').update({
          logo_url: parsed.logoUrl || null,
        }).eq('id', organizationId),
        db.from('locations').update({
          logo_url: parsed.locationLogoUrl || null,
          cover_url: parsed.coverUrl || null,
          address_line1: parsed.addressLine1 || null,
          postal_code: parsed.postalCode || null,
          city: parsed.city || null,
          phone: parsed.phone || null,
          google_review_url: parsed.googleReviewUrl || null,
          maps_url: parsed.mapsUrl || null,
        }).eq('id', locationId).eq('organization_id', organizationId),
        db.from('organization_settings').update({
          brand_accent: parsed.brandAccent,
          support_email: parsed.supportEmail || null,
        }).eq('organization_id', organizationId),
      ]);

    if (orgError) throw orgError;
    if (locationError) throw locationError;
    if (settingsError) throw settingsError;

    await audit({
      organizationId,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'organization.created_by_platform_v2',
      targetType: 'organization',
      targetId: organizationId,
      metadata: {
        name: parsed.name,
        activity: parsed.activity,
        locationName: parsed.locationName,
        queueMode: parsed.queueMode,
        planCode: parsed.planCode,
        city: parsed.city || null,
        locationId,
        queueId: result.queue?.id ?? null,
        plateId: result.plate?.id ?? null,
      },
    });

    revalidatePath('/admin', 'layout');
    return { ok: true, data: { organizationId, slug } };
  } catch (error) {
    return fail(error);
  }
}

const updateOrganizationV2Schema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  activity: activitySchema,
  logoUrl: optionalUrl,
  defaultLocale: z.string().trim().min(2).max(10).default('fr'),
  dataRetentionDays: z.number().int().min(1).max(730),
  askClientName: z.boolean(),
  clientNameRequired: z.boolean(),
  allowClientLeave: z.boolean(),
  showPeopleAhead: z.boolean(),
  showEstimatedWait: z.boolean(),
  notifyAheadThreshold: z.number().int().min(1).max(10),
  sendCompletionReview: z.boolean(),
  brandAccent: brandAccentSchema,
  supportEmail: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
  privacyUrl: optionalUrl,
  termsUrl: optionalUrl,
  location: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    addressLine1: optionalText(160),
    addressLine2: optionalText(160),
    postalCode: optionalText(20),
    city: optionalText(100),
    countryCode: z.string().trim().regex(/^[A-Z]{2}$/),
    phone: optionalText(40),
    timezone: z.string().trim().min(3).max(80),
    googleReviewUrl: optionalUrl,
    mapsUrl: optionalUrl,
    logoUrl: optionalUrl,
    coverUrl: optionalUrl,
    isActive: z.boolean(),
  }),
});

export async function adminUpdateOrganizationV2(
  input: z.input<typeof updateOrganizationV2Schema>,
): Promise<AdminV2Result<{ organizationId: string; locationId: string }>> {
  try {
    const parsed = updateOrganizationV2Schema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: location } = await db
      .from('locations')
      .select('id, organization_id')
      .eq('id', parsed.location.id)
      .eq('organization_id', parsed.organizationId)
      .maybeSingle();
    if (!location) throw new AppError('not_found', 'Établissement introuvable.', 404);

    const orgPatch = {
      name: parsed.name,
      activity: parsed.activity,
      logo_url: parsed.logoUrl || null,
    };

    const settingsPatch = {
      default_locale: parsed.defaultLocale,
      data_retention_days: parsed.dataRetentionDays,
      ask_client_name: parsed.askClientName,
      client_name_required: parsed.clientNameRequired,
      allow_client_leave: parsed.allowClientLeave,
      show_people_ahead: parsed.showPeopleAhead,
      show_estimated_wait: parsed.showEstimatedWait,
      notify_ahead_threshold: parsed.notifyAheadThreshold,
      send_completion_review: parsed.sendCompletionReview,
      brand_accent: parsed.brandAccent,
      support_email: parsed.supportEmail || null,
      privacy_url: parsed.privacyUrl || null,
      terms_url: parsed.termsUrl || null,
    };

    const locationPatch = {
      name: parsed.location.name,
      address_line1: parsed.location.addressLine1 || null,
      address_line2: parsed.location.addressLine2 || null,
      postal_code: parsed.location.postalCode || null,
      city: parsed.location.city || null,
      country_code: parsed.location.countryCode,
      phone: parsed.location.phone || null,
      timezone: parsed.location.timezone,
      google_review_url: parsed.location.googleReviewUrl || null,
      maps_url: parsed.location.mapsUrl || null,
      logo_url: parsed.location.logoUrl || null,
      cover_url: parsed.location.coverUrl || null,
      is_active: parsed.location.isActive,
    };

    const [{ error: orgError }, { error: settingsError }, { error: locationError }] =
      await Promise.all([
        db.from('organizations').update(orgPatch).eq('id', parsed.organizationId),
        db.from('organization_settings').update(settingsPatch)
          .eq('organization_id', parsed.organizationId),
        db.from('locations').update(locationPatch)
          .eq('id', parsed.location.id)
          .eq('organization_id', parsed.organizationId),
      ]);

    if (orgError) throw orgError;
    if (settingsError) throw settingsError;
    if (locationError) throw locationError;

    await audit({
      organizationId: parsed.organizationId,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'organization.configuration_updated',
      targetType: 'organization',
      targetId: parsed.organizationId,
      metadata: {
        organization: orgPatch,
        experience: settingsPatch,
        locationId: parsed.location.id,
        location: locationPatch,
      },
    });

    revalidatePath('/admin/etablissements');
    revalidatePath(`/admin/etablissements/${parsed.organizationId}`);
    revalidatePath('/app', 'layout');
    return {
      ok: true,
      data: { organizationId: parsed.organizationId, locationId: parsed.location.id },
    };
  } catch (error) {
    return fail(error);
  }
}


/* ===================================================================
   ÉCRANS TV — appairage sécurisé plateforme
   =================================================================== */

const createDisplayPairSchema = z.object({
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  queueId: z.string().uuid(),
  eventId: z.string().uuid().nullish(),
  displayName: z.string().trim().min(1).max(80).default('Écran TV'),
});

export async function adminCreateDisplayPairCode(
  input: z.input<typeof createDisplayPairSchema>,
): Promise<AdminV2Result<{ code: string; expiresAt: string }>> {
  try {
    const parsed = createDisplayPairSchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: queue } = await db
      .from('queues')
      .select('id, organization_id, location_id')
      .eq('id', parsed.queueId)
      .eq('organization_id', parsed.organizationId)
      .eq('location_id', parsed.locationId)
      .maybeSingle();

    if (!queue) {
      throw new AppError('invalid_queue', 'La file choisie ne correspond pas à cet établissement.', 400);
    }

    if (parsed.eventId) {
      const { data: event } = await db
        .from('event_campaigns')
        .select('id')
        .eq('id', parsed.eventId)
        .eq('organization_id', parsed.organizationId)
        .eq('location_id', parsed.locationId)
        .eq('queue_id', parsed.queueId)
        .maybeSingle();

      if (!event) {
        throw new AppError('invalid_event', 'Cet événement ne correspond pas à cette file.', 400);
      }
    }

    await db.from('display_pair_codes')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .is('consumed_at', null);

    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    let code = '';
    let inserted = false;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      code = generateTvPairCode();
      const { error } = await db.from('display_pair_codes').insert({
        organization_id: parsed.organizationId,
        location_id: parsed.locationId,
        queue_id: parsed.queueId,
        event_id: parsed.eventId || null,
        display_name: parsed.displayName,
        code_hash: hashTvPairCode(code),
        expires_at: expiresAt,
        created_by: admin.id,
      });

      if (!error) {
        inserted = true;
        break;
      }

      if (error.code !== '23505') throw error;
    }

    if (!inserted) {
      throw new AppError('pairing_collision', 'Impossible de générer un code. Réessayez.', 500);
    }

    await audit({
      organizationId: parsed.organizationId,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'display.pair_code_created',
      targetType: 'display',
      metadata: {
        locationId: parsed.locationId,
        queueId: parsed.queueId,
        eventId: parsed.eventId || null,
        displayName: parsed.displayName,
        expiresAt,
      },
    });

    revalidatePath('/admin/etablissements/' + parsed.organizationId);
    return { ok: true, data: { code, expiresAt } };
  } catch (error) {
    return fail(error);
  }
}

const updateDisplaySchema = z.object({
  deviceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  queueId: z.string().uuid().optional(),
  eventId: z.string().uuid().nullable().optional(),
});

export async function adminUpdateDisplayDevice(
  input: z.input<typeof updateDisplaySchema>,
): Promise<AdminV2Result<{ deviceId: string }>> {
  try {
    const parsed = updateDisplaySchema.parse(input);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: device } = await db
      .from('display_devices')
      .select('id, organization_id, location_id, queue_id')
      .eq('id', parsed.deviceId)
      .maybeSingle();

    if (!device) throw new AppError('not_found', 'Écran introuvable.', 404);

    const nextQueueId = parsed.queueId ?? device.queue_id;
    const { data: queue } = await db
      .from('queues')
      .select('id')
      .eq('id', nextQueueId)
      .eq('organization_id', device.organization_id)
      .eq('location_id', device.location_id)
      .maybeSingle();

    if (!queue) throw new AppError('invalid_queue', 'File incompatible avec cet écran.', 400);

    if (parsed.eventId) {
      const { data: event } = await db
        .from('event_campaigns')
        .select('id')
        .eq('id', parsed.eventId)
        .eq('organization_id', device.organization_id)
        .eq('location_id', device.location_id)
        .eq('queue_id', nextQueueId)
        .maybeSingle();

      if (!event) throw new AppError('invalid_event', 'Événement incompatible avec cet écran.', 400);
    }

    const patch: Record<string, unknown> = {};
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.queueId !== undefined) patch.queue_id = parsed.queueId;
    if (parsed.eventId !== undefined) patch.event_id = parsed.eventId;

    if (Object.keys(patch).length) {
      const { error } = await db.from('display_devices').update(patch).eq('id', parsed.deviceId);
      if (error) throw error;
    }

    await audit({
      organizationId: device.organization_id,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'display.updated',
      targetType: 'display',
      targetId: parsed.deviceId,
      metadata: patch,
    });

    revalidatePath('/admin/etablissements/' + device.organization_id);
    return { ok: true, data: { deviceId: parsed.deviceId } };
  } catch (error) {
    return fail(error);
  }
}

export async function adminRevokeDisplayDevice(
  deviceId: string,
): Promise<AdminV2Result<{ deviceId: string }>> {
  try {
    const parsedId = z.string().uuid().parse(deviceId);
    const admin = await assertPlatformAdmin();
    const db = supabaseAdmin();

    const { data: device } = await db
      .from('display_devices')
      .select('id, organization_id, name')
      .eq('id', parsedId)
      .maybeSingle();

    if (!device) throw new AppError('not_found', 'Écran introuvable.', 404);

    const { error } = await db
      .from('display_devices')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      })
      .eq('id', parsedId);
    if (error) throw error;

    await audit({
      organizationId: device.organization_id,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'display.revoked',
      targetType: 'display',
      targetId: parsedId,
      metadata: { name: device.name },
    });

    revalidatePath('/admin/etablissements/' + device.organization_id);
    return { ok: true, data: { deviceId: parsedId } };
  } catch (error) {
    return fail(error);
  }
}
