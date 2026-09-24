import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * LIEN DE SUIVI — le QR de l'étiquette de clé (« Suivre mon véhicule »).
 *
 * Le réceptionnaire crée la fiche d'un véhicule déposé sans que le client
 * ait scanné la plaque du comptoir. Rangvia lui affiche un QR (ou
 * l'imprime sur l'étiquette de clé) : le client le scanne, et la fiche est
 * rattachée à SON téléphone, sans rien saisir.
 *
 * Le jeton est la seule chose qui relie un inconnu à une fiche : il est
 * donc traité comme un mot de passe à usage unique.
 *  - 32 octets aléatoires (`crypto.randomBytes`), 256 bits : impossible à
 *    deviner, même à raison de milliers d'essais par seconde ;
 *  - encodé en base64url (43 caractères, sans `=`), sûr dans une URL ;
 *  - la base ne stocke que son SHA-256 en hexadécimal (`set_claim`,
 *    contrôlé par `^[0-9a-f]{64}$`) : une copie de la base ne permet pas
 *    de rattacher une fiche ;
 *  - il expire (24 h au plus, borné en SQL), ne sert qu'une fois (effacé
 *    par `claim_entry`) et ne fonctionne que tant que la fiche n'a pas
 *    d'appareil ;
 *  - il n'est affiché qu'une fois, sur l'écran du pro ou l'étiquette, et
 *    n'est jamais journalisé : `/s/…` échappe au middleware, et aucune
 *    ligne de ce module n'écrit le jeton brut.
 *
 * Pas de poivre ici, contrairement aux sessions : un jeton de 256 bits
 * tiré au hasard n'a pas besoin d'être protégé d'une attaque par
 * dictionnaire, et un hash sans secret reste vérifiable si le secret de
 * session change pendant qu'une étiquette attend d'être scannée.
 */

export const TRACKING_TOKEN_BYTES = 32;

/** base64url de 32 octets : 43 caractères, sans remplissage. */
export const TRACKING_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Durée de vie par défaut : une journée (le maximum accepté par `set_claim`). */
export const TRACKING_TTL_MINUTES = 1440;

export interface TrackingToken {
  /** Le jeton, à ne montrer qu'une fois (QR, étiquette). */
  token: string;
  /** Son SHA-256 hexadécimal : la seule forme stockée. */
  hash: string;
}

export function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateTrackingToken(): TrackingToken {
  const token = randomBytes(TRACKING_TOKEN_BYTES).toString('base64url');
  return { token, hash: hashTrackingToken(token) };
}

/** Forme attendue d'un jeton (avant tout accès à la base). */
export function isTrackingToken(value: unknown): value is string {
  return typeof value === 'string' && TRACKING_TOKEN_RE.test(value);
}

/**
 * Le jeton correspond-il à ce hash ? Comparaison à temps constant : la
 * durée de la réponse ne dit rien du nombre de caractères justes. (La
 * base compare elle-même par égalité d'index ; cette fonction sert aux
 * contrôles côté serveur et aux tests.)
 */
export function trackingTokenMatches(token: string, expectedHash: string): boolean {
  if (!isTrackingToken(token) || !/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashTrackingToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** URL publique de rattachement : `https://…/s/<jeton>`. */
export function trackingUrl(token: string, siteUrl: string = env.siteUrl): string {
  return `${siteUrl.replace(/\/+$/, '')}/s/${token}`;
}
