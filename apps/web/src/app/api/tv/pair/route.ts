import { NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/server/ratelimit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import {
  TV_COOKIE,
  generateTvDeviceToken,
  hashTvDeviceToken,
  hashTvPairCode,
} from '@/server/tv-kiosk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
});

function clientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
  ).slice(0, 80);
}

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    await enforceRateLimit(
      'tv-pair:' + clientIp(request),
      10,
      600,
      'Trop de codes essayés. Patientez quelques minutes.',
    );

    const rawToken = generateTvDeviceToken();
    const { data, error } = await supabaseAdmin().rpc('consume_display_pair_code', {
      p_code_hash: hashTvPairCode(body.code),
      p_token_hash: hashTvDeviceToken(rawToken),
    });

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { ok: false, error: 'Code invalide ou expiré.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const response = NextResponse.json(
      { ok: true, data: { paired: true } },
      { headers: { 'Cache-Control': 'no-store' } },
    );

    response.cookies.set(TV_COOKIE, rawToken, {
      httpOnly: true,
      secure: env.isProduction,
      sameSite: 'lax',
      path: '/tv',
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Appairage impossible.';
    const status = message.includes('Trop de') ? 429 : 400;
    return NextResponse.json(
      { ok: false, error: message },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
