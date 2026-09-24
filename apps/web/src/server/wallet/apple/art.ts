import { mix } from '../palette';

/**
 * Dessins propres au pass Apple, dans la grammaire des lattes
 * (art/slats.ts) : un rail, des lattes accrochées par leur encoche, et la
 * latte « Vous » qui porte la couleur. Aucun texte dans les images : le
 * serveur n'a pas les polices de la charte, et Wallet écrit lui-même les
 * champs, en grand, avec la typographie du système.
 *
 * DÉTERMINISTE : une chaîne SVG ne dépend que de ses paramètres. Le
 * .pkpass en tire son empreinte de rendu ; un dessin qui changerait d'un
 * appel à l'autre ferait pousser une mise à jour pour rien.
 */

const f = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Dimensions en points Apple (× 1, 2, 3 en pixels). */
export const LOGO_BOX = { width: 160, height: 50 } as const;
export const ICON_SIZE = 29;
export const STRIP_SIZE = { width: 375, height: 98 } as const;

/**
 * Le signe Rangvia (public/icon.svg), SANS son fond : il se pose sur le
 * fond du pass, encre pour une file, couleur de la marque pour un drop.
 * Carré de 50 × 50 pt, la hauteur utile d'un logo Wallet.
 *
 * @param ink   couleur du rail et des lattes (le texte du pass)
 * @param self  couleur de la latte « Vous »
 */
export function markSvg(ink: string, self: string, scale: 1 | 2 | 3): string {
  const px = 50 * scale;
  // Géométrie de icon.svg (512), recadrée sur le dessin (x 112→400, y 128→384).
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="100 120 312 272">`,
    `<rect x="112" y="128" width="16" height="256" rx="8" fill="${ink}" fill-opacity="0.34"/>`,
    `<rect x="164" y="140" width="236" height="56" rx="28" fill="${ink}" fill-opacity="0.3"/>`,
    `<rect x="164" y="228" width="170" height="56" rx="28" fill="${ink}" fill-opacity="0.55"/>`,
    `<rect x="164" y="316" width="112" height="56" rx="28" fill="${self}"/>`,
    `<rect x="128" y="160" width="40" height="14" rx="7" fill="${ink}" fill-opacity="0.34"/>`,
    `<rect x="128" y="248" width="40" height="14" rx="7" fill="${ink}" fill-opacity="0.34"/>`,
    `<rect x="128" y="336" width="40" height="16" rx="8" fill="${self}"/>`,
    `</svg>`,
  ].join('');
}

/**
 * Icône (notifications de l'écran verrouillé, courriels) : le signe sur
 * un carré plein, parce qu'iOS la pose sur des fonds qu'on ne choisit pas.
 */
export function iconSvg(background: string, ink: string, self: string, scale: 1 | 2 | 3): string {
  const px = ICON_SIZE * scale;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 512 512">`,
    `<rect width="512" height="512" fill="${background}"/>`,
    `<rect x="112" y="128" width="16" height="256" rx="8" fill="${ink}" fill-opacity="0.34"/>`,
    `<rect x="164" y="140" width="236" height="56" rx="28" fill="${ink}" fill-opacity="0.26"/>`,
    `<rect x="164" y="228" width="170" height="56" rx="28" fill="${ink}" fill-opacity="0.48"/>`,
    `<rect x="164" y="316" width="112" height="56" rx="28" fill="${self}"/>`,
    `<rect x="128" y="160" width="40" height="14" rx="7" fill="${ink}" fill-opacity="0.34"/>`,
    `<rect x="128" y="248" width="40" height="14" rx="7" fill="${ink}" fill-opacity="0.34"/>`,
    `<rect x="128" y="336" width="40" height="16" rx="8" fill="${self}"/>`,
    `</svg>`,
  ].join('');
}

/**
 * Bandeau d'un billet de drop sans visuel de couverture : la file couchée,
 * ton sur ton dans la couleur de la marque, qui avance vers le comptoir à
 * droite. Wallet pose le grand champ principal (« Accès ouvert ») en bas
 * à gauche du bandeau : toute la matière est donc à droite, et le quart
 * gauche reste calme pour le texte.
 *
 * @param background fond du billet (couleur de la marque, assombrie si besoin)
 * @param ink        texte du billet (encre ou os, contraste garanti)
 */
export function stripSvg(background: string, ink: string, scale: 1 | 2 | 3): string {
  const W = STRIP_SIZE.width;
  const H = STRIP_SIZE.height;
  const px = { w: W * scale, h: H * scale };
  const railY = 82;
  const counterX = 356;
  const slatW = 9;
  const gap = 5;
  const count = 11;
  const tone = (t: number) => mix(background, ink, t);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px.w}" height="${px.h}" viewBox="0 0 ${W} ${H}">`,
    `<defs>`,
    `<radialGradient id="glow" cx="78%" cy="70%" r="62%">`,
    `<stop offset="0" stop-color="${ink}" stop-opacity="0.16"/>`,
    `<stop offset="1" stop-color="${ink}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<linearGradient id="rail" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0.25" stop-color="${ink}" stop-opacity="0"/>`,
    `<stop offset="1" stop-color="${ink}" stop-opacity="0.38"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" fill="${background}"/>`,
    `<rect width="${W}" height="${H}" fill="url(#glow)"/>`,
    // Le rail, qui naît au premier tiers et s'affirme vers le comptoir.
    `<rect x="0" y="${railY}" width="${counterX}" height="2" rx="1" fill="url(#rail)"/>`,
    // Le comptoir.
    `<rect x="${counterX}" y="${railY - 58}" width="3" height="60" rx="1.5" fill="${ink}" fill-opacity="0.7"/>`,
  ];

  // Lattes debout sur le rail, de plus en plus nettes vers le comptoir ;
  // la tête de file touche presque le comptoir.
  for (let i = 0; i < count; i += 1) {
    const x = counterX - 8 - (count - i) * (slatW + gap);
    const progress = (i + 1) / count;
    const h = 22 + progress * 26;
    const y = railY - 6 - h;
    parts.push(
      `<rect x="${f(x)}" y="${f(y + 1.5)}" width="${slatW}" height="${f(h)}" rx="3" fill="${tone(0.04 + progress * 0.08)}"/>`,
      `<rect x="${f(x)}" y="${f(y)}" width="${slatW}" height="${f(h)}" rx="3" fill="${tone(0.1 + progress * 0.2)}"/>`,
      // Encoche vers le rail.
      `<rect x="${f(x + slatW / 2 - 1)}" y="${f(y + h)}" width="2" height="6" rx="1" fill="${ink}" fill-opacity="${f(0.12 + progress * 0.2)}"/>`,
    );
  }
  parts.push(`</svg>`);
  return parts.join('');
}

/**
 * Voile posé sur une photo de couverture : la moitié gauche se fond dans
 * la couleur du billet (le texte de Wallet y reste lisible, contraste du
 * fond garanti par la palette), la droite laisse voir l'image.
 */
export function stripVeilSvg(background: string, widthPx: number, heightPx: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 100 100" preserveAspectRatio="none">`,
    `<defs>`,
    `<linearGradient id="side" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0" stop-color="${background}" stop-opacity="0.92"/>`,
    `<stop offset="0.45" stop-color="${background}" stop-opacity="0.66"/>`,
    `<stop offset="1" stop-color="${background}" stop-opacity="0.12"/>`,
    `</linearGradient>`,
    `<linearGradient id="foot" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0.35" stop-color="${background}" stop-opacity="0"/>`,
    `<stop offset="1" stop-color="${background}" stop-opacity="0.55"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect width="100" height="100" fill="url(#side)"/>`,
    `<rect width="100" height="100" fill="url(#foot)"/>`,
    `</svg>`,
  ].join('');
}
