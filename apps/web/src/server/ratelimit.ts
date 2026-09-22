import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors';

/**
 * Limitation de débit adossée à PostgreSQL.
 *
 * Le compteur est incrémenté et vérifié dans une seule instruction
 * atomique (INSERT … ON CONFLICT DO UPDATE … RETURNING) : deux requêtes
 * simultanées ne peuvent pas passer ensemble au-dessus de la limite,
 * contrairement à un compteur mémoire qui ne survivrait ni au
 * redéploiement ni au multi-instance.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function consumeRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { data, error } = await supabaseAdmin().rpc('consume_rate_limit', {
    p_key: key.slice(0, 200),
    p_max: max,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Une panne du compteur ne doit pas bloquer un client dans un salon :
    // on laisse passer, mais on trace.
    console.error('[ratelimit] indisponible', error);
    return { allowed: true, remaining: max, retryAfterSeconds: 0 };
  }

  const row = (data as { allowed: boolean; remaining: number; retry_after_seconds: number }[] | null)?.[0];
  if (!row) return { allowed: true, remaining: max, retryAfterSeconds: 0 };

  return {
    allowed: row.allowed,
    remaining: row.remaining,
    retryAfterSeconds: row.retry_after_seconds,
  };
}

/** Variante qui lève une erreur 429 exploitable directement en API. */
export async function enforceRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
  message = 'Trop de tentatives. Réessayez dans un instant.',
): Promise<void> {
  const result = await consumeRateLimit(key, max, windowSeconds);
  if (!result.allowed) {
    throw new AppError('rate_limited', message, 429, { retryAfterSeconds: result.retryAfterSeconds });
  }
}

/** Barèmes centralisés, pour garder des limites cohérentes. */
export const LIMITS = {
  /** Rejoindre une file : large pour un vrai client, serré pour un robot. */
  join: { max: 8, window: 300 },
  /** Actions client sur son propre ticket. */
  clientAction: { max: 40, window: 300 },
  /** Résolution d'une plaque : un scan de QR peut être répété. */
  resolve: { max: 60, window: 300 },
  /** Enregistrement d'un abonnement push. */
  pushSubscribe: { max: 20, window: 3600 },
  /** Actions professionnelles : rapides, mais bornées. */
  staffAction: { max: 300, window: 60 },
  /** Création de compte / d'organisation. */
  signup: { max: 5, window: 3600 },
  /** Support. */
  support: { max: 10, window: 3600 },
} as const;
