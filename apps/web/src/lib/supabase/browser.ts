'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

let cached: SupabaseClient | null = null;

/**
 * Client navigateur (clé publique anon). Deux usages seulement :
 *  - l'authentification du professionnel ;
 *  - les abonnements temps réel.
 * Aucune mutation métier ne passe par ici.
 */
export function supabaseBrowser(): SupabaseClient {
  if (!cached) {
    cached = createBrowserClient(env.supabase.url, env.supabase.anonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return cached;
}
