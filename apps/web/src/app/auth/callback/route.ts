import { NextResponse } from 'next/server';
import { createSupabaseRouteClient } from '@/lib/supabase/server';
import { safeRedirectPath } from '@/lib/safe-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Point de retour des liens envoyés par e-mail (confirmation d'adresse,
 * réinitialisation de mot de passe). Échange le code contre une session
 * puis redirige vers la destination demandée.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');
  const destination = safeRedirectPath(next);

  const response = NextResponse.redirect(new URL(destination, url.origin));

  if (!code) {
    return NextResponse.redirect(new URL('/connexion?erreur=lien_invalide', url.origin));
  }

  const supabase = createSupabaseRouteClient(request, (name, value, options) => {
    response.cookies.set(name, value, options);
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL('/connexion?erreur=lien_expire', url.origin));
  }

  return response;
}
