import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Jeton `ApplePass` du service web Apple Wallet.
 *
 * Wallet renvoie, à chaque appel du service web (inscription, mise à jour,
 * désinscription), le `authenticationToken` inscrit dans le pass. Apple
 * interdit de le changer une fois le pass installé : il doit donc être
 * reproductible à l'identique, version après version.
 *
 * On le DÉRIVE plutôt que de le stocker :
 *   base64url(HMAC-SHA256(secret, "wallet-auth:v1:" + numéro de série))
 * → 43 caractères (Apple en exige au moins 16). Une fuite de la base ne
 * donne aucun jeton ; sans le secret (walletAuthSecret(), providers.ts),
 * impossible d'appeler le service web pour un pass. Le préfixe versionné
 * permet un jour une autre dérivation sans ambiguïté.
 *
 * Changer le secret invalide TOUS les passes installés (ils cessent de se
 * mettre à jour) : c'est le coupe-circuit documenté, pas une rotation.
 */

const PREFIX = 'wallet-auth:v1:';
/** Numéro de série Apple : 22 caractères aléatoires (internal.generate_public_id(22)). */
export const APPLE_SERIAL = /^[0-9A-Za-z]{22}$/;
/** Forme d'un jeton dérivé : base64url, 43 caractères. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

export function applePassToken(serial: string, secret: string): string {
  if (!secret) throw new Error('Secret des jetons Apple Wallet absent');
  return createHmac('sha256', secret).update(`${PREFIX}${serial}`, 'utf8').digest('base64url');
}

/**
 * En-tête `Authorization: ApplePass <jeton>` → jeton, ou null. Wallet
 * écrit exactement ce schéma ; on tolère la casse du mot-clé et les
 * espaces surnuméraires, rien d'autre.
 */
export function parseApplePassAuthorization(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^\s*ApplePass\s+(\S+)\s*$/i.exec(header);
  const token = match?.[1];
  return token && TOKEN_SHAPE.test(token) ? token : null;
}

/**
 * Comparaison en TEMPS CONSTANT : on compare les condensats SHA-256 des
 * deux valeurs (longueur fixe), si bien que ni le contenu ni la longueur
 * du jeton présenté ne se devinent au chronomètre. Toute forme invalide
 * répond faux, sans exception, par le même chemin.
 */
export function verifyApplePassToken(serial: string, header: string | null | undefined, secret: string | null): boolean {
  const presented = parseApplePassAuthorization(header) ?? '';
  const expected = secret && APPLE_SERIAL.test(serial) ? applePassToken(serial, secret) : '';
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  const same = timingSafeEqual(a, b);
  return same && presented.length > 0 && expected.length > 0;
}

/** Masque les jetons ApplePass d'un texte (journal /v1/log, messages d'erreur). */
export function redactApplePass(text: string): string {
  return text.replace(/ApplePass\s+\S+/gi, 'ApplePass ***');
}
