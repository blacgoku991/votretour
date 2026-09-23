import { describe, it, expect } from 'vitest';
import {
  clamp, lerp, progress, cubicBezier, easeSlat, easeCamera, easeIn, keyframes, round3,
} from '@/lib/motion';
import {
  reconcileRang, settleRang, shiftAt, presentTokens, type RangModel,
} from '@/components/motion/rangTokens';

const curves = { easeSlat, easeCamera, easeIn } as const;

describe('outils de base', () => {
  it('borne, interpole et arrondit', () => {
    expect(clamp(-1)).toBe(0);
    expect(clamp(2)).toBe(1);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(round3(1.23456)).toBe(1.235);
    expect(round3(-0.0004)).toBe(-0);
  });

  it('calcule une progression bornée', () => {
    expect(progress(10, 20, 5)).toBe(0);
    expect(progress(10, 20, 15)).toBe(0.5);
    expect(progress(10, 20, 25)).toBe(1);
    expect(progress(3, 3, 3)).toBe(1);
    expect(progress(3, 3, 2)).toBe(0);
    expect(progress(0, 1, Number.NaN)).toBe(0);
  });
});

describe('courbes de Bézier', () => {
  for (const [name, f] of Object.entries(curves)) {
    it(`${name} : bornes 0 et 1 exactes`, () => {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      expect(f(-0.5)).toBe(0);
      expect(f(1.5)).toBe(1);
    });

    it(`${name} : monotone sur 200 points, sans NaN`, () => {
      let previous = f(0);
      for (let i = 1; i <= 200; i += 1) {
        const y = f(i / 200);
        expect(Number.isNaN(y)).toBe(false);
        expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = y;
      }
    });
  }

  it('reproduit la courbe linéaire', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const x of [0.1, 0.25, 0.5, 0.9]) expect(linear(x)).toBeCloseTo(x, 5);
  });

  it('résiste aux pentes nulles (repli par dichotomie)', () => {
    const steep = cubicBezier(1, 0, 1, 1);
    let previous = 0;
    for (let i = 0; i <= 200; i += 1) {
      const y = steep(i / 200);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = y;
    }
  });

  it('ne renvoie jamais NaN, même pour une entrée invalide', () => {
    expect(easeSlat(Number.NaN)).toBe(0);
    expect(easeCamera(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('keyframes', () => {
  const keys = [
    [1, 0],
    [1.9, 56],
    [2.9, 56],
    [4.9, 34],
  ] as const;

  it('garde la première valeur avant la première clé', () => {
    expect(keyframes(0, keys)).toBe(0);
    expect(keyframes(-10, keys, easeCamera)).toBe(0);
  });

  it('garde la dernière valeur après la dernière clé', () => {
    expect(keyframes(6, keys)).toBe(34);
    expect(keyframes(100, keys, easeCamera)).toBe(34);
  });

  it('renvoie la valeur exacte sur chaque clé', () => {
    for (const [t, v] of keys) {
      expect(keyframes(t, keys)).toBe(v);
      expect(keyframes(t, keys, easeCamera)).toBe(v);
    }
  });

  it('interpole entre deux clés avec la courbe', () => {
    expect(keyframes(1.45, keys)).toBeCloseTo(28, 6);
    const eased = keyframes(1.45, keys, easeCamera);
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(56);
    expect(keyframes(2.4, keys, easeCamera)).toBe(56);
  });

  it('ne produit aucun NaN sur 600 points', () => {
    for (let i = 0; i <= 600; i += 1) {
      const t = (i / 600) * 7 - 0.5;
      expect(Number.isNaN(keyframes(t, keys, easeCamera))).toBe(false);
    }
    expect(Number.isNaN(keyframes(Number.NaN, keys))).toBe(false);
    expect(keyframes(1, [])).toBe(0);
    expect(keyframes(5, [[2, 7]])).toBe(7);
  });
});

describe('Rang : réconciliation des jetons', () => {
  const factory = () => {
    let n = 0;
    return (k: number) => Array.from({ length: k }, () => `t${(n += 1)}`);
  };

  it('4 → 3 → 2 en moins de 420 ms finit sur 2 lattes (un départ par avance)', () => {
    const make = factory();
    let model: RangModel = { tokens: make(4), leaving: [] };
    const a = reconcileRang(model, 3, make);
    expect(a.removed).toEqual(['t1']);
    model = a.model;
    // Deuxième avance AVANT la fin du Passage : t1 part encore.
    const b = reconcileRang(model, 2, make);
    expect(b.removed).toEqual(['t2']);
    model = b.model;
    expect(model.leaving).toEqual(['t1', 't2']);
    expect(presentTokens(model)).toEqual(['t3', 't4']);
    // Les lattes qui partent gardent leur place dans le flux…
    expect(model.tokens).toHaveLength(4);
    // …et les suivantes montent de deux crans.
    expect(shiftAt(model, 0)).toBe(0);
    expect(shiftAt(model, 1)).toBe(-1);
    expect(shiftAt(model, 2)).toBe(-2);
    expect(shiftAt(model, 4)).toBe(-2);
    const done = settleRang(model);
    expect(done).toEqual({ tokens: ['t3', 't4'], leaving: [] });
  });

  it('retire par identité : une arrivée pendant le Passage est conservée', () => {
    const make = factory();
    let model: RangModel = { tokens: make(3), leaving: [] };
    model = reconcileRang(model, 2, make).model;
    const arrive = reconcileRang(model, 3, make);
    expect(arrive.added).toEqual(['t4']);
    model = arrive.model;
    expect(settleRang(model).tokens).toEqual(['t2', 't3', 't4']);
  });

  it('valeur inchangée : même modèle, rien à faire', () => {
    const make = factory();
    const model: RangModel = { tokens: make(2), leaving: [] };
    expect(reconcileRang(model, 2, make).model).toBe(model);
    expect(settleRang(model)).toBe(model);
  });

  it('mouvement réduit : retrait immédiat, sans Passage', () => {
    const make = factory();
    const model: RangModel = { tokens: make(4), leaving: [] };
    const step = reconcileRang(model, 1, make, true);
    expect(step.model).toEqual({ tokens: ['t4'], leaving: [] });
  });

  it('4 → 0 : toutes les lattes passent, aucune valeur négative', () => {
    const make = factory();
    const step = reconcileRang({ tokens: make(4), leaving: [] }, -3, make);
    expect(step.model.leaving).toHaveLength(4);
    expect(presentTokens(step.model)).toEqual([]);
  });
});
