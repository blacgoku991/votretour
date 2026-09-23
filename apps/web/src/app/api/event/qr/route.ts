import QRCode from 'qrcode';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  event: z.string().uuid(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ event: url.searchParams.get('event') });
  if (!parsed.success) return new Response('Événement invalide', { status: 400 });

  const { data: event } = await supabaseAdmin()
    .from('event_campaigns')
    .select('id, status, accent_hex, locations(slug)')
    .eq('id', parsed.data.event)
    .maybeSingle();

  if (!event) return new Response('Événement introuvable', { status: 404 });

  const location = Array.isArray(event.locations) ? event.locations[0] : event.locations;
  if (!location?.slug) return new Response('Établissement introuvable', { status: 404 });

  const target = `${env.siteUrl}/e/${location.slug}?src=qr&event=${event.id}`;
  const dark = /^#[0-9A-Fa-f]{6}$/.test(event.accent_hex ?? '')
    ? event.accent_hex
    : '#0B0E13';

  const png = await QRCode.toBuffer(target, {
    errorCorrectionLevel: 'H',
    type: 'png',
    width: 720,
    margin: 2,
    color: { dark: dark + 'FF', light: '#FFFFFFFF' },
  });

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
