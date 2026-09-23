/**
 * LE RANG EN RELIEF — la séquence de l'accueil, en fonctions PURES.
 *
 * Aucune dépendance au DOM : même entrée, même sortie, jamais de NaN.
 * Testé par tests/story-frame.test.ts.
 *
 * `t` va de 0 (le héros, la file à plat, exactement l'écran client) à 6
 * (fin de la sixième étape, retour à plat). Deux familles de fonctions :
 *
 *  - CONTINUES (cameraAt, decorAt) : la caméra et le décor suivent le
 *    défilement au pixel près. Interpolation par clés, courbe caméra.
 *  - DISCRÈTES (queueAt) : l'état de la file ne dépend QUE de seuils.
 *    Un cran est un pas : on le déclenche en franchissant un seuil, puis
 *    les transitions CSS le jouent dans le temps (et à l'envers en
 *    remontant). On ne voit jamais une demi-personne.
 */

import { clamp, easeCamera, keyframes, round3 } from '@/lib/motion';

/** Fenêtre. Mobile = w < 1024. */
export type Vp = { w: number; h: number };

export interface Camera {
  tx: number;
  ty: number;
  tilt: number;
  turn: number;
  scale: number;
}

export interface Decor {
  /** Téléphone qui vient toucher la plaque : décalage (px) depuis la position de contact, rotation (deg), opacité. */
  phone: { x: number; y: number; rot: number; o: number };
  /** Opacité de la Plaque 2D. */
  plaqueO: number;
  /** Échelle du volet (mobile seulement ; 1 sur ordinateur). */
  voletScale: number;
  /** Opacité de la flaque de lumière derrière le seuil. */
  spill: number;
  /** Opacité du seuil (et du marquage au sol) : invisible à plat. */
  seuilO: number;
  /** Remplissage des 6 segments de progression, chacun dans [0, 1]. */
  seg: number[];
}

export type SlotId = 's0' | 's1' | 's2' | 'vous' | 'b1' | 'b2' | 'next';
export type SlotState = 'hidden' | 'wait' | 'serving' | 'ghost' | 'self' | 'kept' | 'back' | 'turn' | 'passed';

export interface QueueState {
  slots: Record<SlotId, { pos: number; state: SlotState }>;
  /** Valeur du volet. */
  ahead: number;
  /** Libellé « devant vous » plutôt que « dans la file ». */
  joined: boolean;
  nfc: boolean;
  phoneGone: boolean;
  dotOut: boolean;
  notif: boolean;
  pro: 'off' | 'on' | 'pressed';
  turn: boolean;
  merci: boolean;
  /** Étape active : 0 (héros) … 6. */
  active: number;
  /** Nombre d'avances jouées (pour l'impulsion du rail). */
  crans: number;
}

export const SLOT_IDS: readonly SlotId[] = ['s0', 's1', 's2', 'vous', 'b1', 'b2', 'next'];

/** Durée totale de la séquence : 6 étapes. */
export const T_MAX = 6;

/** Seuils de la file (t ≥ valeur). Table du cahier, §5.7. */
export const THRESHOLDS: Readonly<Record<string, number>> = Object.freeze({
  nfc: 0.3,
  join: 0.45,
  phoneGone: 0.75,
  dotOut: 1.35,
  b1: 1.55,
  b2: 1.7,
  cranA: 2.45,
  cranB: 3.35,
  notif: 3.45,
  back: 3.6,
  counter: 4.1,
  terminer: 4.4,
  proOff: 4.8,
  passe: 5.2,
  merci: 5.3,
  next: 5.7,
});

/* ------------------------------------------------------------------ */
/* Géométrie                                                           */
/* ------------------------------------------------------------------ */

export type Layout = 'mobile' | 'tablet' | 'desktop';

export function layoutOf(vp: Vp): Layout {
  if (!(vp.w >= 768)) return 'mobile';
  return vp.w < 1024 ? 'tablet' : 'desktop';
}

/**
 * Boîte du monde (§5.4). `right` : distance au bord droit de la scène à
 * plat (mobile et tablette) ; sur ordinateur le monde est placé par CSS.
 */
export function worldBox(vp: Vp): { width: number; right: number; pitch: number; slat: number; self: number } {
  switch (layoutOf(vp)) {
    case 'mobile':
      return { width: 220, right: 20, pitch: 48, slat: 38, self: 42 };
    case 'tablet':
      return { width: 280, right: 40, pitch: 56, slat: 44, self: 48 };
    default:
      return { width: 430, right: 0, pitch: 70, slat: 54, self: 58 };
  }
}

/** Plafonds de caméra (§5.5). */
export function cameraLimits(vp: Vp): { tilt: number; turn: number; scale: number } {
  return vp.w >= 1024 ? { tilt: 58, turn: 9, scale: 1.25 } : { tilt: 52, turn: 4, scale: 1.14 };
}

type Keys = ReadonlyArray<readonly [number, number]>;

/** Instants des clés de caméra, communs aux deux jeux. */
const KT = [0, 1, 1.9, 2.9, 3.8, 4.1, 4.9, 5.45, 5.95, 6] as const;
const zip = (values: readonly number[]): Keys => KT.map((t, i) => [t, values[i] ?? 0] as const);

const DESKTOP = {
  tilt: zip([0, 0, 56, 56, 56, 56, 34, 34, 0, 0]),
  turn: zip([0, 0, 8, 8, 8, 8, 0, 0, 0, 0]),
  scale: zip([1, 1, 1.08, 1.08, 1.08, 1.08, 1.22, 1.22, 1, 1]),
  ty: zip([0, 0, 40, 72, 104, 104, 180, 180, 0, 0]),
};

const MOBILE = {
  tilt: zip([0, 0, 52, 52, 52, 52, 32, 32, 0, 0]),
  turn: zip([0, 0, 4, 4, 4, 4, 0, 0, 0, 0]),
  scale: zip([1, 1, 1.04, 1.04, 1.04, 1.04, 1.12, 1.12, 1, 1]),
  ty: zip([0, 0, 24, 48, 72, 72, 140, 140, 0, 0]),
};

/** Recentrage du monde en relief sur ordinateur (px). */
const DESKTOP_RECENTRE = -60;

/** Part « en relief » (0 à plat, 1 en relief) : même courbe que l'inclinaison au lever et au retour. */
const RELIEF = zip([0, 0, 1, 1, 1, 1, 1, 1, 0, 0]);

const safeT = (t: number): number => (Number.isFinite(t) ? clamp(t, 0, T_MAX) : 0);
/** Évite -0 (chaînes de transform stables, égalités exactes). */
const z = (v: number): number => (v === 0 ? 0 : v);

/** La caméra à l'instant t : identité à t = 0 et à t = 6. */
export function cameraAt(t: number, vp: Vp, lite = false): Camera {
  const tt = safeT(t);
  const desktop = vp.w >= 1024;
  const K = desktop ? DESKTOP : MOBILE;
  const lim = cameraLimits(vp);

  let tilt = clamp(keyframes(tt, K.tilt, easeCamera), 0, lim.tilt);
  let turn = clamp(keyframes(tt, K.turn, easeCamera), -lim.turn, lim.turn);
  const scale = clamp(keyframes(tt, K.scale, easeCamera), 0.5, lim.scale);
  const ty = keyframes(tt, K.ty, easeCamera);

  if (lite) {
    tilt = Math.min(tilt, 42);
    turn = 0;
  }

  // Le monde est à droite à plat (c'est l'écran client : volet à gauche,
  // file à droite) ; en relief, on le recentre dans la scène. Mobile et
  // tablette : exactement (130 − w/2 en mobile) ; ordinateur : de 60 px,
  // pour compenser le virage qui envoie la tête vers la droite.
  const box = worldBox(vp);
  const w = Number.isFinite(vp.w) ? vp.w : 390;
  const recentre = desktop ? DESKTOP_RECENTRE : box.right + box.width / 2 - w / 2;
  const tx = recentre * keyframes(tt, RELIEF, easeCamera);

  return { tx: z(tx), ty: z(ty), tilt: z(tilt), turn: z(turn), scale };
}

/** Chaîne de transform du monde, arrondie à 3 décimales. */
export function cameraTransform(c: Camera): string {
  const r = (v: number) => z(round3(Number.isFinite(v) ? v : 0));
  const s = Number.isFinite(c.scale) ? round3(c.scale) : 1;
  return `translate3d(${r(c.tx)}px, ${r(c.ty)}px, 0) rotateX(${r(c.tilt)}deg) rotateZ(${r(c.turn)}deg) scale(${s})`;
}

/* ------------------------------------------------------------------ */
/* Décor                                                               */
/* ------------------------------------------------------------------ */

const PHONE_O: Keys = [[0.05, 0], [0.12, 1]];
const PHONE_X: Keys = [[0.05, -90], [0.3, 0]];
const PHONE_Y: Keys = [[0.05, 120], [0.3, 0]];
const PHONE_R: Keys = [[0.05, -14], [0.3, -6]];
const PLAQUE_O: Keys = [[0.85, 1], [1.05, 0]];
const VOLET_S: Keys = [[1, 1], [1.9, 0.8], [5.45, 0.8], [5.95, 1]];
const SPILL: Keys = [[1.5, 0], [1.9, 0.35], [4.4, 0.35], [4.6, 0.7], [5.45, 0.7], [5.8, 0]];

export function decorAt(t: number, vp: Vp, lite = false): Decor {
  const tt = safeT(t);
  const cam = cameraAt(tt, vp, lite);
  const linear = (x: number) => x;
  return {
    phone: {
      x: keyframes(tt, PHONE_X, easeCamera),
      y: keyframes(tt, PHONE_Y, easeCamera),
      rot: keyframes(tt, PHONE_R, easeCamera),
      o: clamp(keyframes(tt, PHONE_O, linear)),
    },
    plaqueO: clamp(keyframes(tt, PLAQUE_O, linear)),
    voletScale: vp.w >= 1024 ? 1 : keyframes(tt, VOLET_S, easeCamera),
    spill: lite ? 0 : clamp(keyframes(tt, SPILL, linear)),
    seuilO: clamp((cam.tilt - 8) / 16),
    seg: [0, 1, 2, 3, 4, 5].map((i) => clamp(tt - i)),
  };
}

/* ------------------------------------------------------------------ */
/* File (discret)                                                      */
/* ------------------------------------------------------------------ */

/** État de la file à l'instant t : uniquement des seuils, aucune interpolation. */
export function queueAt(t: number): QueueState {
  const tt = safeT(t);
  const T = THRESHOLDS as Record<string, number>;
  const at = (k: string) => tt >= (T[k] as number);

  const slots: QueueState['slots'] = {
    s0: { pos: 0, state: 'serving' },
    s1: { pos: 1, state: 'wait' },
    s2: { pos: 2, state: 'wait' },
    vous: { pos: 3, state: 'ghost' },
    b1: { pos: 4, state: 'hidden' },
    b2: { pos: 5, state: 'hidden' },
    next: { pos: 2, state: 'hidden' },
  };
  let ahead = 3;
  let joined = false;
  let dotOut = false;
  let notif = false;
  let pro: QueueState['pro'] = 'off';
  let turn = false;
  let crans = 0;

  if (at('join')) {
    slots.vous.state = 'self';
    joined = true;
  }
  if (at('dotOut')) {
    dotOut = true;
    slots.vous.state = 'kept';
  }
  if (at('b1')) slots.b1.state = 'wait';
  if (at('b2')) slots.b2.state = 'wait';
  if (at('cranA')) {
    slots.s0.state = 'passed';
    slots.s1 = { pos: 0, state: 'serving' };
    slots.s2.pos = 1;
    slots.vous.pos = 2;
    slots.b1.pos = 3;
    slots.b2.pos = 4;
    ahead = 2;
    crans = 1;
  }
  if (at('cranB')) {
    slots.s1.state = 'passed';
    slots.s2 = { pos: 0, state: 'serving' };
    slots.vous.pos = 1;
    slots.b1.pos = 2;
    slots.b2.pos = 3;
    ahead = 1;
    crans = 2;
  }
  if (at('notif')) notif = true;
  if (at('back')) {
    dotOut = false;
    slots.vous.state = 'back';
  }
  if (at('counter')) {
    notif = false;
    pro = 'on';
  }
  if (at('terminer')) {
    pro = 'pressed';
    slots.s2.state = 'passed';
    slots.vous = { pos: 0, state: 'turn' };
    slots.b1.pos = 1;
    slots.b2.pos = 2;
    ahead = 0;
    turn = true;
    crans = 3;
  }
  if (at('proOff')) pro = 'off';
  if (at('passe')) {
    slots.vous.state = 'passed';
    slots.b1 = { pos: 0, state: 'serving' };
    slots.b2.pos = 1;
    turn = false;
    crans = 4;
  }
  const merci = at('merci');
  if (at('next')) slots.next.state = 'ghost';

  return {
    slots,
    ahead,
    joined,
    nfc: at('nfc'),
    phoneGone: at('phoneGone'),
    dotOut,
    notif,
    pro,
    turn,
    merci,
    active: tt < 0.02 ? 0 : Math.min(6, Math.floor(tt) + 1),
    crans,
  };
}
