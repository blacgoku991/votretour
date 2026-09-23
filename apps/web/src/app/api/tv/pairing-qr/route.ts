import QRCode from 'qrcode';
import { z } from 'zod';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ code: url.searchParams.get('code') });
  if (!parsed.success) return new Response('Code invalide', { status: 400 });

  const target = `${env.siteUrl}/tv?code=${parsed.data.code}`;
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
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
