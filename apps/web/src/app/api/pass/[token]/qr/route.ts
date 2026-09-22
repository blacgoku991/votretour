import QRCode from 'qrcode';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { currentEventPassSlot, hashEventPassToken, signEventPassSlot } from '@/lib/event-pass';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return new Response('Pass invalide', { status: 400 });
  }

  const tokenHash = hashEventPassToken(token);
  const db = supabaseAdmin();

  const { data: limit } = await db.rpc('consume_rate_limit', {
    p_key: `event-pass-qr:${tokenHash.slice(0, 24)}`,
    p_max: 240,
    p_window_seconds: 300,
  });
  const rate = Array.isArray(limit) ? limit[0] : limit;
  if (rate && rate.allowed === false) {
    return new Response('Trop de requêtes', {
      status: 429,
      headers: { 'Retry-After': String(rate.retry_after_seconds ?? 30) },
    });
  }

  const { data: pass } = await db
    .from('event_access_passes')
    .select('public_id, status, grace_until')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!pass || pass.status !== 'issued' || new Date(pass.grace_until).getTime() < Date.now()) {
    return new Response('Pass expiré', { status: 410 });
  }

  const slot = currentEventPassSlot();
  const signature = signEventPassSlot(tokenHash, slot);
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
    },
  });
}
