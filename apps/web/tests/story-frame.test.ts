import { describe, it, expect } from 'vitest';
import {
  cameraAt, cameraTransform, decorAt, queueAt, worldBox, THRESHOLDS, SLOT_IDS, T_MAX, type Vp,
} from '@/components/home/story/frame';

const PHONES: Vp[] = [{ w: 375, h: 667 }, { w: 390, h: 844 }, { w: 430, h: 932 }];
const VIEWPORTS: Vp[] = [...PHONES, { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1440, h: 900 }];
/** 600 points de -0,5 à 6,5 (on déborde exprès des bornes). */
const SAMPLES = Array.from({ length: 600 }, (_, i) => -0.5 + (i * 7) / 599);

describe('queueAt : état discret de la file', () => {
  it("t = 0 donne exactement l'état rendu par le serveur", () => {
    expect(queueAt(0)).toEqual({
      slots: {
        s0: { pos: 0, state: 'serving' },
        s1: { pos: 1, state: 'wait' },
        s2: { pos: 2, state: 'wait' },
        vous: { pos: 3, state: 'ghost' },
        b1: { pos: 4, state: 'hidden' },
        b2: { pos: 5, state: 'hidden' },
        next: { pos: 2, state: 'hidden' },
      },
      ahead: 3,
      joined: false,
      nfc: false,
      phoneGone: false,
      dotOut: false,
      notif: false,
      pro: 'off',
      turn: false,
      merci: false,
      active: 0,
      crans: 0,
    });
  });

  it("le volet ne remonte jamais avant le tour (ahead monotone non croissant sur [0 ; 4,4])", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 880; i += 1) {
      const { ahead } = queueAt((i * 4.4) / 880);
      expect(ahead).toBeLessThanOrEqual(prev);
      prev = ahead;
    }
    expect(queueAt(4.4).ahead).toBe(0);
  });

  it('ne dépend que des seuils : constant entre deux seuils', () => {
    const cuts = [0, ...Object.values(THRESHOLDS), T_MAX].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i += 1) {
      const a = cuts[i] as number;
      const b = cuts[i + 1] as number;
      if (b - a < 1e-6) continue;
      const ref = JSON.stringify({ ...queueAt(a), active: 0 });
      for (const k of [0.25, 0.5, 0.75]) {
        const t = a + (b - a) * k;
        // L'étape active suit floor(t) : on la compare à part.
        expect(JSON.stringify({ ...queueAt(t), active: 0 })).toBe(ref);
      }
    }
  });

  it('joue les grands moments aux bons seuils', () => {
    expect(queueAt(0.5).joined).toBe(true);
    expect(queueAt(0.5).slots.vous.state).toBe('self');
    expect(queueAt(1.4).slots.vous.state).toBe('kept');
    expect(queueAt(2.6).ahead).toBe(2);
    expect(queueAt(3.5).notif).toBe(true);
    expect(queueAt(3.5).ahead).toBe(1);
    expect(queueAt(4.5).turn).toBe(true);
    expect(queueAt(4.5).slots.vous).toEqual({ pos: 0, state: 'turn' });
    expect(queueAt(5.4).merci).toBe(true);
    expect(queueAt(5.4).slots.vous.state).toBe('passed');
    expect(queueAt(6).slots.next.state).toBe('ghost');
    expect(queueAt(6).active).toBe(6);
    expect(queueAt(0.01).active).toBe(0);
    expect(queueAt(1.5).active).toBe(2);
  });

  it('garde des positions entières et des lattes présentes distinctes', () => {
    for (const t of SAMPLES) {
      const q = queueAt(t);
      const taken = new Set<number>();
      for (const id of SLOT_IDS) {
        const s = q.slots[id];
        expect(Number.isInteger(s.pos)).toBe(true);
        if (s.state === 'passed' || s.state === 'hidden') continue;
        expect(taken.has(s.pos)).toBe(false);
        taken.add(s.pos);
      }
    }
  });

  it('compte les crans sans jamais revenir en arrière', () => {
    let prev = 0;
    for (const t of SAMPLES) {
      const { crans } = queueAt(t);
      expect(crans).toBeGreaterThanOrEqual(prev);
      prev = crans;
    }
    expect(prev).toBe(4);
  });
});

describe('cameraAt : caméra continue', () => {
  it("vaut l'identité à t = 0 et à t = 6", () => {
    for (const vp of VIEWPORTS) {
      for (const t of [0, 6]) {
        expect(cameraAt(t, vp)).toEqual({ tx: 0, ty: 0, tilt: 0, turn: 0, scale: 1 });
        expect(cameraAt(t, vp, true)).toEqual({ tx: 0, ty: 0, tilt: 0, turn: 0, scale: 1 });
      }
    }
    expect(cameraTransform(cameraAt(0, { w: 390, h: 844 }))).toBe(
      'translate3d(0px, 0px, 0) rotateX(0deg) rotateZ(0deg) scale(1)',
    );
  });

  it('respecte les plafonds (tilt, virage, échelle)', () => {
    for (const vp of VIEWPORTS) {
      const desktop = vp.w >= 1024;
      for (const t of SAMPLES) {
        for (const lite of [false, true]) {
          const c = cameraAt(t, vp, lite);
          expect(c.tilt).toBeLessThanOrEqual(lite ? 42 : desktop ? 58 : 52);
          expect(c.tilt).toBeGreaterThanOrEqual(0);
          expect(Math.abs(c.turn)).toBeLessThanOrEqual(lite ? 0 : desktop ? 9 : 4);
          expect(c.scale).toBeLessThanOrEqual(desktop ? 1.25 : 1.14);
        }
      }
    }
  });

  it('ne produit jamais de NaN, même sur une entrée absurde', () => {
    for (const vp of [...VIEWPORTS, { w: Number.NaN, h: Number.NaN }]) {
      for (const t of [...SAMPLES, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const c = cameraAt(t, vp);
        for (const v of Object.values(c)) expect(Number.isNaN(v)).toBe(false);
        expect(cameraTransform(c)).not.toMatch(/NaN|Infinity/);
        const d = decorAt(t, vp);
        const flat = [d.phone.x, d.phone.y, d.phone.rot, d.phone.o, d.plaqueO, d.voletScale, d.spill, d.seuilO, ...d.seg];
        for (const v of flat) expect(Number.isNaN(v)).toBe(false);
      }
    }
  });

  it('garde le monde dans la largeur du téléphone (w − 32) à 375, 390 et 430', () => {
    for (const vp of PHONES) {
      const box = worldBox(vp);
      for (const t of SAMPLES) {
        const c = cameraAt(t, vp);
        expect(box.width * c.scale).toBeLessThanOrEqual(vp.w - 32);
      }
    }
  });

  it('recentre le monde en mobile une fois en relief, et seulement alors', () => {
    const vp = { w: 390, h: 844 };
    expect(cameraAt(0.9, vp).tx).toBe(0);
    expect(cameraAt(3, vp).tx).toBeCloseTo(130 - 195, 6);
    expect(cameraAt(0.9, { w: 1440, h: 900 }).tx).toBe(0);
    expect(cameraAt(3, { w: 1440, h: 900 }).tx).toBeCloseTo(-60, 6);
  });
});

describe('decorAt : décor continu', () => {
  it('garde toutes les opacités et tous les segments dans [0 ; 1]', () => {
    for (const vp of VIEWPORTS) {
      for (const t of SAMPLES) {
        const d = decorAt(t, vp);
        for (const v of [d.phone.o, d.plaqueO, d.spill, d.seuilO, ...d.seg]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        expect(d.seg).toHaveLength(6);
      }
    }
  });

  it('montre la plaque et cache le seuil à plat', () => {
    const d0 = decorAt(0, { w: 390, h: 844 });
    expect(d0.plaqueO).toBe(1);
    expect(d0.seuilO).toBe(0);
    expect(d0.phone.o).toBe(0);
    expect(d0.voletScale).toBe(1);
    expect(d0.seg).toEqual([0, 0, 0, 0, 0, 0]);
    const d6 = decorAt(6, { w: 390, h: 844 });
    expect(d6.seuilO).toBe(0);
    expect(d6.spill).toBe(0);
    expect(d6.seg).toEqual([1, 1, 1, 1, 1, 1]);
    expect(decorAt(2.5, { w: 1440, h: 900 }).seuilO).toBe(1);
    expect(decorAt(2.5, { w: 1440, h: 900 }).voletScale).toBe(1);
    expect(decorAt(2.5, { w: 390, h: 844 }).voletScale).toBeCloseTo(0.8, 6);
    expect(decorAt(4.5, { w: 390, h: 844 }, true).spill).toBe(0);
  });
});
