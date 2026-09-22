import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import {
  makeEventPassCookie,
  verifyEventAccessLink,
} from '@/lib/event-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE = 'rv_event_pass';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const expiresAt = Number(url.searchParams.get('exp'));
  const signature = url.searchParams.get('sig') ?? '';

  if (!verifyEventAccessLink(id, expiresAt, signature)) {
    return NextResponse.redirect(new URL('/pass?etat=invalide', request.url), 302);
  }

  const db = supabaseAdmin();

  const { data: limit } = await db.rpc('consume_rate_limit', {
    p_key: `event-access-open:${id}`,
    p_max: 30,
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
    .eq('public_id', id)
    .maybeSingle();

  if (!pass) {
    return NextResponse.redirect(new URL('/pass?etat=invalide', request.url), 302);
  }

  const graceUnix = Math.floor(new Date(pass.grace_until).getTime() / 1000);
  const nowUnix = Math.floor(Date.now() / 1000);

  // La signature doit être exactement bornée par l'échéance enregistrée.
  // Impossible de prolonger un pass en modifiant simplement ?exp=.
  if (graceUnix !== expiresAt || pass.status !== 'issued' || graceUnix <= nowUnix) {
    return NextResponse.redirect(new URL('/pass?etat=expire', request.url), 302);
  }

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
