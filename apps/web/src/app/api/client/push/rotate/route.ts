import { z } from 'zod';
import { jsonOk, jsonError, parseBody } from '@/lib/api';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { endpointFingerprint } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  oldEndpoint: z.string().url().max(1000),
  newSubscription: z
    .object({
      endpoint: z.string().url().max(1000),
      keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
    })
    .nullable(),
});

/**
 * Rotation d'abonnement Web Push.
 *
 * Le navigateur peut révoquer un abonnement de sa propre initiative. Le
 * service worker prévient alors le serveur : on rattache le nouvel
 * abonnement à la même session d'appareil, sans que le client ait à
 * refaire quoi que ce soit.
 */
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, bodySchema);
    const db = supabaseAdmin();
    const oldHash = endpointFingerprint('web_push', body.oldEndpoint);

    const { data: existing } = await db
      .from('notification_subscriptions')
      .select('id, organization_id, client_session_id')
      .eq('channel', 'web_push')
      .eq('endpoint_hash', oldHash)
      .maybeSingle();

    if (!existing) return jsonOk({ rotated: false });

    if (!body.newSubscription) {
      await db.from('notification_subscriptions')
        .update({ is_active: false, last_error: 'abonnement révoqué par le navigateur' })
        .eq('id', existing.id);
      return jsonOk({ rotated: false, deactivated: true });
    }

    await db.from('notification_subscriptions').update({
      endpoint: body.newSubscription.endpoint,
      p256dh: body.newSubscription.keys.p256dh,
      auth_secret: body.newSubscription.keys.auth,
      endpoint_hash: endpointFingerprint('web_push', body.newSubscription.endpoint),
      is_active: true,
      failure_count: 0,
      last_error: null,
    }).eq('id', existing.id);

    return jsonOk({ rotated: true });
  } catch (error) {
    return jsonError(error);
  }
}
