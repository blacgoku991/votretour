import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Rafraîchit le jeton de session à chaque navigation et verrouille les
 * espaces authentifiés.
 *
 * Le middleware ne fait aucun contrôle d'autorisation fin : il empêche
 * d'atteindre une page privée sans session, et /admin sans être
 * super-admin. L'appartenance à
 * l'organisation et les rôles sont revérifiés côté serveur sur chaque
 * page et chaque action (voir server/auth.ts) — un middleware ne doit
 * jamais être la seule barrière.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const { pathname } = request.nextUrl;

  const isPrivate =
    pathname.startsWith('/app') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/scan') ||
    pathname.startsWith('/bienvenue');

  if (isPrivate && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/connexion';
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  // Seule exception à la règle ci-dessus : /admin est aussi fermé ici aux
  // comptes qui ne sont pas super-admin. Une requête RSC forgée peut
  // sauter le layout /admin, pas le middleware. Les pages et les actions
  // revérifient le rôle de leur côté : ceci n'est qu'une barrière de plus.
  if (user && (pathname === '/admin' || pathname.startsWith('/admin/'))) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.is_platform_admin !== true) {
      const url = request.nextUrl.clone();
      url.pathname = '/app';
      url.search = '';
      const redirect = NextResponse.redirect(url);
      // Garde le jeton éventuellement rafraîchi plus haut.
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return redirect;
    }
  }

  if (user && (pathname === '/connexion' || pathname === '/inscription')) {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Tout sauf : ressources statiques, images, et les points d'entrée
     * publics qui doivent rester rapides (/e/… est le parcours client :
     * aucune raison d'y faire tourner l'authentification).
     */
    '/((?!_next/static|_next/image|favicon.ico|icon|sw.js|manifest.webmanifest|\\.well-known|e/|tv(?:/|$)|media/|api/client/|api/cron/|api/stripe/|api/tv/|api/event/).*)',
  ],
};
