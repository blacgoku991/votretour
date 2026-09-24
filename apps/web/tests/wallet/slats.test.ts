import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  ART_REVISION, HERO_HEIGHT, HERO_WIDTH, heroCount, heroFileName, heroSvg, heroUrl, parseArtFile, thumbCount, thumbSvg,
} from '../../src/server/wallet/art/slats';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { svgToPng, thumbPng, walletCacheDir } from '../../src/server/wallet/art/raster';
import { WALLET_ACCENTS } from '../../src/server/wallet/types';

/**
 * Lattes : un dessin par (format, nombre, accent), identique à chaque
 * appel. Google met les images en cache par URL : deux états ne doivent
 * jamais partager une URL, et une URL ne doit jamais changer de contenu.
 */

describe('lattes (SVG)', () => {
  it('déterministes', () => {
    for (const accent of WALLET_ACCENTS) {
      for (const n of [0, 1, 3, 5, 'plus'] as const) expect(thumbSvg(n, accent, 2)).toBe(thumbSvg(n, accent, 2));
      for (const n of [0, 7, 20, 'plus'] as const) expect(heroSvg(n, accent)).toBe(heroSvg(n, accent));
    }
  });

  it('un état = un dessin', () => {
    const thumbs = new Set<string>();
    const heroes = new Set<string>();
    for (const accent of WALLET_ACCENTS) {
      for (const n of [0, 1, 2, 3, 4, 5, 'plus'] as const) thumbs.add(thumbSvg(n, accent));
      for (let n = 0; n <= 20; n += 1) heroes.add(heroSvg(n, accent));
      heroes.add(heroSvg('plus', accent));
    }
    expect(thumbs.size).toBe(7 * 5);
    expect(heroes.size).toBe(22 * 5);
  });

  it('aucun texte dans l’image, aucune ressource externe', () => {
    for (const svg of [thumbSvg('plus', 'cobalt', 3), heroSvg(12, 'jade')]) {
      expect(svg).not.toMatch(/<text|<image|href=|@import|url\((?!#)/);
    }
  });

  it('paliers et bornes', () => {
    expect(thumbCount(4)).toBe(4);
    expect(thumbCount(6)).toBe('plus');
    expect(heroCount(20)).toBe(20);
    expect(heroCount(21)).toBe('plus');
    expect(() => thumbSvg(6, 'signal')).toThrow();
    expect(() => heroSvg(21, 'signal')).toThrow();
    expect(() => heroSvg(1, 'fuchsia' as never)).toThrow();
  });

  it('noms de fichiers : révision du dessin dans le nom, liste blanche stricte, un seul nom par état', () => {
    expect(ART_REVISION).toMatch(/^r\d+$/);
    const r = ART_REVISION;
    expect(heroFileName(7, 'jade')).toBe(`rang-${r}-7-jade.png`);
    expect(heroUrl('https://rangvia.fr/', 33, 'signal')).toBe(`https://rangvia.fr/api/wallet/art/rang-${r}-plus-signal.png`);
    expect(parseArtFile(`rang-${r}-7-jade.png`)).toEqual({ type: 'hero', count: 7, accent: 'jade' });
    expect(parseArtFile(`rang-${r}-plus-brique.png`)).toEqual({ type: 'hero', count: 'plus', accent: 'brique' });
    expect(parseArtFile('rangvia-660.png')).toEqual({ type: 'logo' });
    for (const bad of [
      // Sans révision, ou une autre révision : une ancienne URL (en cache
      // « immutable » chez Google) ne reçoit jamais le nouveau dessin.
      'rang-7-jade.png', 'rang-r0-7-jade.png', 'rang-r99-7-jade.png',
      `rang-${r}-07-jade.png`, `rang-${r}-21-jade.png`, `rang-${r}-3-ardoise.png`, `rang-${r}-3-jade.svg`,
      `../rang-${r}-3-jade.png`, `rang-${r}-3-jade.png?x`,
    ]) {
      expect(parseArtFile(bad), bad).toBeNull();
    }
  });

  it('en-tête : sillage des places parcourues, jamais à la place d’une latte', () => {
    // Personne devant : la latte « Vous » seule, son sillage en creux derrière elle.
    const svg = heroSvg(0, 'signal');
    expect((svg.match(/fill="none"/g) ?? []).length).toBeGreaterThan(0);
    // « Plus » : la latte « Vous » est au bord, pas de sillage.
    expect(heroSvg('plus', 'signal')).not.toContain('fill="none"');
  });
});

describe('lattes (PNG)', () => {
  it('vignette Apple @1x, @2x, @3x', async () => {
    for (const scale of [1, 2, 3] as const) {
      const meta = await sharp(await svgToPng(thumbSvg(3, 'signal', scale))).metadata();
      expect(meta.format).toBe('png');
      expect([meta.width, meta.height]).toEqual([90 * scale, 90 * scale]);
      expect(meta.hasAlpha).toBe(true);
    }
  });

  it('en-tête Google 1032 × 336, léger', async () => {
    const png = await svgToPng(heroSvg(12, 'cobalt'));
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([HERO_WIDTH, HERO_HEIGHT]);
    expect(png.length).toBeLessThan(60_000);
  });
});

describe('cache des rendus', () => {
  it('dossier voisin de MEDIA_ROOT, jamais dedans (pas servi par /media)', () => {
    const saved = { media: process.env.MEDIA_ROOT, cache: process.env.WALLET_CACHE_DIR };
    try {
      process.env.MEDIA_ROOT = '/srv/rangvia/uploads';
      delete process.env.WALLET_CACHE_DIR;
      expect(walletCacheDir()).toBe('/srv/rangvia/wallet-cache');
      process.env.WALLET_CACHE_DIR = '/var/cache/rangvia-wallet';
      expect(walletCacheDir()).toBe('/var/cache/rangvia-wallet');
    } finally {
      if (saved.media === undefined) delete process.env.MEDIA_ROOT; else process.env.MEDIA_ROOT = saved.media;
      if (saved.cache === undefined) delete process.env.WALLET_CACHE_DIR; else process.env.WALLET_CACHE_DIR = saved.cache;
    }
  });

  it('rendus simultanés d’une même image : un seul passage, un seul fichier', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rv-wallet-cache-'));
    const saved = process.env.WALLET_CACHE_DIR;
    process.env.WALLET_CACHE_DIR = dir;
    try {
      const [a, b, c] = await Promise.all([thumbPng(4, 'copper', 2), thumbPng(4, 'copper', 2), thumbPng(4, 'copper', 2)]);
      expect(b).toBe(a);
      expect(c).toBe(a);
      expect(readdirSync(dir).filter((name) => name.endsWith('.png'))).toHaveLength(1);
      // Aucun fichier temporaire oublié.
      expect(readdirSync(dir).every((name) => name.endsWith('.png'))).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.WALLET_CACHE_DIR; else process.env.WALLET_CACHE_DIR = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
