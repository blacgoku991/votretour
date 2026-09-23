import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { TV_COOKIE } from '@/server/tv-kiosk';

export const runtime = 'nodejs';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(TV_COOKIE, '', {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/tv',
    maxAge: 0,
  });
  return response;
}
