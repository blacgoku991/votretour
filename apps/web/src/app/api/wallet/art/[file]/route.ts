import { parseArtFile } from '@/server/wallet/art/slats';
import { heroPng, rangviaLogoPng } from '@/server/wallet/art/raster';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Images publiques des passes Google Wallet : lattes d'en-tête
 * (rang-<révision>-<n|plus>-<accent>.png, 1032 × 336) et logo Rangvia par
 * défaut (rangvia-660.png).
 *
 * Google télécharge et met en cache ces images PAR URL : chaque état a sa
 * propre URL, la révision du dessin en fait partie, et son contenu ne
 * change jamais (d'où « immutable »). Le logo, lui, suit public/icon.svg,
 * qui peut être retouché sans y penser : un jour de cache seulement. Le nom
 * passe une liste blanche stricte avant tout travail : aucune donnée, aucun
 * chemin de fichier ne vient de la requête.
 */
export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const art = parseArtFile(file);
  if (!art) return new Response('Introuvable', { status: 404, headers: { 'Cache-Control': 'no-store' } });

  try {
    const png = art.type === 'logo' ? await rangviaLogoPng(660) : await heroPng(art.count, art.accent);
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(png.length),
        'Cache-Control': art.type === 'logo' ? 'public, max-age=86400' : 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[wallet] image indisponible', file, error instanceof Error ? error.message : error);
    return new Response('Indisponible', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  }
}
