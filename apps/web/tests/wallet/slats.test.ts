import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  HERO_HEIGHT, HERO_WIDTH, heroCount, heroFileName, heroSvg, heroUrl, parseArtFile, thumbCount, thumbSvg,
} from '../../src/server/wallet/art/slats';
import { svgToPng } from '../../src/server/wallet/art/raster';
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

  it('noms de fichiers : liste blanche stricte, un seul nom par état', () => {
    expect(heroFileName(7, 'jade')).toBe('rang-7-jade.png');
    expect(heroUrl('https://rangvia.fr/', 33, 'signal')).toBe('https://rangvia.fr/api/wallet/art/rang-plus-signal.png');
    expect(parseArtFile('rang-7-jade.png')).toEqual({ type: 'hero', count: 7, accent: 'jade' });
    expect(parseArtFile('rang-plus-brique.png')).toEqual({ type: 'hero', count: 'plus', accent: 'brique' });
    expect(parseArtFile('rangvia-660.png')).toEqual({ type: 'logo' });
    for (const bad of ['rang-07-jade.png', 'rang-21-jade.png', 'rang-3-ardoise.png', 'rang-3-jade.svg', '../rang-3-jade.png', 'rang-3-jade.png?x']) {
      expect(parseArtFile(bad), bad).toBeNull();
    }
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
