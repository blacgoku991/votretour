import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import rawManifest from '@/lib/metiers/videos.json';
import { shippedCapabilities } from '@/lib/metiers/capabilities';
import { PROFILE_BASE, getMetier } from '@/lib/metiers/registry';
import { selectMetier } from '@/lib/metiers/select';
import type { Capability } from '@/lib/metiers/types';

/**
 * LE MANIFESTE DES VIDÉOS DE DÉMONSTRATION (`lib/metiers/videos.json`).
 *
 * Écrit par le montage (`scripts/demo/montage.mjs`), lu par les pages
 * métier. Ce test vérifie ce que la page promet au visiteur : chaque
 * fichier existe, pèse moins que son budget ([SEO § 10.5]), est bien du
 * format annoncé, et aucun métier n'a de vidéo pour un parcours que le
 * produit ne livre pas encore ([SEO § 10.1, règle 6]).
 *
 * Aucun outil externe n'est exigé : l'en-tête des fichiers est lu
 * directement (boîtes MP4, EBML du WebM, signatures des images). Si
 * `ffprobe` est présent, il confirme en plus codec, pixels et cadence.
 */

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));

/** Budgets de [SEO § 10.5] (octets). */
const BUDGET = { mp4: 4_000_000, webm: 3_000_000, poster: 60_000, teaser: 600_000 };

interface Files {
  mp4: string;
  webm?: string;
  poster: { jpg: string; webp?: string; avif?: string };
  teaser?: { mp4: string; webm?: string };
}
interface Entry {
  id: string;
  metier: string;
  duration: number;
  width: number;
  height: number;
  uploadDate: string;
  files: Files;
  bytes?: Record<string, unknown>;
  chapters: string[];
}

const manifest = rawManifest as unknown;
const entries: Entry[] = Array.isArray(manifest) ? (manifest as Entry[]) : [];

const onDisk = (url: string) => `${PUBLIC}${url}`;
const read = (url: string) => readFileSync(onDisk(url));

/** Boîtes MP4 de premier niveau, dans l'ordre du fichier. */
function mp4Boxes(buf: Buffer): string[] {
  const boxes: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length && boxes.length < 64) {
    let size = buf.readUInt32BE(offset);
    if (size === 1) size = Number(buf.readBigUInt64BE(offset + 8));
    else if (size === 0) size = buf.length - offset;
    if (size < 8) break;
    boxes.push(buf.toString('latin1', offset + 4, offset + 8));
    offset += size;
  }
  return boxes;
}

/** Première entrée « avc1 » : largeur, hauteur et profil H.264 (avcC). */
function avcInfo(buf: Buffer): { width: number; height: number; profile: number } | null {
  // Après « stsd » : « avc1 » figure aussi parmi les marques compatibles de ftyp.
  const at = buf.indexOf('avc1', buf.indexOf('stsd', 0, 'latin1'), 'latin1');
  const cfg = buf.indexOf('avcC', 0, 'latin1');
  if (at < 0 || cfg < 0) return null;
  // VisualSampleEntry : 6 octets réservés, index (2), 16 réservés, puis largeur et hauteur.
  return { width: buf.readUInt16BE(at + 28), height: buf.readUInt16BE(at + 30), profile: buf[cfg + 5]! };
}

function ffprobeAvailable(): boolean {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('manifeste des vidéos de démonstration', () => {
  it('est une liste, une entrée au plus par métier', () => {
    expect(Array.isArray(manifest)).toBe(true);
    const metiers = entries.map((e) => e.metier);
    expect(new Set(metiers).size).toBe(metiers.length);
  });

  for (const entry of entries) {
    describe(entry.metier, () => {
      const urls = [
        entry.files.mp4, entry.files.webm, entry.files.poster.jpg, entry.files.poster.webp, entry.files.poster.avif,
        entry.files.teaser?.mp4, entry.files.teaser?.webm,
      ].filter((u): u is string => typeof u === 'string');

      it('porte des champs valides', () => {
        expect(entry.id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
        expect(entry.duration).toBeGreaterThan(0);
        expect(entry.width).toBe(1920);
        expect(entry.height).toBe(1080);
        expect(entry.uploadDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(entry.uploadDate))).toBe(false);
        expect(Date.parse(entry.uploadDate)).toBeLessThanOrEqual(Date.now());
        expect(entry.chapters.length).toBeGreaterThan(0);
        for (const chapter of entry.chapters) {
          expect(chapter.trim()).not.toBe('');
          // Typographie du dépôt : apostrophe courbe.
          expect(chapter).not.toContain("'");
        }
      });

      it('ne montre qu’un parcours que le produit livre', () => {
        expect(getMetier(entry.metier)?.published).toBe(true);
        // Le profil du métier (celui qu'un nouveau compte obtient) : son
        // socle de capacités doit être livré, sinon la vidéo montrerait un
        // parcours qu'un commerçant qui s'inscrit ne trouverait pas.
        const page = selectMetier(entry.metier);
        expect(page).not.toBeNull();
        const base: readonly Capability[] = page ? PROFILE_BASE[page.profile] ?? [] : [];
        const shipped = shippedCapabilities();
        expect(base.filter((c) => !shipped.has(c))).toEqual([]);
      });

      it('pointe vers des fichiers locaux présents, au nom haché', () => {
        for (const url of urls) {
          expect(url.startsWith(`/videos/${entry.metier}/`)).toBe(true);
          expect(url).toMatch(/\.[0-9a-f]{8}\.(mp4|webm|jpg|webp|avif)$/);
          expect(existsSync(onDisk(url)), url).toBe(true);
        }
      });

      it('tient ses budgets de poids', () => {
        const size = (url?: string) => (url ? statSync(onDisk(url)).size : 0);
        expect(size(entry.files.mp4)).toBeLessThanOrEqual(BUDGET.mp4);
        expect(size(entry.files.webm)).toBeLessThanOrEqual(BUDGET.webm);
        for (const url of Object.values(entry.files.poster)) expect(size(url)).toBeLessThanOrEqual(BUDGET.poster);
        for (const url of Object.values(entry.files.teaser ?? {})) expect(size(url)).toBeLessThanOrEqual(BUDGET.teaser);
      });

      it('annonce des poids exacts', () => {
        const bytes = entry.bytes as { mp4?: number; webm?: number } | undefined;
        if (!bytes) return;
        if (bytes.mp4 !== undefined) expect(bytes.mp4).toBe(statSync(onDisk(entry.files.mp4)).size);
        if (bytes.webm !== undefined && entry.files.webm) expect(bytes.webm).toBe(statSync(onDisk(entry.files.webm)).size);
      });

      it('MP4 : H.264 High 1920×1080, démarrage rapide (moov avant mdat)', () => {
        const buf = read(entry.files.mp4);
        const boxes = mp4Boxes(buf);
        expect(boxes[0]).toBe('ftyp');
        expect(boxes.indexOf('moov')).toBeGreaterThan(-1);
        expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
        expect(avcInfo(buf)).toEqual({ width: 1920, height: 1080, profile: 100 });
      });

      it('aperçu et WebM : bons conteneurs', () => {
        if (entry.files.teaser) {
          const teaser = read(entry.files.teaser.mp4);
          expect(mp4Boxes(teaser).indexOf('moov')).toBeLessThan(mp4Boxes(teaser).indexOf('mdat'));
          expect(avcInfo(teaser)?.width).toBe(960);
        }
        for (const url of [entry.files.webm, entry.files.teaser?.webm]) {
          if (!url) continue;
          const buf = read(url);
          expect(buf.readUInt32BE(0)).toBe(0x1a45dfa3);
          expect(buf.subarray(0, 64).includes(Buffer.from('webm'))).toBe(true);
          expect(buf.subarray(0, 4096).includes(Buffer.from('V_VP9'))).toBe(true);
        }
      });

      it('affiches : JPEG, WebP et AVIF réels', () => {
        const { jpg, webp, avif } = entry.files.poster;
        expect(read(jpg).readUInt16BE(0)).toBe(0xffd8);
        if (webp) expect(read(webp).toString('latin1', 8, 12)).toBe('WEBP');
        if (avif) expect(read(avif).toString('latin1', 4, 12)).toBe('ftypavif');
      });

      it.runIf(ffprobeAvailable())('ffprobe : h264, yuv420p, 30 i/s, durée annoncée', () => {
        const out = JSON.parse(execFileSync('ffprobe', [
          '-v', 'error', '-select_streams', 'v:0', '-show_entries',
          'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate:format=duration', '-of', 'json',
          onDisk(entry.files.mp4),
        ], { encoding: 'utf8' })) as {
          streams: { codec_name: string; profile: string; pix_fmt: string; r_frame_rate: string }[];
          format: { duration: string };
        };
        const stream = out.streams[0]!;
        expect(stream.codec_name).toBe('h264');
        expect(stream.profile).toBe('High');
        expect(stream.pix_fmt).toBe('yuv420p');
        expect(stream.r_frame_rate).toBe('30/1');
        expect(Math.abs(Number(out.format.duration) - entry.duration)).toBeLessThanOrEqual(0.5);
      });
    });
  }
});
