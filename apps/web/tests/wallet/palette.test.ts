import { describe, expect, it } from 'vitest';
import {
  ACCENT_HEX, BONE, INK, MIN_CONTRAST, appleRgb, contrastRatio, eventPalette, googleHex, normalizeHex,
  queuePalette, rgbToHex,
} from '../../src/server/wallet/palette';
import { WALLET_ACCENTS } from '../../src/server/wallet/types';

/** Contrastes garantis : 5 accents, puis 1 000 couleurs de marque aléatoires. */

/** Générateur pseudo-aléatoire à graine fixe : un échec se rejoue à l'identique. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('palette des passes', () => {
  it('valeurs de référence (document de conception)', () => {
    expect(contrastRatio(INK, BONE)).toBeGreaterThan(18);
    expect(contrastRatio(ACCENT_HEX.signal, INK)).toBeCloseTo(5.78, 1);
    expect(contrastRatio(ACCENT_HEX.cobalt, INK)).toBeCloseTo(3.64, 1);
    expect(contrastRatio(ACCENT_HEX.brique, INK)).toBeCloseTo(3.30, 1);
  });

  it.each(WALLET_ACCENTS)('file %s : texte et étiquettes ≥ 4,5 sur l’encre', (accent) => {
    const p = queuePalette(accent);
    expect(p.background).toBe(INK);
    expect(p.foreground).toBe(BONE);
    expect(contrastRatio(p.foreground, p.background)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastRatio(p.label, p.background)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // Un accent déjà lisible n'est pas retouché.
    if (contrastRatio(ACCENT_HEX[accent], INK) >= MIN_CONTRAST) expect(p.label).toBe(ACCENT_HEX[accent]);
    else expect(p.label).not.toBe(ACCENT_HEX[accent]);
    // Le texte posé sur l'accent (latte « Vous ») est lisible lui aussi.
    expect(contrastRatio(p.onAccent, p.accent)).toBeGreaterThanOrEqual(3);
  });

  it('1 000 couleurs de marque : texte et étiquettes toujours ≥ 4,5', () => {
    const rand = lcg(20260924);
    for (let i = 0; i < 1000; i += 1) {
      const hex = rgbToHex([rand() * 255, rand() * 255, rand() * 255]);
      const p = eventPalette(hex);
      expect(contrastRatio(p.foreground, p.background), hex).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(p.label, p.background), hex).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(p.accent).toBe(hex);
    }
  });

  it('les couleurs médianes sont assombries, les autres gardées telles quelles', () => {
    expect(eventPalette('#18143C').background).toBe('#18143C');
    expect(eventPalette('#FF4B1F').background).toBe('#FF4B1F');
    const mid = eventPalette('#747474');
    expect(mid.background).not.toBe('#747474');
    expect(mid.foreground).toBe(BONE);
  });

  it('couleur absente ou invalide → accent de l’établissement', () => {
    expect(eventPalette(null, 'jade').accent).toBe(ACCENT_HEX.jade);
    expect(eventPalette('rouge', 'cobalt').accent).toBe(ACCENT_HEX.cobalt);
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('abcdef')).toBe('#ABCDEF');
    expect(normalizeHex('#abcd')).toBeNull();
  });

  it('formats Apple rgb(r, g, b) et Google #RRGGBB', () => {
    const p = queuePalette('signal');
    expect(p.apple.backgroundColor).toBe('rgb(11, 14, 19)');
    expect(p.apple.foregroundColor).toBe('rgb(250, 249, 246)');
    expect(p.apple.labelColor).toBe('rgb(255, 75, 31)');
    expect(p.google.hexBackgroundColor).toBe('#0B0E13');
    expect(appleRgb('#3a63d8')).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
    expect(googleHex('#3a63d8')).toMatch(/^#[0-9A-F]{6}$/);
    for (const accent of WALLET_ACCENTS) {
      const q = eventPalette(ACCENT_HEX[accent]);
      for (const color of Object.values(q.apple)) expect(color).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
      expect(q.google.hexBackgroundColor).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
