import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, requireServiceRoleKey } from '@/lib/env';

let cached: SupabaseClient | null = null;

/**
 * Client à privilèges élevés (service_role, BYPASSRLS).
 *
 * C'est le SEUL moyen d'appeler les fonctions métier de la file : elles
 * ont toutes été révoquées pour anon et authenticated. Chaque appelant
 * doit donc avoir préalablement vérifié l'identité et l'appartenance au
 * bon tenant. `server-only` garantit qu'un import accidentel côté
 * navigateur casse la compilation.
 */
export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(env.supabase.url, requireServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-votretour-origin': 'server' } },
  });
  return cached;
}
