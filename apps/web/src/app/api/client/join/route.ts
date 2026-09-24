import { z } from 'zod';
import { cookies } from 'next/headers';
import { jsonOk, jsonError, parseBody, slugSchema, uuidSchema, clientNameSchema } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { resolveEntryPoint, joinQueue } from '@/server/queue';
import {
  getOrCreateClientSession, sessionCookieName, sessionCookieOptions,
  requestFingerprint, detectPlatform,
} from '@/server/client-session';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { EntrySource } from '@/lib/types';
import { detailsSchemaFor } from '@/lib/profiles/details';
import { resolveProfileOptions } from '@/lib/profiles/options';
import type { EntryDetails, ProfileEntryPoint } from '@/lib/profiles/types';
import {
  frenchIssues, getQueueProfileInfo, joinProfileQueue, loadOrganizationFeatures, PROFILES_HEADER, resolveJoinPath,
} from '@/server/profiles/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  slug: slugSchema,
  name: clientNameSchema.nullish(),
  staffId: uuidSchema.nullish(),
  serviceId: uuidSchema.nullish(),
  source: z.enum(['qr', 'nfc', 'appclip', 'link']).default('qr'),
  eventId: uuidSchema.nullish(),
  // Informations métier (immatriculation, couverts…) : validées plus bas
  // par le schéma STRICT du profil de la file, une fois celle-ci connue.
  // Ignorées sur une file walkin ou event.
  details: z.record(z.string(), z.unknown()).nullish(),
});

/**
 * Rejoindre une file depuis une plaque NFC, un QR code ou l'App Clip.
 *
 * C'est le point d'entrée le plus exposé du produit : il est accessible
 * sans compte. Il est donc borné par une limitation de débit par
 * empreinte d'appareil ET par adresse IP anonymisée, et la file elle-même
 * refuse une seconde inscription active pour le même appareil.
 */
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, bodySchema);
    const fingerprint = await requestFingerprint();

    await enforceRateLimit(
      `join:ip:${fingerprint.ipHash ?? 'inconnue'}`,
      LIMITS.join.max,
      LIMITS.join.window,
      'Trop de tentatives depuis cet appareil. Patientez un instant.',
    );

    const entryPoint = await resolveEntryPoint(body.slug);
    if (!entryPoint || entryPoint.status !== 'ok') {
      throw new AppError('not_found', "Cette plaque ne correspond à aucun établissement.", 404);
    }
    let targetQueue = entryPoint.queue;

    if (body.eventId) {
      const db = supabaseAdmin();
      const { data: event } = await db
        .from('event_campaigns')
        .select('id, queue_id, status')
        .eq('id', body.eventId)
        .eq('organization_id', entryPoint.organization.id)
        .eq('location_id', entryPoint.location.id)
        .in('status', ['live', 'paused'])
        .maybeSingle();

      if (!event) {
        throw new AppError('event_unavailable', "Cet événement n'est plus disponible.", 409);
      }

      const { data: eventQueue } = await db
        .from('queues')
        .select('id, name, mode, status, ask_client_name, client_name_required, allow_staff_choice, allow_service_choice, pause_reason')
        .eq('id', event.queue_id)
        .eq('organization_id', entryPoint.organization.id)
        .eq('location_id', entryPoint.location.id)
        .maybeSingle();

      if (!eventQueue) {
        throw new AppError('not_found', "La file de cet événement est introuvable.", 404);
      }

      targetQueue = {
        id: eventQueue.id,
        name: eventQueue.name,
        mode: eventQueue.mode,
        status: eventQueue.status,
        askClientName: eventQueue.ask_client_name,
        clientNameRequired: eventQueue.client_name_required,
        allowStaffChoice: eventQueue.allow_staff_choice,
        allowServiceChoice: eventQueue.allow_service_choice,
        pauseReason: eventQueue.pause_reason,
        waitingCount: 0,
      };
    }

    if (!targetQueue) {
      throw new AppError('not_found', "Aucune file n'est rattachée à cette plaque.", 404);
    }
    if (targetQueue.status === 'closed') {
      throw new AppError('queue_closed', 'La file est fermée pour le moment.', 409);
    }
    if (targetQueue.status === 'paused') {
      throw new AppError('queue_paused', 'La file est momentanément en pause.', 409);
    }
    if (targetQueue.clientNameRequired && !body.name) {
      throw new AppError('validation', 'Cet établissement demande votre prénom.', 422);
    }

    const profiled = (entryPoint as ProfileEntryPoint).queue;
    const path = await resolveJoinPath({
      profile: body.eventId ? null : profiled?.profile,
      eventId: body.eventId,
      source: body.source,
      profilesHeader: request.headers.get(PROFILES_HEADER),
      loadFeatures: () => loadOrganizationFeatures(entryPoint.organization.id),
    });

    // Validées AVANT de créer la session : une saisie refusée ne laisse
    // aucune trace. Le client ne peut poser que ses propres clés
    // (jamais `keys`, `readyEta`, ni un devis) ; la base revérifie.
    let details: EntryDetails | null = null;
    // Santé (`sensitive`) : jamais de prénom, pas même sur la session.
    let clientName = body.name ?? null;
    if (path.kind === 'profile') {
      // Les réglages COMPLETS de la file (`publicOptions` n'en montre au
      // client qu'une partie : `registrationRequired` n'y figure pas).
      const info = await getQueueProfileInfo(targetQueue.id);
      const options = info?.options ?? resolveProfileOptions(path.profile, profiled?.publicOptions ?? {});
      if (options.sensitive === true) clientName = null;
      const parsed = detailsSchemaFor(path.profile, { actor: 'client', options })
        .safeParse(body.details ?? {}, { error: frenchIssues });
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new AppError('invalid_details', first?.message ?? 'Informations invalides.', 422, parsed.error.issues);
      }
      details = parsed.data;
    }

    const platform = await detectPlatform();
    const session = await getOrCreateClientSession(entryPoint.organization.id, {
      displayName: clientName,
      platform: body.source === 'appclip' ? 'ios_appclip' : platform,
    });

    // Une plaque dédiée à un professionnel impose son choix.
    const staffId = entryPoint.plate?.staffId ?? body.staffId ?? null;

    // Walkin et event : EXACTEMENT l'appel d'aujourd'hui.
    const result = path.kind === 'profile' && details
      ? await joinProfileQueue({
          queueId: targetQueue.id,
          clientSessionId: session.id,
          clientName,
          staffId,
          serviceId: body.serviceId ?? null,
          source: body.source as EntrySource,
          plateId: entryPoint.plate?.id ?? null,
          details,
        })
      : await joinQueue({
          queueId: targetQueue.id,
          clientSessionId: session.id,
          clientName: body.name ?? null,
          staffId,
          serviceId: body.serviceId ?? null,
          source: body.source as EntrySource,
          plateId: entryPoint.plate?.id ?? null,
        });

    // Journal de scan : alimente les statistiques de plaque.
    if (entryPoint.plate) {
      void supabaseAdmin()
        .from('plate_scans')
        .insert({
          organization_id: entryPoint.organization.id,
          plate_id: entryPoint.plate.id,
          location_id: entryPoint.location.id,
          source: body.source,
          platform,
          converted: true,
        })
        .then(({ error }) => {
          if (error) console.error('[join] scan non enregistré', error.message);
        });
    }

    const response = jsonOk({
      entry: result.entry,
      rejoined: result.rejoined,
      queueId: result.queueId,
      organizationId: entryPoint.organization.id,
      // Renvoyé uniquement aux clients natifs (App Clip) : le web le
      // reçoit sous forme de cookie httpOnly, jamais lisible en JS.
      sessionToken: body.source === 'appclip' ? session.issuedToken ?? null : undefined,
    });

    if (session.issuedToken && body.source !== 'appclip') {
      const store = await cookies();
      store.set(
        sessionCookieName(entryPoint.organization.id),
        session.issuedToken,
        sessionCookieOptions(),
      );
    }

    return response;
  } catch (error) {
    return jsonError(error);
  }
}
