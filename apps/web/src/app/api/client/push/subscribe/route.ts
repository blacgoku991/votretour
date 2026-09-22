import { z } from 'zod';
import { jsonOk, jsonError, parseBody, uuidSchema, publicIdSchema } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { getClientSession, requestFingerprint } from '@/server/client-session';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { endpointFingerprint } from '@/lib/crypto';
import { webPushConfigured } from '@/server/notifications/webpush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  organizationId: uuidSchema,
  entryId: publicIdSchema.nullish(),
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    p256dh: z.string().min(16).max(200),
    auth: z.string().min(8).max(100),
  }),
});

/** Enregistre un abonnement Web Push (Android, PWA iOS) pour cet appareil. */
export async function POST(request: Request) {
  try {
    if (!webPushConfigured()) {
      throw new AppError(
        'not_configured',
        "Les notifications navigateur ne sont pas activées sur cette installation.",
        503,
      );
    }

    const body = await parseBody(request, bodySchema);
    const fingerprint = await requestFingerprint();
    await enforceRateLimit(
      `push-sub:${fingerprint.ipHash ?? 'inconnue'}`,
      LIMITS.pushSubscribe.max,
      LIMITS.pushSubscribe.window,
    );

    const session = await getClientSession(body.organizationId);
    if (!session) {
      throw new AppError('session_mismatch', "Rejoignez d'abord la file.", 403);
    }

    const hash = endpointFingerprint('web_push', body.subscription.endpoint);

    const { error } = await supabaseAdmin()
      .from('notification_subscriptions')
      .upsert(
        {
          organization_id: body.organizationId,
          client_session_id: session.id,
          channel: 'web_push',
          endpoint: body.subscription.endpoint,
          p256dh: body.subscription.p256dh,
          auth_secret: body.subscription.auth,
          endpoint_hash: hash,
          is_active: true,
          failure_count: 0,
          last_error: null,
          // Un abonnement navigateur n'expire pas de lui-même ; on lui
          // donne tout de même un horizon pour la purge RGPD.
          expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        },
        { onConflict: 'channel,endpoint_hash' },
      );

    if (error) throw error;

    return jsonOk({ registered: true, channel: 'web_push' });
  } catch (error) {
    return jsonError(error);
  }
}

const deleteSchema = z.object({
  organizationId: uuidSchema,
  endpoint: z.string().url().max(1000),
});

/** Désabonnement explicite (le client coupe les notifications). */
export async function DELETE(request: Request) {
  try {
    const body = await parseBody(request, deleteSchema);
    const session = await getClientSession(body.organizationId);
    if (!session) return jsonOk({ removed: false });

    await supabaseAdmin()
      .from('notification_subscriptions')
      .update({ is_active: false })
      .eq('client_session_id', session.id)
      .eq('endpoint_hash', endpointFingerprint('web_push', body.endpoint));

    return jsonOk({ removed: true });
  } catch (error) {
    return jsonError(error);
  }
}
