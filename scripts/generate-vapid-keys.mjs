#!/usr/bin/env node
/**
 * Génère une paire de clés VAPID pour le Web Push.
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * La clé publique part dans le navigateur (NEXT_PUBLIC_VAPID_PUBLIC_KEY),
 * la clé privée reste strictement côté serveur (VAPID_PRIVATE_KEY).
 *
 * VAPID attend :
 *   - clé publique : point EC P-256 non compressé (0x04 || X || Y), base64url
 *   - clé privée   : le scalaire d sur 32 octets, base64url
 * L'export JWK de Node fournit exactement x, y et d en base64url.
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });

const b64 = (value) => Buffer.from(value, 'base64url');
const publicKey = Buffer.concat([Buffer.from([0x04]), b64(jwk.x), b64(jwk.y)]).toString('base64url');

if (publicKey.length !== 87) {
  console.error('Clé publique de longueur inattendue :', publicKey.length);
  process.exit(1);
}

console.log("\nClés VAPID générées. À copier dans vos variables d'environnement :\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log('VAPID_SUBJECT=mailto:contact@votre-domaine.fr\n');
console.log("La clé privée ne doit jamais être commitée ni préfixée NEXT_PUBLIC_.\n");
