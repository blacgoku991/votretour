/**
 * Codes des plaques de stock fournisseur — logique pure.
 *
 * Un code de stock a la forme `rv-xxxxx-xxxxx` dans l'URL, et s'affiche
 * `RV-XXXXX-XXXXX` sur la plaque et dans le super-admin. L'alphabet est
 * celui de Crockford : ni i, ni l, ni o, ni u, les lettres qu'on confond
 * en recopiant un code gravé.
 */

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const CODE_RE = /^rv-[0-9abcdefghjkmnpqrstvwxyz]{5}-[0-9abcdefghjkmnpqrstvwxyz]{5}$/;

/** Vrai si la chaîne est un code de stock canonique (forme d'URL). */
export function isStockCode(value: string): boolean {
  return CODE_RE.test(value);
}

/**
 * Ramène à la forme canonique ce qu'un humain tape ou colle : un code
 * en majuscules, avec ou sans tirets ni préfixe, ou l'URL complète lue
 * dans une puce NFC. Les confusions classiques de recopie sont
 * corrigées comme le prévoit Crockford : O → 0, I et L → 1.
 * Renvoie null si ce n'est manifestement pas un code de stock.
 */
export function normalizeStockCode(input: string): string | null {
  let raw = input.trim().toLowerCase();
  const fromUrl = raw.match(/\/e\/([a-z0-9-]+)\/?(?:[?#].*)?$/);
  if (fromUrl?.[1]) raw = fromUrl[1];

  raw = raw.replace(/[\s_.–—-]+/g, '');
  // Le préfixe ne se retire que s'il est en trop : un code nu de dix
  // caractères peut lui-même commencer par « rv ».
  if (raw.length === 12 && raw.startsWith('rv')) raw = raw.slice(2);
  raw = raw.replace(/o/g, '0').replace(/[il]/g, '1');

  if (raw.length !== 10) return null;
  for (const char of raw) {
    if (!ALPHABET.includes(char)) return null;
  }
  return `rv-${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Forme lisible, telle qu'imprimée sur la plaque. */
export function formatStockCode(code: string): string {
  return code.toUpperCase();
}

/** Numéro de série sur six chiffres : « 000042 ». */
export function formatSerial(serial: number | string): string {
  return String(serial).padStart(6, '0');
}

/** L'URL gravée dans la puce et encodée dans le QR. */
export function stockPlateUrl(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/e/${code}`;
}

export interface SupplierRow {
  serial: number;
  code: string;
}

/**
 * Fichier CSV pour le fabricant.
 *
 * Point-virgule et BOM UTF-8 : c'est ce qu'Excel attend en France pour
 * ouvrir un CSV d'un double clic, avec les accents intacts. Chaque
 * champ est entre guillemets ; un guillemet interne est doublé. Une
 * cellule qui commence par =, +, - ou @ est préfixée d'une apostrophe :
 * sans cela, un tableur l'exécuterait comme une formule.
 */
export function buildSupplierCsv(rows: SupplierRow[], siteUrl: string, batchLabel: string): string {
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = ['Numéro', 'Code imprimé', 'URL à graver (NFC et QR)', 'Lot'];
  const lines = rows.map((row) => [
    cell(formatSerial(row.serial)),
    cell(formatStockCode(row.code)),
    cell(stockPlateUrl(siteUrl, row.code)),
    cell(batchLabel),
  ].join(';'));
  return '﻿' + [header.map(cell).join(';'), ...lines].join('\r\n') + '\r\n';
}

/** Une URL par ligne : le format que la plupart des encodeurs NFC acceptent. */
export function buildSupplierUrlList(rows: SupplierRow[], siteUrl: string): string {
  return rows.map((row) => stockPlateUrl(siteUrl, row.code)).join('\n') + '\n';
}
