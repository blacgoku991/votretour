import { z } from 'zod';
import { jsonOk, jsonError, parseBody, uuidSchema } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { getClientSession } from '@/server/client-session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { endpointFingerprint } from '@/lib/crypto';
import { env } from '@/lib/env';
import { apnsConfigured } from '@/server/notifications/apns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Enregistrement du jeton de notification d'un App Clip.
 *
 * Deux règles d'Apple dictent cette route :
 *
 *  1. Un App Clip qui déclare NSAppClipRequestEphemeralUserNotification
 *     ne peut recevoir de notifications que pendant 8 HEURES après CHAQUE
 *     lancement. On date donc l'expiration de l'abonnement à l'instant du
 *     lancement + 8 h. Le client relance l'App Clip depuis la
 *     notification ou la plaque : la fenêtre repart.
 *
 *  2. Un App Clip qui sert plusieurs commerces doit recevoir des
 *     notifications portant un `target-content-id` égal à l'URL
 *     d'invocation. On mémorise donc cette URL ici pour la rejouer à
 *     chaque envoi. C'est ce qui garantit qu'une notification d'un
 *     commerce ne peut pas s'afficher dans l'instance d'un autre.
 */
const bodySchema = z.object({
  organizationId: uuidSchema,
  /** URL exacte ayant lancé l'App Clip. */
  invocationUrl: z.string().url().max(500),
  bundleId: z.string().min(3).max(200),
  /** Jeton APNs hexadécimal fourni par iOS. */
  deviceToken: z.string().regex(/^[0-9a-fA-F]{32,200}$/, 'Jeton APNs invalide.').nullish(),
  authorizationStatus: z
    .enum(['ephemeral', 'authorized', 'provisional', 'denied', 'not_determined'])
    .default('not_determined'),
  appClipVersion: z.string().max(40).nullish(),
  environment: z.enum(['sandbox', 'production']).nullish(),
  locationId: uuidSchema.nullish(),
});

/** Fenêtre éphémère accordée par Apple aux App Clips : 8 heures. */
const EPHEMERAL_WINDOW_MS = 8 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await parseBody(request, bodySchema);

    const session = await getClientSession(body.organizationId);
    if (!session) {
      throw new AppError('session_mismatch', 'Session App Clip inconnue.', 403);
    }

    const db = supabaseAdmin();
    const launchedAt = new Date();
    const expiresAt =
      body.authorizationStatus === 'authorized'
        ? new Date(launchedAt.getTime() + 30 * 24 * 3600 * 1000)
        : new Date(launchedAt.getTime() + EPHEMERAL_WINDOW_MS);

    await db.from('app_clip_sessions').insert({
      organization_id: body.organizationId,
      location_id: body.locationId ?? null,
      client_session_id: session.id,
      invocation_url: body.invocationUrl,
      bundle_id: body.bundleId,
      app_clip_version: body.appClipVersion ?? null,
      device_token: body.deviceToken ?? null,
      notification_authorization: body.authorizationStatus,
      ephemeral_expires_at: body.deviceToken ? expiresAt.toISOString() : null,
      launched_at: launchedAt.toISOString(),
    });

    let registered = false;

    if (body.deviceToken && body.authorizationStatus !== 'denied') {
      const { error } = await db.from('notification_subscriptions').upsert(
        {
          organization_id: body.organizationId,
          client_session_id: session.id,
          channel: 'apns_appclip',
          device_token: body.deviceToken,
          bundle_id: body.bundleId,
          apns_environment: body.environment ?? env.apns.environment,
          invocation_url: body.invocationUrl,
          endpoint_hash: endpointFingerprint('apns_appclip', body.deviceToken),
          is_active: true,
          failure_count: 0,
          last_error: null,
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: 'channel,endpoint_hash' },
      );
      if (error) throw error;
      registered = true;
    }

    return jsonOk({
      registered,
      // L'App Clip affiche honnêtement ce qu'il peut promettre : sans
      // APNs configuré côté serveur, il dit au client de garder un œil
      // sur l'écran plutôt que d'annoncer une notification.
      pushAvailable: registered && apnsConfigured(),
      expiresAt: registered ? expiresAt.toISOString() : null,
      ephemeralWindowHours: 8,
    });
  } catch (error) {
    return jsonError(error);
  }
}
