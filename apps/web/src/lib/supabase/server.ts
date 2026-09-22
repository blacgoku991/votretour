import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Client Supabase lié à la session du professionnel connecté.
 * Il utilise la clé ANON : toutes les lectures repassent donc par RLS.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(env.supabase.url, env.supabase.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un Server Component : le rafraîchissement du
          // jeton est alors pris en charge par le middleware.
        }
      },
    },
  });
}

/** Variante pour route handlers et middleware, où l'on contrôle la réponse. */
export function createSupabaseRouteClient(
  request: Request,
  cookieSink: (name: string, value: string, options: Record<string, unknown>) => void,
): SupabaseClient {
  return createServerClient(env.supabase.url, env.supabase.anonKey, {
    cookies: {
      getAll() {
        const header = request.headers.get('cookie') ?? '';
        return header
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const eq = part.indexOf('=');
            return eq === -1
              ? { name: part, value: '' }
              : { name: part.slice(0, eq), value: decodeURIComponent(part.slice(eq + 1)) };
          });
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieSink(name, value, (options ?? {}) as Record<string, unknown>);
        }
      },
    },
  });
}
