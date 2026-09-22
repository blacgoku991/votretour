import QRCode from 'qrcode';
import { env } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Génère le visuel d'une plaque.
 *
 *   /api/p/{code}?format=svg|png            le QR seul
 *   /api/p/{code}?format=affiche            une affiche A5 prête à imprimer
 *
 * Le QR encode exactement la même URL que le tag NFC — /e/{code} — pour
 * que les deux ouvrent rigoureusement la même expérience. Correction
 * d'erreur au niveau H : le code reste lisible même abîmé, sali, ou
 * partiellement masqué par le repère central.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'svg';
  const size = Math.min(Math.max(Number(url.searchParams.get('size') ?? 640), 160), 2048);

  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(code)) {
    return new Response('Code invalide', { status: 400 });
  }

  const { data: plate } = await supabaseAdmin()
    .from('plates')
    .select('label, is_active, locations(name, city)')
    .eq('code', code)
    .maybeSingle();

  if (!plate) return new Response('Plaque introuvable', { status: 404 });

  const location = Array.isArray(plate.locations) ? plate.locations[0] : plate.locations;
  const target = `${env.siteUrl}/e/${code}`;

  if (format === 'png') {
    const buffer = await QRCode.toBuffer(target, {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: size,
      margin: 2,
      color: { dark: '#0B0E13FF', light: '#FFFFFFFF' },
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="votretour-${code}.png"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  const qrSvg = await QRCode.toString(target, {
    errorCorrectionLevel: 'H',
    type: 'svg',
    margin: 0,
    color: { dark: '#0B0E13', light: '#FFFFFF' },
  });

  if (format === 'affiche') {
    const poster = buildPoster({
      qrSvg,
      placeName: location?.name ?? 'Votre établissement',
      plateLabel: plate.label,
      url: target.replace(/^https?:\/\//, ''),
    });
    return new Response(poster, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Disposition': `inline; filename="affiche-${code}.svg"`,
      },
    });
  }

  return new Response(qrSvg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * Affiche A5 (148 × 210 mm) à poser au comptoir. Dessinée dans le
 * vocabulaire du produit : un rail, des lattes, le QR, une phrase.
 *
 * Contrainte d'impression : on ne peut pas garantir qu'Archivo soit
 * présent sur la machine qui imprimera le fichier. Les tailles de
 * caractères sont donc calculées pour tenir dans la largeur utile quelle
 * que soit la police de repli — un nom d'établissement à rallonge rétrécit
 * au lieu de déborder de la page.
 */
const SAFE_FONT = "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const CONTENT_WIDTH = 116; // 148 mm moins deux marges de 16 mm

/** Taille de police qui garde `text` dans `maxWidth`, sans dépasser `base`. */
function fitFontSize(text: string, base: number, maxWidth = CONTENT_WIDTH, ratio = 0.56): number {
  if (!text) return base;
  const needed = maxWidth / (text.length * ratio);
  return Math.max(3.2, Math.min(base, needed));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildPoster({
  qrSvg, placeName, plateLabel, url,
}: { qrSvg: string; placeName: string; plateLabel: string; url: string }): string {
  // On réinsère le contenu du QR à l'échelle voulue.
  const inner = qrSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const viewBox = qrSvg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 41 41';

  const name = escapeXml(placeName);
  const label = escapeXml(plateLabel.toUpperCase());
  const link = escapeXml(url);
  const tagline = "Scannez, rejoignez la file, et revenez quand c'est votre tour.";

  const nameSize = fitFontSize(placeName, 11, CONTENT_WIDTH, 0.6);
  const labelSize = fitFontSize(plateLabel, 6.2, CONTENT_WIDTH, 0.82);
  const taglineSize = fitFontSize(tagline, 6.4, CONTENT_WIDTH, 0.48);
  const linkSize = fitFontSize(url, 5, CONTENT_WIDTH, 0.56);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="148mm" height="210mm" viewBox="0 0 148 210">
  <rect width="148" height="210" fill="#FAF9F6"/>

  <!-- le rail et ses lattes : la signature du produit -->
  <g>
    <rect x="16" y="18" width="0.8" height="26" rx="0.4" fill="#0B0E13" opacity="0.28"/>
    <rect x="20" y="19" width="22" height="3.4" rx="1.7" fill="#0B0E13" opacity="0.22"/>
    <rect x="20" y="27" width="16" height="3.4" rx="1.7" fill="#0B0E13" opacity="0.36"/>
    <rect x="20" y="35" width="10" height="3.4" rx="1.7" fill="#FF4B1F"/>
    <rect x="16.8" y="20.1" width="3.2" height="1.2" rx="0.6" fill="#0B0E13" opacity="0.28"/>
    <rect x="16.8" y="28.1" width="3.2" height="1.2" rx="0.6" fill="#0B0E13" opacity="0.28"/>
    <rect x="16.8" y="36.1" width="3.2" height="1.2" rx="0.6" fill="#FF4B1F"/>
  </g>

  <text x="16" y="60" font-family="${SAFE_FONT}" font-size="${nameSize.toFixed(2)}"
        font-weight="800" letter-spacing="-0.3" fill="#0B0E13">${name}</text>
  <text x="16" y="70" font-family="${SAFE_FONT}" font-size="${labelSize.toFixed(2)}"
        font-weight="600" letter-spacing="1.4" fill="#6B7583">${label}</text>

  <text x="16" y="88" font-family="${SAFE_FONT}" font-size="8.4"
        font-weight="700" fill="#0B0E13">Pas envie d&apos;attendre debout ?</text>
  <text x="16" y="98" font-family="${SAFE_FONT}" font-size="${taglineSize.toFixed(2)}"
        fill="#46505E">${escapeXml(tagline)}</text>

  <!-- le QR -->
  <rect x="34" y="108" width="80" height="80" rx="6" fill="#FFFFFF" stroke="#E7E3DA" stroke-width="0.6"/>
  <svg x="39" y="113" width="70" height="70" viewBox="${viewBox}">${inner}</svg>

  <text x="74" y="196" text-anchor="middle" font-family="${SAFE_FONT}"
        font-size="${linkSize.toFixed(2)}" font-weight="600" letter-spacing="0.3"
        fill="#6B7583">${link}</text>
  <text x="74" y="203" text-anchor="middle" font-family="${SAFE_FONT}"
        font-size="4.4" fill="#B4AEA1">Aucune application à installer.</text>
</svg>`;
}
