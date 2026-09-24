import type { WalletAccent } from './types';
import { WALLET_ACCENTS } from './types';

/**
 * Couleurs des passes, contrastes GARANTIS.
 *
 * Un pass s'affiche en plein soleil, sur l'écran verrouillé, parfois sur
 * une montre : un texte illisible y est un défaut, pas un détail. Chaque
 * couple texte / fond sort d'ici avec un contraste WCAG ≥ 4,5:1, vérifié
 * par tests/wallet/palette.test.ts sur les 5 accents et 1 000 couleurs
 * aléatoires (une marque peut choisir n'importe quelle couleur de drop).
 *
 * Direction « Le Rang en relief » :
 *  - FILE : fond encre #0B0E13, texte os #FAF9F6, étiquettes à l'accent
 *    de l'établissement, éclairci vers l'os par pas de 5 % tant qu'il
 *    n'atteint pas 4,5:1 (cobalt et brique en ont besoin) ;
 *  - DROP : fond = couleur exacte de la marque, texte encre ou os selon
 *    le meilleur contraste ; si aucun des deux n'atteint 4,5:1 (couleurs
 *    médianes), le fond est assombri vers l'encre, par pas de 5 % aussi.
 *
 * Aucune dépendance : fichier pur, partagé par Apple (rgb(r, g, b)),
 * Google (#RRGGBB) et les lattes (art/slats.ts).
 */

export const INK = '#0B0E13';
export const INK_1000 = '#05070A';
export const INK_600 = '#222833';
export const INK_700 = '#181D25';
export const BONE = '#FAF9F6';

/** Accents de globals.css (--signal-500, --copper-500…). */
export const ACCENT_HEX: Record<WalletAccent, string> = {
  signal: '#FF4B1F',
  copper: '#D9903A',
  jade: '#1FA97A',
  cobalt: '#3A63D8',
  brique: '#A8453C',
};

/** Seuil exigé partout (WCAG AA, texte courant). */
export const MIN_CONTRAST = 4.5;

export function normalizeAccent(value: string | null | undefined): WalletAccent {
  return (WALLET_ACCENTS as readonly string[]).includes(value ?? '') ? (value as WalletAccent) : 'signal';
}

type Rgb = readonly [number, number, number];

/** « #abc », « #AABBCC », « AABBCC » → « #AABBCC » ; sinon null. */
export function normalizeHex(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw.split('').map((c) => c + c).join('')}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw}`.toUpperCase();
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const clean = normalizeHex(hex);
  if (!clean) throw new Error(`Couleur invalide : ${hex}`);
  const n = Number.parseInt(clean.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mélange linéaire en sRGB : t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return rgbToHex([
    ra[0] + (rb[0] - ra[0]) * t,
    ra[1] + (rb[1] - ra[1]) * t,
    ra[2] + (rb[2] - ra[2]) * t,
  ]);
}

/**
 * Rapproche `color` de `towards` par pas de 5 % jusqu'à atteindre `min`
 * contre `against`. Termine toujours : à 100 %, c'est `towards` lui-même,
 * choisi par l'appelant pour contraster (os sur encre, encre sur os).
 */
export function pushToContrast(color: string, against: string, towards: string, min = MIN_CONTRAST): string {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mix(color, towards, step * 0.05);
    if (contrastRatio(candidate, against) >= min) return candidate;
  }
  return towards;
}

export interface PassColors {
  background: string;
  foreground: string;
  label: string;
}

export interface WalletPalette extends PassColors {
  /** Accent brut (lattes, bandeau) ; jamais utilisé pour du texte sur le fond. */
  accent: string;
  /** Texte posé SUR l'accent (latte « Vous »). */
  onAccent: string;
  /** Tranche en relief de la latte « Vous » (--slat-edge-self). */
  accentEdge: string;
  apple: { backgroundColor: string; foregroundColor: string; labelColor: string };
  google: { hexBackgroundColor: string };
}

export function appleRgb(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

export function googleHex(hex: string): string {
  const clean = normalizeHex(hex);
  if (!clean) throw new Error(`Couleur invalide : ${hex}`);
  return clean;
}

/** Meilleur texte (encre ou os) posé sur `background`. */
export function bestInkOrBone(background: string): string {
  return contrastRatio(INK_1000, background) >= contrastRatio(BONE, background) ? INK_1000 : BONE;
}

function finish(colors: PassColors, accent: string): WalletPalette {
  const onAccent = bestInkOrBone(accent);
  return {
    ...colors,
    accent,
    onAccent,
    accentEdge: mix(accent, INK, 0.14),
    apple: {
      backgroundColor: appleRgb(colors.background),
      foregroundColor: appleRgb(colors.foreground),
      labelColor: appleRgb(colors.label),
    },
    google: { hexBackgroundColor: googleHex(colors.background) },
  };
}

/** Ticket de file : encre, os, étiquettes à l'accent (éclairci si besoin). */
export function queuePalette(accent: WalletAccent): WalletPalette {
  const hex = ACCENT_HEX[accent];
  return finish(
    { background: INK, foreground: BONE, label: pushToContrast(hex, INK, BONE) },
    hex,
  );
}

/**
 * Billet de drop : la couleur de la marque en fond. `hex` invalide ou
 * absent → accent de l'établissement.
 */
export function eventPalette(hex: string | null | undefined, fallback: WalletAccent = 'signal'): WalletPalette {
  const brand = normalizeHex(hex) ?? ACCENT_HEX[fallback];

  let background = brand;
  let foreground = bestInkOrBone(background);
  // Couleur médiane : ni l'encre ni l'os n'atteignent 4,5:1. On assombrit
  // le fond (le texte os reprend alors l'avantage) plutôt que de livrer un
  // billet illisible. La teinte d'origine reste celle du bandeau.
  if (contrastRatio(foreground, background) < MIN_CONTRAST) {
    background = pushToContrast(brand, BONE, INK);
    foreground = BONE;
  }

  // Étiquettes un ton en retrait (65 % texte, 35 % fond) si c'est lisible.
  const soft = mix(foreground, background, 0.35);
  const label = contrastRatio(soft, background) >= MIN_CONTRAST ? soft : foreground;

  return finish({ background, foreground, label }, brand);
}
