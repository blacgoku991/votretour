import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { hashEventPassToken, makeEventPassCookie } from '@/lib/event-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE = 'rv_event_pass';

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const fallback = new URL('/', request.url);

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return NextResponse.redirect(fallback, 302);
  }

  const db = supabaseAdmin();
  const tokenHash = hashEventPassToken(token);

  const { data: limit } = await db.rpc('consume_rate_limit', {
    p_key: `event-pass-activate:${tokenHash.slice(0, 24)}`,
    p_max: 20,
    p_window_seconds: 300,
  });
  const rate = Array.isArray(limit) ? limit[0] : limit;
  if (rate && rate.allowed === false) {
    return new NextResponse('Trop de tentatives', {
      status: 429,
      headers: {
        'Retry-After': String(rate.retry_after_seconds ?? 60),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }

  const { data: pass } = await db
    .from('event_access_passes')
    .select('public_id, status, grace_until')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!pass) {
    return NextResponse.redirect(new URL('/pass?etat=invalide', request.url), 302);
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const graceUnix = Math.floor(new Date(pass.grace_until).getTime() / 1000);

  if (pass.status !== 'issued' || graceUnix <= nowUnix) {
    return NextResponse.redirect(new URL('/pass?etat=expire', request.url), 302);
  }

  // Le bearer brut disparaît immédiatement de l'URL : le navigateur ne
  // conserve ensuite qu'un cookie signé, HttpOnly, SameSite=Lax et court.
  const cookieExpiry = Math.min(graceUnix, nowUnix + 8 * 60 * 60);
  const response = NextResponse.redirect(new URL('/pass', request.url), 302);

  response.cookies.set({
    name: COOKIE,
    value: makeEventPassCookie(pass.public_id, cookieExpiry),
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(1, cookieExpiry - nowUnix),
  });

  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
