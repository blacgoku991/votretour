import { z } from 'zod';
import { jsonOk, jsonError, parseQuery, slugSchema } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { resolveEntryPoint } from '@/server/queue';
import { requestFingerprint } from '@/server/client-session';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  slug: slugSchema,
  /** L'App Clip signale son arrivée pour alimenter les statistiques de plaque. */
  scan: z.enum(['1', '0']).optional(),
  source: z.enum(['qr', 'nfc', 'appclip', 'link']).optional(),
});

/**
 * Résolution d'une plaque pour les clients natifs (App Clip et
 * application iOS). Même source de vérité que la page web /e/{slug} :
 * une seule fonction SQL décide de ce qui est public.
 */
export async function GET(request: Request) {
  try {
    const query = parseQuery(request, querySchema);
    const fingerprint = await requestFingerprint();
    await enforceRateLimit(
      `resolve:${fingerprint.ipHash ?? 'inconnue'}`,
      LIMITS.resolve.max,
      LIMITS.resolve.window,
    );

    const entryPoint = await resolveEntryPoint(query.slug);
    if (!entryPoint) {
      throw new AppError('not_found', "Cette plaque ne correspond à aucun établissement.", 404);
    }
    if (entryPoint.status !== 'ok') {
      throw new AppError('organization_suspended', "Cet établissement n'est pas accessible.", 403);
    }

    // Un lancement d'App Clip est un scan physique : on le compte, même
    // si le client ne rejoint pas la file. C'est ce qui permet de mesurer
    // honnêtement le taux de conversion d'une plaque.
    if (query.scan === '1' && entryPoint.plate) {
      void supabaseAdmin()
        .from('plate_scans')
        .insert({
          organization_id: entryPoint.organization.id,
          plate_id: entryPoint.plate.id,
          location_id: entryPoint.location.id,
          source: query.source ?? 'appclip',
          platform: 'ios_appclip',
          converted: false,
        })
        .then(({ error }) => {
          if (error) console.error('[entry-point] scan non enregistré', error.message);
        });
    }

    // Les clients natifs reçoivent aussi de quoi ouvrir le canal temps
    // réel. On les sert depuis l'API plutôt que de les figer dans le
    // binaire : une rotation de clé ne demande pas de mise à jour de
    // l'application. La clé anon est publique par construction — elle
    // n'ouvre aucune table, toutes les policies la rejettent.
    return jsonOk({
      ...entryPoint,
      realtime: entryPoint.queue
        ? {
            url: env.supabase.url,
            apiKey: env.supabase.anonKey,
            channel: `queue:${entryPoint.queue.id}`,
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
