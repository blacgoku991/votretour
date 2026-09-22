import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import {
  hashEventPassToken,
  makeEventPassCookie,
  verifyEventPassCookie,
} from '@/lib/event-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE = 'rv_event_pass';

const activationSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/i),
});

async function loadPassByPublicId(publicId: string) {
  const { data: pass } = await supabaseAdmin()
    .from('event_access_passes')
    .select(`
      public_id, status, issued_at, valid_until, grace_until, redeemed_at,
      event_campaigns(name, status),
      locations(name, city, logo_url),
      queue_entries(client_name)
    `)
    .eq('public_id', publicId)
    .maybeSingle();

  if (!pass) return null;

  const event = Array.isArray(pass.event_campaigns) ? pass.event_campaigns[0] : pass.event_campaigns;
  const location = Array.isArray(pass.locations) ? pass.locations[0] : pass.locations;
  const entry = Array.isArray(pass.queue_entries) ? pass.queue_entries[0] : pass.queue_entries;

  const expired = pass.status === 'issued' && new Date(pass.grace_until).getTime() < Date.now();

  return {
    passId: pass.public_id,
    status: expired ? 'expired' : pass.status,
    eventName: event?.name ?? 'Événement Rangvia',
    eventStatus: event?.status ?? 'ended',
    locationName: location?.name ?? 'Établissement',
    city: location?.city ?? null,
    logoUrl: location?.logo_url ?? null,
    clientName: entry?.client_name ?? null,
    validUntil: pass.valid_until,
    graceUntil: pass.grace_until,
    redeemedAt: pass.redeemed_at,
  };
}

export async function POST(request: Request) {
  const body = activationSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ ok: false, error: 'Laisser-passer invalide.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const tokenHash = hashEventPassToken(body.data.token);

  const { data: rateData } = await db.rpc('consume_rate_limit', {
    p_key: `event-pass-activate:${tokenHash.slice(0, 24)}`,
    p_max: 20,
    p_window_seconds: 300,
  });
  const rate = Array.isArray(rateData) ? rateData[0] : rateData;
  if (rate && rate.allowed === false) {
    return NextResponse.json(
      { ok: false, error: 'Trop de tentatives.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retry_after_seconds ?? 60) },
      },
    );
  }

  const { data: pass } = await db
    .from('event_access_passes')
    .select('public_id, status, grace_until')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!pass) {
    return NextResponse.json({ ok: false, error: 'Laisser-passer introuvable.' }, { status: 404 });
  }

  const graceUnix = Math.floor(new Date(pass.grace_until).getTime() / 1000);
  const nowUnix = Math.floor(Date.now() / 1000);

  if (pass.status !== 'issued' || graceUnix <= nowUnix) {
    const data = await loadPassByPublicId(pass.public_id);
    return NextResponse.json({ ok: true, data }, { status: 200 });
  }

  const cookieExpiry = Math.min(graceUnix, nowUnix + 8 * 60 * 60);
  const response = NextResponse.json({
    ok: true,
    data: await loadPassByPublicId(pass.public_id),
  });

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
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET() {
  const jar = await cookies();
  const session = verifyEventPassCookie(jar.get(COOKIE)?.value);

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Session de laisser-passer absente ou expirée.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const data = await loadPassByPublicId(session.publicId);
  if (!data) {
    return NextResponse.json({ ok: false, error: 'Laisser-passer introuvable.' }, { status: 404 });
  }

  return NextResponse.json(
    { ok: true, data },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}
