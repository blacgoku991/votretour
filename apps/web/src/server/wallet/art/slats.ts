import { WALLET_ACCENTS } from '../types';
import type { WalletAccent } from '../types';
import { ACCENT_HEX, BONE, INK, INK_600, INK_700, mix, queuePalette } from '../palette';
import { WALLET_PLUS_THRESHOLD } from '@/lib/wallet-copy';

/**
 * Les « lattes » dans la poche : la métaphore de la page client, dessinée
 * pour le Wallet.
 *
 * Même grammaire que le composant Rang et que globals.css : un rail, une
 * latte par personne devant, accrochée par son encoche ; la latte « Vous »
 * à l'accent de l'établissement, plus grande, avec sa tranche en relief
 * (--slat-edge-self) et la lueur qu'elle répand au sol (--spill). Aucun
 * texte dans l'image : les polices d'un serveur Alpine ne sont pas celles
 * de la charte, et le chiffre est déjà écrit par Wallet, en grand.
 *
 * Deux formats :
 *  - VIGNETTE Apple (thumbnail, 90 × 90 pt, @1x/@2x/@3x) : le rail
 *    vertical de la page client, 0 à 5 lattes, au-delà 5 lattes et trois
 *    points. Transparente : elle se pose sur le fond encre du pass.
 *  - IMAGE D'EN-TÊTE Google (heroImage, 1032 × 336 px) : la file couchée,
 *    qui avance vers le comptoir, à droite. La latte « Vous » se rapproche
 *    réellement du comptoir d'une image à l'autre : 0 à 20 lattes, au-delà
 *    18 lattes et trois points (« Plus de 20 »).
 *
 * DÉTERMINISTE : une chaîne SVG ne dépend que de (format, nombre, accent).
 * Google met les images en cache par URL : une URL par état, jamais deux
 * contenus sous la même URL (voir heroFileName). Toute retouche du dessin
 * DOIT changer ART_REVISION : la révision fait partie du nom public
 * (rang-r2-7-jade.png), si bien qu'un nouveau dessin a de nouvelles URL et
 * que Google ne peut pas garder l'ancienne image en cache.
 */

export const ART_REVISION = 'r2';

/** Nombre de personnes devant, ou « au-delà du dernier palier dessiné ». */
export type SlatsCount = number | 'plus';

export const THUMB_MAX = 5;
export const HERO_MAX = WALLET_PLUS_THRESHOLD;

export const THUMB_SIZE = 90;
export const HERO_WIDTH = 1032;
export const HERO_HEIGHT = 336;

/** Palier dessiné pour une position donnée. */
export function thumbCount(peopleAhead: number): SlatsCount {
  const n = Math.max(0, Math.floor(peopleAhead));
  return n > THUMB_MAX ? 'plus' : n;
}

export function heroCount(peopleAhead: number): SlatsCount {
  const n = Math.max(0, Math.floor(peopleAhead));
  return n > HERO_MAX ? 'plus' : n;
}

/* --------------------------------------------------------------------
   Outils : nombres à précision fixe (déterminisme), couleurs du thème
   -------------------------------------------------------------------- */

const f = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

interface Tones {
  accent: string;
  edgeSelf: string;
  onAccent: string;
  slat: string;
  slatHead: string;
  edge: string;
  tick: string;
  rail: string;
}

/** Couleurs du thème sombre de globals.css, résolues en hexadécimal opaque. */
function tones(accent: WalletAccent): Tones {
  const palette = queuePalette(accent);
  return {
    accent: ACCENT_HEX[accent],
    edgeSelf: palette.accentEdge,
    onAccent: palette.onAccent,
    slat: INK_600,
    // --slat-head : 7 % de texte (os) dans la latte.
    slatHead: mix(INK_600, BONE, 0.07),
    edge: INK_700,
    // --slat-text (#9AA3AF) à 35 % : la « matière » de la latte.
    tick: '#9AA3AF',
    // --rail du thème sombre : os à 26 % sur l'encre, rendu opaque.
    rail: mix(INK, BONE, 0.26),
  };
}

function assertAccent(accent: string): asserts accent is WalletAccent {
  if (!(WALLET_ACCENTS as readonly string[]).includes(accent)) throw new Error(`Accent inconnu : ${accent}`);
}

function assertCount(count: SlatsCount, max: number): void {
  if (count === 'plus') return;
  if (!Number.isSafeInteger(count) || count < 0 || count > max) throw new Error(`Nombre de lattes invalide : ${count}`);
}

/* --------------------------------------------------------------------
   Vignette Apple : rail vertical, tête en haut, « Vous » en bas
   -------------------------------------------------------------------- */

/**
 * @param scale 1, 2 ou 3 (@1x, @2x, @3x) : seule la taille en pixels
 *              change, le dessin est vectoriel.
 */
export function thumbSvg(count: SlatsCount, accent: WalletAccent, scale = 1): string {
  assertAccent(accent);
  assertCount(count, THUMB_MAX);
  const t = tones(accent);
  const size = THUMB_SIZE;
  const px = size * scale;

  const railX = 9;
  const railW = 3;
  const slatX = 22;
  const slatW = size - slatX - 5;
  const h = 8.4;              // --slat-h, à l'échelle
  const gap = 3.2;            // --slat-gap
  const r = 2.5;              // --r-slat (10 / 34 de la hauteur)
  const edge = 1.3;           // tranche en relief (0 2px 0)
  const bottom = size - 7;

  const grey = count === 'plus' ? THUMB_MAX : count;
  const alone = count === 0;
  // Seule, la latte « Vous » prend toute la place : c'est votre tour.
  const selfH = alone ? h * 3.4 : h * 2.1;
  const selfY = alone ? (size - selfH) / 2 : bottom - selfH;

  // Centrage vertical PARTIEL du groupe (comptoir ou points → « Vous ») :
  // aux petits paliers, une file ancrée en bas laissait le haut vide. On
  // remonte le groupe de 70 % de l'écart entre les marges haute et basse :
  // la composition s'équilibre, et « Vous » bouge encore un peu quand la
  // file avance (le comptoir, lui, descend nettement vers vous).
  const groupTop = alone
    ? selfY
    : selfY - grey * (h + gap) - (count === 'plus' ? 4.4 + 1.5 : gap + 0.8);
  const groupBottom = selfY + selfH + edge * 1.4;
  const lift = alone ? 0 : Math.max(0, ((groupTop - (size - groupBottom)) / 2) * 0.7);

  const parts: string[] = [];
  parts.push(
    `<defs>`,
    `<radialGradient id="spill" cx="50%" cy="50%" r="50%">`,
    `<stop offset="0" stop-color="${t.accent}" stop-opacity="0.34"/>`,
    `<stop offset="1" stop-color="${t.accent}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `</defs>`,
  );
  if (lift > 0) parts.push(`<g transform="translate(0 ${f(-lift)})">`);

  // Lueur de la latte « Vous » (--spill), sous tout le reste.
  parts.push(
    `<ellipse cx="${f(slatX + slatW / 2)}" cy="${f(selfY + selfH * 0.72)}" rx="${f(slatW * 0.62)}" ry="${f(selfH * 0.95)}" fill="url(#spill)"/>`,
  );

  // Le rail, sur toute la hauteur occupée par la file.
  const firstTop = alone ? selfY : selfY - grey * (h + gap) - (count === 'plus' ? 9 : 0);
  parts.push(
    `<rect x="${f(railX - railW / 2)}" y="${f(Math.max(4, firstTop))}" width="${f(railW)}" height="${f(selfY + selfH - Math.max(4, firstTop))}" rx="${f(railW / 2)}" fill="${t.rail}"/>`,
  );

  // Le comptoir (trait d'accent de la page client), juste au-dessus de la
  // tête de file : il descend vers « Vous » à mesure que la file avance.
  // Au-delà de 5, il est hors champ : trois points à la place.
  if (count !== 'plus') {
    const counterY = (alone ? selfY : selfY - grey * (h + gap)) - gap - 0.8;
    parts.push(
      `<rect x="${f(railX - railW / 2)}" y="${f(counterY)}" width="${f(slatX + slatW - railX + railW / 2)}" height="1.6" rx="0.8" fill="${t.accent}"/>`,
    );
  }

  // Trois points : il y a plus de monde que ce que la vignette dessine.
  if (count === 'plus') {
    const dotsY = selfY - grey * (h + gap) - 4.4;
    for (let i = 0; i < 3; i += 1) {
      parts.push(`<circle cx="${f(slatX + 3 + i * 6)}" cy="${f(dotsY)}" r="1.5" fill="${t.tick}" fill-opacity="0.7"/>`);
    }
  }

  // Lattes « quelqu'un devant » : de la tête (en haut) vers le client.
  for (let i = 0; i < grey; i += 1) {
    const y = selfY - (grey - i) * (h + gap);
    const head = i === 0;
    parts.push(
      `<rect x="${f(slatX)}" y="${f(y + edge)}" width="${f(slatW)}" height="${f(h)}" rx="${f(r)}" fill="${t.edge}"/>`,
      `<rect x="${f(slatX)}" y="${f(y)}" width="${f(slatW)}" height="${f(h)}" rx="${f(r)}" fill="${head ? t.slatHead : t.slat}"/>`,
      // Encoche : le trait part du rail et s'ancre dans la latte.
      `<rect x="${f(railX)}" y="${f(y + h / 2 - 0.6)}" width="${f(slatX - railX + 1)}" height="1.2" rx="0.6" fill="${t.rail}"/>`,
      `<rect x="${f(slatX + 4)}" y="${f(y + h / 2 - 0.55)}" width="7" height="1.1" rx="0.55" fill="${head ? t.accent : t.tick}" fill-opacity="${head ? '0.9' : '0.35'}"/>`,
    );
  }

  // La latte « Vous » : accent, tranche plus foncée, repère et son halo.
  const dotR = alone ? 3.4 : 2.6;
  const dotX = slatX + 7 + dotR;
  const dotY = selfY + selfH / 2;
  parts.push(
    `<rect x="${f(railX - 0.5)}" y="${f(dotY - 1.2)}" width="${f(slatX - railX + 2)}" height="2.4" rx="1.2" fill="${t.accent}"/>`,
    `<rect x="${f(slatX)}" y="${f(selfY + edge * 1.4)}" width="${f(slatW)}" height="${f(selfH)}" rx="${f(r * 1.2)}" fill="${t.edgeSelf}"/>`,
    `<rect x="${f(slatX)}" y="${f(selfY)}" width="${f(slatW)}" height="${f(selfH)}" rx="${f(r * 1.2)}" fill="${t.accent}"/>`,
    `<circle cx="${f(dotX)}" cy="${f(dotY)}" r="${f(dotR * 1.9)}" fill="${t.onAccent}" fill-opacity="0.2"/>`,
    `<circle cx="${f(dotX)}" cy="${f(dotY)}" r="${f(dotR)}" fill="${t.onAccent}"/>`,
    // Deux traits, à la place d'un prénom que le pass ne porte jamais.
    `<rect x="${f(dotX + dotR * 2.4)}" y="${f(dotY - 2.6)}" width="${f(slatW * 0.34)}" height="2" rx="1" fill="${t.onAccent}" fill-opacity="0.78"/>`,
    `<rect x="${f(dotX + dotR * 2.4)}" y="${f(dotY + 1.2)}" width="${f(slatW * 0.2)}" height="1.4" rx="0.7" fill="${t.onAccent}" fill-opacity="0.45"/>`,
  );
  if (lift > 0) parts.push(`</g>`);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${size} ${size}">`,
    ...parts,
    `</svg>`,
  ].join('');
}

/* --------------------------------------------------------------------
   En-tête Google : la file couchée, qui avance vers le comptoir
   -------------------------------------------------------------------- */

/** Places déjà parcourues dessinées en creux derrière « Vous ». */
const GHOST_TRAIL = 6;

export function heroSvg(count: SlatsCount, accent: WalletAccent): string {
  assertAccent(accent);
  assertCount(count, HERO_MAX);
  const t = tones(accent);
  const W = HERO_WIDTH;
  const H = HERO_HEIGHT;

  const railY = 236;
  const railH = 4;
  const counterX = 948;       // le comptoir : la file avance vers lui
  const w = 30;               // --slat-h, couché
  const gap = 10;             // --slat-gap
  const slatH = 124;
  const selfW = w * 2.1;
  const selfH = 158;
  const notch = 16;           // hauteur de l'encoche entre latte et rail
  const r = 9;
  const edge = 3;

  const plus = count === 'plus';
  const grey = plus ? HERO_MAX - 2 : count;
  const dotsW = plus ? 44 : 0;

  const slatBottom = railY - notch;
  // De droite à gauche : comptoir, lattes (la tête contre le comptoir),
  // points éventuels, puis la latte « Vous ».
  const headRight = counterX - 26;
  const greyLeft = headRight - grey * w - Math.max(0, grey - 1) * gap;
  const selfRight = grey > 0 ? greyLeft - gap - dotsW : headRight;
  const selfX = selfRight - selfW;
  const selfY = slatBottom - selfH;
  const selfCx = selfX + selfW / 2;
  const railStart = Math.min(72, selfX - 36);

  const parts: string[] = [];
  parts.push(
    `<defs>`,
    // Sol : une nappe à peine plus claire sous le rail, qui s'éteint.
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${BONE}" stop-opacity="0.035"/>`,
    `<stop offset="1" stop-color="${BONE}" stop-opacity="0"/>`,
    `</linearGradient>`,
    // Lueur de la latte « Vous » répandue au sol (--spill).
    `<radialGradient id="spill" cx="50%" cy="50%" r="50%">`,
    `<stop offset="0" stop-color="${t.accent}" stop-opacity="0.42"/>`,
    `<stop offset="0.55" stop-color="${t.accent}" stop-opacity="0.12"/>`,
    `<stop offset="1" stop-color="${t.accent}" stop-opacity="0"/>`,
    `</radialGradient>`,
    // Halo derrière la latte, plus large et plus doux.
    `<radialGradient id="halo" cx="50%" cy="50%" r="50%">`,
    `<stop offset="0" stop-color="${t.accent}" stop-opacity="0.2"/>`,
    `<stop offset="1" stop-color="${t.accent}" stop-opacity="0"/>`,
    `</radialGradient>`,
    // Le rail naît du bord gauche et prend corps en arrivant sur « Vous » :
    // aux petits paliers, la distance déjà parcourue se lit au lieu d'un vide.
    `<linearGradient id="railIn" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0" stop-color="${t.rail}" stop-opacity="0"/>`,
    `<stop offset="1" stop-color="${t.rail}" stop-opacity="1"/>`,
    `</linearGradient>`,
    // Le comptoir : le trait d'accent de la page client (« COMPTOIR »),
    // redressé, qui s'estompe vers le haut.
    `<linearGradient id="counter" x1="0" y1="1" x2="0" y2="0">`,
    `<stop offset="0" stop-color="${t.accent}" stop-opacity="1"/>`,
    `<stop offset="0.7" stop-color="${t.accent}" stop-opacity="0.8"/>`,
    `<stop offset="1" stop-color="${t.accent}" stop-opacity="0.08"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" fill="${INK}"/>`,
    `<rect y="${railY}" width="${W}" height="${H - railY}" fill="url(#floor)"/>`,
  );

  // Lignes de sol (--floor-line), de plus en plus ténues.
  [266, 290, 312].forEach((y, i) => {
    parts.push(`<rect x="0" y="${y}" width="${W}" height="1" fill="${BONE}" fill-opacity="${f(0.07 - i * 0.02)}"/>`);
  });

  parts.push(
    `<ellipse cx="${f(selfCx)}" cy="${f(selfY + selfH * 0.5)}" rx="${f(selfW * 2.4)}" ry="${f(selfH * 0.9)}" fill="url(#halo)"/>`,
    `<ellipse cx="${f(selfCx)}" cy="${f(railY + 20)}" rx="${f(selfW * 1.9)}" ry="30" fill="url(#spill)"/>`,
  );

  // Le rail, jusqu'au comptoir. Derrière « Vous », il s'estompe vers le
  // bord gauche, et les places déjà parcourues restent dessinées en
  // creux (simple contour, de plus en plus ténu) : la distance au comptoir
  // se lit, et la composition tient même avec 0 à 3 lattes devant.
  const fadeEnd = Math.max(railStart, selfX - 24);
  if (fadeEnd > 24) {
    parts.push(
      `<rect x="0" y="${railY}" width="${f(fadeEnd)}" height="${railH}" fill="url(#railIn)"/>`,
    );
    const pitch = w + gap;
    const trail = plus ? 0 : GHOST_TRAIL;
    for (let i = 0; i < trail; i += 1) {
      const x = selfX - gap - w - i * pitch;
      if (x < 8) break;
      // Traînée courte, qui s'éteint vite : un sillage, pas une foule.
      const alpha = 0.26 * (1 - i / trail) ** 1.8;
      parts.push(
        `<rect x="${f(x + 0.75)}" y="${f(slatBottom - slatH + 0.75)}" width="${f(w - 1.5)}" height="${f(slatH - 1.5)}" rx="${r}" fill="none" stroke="${t.tick}" stroke-width="1.5" stroke-opacity="${f(alpha)}"/>`,
        `<rect x="${f(x + w / 2 - 1)}" y="${f(slatBottom)}" width="2" height="${notch + 1}" rx="1" fill="${t.rail}" fill-opacity="${f(Math.min(1, alpha * 3))}"/>`,
      );
    }
  }
  parts.push(
    `<rect x="${f(fadeEnd)}" y="${railY}" width="${f(counterX - fadeEnd)}" height="${railH}" rx="${railH / 2}" fill="${t.rail}"/>`,
    `<rect x="${counterX}" y="${railY - 184}" width="4" height="${184 + railH}" rx="2" fill="url(#counter)"/>`,
  );

  // Lattes « quelqu'un devant » : la tête (i = 0) contre le comptoir.
  for (let i = 0; i < grey; i += 1) {
    const x = headRight - (i + 1) * w - i * gap;
    const head = i === 0;
    parts.push(
      `<rect x="${f(x + w / 2 - 1)}" y="${f(slatBottom)}" width="2" height="${notch + 1}" rx="1" fill="${t.rail}"/>`,
      `<rect x="${f(x)}" y="${f(slatBottom - slatH + edge)}" width="${w}" height="${slatH}" rx="${r}" fill="${t.edge}"/>`,
      `<rect x="${f(x)}" y="${f(slatBottom - slatH)}" width="${w}" height="${slatH}" rx="${r}" fill="${head ? t.slatHead : t.slat}"/>`,
      `<rect x="${f(x + w / 2 - 1)}" y="${f(slatBottom - 26)}" width="2" height="14" rx="1" fill="${head ? t.accent : t.tick}" fill-opacity="${head ? '0.9' : '0.35'}"/>`,
    );
  }

  if (plus) {
    const cx = greyLeft - gap - dotsW / 2;
    for (let i = -1; i <= 1; i += 1) {
      parts.push(`<circle cx="${f(cx + i * 12)}" cy="${f(slatBottom - slatH / 2)}" r="3.5" fill="${t.tick}" fill-opacity="0.7"/>`);
    }
  }

  // La latte « Vous ».
  const dotY = selfY + 34;
  parts.push(
    `<rect x="${f(selfCx - 2)}" y="${f(slatBottom)}" width="4" height="${notch + 2}" rx="2" fill="${t.accent}"/>`,
    `<rect x="${f(selfX)}" y="${f(selfY + edge + 1)}" width="${f(selfW)}" height="${selfH}" rx="${r + 2}" fill="${t.edgeSelf}"/>`,
    `<rect x="${f(selfX)}" y="${f(selfY)}" width="${f(selfW)}" height="${selfH}" rx="${r + 2}" fill="${t.accent}"/>`,
    `<circle cx="${f(selfCx)}" cy="${f(dotY)}" r="15" fill="${t.onAccent}" fill-opacity="0.2"/>`,
    `<circle cx="${f(selfCx)}" cy="${f(dotY)}" r="8" fill="${t.onAccent}"/>`,
    `<rect x="${f(selfCx - 1.5)}" y="${f(dotY + 30)}" width="3" height="${f(selfH - 30 - 34 - 22)}" rx="1.5" fill="${t.onAccent}" fill-opacity="0.45"/>`,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    ...parts,
    `</svg>`,
  ].join('');
}

/* --------------------------------------------------------------------
   Noms de fichiers publics (route /api/wallet/art/[file])
   -------------------------------------------------------------------- */

export type ArtFile =
  | { type: 'hero'; count: SlatsCount; accent: WalletAccent }
  | { type: 'logo' };

export const RANGVIA_LOGO_FILE = 'rangvia-660.png';

export function heroFileName(count: SlatsCount, accent: WalletAccent): string {
  return `rang-${ART_REVISION}-${count}-${accent}.png`;
}

export function heroUrl(siteUrl: string, peopleAhead: number, accent: WalletAccent): string {
  return `${siteUrl.replace(/\/+$/, '')}/api/wallet/art/${heroFileName(heroCount(peopleAhead), accent)}`;
}

const ART_FILE = new RegExp(`^rang-${ART_REVISION}-(\\d{1,2}|plus)-(signal|copper|jade|cobalt|brique)\\.png$`);

/**
 * Liste blanche stricte : tout autre nom est refusé avant même d'être lu,
 * y compris une AUTRE révision (une ancienne URL ne doit jamais recevoir
 * le nouveau dessin sous un en-tête « immutable »).
 */
export function parseArtFile(name: string): ArtFile | null {
  if (name === RANGVIA_LOGO_FILE) return { type: 'logo' };
  const match = ART_FILE.exec(name);
  if (!match) return null;
  const raw = match[1]!;
  if (raw === 'plus') return { type: 'hero', count: 'plus', accent: match[2] as WalletAccent };
  // « 07 » et « 7 » ne doivent pas être deux URL d'un même état.
  if (raw.length > 1 && raw.startsWith('0')) return null;
  const n = Number(raw);
  if (n > HERO_MAX) return null;
  return { type: 'hero', count: n, accent: match[2] as WalletAccent };
}
