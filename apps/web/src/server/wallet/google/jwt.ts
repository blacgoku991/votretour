import { SignJWT, type importPKCS8 } from 'jose';
import type { GoogleObjectType } from './client';

/**
 * JWT « savetowallet » LÉGER et lien d'enregistrement.
 *
 * L'objet est d'abord créé par l'API REST (sync.ts / provider.ts) ; le JWT
 * ne fait que le RÉFÉRENCER par son identifiant. Trois raisons :
 *  - taille : un objet complet dépasserait les 1 800 caractères sûrs d'une
 *    URL (certains navigateurs tronquent au-delà) ; ~700 ici ;
 *  - fraîcheur : l'objet existe dès le clic et nos PATCH s'appliquent même
 *    pendant que le client hésite sur la feuille d'enregistrement ;
 *  - secret : la clé TOTP d'un billet de drop ne voyage pas dans l'URL
 *    (recommandation de Google, page « Rotating Barcodes »).
 *
 * Pièges verrouillés par tests/wallet/google-jwt.test.ts : `typ` doit
 * valoir exactement « savetowallet » et `iat` est OBLIGATOIRE (sans lui,
 * Google affiche un « Something went wrong » alors que l'insertion REST a
 * réussi). Le JWT n'est jamais écrit dans une page : il n'existe que dans
 * l'en-tête Location d'une redirection `no-store`.
 */

export const SAVE_URL_PREFIX = 'https://pay.google.com/gp/v/save/';
/** Longueur maximale sûre du lien complet. */
export const SAVE_URL_MAX_LENGTH = 1800;

const OBJECT_ID = /^\d+\.[A-Za-z0-9._-]+$/;

export interface SaveJwtInput {
  key: Awaited<ReturnType<typeof importPKCS8>>;
  clientEmail: string;
  privateKeyId: string;
  /** Origine du site (https://rangvia.fr), seule autorisée à afficher le bouton. */
  origin: string;
  objectType: GoogleObjectType;
  objectId: string;
  /** Secondes epoch ; par défaut maintenant. */
  iat?: number;
}

export async function buildSaveJwt(input: SaveJwtInput): Promise<string> {
  if (!OBJECT_ID.test(input.objectId)) throw new Error('Identifiant d’objet Google invalide');
  if (!/^https:\/\/[^/]+$/.test(input.origin)) throw new Error('Origine du JWT invalide (https://hôte attendu)');
  const collection = input.objectType === 'genericObject' ? 'genericObjects' : 'eventTicketObjects';
  return new SignJWT({
    typ: 'savetowallet',
    origins: [input.origin],
    // UNIQUEMENT l'identifiant : ni contenu, ni classe, ni clé.
    payload: { [collection]: [{ id: input.objectId }] },
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: input.privateKeyId })
    .setIssuer(input.clientEmail)
    .setAudience('google')
    .setIssuedAt(input.iat ?? Math.floor(Date.now() / 1000))
    .sign(input.key);
}

/** Lien final ; lève s'il dépasse la longueur sûre (jamais un lien tronqué). */
export function saveUrl(jwt: string): string {
  const url = `${SAVE_URL_PREFIX}${jwt}`;
  if (url.length >= SAVE_URL_MAX_LENGTH) throw new Error(`Lien Google Wallet trop long (${url.length} caractères)`);
  return url;
}
