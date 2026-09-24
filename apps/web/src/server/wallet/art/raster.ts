import 'server-only';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mediaRoot } from '../media';
import type { WalletAccent } from '../types';
import { ART_REVISION, heroSvg, thumbSvg, type SlatsCount } from './slats';

/**
 * SVG → PNG, avec cache.
 *
 * `sharp` (librsvg) est déjà dans l'image Docker (binaires linuxmusl,
 * dépendance de Next) ; il est chargé À LA DEMANDE : une action de file
 * qui ne touche pas au Wallet n'a pas à charger libvips.
 *
 * Trois protections, parce qu'une vague de 200 accès demande 200 fois
 * les mêmes quelques images :
 *  - rendus simultanés d'une même image regroupés : un seul passage par
 *    sharp, les autres attendent le même résultat ;
 *  - mémoire (quelques dizaines d'entrées, bornée) ;
 *  - disque : un dossier VOISIN de MEDIA_ROOT (/app/data/wallet-cache par
 *    défaut, ou WALLET_CACHE_DIR), jamais dedans. MEDIA_ROOT est servi
 *    tel quel par /media/… et sauvegardé avec les téléversements des pros :
 *    un cache n'a rien à y faire. Il survit aux redémarrages du processus
 *    (le dossier /app/data appartient à l'utilisateur du conteneur) mais
 *    pas forcément au redéploiement : ce n'est qu'un cache, il se refait
 *    au premier passage. Écriture atomique (fichier temporaire
 *    puis renommage) : deux processus qui génèrent la même image en même
 *    temps ne laissent jamais un fichier tronqué. Un disque en lecture
 *    seule n'empêche rien : on sert depuis la mémoire.
 * La clé est l'empreinte du SVG : un nouveau dessin ne peut pas servir
 * l'ancienne image.
 */

const MEMORY_MAX = 96;
const memory = new Map<string, Buffer>();
const inflight = new Map<string, Promise<Buffer>>();
let diskWarned = false;

function remember(key: string, png: Buffer): void {
  if (memory.has(key)) memory.delete(key);
  memory.set(key, png);
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

export function walletCacheDir(): string {
  const explicit = process.env.WALLET_CACHE_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(path.dirname(path.resolve(mediaRoot())), 'wallet-cache');
}

type SharpFactory = (input: Buffer, options?: { density?: number }) => {
  png(options?: { compressionLevel?: number; palette?: boolean; effort?: number }): { toBuffer(): Promise<Buffer> };
};

let sharpPromise: Promise<SharpFactory> | null = null;

async function loadSharp(): Promise<SharpFactory> {
  sharpPromise ??= import('sharp').then((mod) => (mod.default ?? mod) as unknown as SharpFactory);
  return sharpPromise;
}

/** Rastérise un SVG. PNG 8 bits (palette) : un .pkpass visé sous 150 ko. */
export async function svgToPng(svg: string, options: { palette?: boolean } = {}): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(Buffer.from(svg, 'utf8'), { density: 72 })
    .png({ compressionLevel: 9, palette: options.palette ?? true, effort: 8 })
    .toBuffer();
}

async function renderAndStore(key: string, svg: string, palette: boolean): Promise<Buffer> {
  const dir = walletCacheDir();
  const file = path.join(dir, `${key}.png`);
  try {
    const png = await readFile(file);
    if (png.length > 0) {
      remember(key, png);
      return png;
    }
  } catch {
    /* pas encore en cache */
  }

  const png = await svgToPng(svg, { palette });
  remember(key, png);
  try {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, png);
    await rename(tmp, file);
  } catch (error) {
    // Une fois par processus : un disque en lecture seule ne doit pas
    // remplir les journaux à chaque image.
    if (!diskWarned) {
      diskWarned = true;
      console.warn('[wallet] cache d’images sur disque indisponible', error instanceof Error ? error.message : error);
    }
  }
  return png;
}

async function cached(name: string, svg: string, palette = true): Promise<Buffer> {
  const digest = createHash('sha256').update(svg).digest('hex').slice(0, 16);
  const key = `${ART_REVISION}-${name}-${digest}`;
  const hit = memory.get(key);
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;
  const job = renderAndStore(key, svg, palette).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Vignette Apple : thumbnail.png (1), @2x (2), @3x (3). */
export function thumbPng(count: SlatsCount, accent: WalletAccent, scale: 1 | 2 | 3): Promise<Buffer> {
  return cached(`thumb-${count}-${accent}-${scale}x`, thumbSvg(count, accent, scale));
}

/** En-tête Google 1032 × 336. */
export function heroPng(count: SlatsCount, accent: WalletAccent): Promise<Buffer> {
  return cached(`hero-${count}-${accent}`, heroSvg(count, accent));
}

let logoSvg: Promise<string> | null = null;

/** Logo Rangvia carré, rastérisé depuis public/icon.svg (logo par défaut du pass). */
export async function rangviaLogoPng(size = 660): Promise<Buffer> {
  logoSvg ??= readFile(path.join(process.cwd(), 'public', 'icon.svg'), 'utf8').catch((error) => {
    logoSvg = null;
    throw error;
  });
  const source = await logoSvg;
  // Même dessin, taille demandée : on réécrit seulement width/height.
  const svg = source.replace(/<svg([^>]*?)\swidth="\d+"\sheight="\d+"/, `<svg$1 width="${size}" height="${size}"`);
  return cached(`logo-${size}`, svg, false);
}
