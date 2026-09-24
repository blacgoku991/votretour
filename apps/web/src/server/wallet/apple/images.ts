import 'server-only';
import { createHash } from 'node:crypto';
import { readLocalMedia } from '../media';
import { svgToPng, thumbPng } from '../art/raster';
import { thumbCount } from '../art/slats';
import type { WalletView } from '../types';
import { ICON_SIZE, LOGO_BOX, STRIP_SIZE, iconSvg, markSvg, stripSvg, stripVeilSvg } from './art';
import { passPalette, thumbnailSpec } from './render';

/**
 * Images du .pkpass, @1x, @2x et @3x.
 *
 *  - icon    : écran verrouillé, notifications, courriels (29 pt). Le logo
 *              de l'établissement sur un carré au fond du pass, sinon le
 *              signe Rangvia ;
 *  - logo    : en haut à gauche (≤ 160 × 50 pt), le logo téléversé tel
 *              quel (transparence gardée), sinon le signe Rangvia sans
 *              fond, à côté duquel Wallet écrit le nom (logoText) ;
 *  - thumbnail (file) : les lattes, qui changent avec la position ;
 *  - strip   (drop)   : la couverture de l'événement voilée à gauche pour
 *              la lisibilité, sinon la file couchée ton sur ton.
 *
 * Sources : fichiers de MEDIA_ROOT uniquement (media.ts, pas de SSRF).
 * Une image illisible ne fait jamais échouer le pass : repli sur le signe.
 * Cache mémoire borné, clé = empreinte de la source + variante : une
 * vague de 200 accès ne redécode pas 200 fois la même couverture.
 */

export type Scale = 1 | 2 | 3;
const SCALES: readonly Scale[] = [1, 2, 3];

const MEMORY_MAX = 128;
const memory = new Map<string, Buffer>();

function remember(key: string, png: Buffer): Buffer {
  memory.delete(key);
  memory.set(key, png);
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
  return png;
}

async function once(key: string, make: () => Promise<Buffer>): Promise<Buffer> {
  const hit = memory.get(key);
  if (hit) return hit;
  return remember(key, await make());
}

type SharpFactory = typeof import('sharp').default;
let sharpPromise: Promise<SharpFactory> | null = null;

async function sharp(): Promise<SharpFactory> {
  sharpPromise ??= import('sharp').then((mod) => (mod.default ?? mod) as unknown as SharpFactory);
  return sharpPromise;
}

/**
 * Décodage borné : 40 mégapixels suffisent largement à un logo ou à une
 * photo de téléphone (48 Mpx en 4:3 recadrés par l'éditeur). Le défaut de
 * sharp (268 Mpx) laisserait une image piégée occuper des centaines de
 * mégaoctets, une fois par échelle et par tâche du vidage (20 en
 * parallèle). Au-delà, sharp lève : le pass repart sur le signe Rangvia.
 */
export const MAX_INPUT_PIXELS = 40_000_000;
const INPUT = { limitInputPixels: MAX_INPUT_PIXELS } as const;

function digest(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 20);
}

/** Nom Apple d'une variante : logo.png, logo@2x.png, logo@3x.png. */
export function scaledName(base: string, scale: Scale): string {
  return scale === 1 ? `${base}.png` : `${base}@${scale}x.png`;
}

/** Logo téléversé, contenu dans 160 × 50 pt, transparence gardée. */
async function brandLogo(source: Buffer, scale: Scale): Promise<Buffer> {
  return once(`logo-${digest(source)}-${scale}`, async () => (await sharp())(source, INPUT)
    .resize({
      width: LOGO_BOX.width * scale,
      height: LOGO_BOX.height * scale,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9, palette: true, effort: 8 })
    .toBuffer());
}

/** Icône carrée : le logo centré sur le fond du pass, avec une marge. */
async function brandIcon(source: Buffer, background: string, scale: Scale): Promise<Buffer> {
  const px = ICON_SIZE * scale;
  const inner = Math.round(px * 0.78);
  return once(`icon-${digest(source)}-${background}-${scale}`, async () => {
    const s = await sharp();
    const logo = await s(source, INPUT).resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    return s({ create: { width: px, height: px, channels: 4, background } })
      .composite([{ input: logo, gravity: 'center' }])
      .png({ compressionLevel: 9, palette: true, effort: 8 })
      .toBuffer();
  });
}

/** Couverture recadrée au format du bandeau, voilée à gauche. */
async function coverStrip(source: Buffer, background: string, scale: Scale): Promise<Buffer> {
  const width = STRIP_SIZE.width * scale;
  const height = STRIP_SIZE.height * scale;
  return once(`strip-${digest(source)}-${background}-${scale}`, async () => {
    const s = await sharp();
    return s(source, INPUT)
      .rotate() // orientation EXIF des photos de téléphone
      .resize({ width, height, fit: 'cover', position: 'attention' })
      .composite([{ input: Buffer.from(stripVeilSvg(background, width, height), 'utf8') }])
      .flatten({ background })
      .png({ compressionLevel: 9, palette: true, quality: 92, dither: 0.8, effort: 8 })
      .toBuffer();
  });
}

async function svgPng(svg: string, key: string): Promise<Buffer> {
  return once(`svg-${key}-${digest(svg)}`, () => svgToPng(svg, { palette: true }));
}

/**
 * Toutes les images d'un pass, par nom de fichier. Les sources locales
 * sont lues ici (bornées en chemin et en taille par readLocalMedia).
 */
export async function renderAppleImages(
  view: WalletView,
  sources: { logo?: Buffer | null; cover?: Buffer | null } = {},
): Promise<{ files: Map<string, Buffer>; brandLogo: boolean }> {
  const palette = passPalette(view);
  const isEvent = view.kind === 'event' && Boolean(view.event);
  // Latte « Vous » : l'accent sur l'encre ; sur la couleur d'une marque,
  // le texte du billet (l'accent y serait invisible).
  const self = isEvent ? palette.foreground : palette.accent;
  const files = new Map<string, Buffer>();

  const logoSource = sources.logo === undefined ? await readLocalMedia(view.brand.logoFile) : sources.logo;
  const coverSource = sources.cover === undefined
    ? (isEvent && view.brand.cover?.kind === 'local' ? await readLocalMedia(view.brand.cover) : null)
    : sources.cover;

  let brandLogoUsed = Boolean(logoSource);
  for (const scale of SCALES) {
    let logo: Buffer | null = null;
    let icon: Buffer | null = null;
    if (logoSource) {
      try {
        [logo, icon] = await Promise.all([brandLogo(logoSource, scale), brandIcon(logoSource, palette.background, scale)]);
      } catch {
        // Fichier corrompu ou format exotique : on retombe sur le signe.
        logo = null;
        icon = null;
        brandLogoUsed = false;
      }
    }
    files.set(scaledName('logo', scale), logo ?? await svgPng(markSvg(palette.foreground, self, scale), `mark-${scale}`));
    files.set(scaledName('icon', scale), icon ?? await svgPng(iconSvg(palette.background, palette.foreground, self, scale), `icon-${scale}`));

    if (isEvent) {
      let strip: Buffer | null = null;
      if (coverSource) {
        try {
          strip = await coverStrip(coverSource, palette.background, scale);
        } catch {
          strip = null;
        }
      }
      files.set(scaledName('strip', scale), strip ?? await svgPng(stripSvg(palette.background, palette.foreground, scale), `strip-${scale}`));
    } else {
      const thumb = thumbnailSpec(view);
      if (thumb) files.set(scaledName('thumbnail', scale), await thumbPng(thumbCount(thumb.peopleAhead), view.brand.accent, scale));
    }
  }
  // Un logo illisible à une seule échelle : on reprend le signe partout,
  // plutôt qu'un pass qui mélange deux dessins selon l'écran.
  if (logoSource && !brandLogoUsed) {
    for (const scale of SCALES) {
      files.set(scaledName('logo', scale), await svgPng(markSvg(palette.foreground, self, scale), `mark-${scale}`));
      files.set(scaledName('icon', scale), await svgPng(iconSvg(palette.background, palette.foreground, self, scale), `icon-${scale}`));
    }
  }
  return { files, brandLogo: brandLogoUsed };
}
