/**
 * IMMATRICULATIONS — normalisation, validation, affichage, masquage.
 *
 * « Plaque » désigne dans tout le dépôt la plaque NFC/QR posée sur le
 * comptoir (`plates`, `Plaque.tsx`) : l'immatriculation d'un véhicule
 * s'appelle donc `registration`, partout.
 *
 * La CNIL tient l'immatriculation pour une donnée personnelle (elle
 * identifie indirectement le propriétaire). D'où trois règles :
 *  - la clé de recherche (`registration_key`) est normalisée ici ET en SQL
 *    (`internal.normalize_registration`), à l'identique ;
 *  - hors du poste du pro, elle n'apparaît que MASQUÉE : les trois derniers
 *    caractères restent lisibles (`AB-123-CD` → `••-••3-CD`) ;
 *  - elle est purgée avec les prénoms, à la même échéance.
 *
 * Formats (arrêté du 9 février 2009 et anciens numéros encore en
 * circulation) :
 *  - SIV, depuis 2009 : deux lettres, trois chiffres, deux lettres. Les
 *    lettres I, O et U ne sont jamais utilisées (confusion avec 1, 0, V) ;
 *  - FNI, avant 2009 : 1 à 4 chiffres, 1 à 3 lettres, le département ;
 *  - étranger : 2 à 12 caractères, sans contrôle de forme.
 * Les cas douteux (combinaison « SS », série « 000 ») ne sont PAS refusés :
 * un avertissement suffit, car refuser une vraie plaque bloquerait un
 * client au comptoir pour une règle que nous ne maîtrisons pas.
 */

import type { RegistrationCountry } from './types';

/** Lettres SIV : A à Z sans I, O ni U. */
const SIV_LETTER = '[A-HJ-NP-TV-Z]';
export const SIV_RE = new RegExp(`^(${SIV_LETTER}{2})([0-9]{3})(${SIV_LETTER}{2})$`);
/** Même gabarit, lettres quelconques : sert à expliquer un refus I/O/U. */
const SIV_SHAPE_RE = /^([A-Z]{2})([0-9]{3})([A-Z]{2})$/;
export const FNI_RE = /^([0-9]{1,4})([A-Z]{1,3})(0[1-9]|[1-8][0-9]|9[0-5]|2A|2B|97[1-6])$/;

export const REGISTRATION_KEY_RE = /^[A-Z0-9]{2,12}$/;

export type RegistrationFormat = 'siv' | 'fni' | 'other';

export type RegistrationParse =
  | {
      ok: true;
      format: RegistrationFormat;
      /** Clé normalisée, stockée dans `registration_key` (`AB123CD`). */
      key: string;
      /** Forme d'affichage (`AB-123-CD`, `1234 AB 75`). */
      display: string;
      warnings: string[];
    }
  | { ok: false; key: string; reason: string };

/**
 * Majuscules, lettres et chiffres seulement : `ab 123-cd` → `AB123CD`.
 * Les accents tombent avec leur lettre de base (`é` → `E`) : un clavier
 * de téléphone en français en glisse parfois un.
 */
export function normalizeRegistration(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function formatFni(match: RegExpMatchArray): string {
  return `${match[1]} ${match[2]} ${match[3]}`;
}

/** Valide et met en forme une immatriculation saisie. */
export function parseRegistration(raw: string, country: RegistrationCountry = 'FR'): RegistrationParse {
  const key = normalizeRegistration(raw);

  if (country === 'other') {
    if (!REGISTRATION_KEY_RE.test(key)) {
      return { ok: false, key, reason: 'Entre 2 et 12 lettres ou chiffres.' };
    }
    // Forme libre : on garde les séparateurs du client, en les simplifiant.
    const display = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 -]/g, '')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    return { ok: true, format: 'other', key, display, warnings: [] };
  }

  if (key.length === 0) {
    return { ok: false, key, reason: 'Saisissez l’immatriculation.' };
  }

  const siv = key.match(SIV_RE);
  if (siv) {
    const warnings: string[] = [];
    if (siv[1] === 'SS' || siv[3] === 'SS') warnings.push('La combinaison SS n’est normalement pas attribuée.');
    if (siv[2] === '000') warnings.push('La série 000 n’est normalement pas attribuée.');
    return { ok: true, format: 'siv', key, display: `${siv[1]}-${siv[2]}-${siv[3]}`, warnings };
  }

  const fni = key.match(FNI_RE);
  if (fni) {
    return { ok: true, format: 'fni', key, display: formatFni(fni), warnings: [] };
  }

  if (SIV_SHAPE_RE.test(key)) {
    return {
      ok: false,
      key,
      reason: 'Les lettres I, O et U ne figurent pas sur les plaques françaises : vérifiez 1, 0 et V.',
    };
  }
  return {
    ok: false,
    key,
    reason: 'Format attendu : AB-123-CD, ou 1234 AB 75 pour une ancienne plaque.',
  };
}

/**
 * Mise en forme PENDANT la frappe (plaque française) : `ab123cd` devient
 * `AB-123-CD` au fil des touches. Les séparateurs sont posés par nous,
 * jamais en fin de saisie : un tiret final piégerait la touche d'effacement.
 * La forme suit le premier caractère : une lettre annonce le SIV, un
 * chiffre l'ancien format.
 */
export function formatRegistrationInput(raw: string): string {
  const key = normalizeRegistration(raw);
  if (!key) return '';
  if (/^[A-Z]/.test(key)) {
    const k = key.slice(0, 7);
    const parts = [k.slice(0, 2), k.slice(2, 5), k.slice(5, 7)].filter(Boolean);
    return parts.join('-');
  }
  // Ancien format : des groupes de même nature (chiffres, lettres, département).
  const k = key.slice(0, 10);
  const lead = k.match(/^[0-9]{1,4}/)?.[0] ?? '';
  const rest = k.slice(lead.length);
  const letters = rest.match(/^[A-Z]{1,3}/)?.[0] ?? '';
  const dept = rest.slice(letters.length);
  return [lead, letters, dept].filter(Boolean).join(' ');
}

/** Caractère de masquage, identique à celui de `internal.mask_registration`. */
export const MASK_CHAR = '•';

/**
 * Masque une immatriculation AFFICHÉE en gardant ses séparateurs : seuls
 * les trois derniers caractères alphanumériques restent lisibles.
 *
 *   AB-123-CD  → ••-••3-CD
 *   1234 AB 75 → •••• •B 75
 *
 * Une immatriculation très courte (étrangère) garde au moins un caractère
 * masqué : sinon, « masquée », elle serait lue en entier.
 */
export function maskRegistration(display: string): string {
  const chars = Array.from(display);
  const alnum = chars.filter((c) => /[A-Za-z0-9]/.test(c)).length;
  const visible = Math.min(3, Math.max(0, alnum - 1));
  let seen = 0;
  const out: string[] = [];
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const c = chars[i] ?? '';
    if (/[A-Za-z0-9]/.test(c)) {
      out.push(seen < visible ? c : MASK_CHAR);
      seen += 1;
    } else {
      out.push(c);
    }
  }
  return out.reverse().join('');
}

/** Les caractères restés visibles d'une forme masquée (« 3-CD »), pour les lecteurs d'écran. */
export function maskedTail(masked: string): string {
  const i = masked.lastIndexOf(MASK_CHAR);
  return masked.slice(i + 1).replace(/^[\s-]+/, '');
}

/**
 * Forme d'affichage d'une immatriculation stockée, quel que soit ce qui a
 * été saisi : la forme canonique si elle est française et valide, sinon la
 * saisie nettoyée.
 */
export function displayRegistration(raw: string, country: RegistrationCountry = 'FR'): string {
  const parsed = parseRegistration(raw, country);
  if (parsed.ok) return parsed.display;
  return country === 'FR' ? formatRegistrationInput(raw) : normalizeRegistration(raw);
}

/**
 * Recherche du poste atelier : `ab 123-cd` trouve `AB-123-CD`, `123` aussi.
 * La requête est normalisée comme la clé ; une requête vide ne trouve rien.
 */
export function registrationMatches(query: string, key: string | null | undefined): boolean {
  const q = normalizeRegistration(query);
  if (!q || !key) return false;
  return normalizeRegistration(key).includes(q);
}
