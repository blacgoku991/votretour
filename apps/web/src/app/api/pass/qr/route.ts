import QRCode from 'qrcode';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  currentEventPassSlot,
  signEventPassSlot,
  verifyEventPassCookie,
} from '@/lib/event-pass';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE = 'rv_event_pass';

export async function GET() {
  const jar = await cookies();
  const session = verifyEventPassCookie(jar.get(COOKIE)?.value);

  if (!session) {
    return new Response('Session expirée', {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const db = supabaseAdmin();

  const { data: limit } = await db.rpc('consume_rate_limit', {
    p_key: `event-pass-qr:${session.publicId}`,
    p_max: 240,
    p_window_seconds: 300,
  });
  const rate = Array.isArray(limit) ? limit[0] : limit;
  if (rate && rate.allowed === false) {
    return new Response('Trop de requêtes', {
      status: 429,
      headers: {
        'Retry-After': String(rate.retry_after_seconds ?? 30),
        'Cache-Control': 'no-store',
      },
    });
  }

  const { data: pass } = await db
    .from('event_access_passes')
    .select('public_id, token_hash, status, grace_until')
    .eq('public_id', session.publicId)
    .maybeSingle();

  if (!pass || pass.status !== 'issued' || new Date(pass.grace_until).getTime() < Date.now()) {
    return new Response('Pass expiré', {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const slot = currentEventPassSlot();
  const signature = signEventPassSlot(pass.token_hash, slot);
  const target = `${env.siteUrl}/scan/${pass.public_id}?slot=${slot}&sig=${encodeURIComponent(signature)}`;

  const png = await QRCode.toBuffer(target, {
    errorCorrectionLevel: 'H',
    type: 'png',
    width: 720,
    margin: 2,
    color: { dark: '#0B0E13FF', light: '#FFFFFFFF' },
  });

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store, max-age=0',
      'Pragma': 'no-cache',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
