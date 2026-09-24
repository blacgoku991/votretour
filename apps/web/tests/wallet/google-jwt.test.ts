import { describe, expect, it } from 'vitest';
import { decodeJwt, decodeProtectedHeader, generateKeyPair, jwtVerify } from 'jose';
import { SAVE_URL_MAX_LENGTH, SAVE_URL_PREFIX, buildSaveJwt, saveUrl } from '../../src/server/wallet/google/jwt';

/**
 * JWT « savetowallet » LÉGER : il ne référence que l'identifiant d'un
 * objet déjà créé par l'API. Pièges connus verrouillés ici : `typ`
 * exactement « savetowallet », `iat` obligatoire, `aud` = « google ».
 */

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });

const BASE = {
  key: privateKey,
  clientEmail: 'wallet@rangvia-test.iam.gserviceaccount.com',
  privateKeyId: 'kid-0123456789',
  origin: 'https://rangvia.fr',
};
const QUEUE_OBJECT = '3388000000012345678.rangvia_q_9f2c0a1b2c3d4e5f60718293a4b5c6d7';
const EVENT_OBJECT = '3388000000012345678.rangvia_e_00112233445566778899aabbccddeeff';

describe('JWT d’enregistrement', () => {
  it('en-tête RS256 avec kid = private_key_id', async () => {
    const jwt = await buildSaveJwt({ ...BASE, objectType: 'genericObject', objectId: QUEUE_OBJECT });
    expect(decodeProtectedHeader(jwt)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-0123456789' });
  });

  it('charges exactes : iss, aud google, typ savetowallet, iat, origins', async () => {
    const jwt = await buildSaveJwt({ ...BASE, objectType: 'genericObject', objectId: QUEUE_OBJECT, iat: 1_790_000_000 });
    const claims = decodeJwt(jwt);
    expect(claims).toEqual({
      iss: 'wallet@rangvia-test.iam.gserviceaccount.com',
      aud: 'google',
      typ: 'savetowallet',
      iat: 1_790_000_000,
      origins: ['https://rangvia.fr'],
      payload: { genericObjects: [{ id: QUEUE_OBJECT }] },
    });
  });

  it('iat présent et proche de maintenant par défaut', async () => {
    const before = Math.floor(Date.now() / 1000);
    const claims = decodeJwt(await buildSaveJwt({ ...BASE, objectType: 'genericObject', objectId: QUEUE_OBJECT }));
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.iat).toBeLessThanOrEqual(before + 2);
  });

  it('billet de drop : eventTicketObjects, et RIEN d’autre que l’identifiant', async () => {
    const claims = decodeJwt(await buildSaveJwt({ ...BASE, objectType: 'eventTicketObject', objectId: EVENT_OBJECT }));
    expect(claims.payload).toEqual({ eventTicketObjects: [{ id: EVENT_OBJECT }] });
    const text = JSON.stringify(claims);
    // Ni contenu, ni classe, ni clé TOTP, ni QR : un lien qui fuite ne dit rien.
    for (const forbidden of ['classId', 'rotatingBarcode', 'barcode', 'totp', 'header', 'textModulesData', 'state']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('signature vérifiable avec la clé publique', async () => {
    const jwt = await buildSaveJwt({ ...BASE, objectType: 'genericObject', objectId: QUEUE_OBJECT });
    const { payload } = await jwtVerify(jwt, publicKey, { audience: 'google', issuer: BASE.clientEmail });
    expect(payload.typ).toBe('savetowallet');
  });

  it('lien pay.google.com sous 1 800 caractères', async () => {
    const url = saveUrl(await buildSaveJwt({ ...BASE, objectType: 'eventTicketObject', objectId: EVENT_OBJECT }));
    expect(url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);
    expect(url.startsWith(SAVE_URL_PREFIX)).toBe(true);
    expect(url.length).toBeLessThan(1800);
    expect(SAVE_URL_MAX_LENGTH).toBe(1800);
  });

  it('identifiant d’objet non conforme : refusé', async () => {
    for (const objectId of ['rangvia_q_abc', '3388.', '3388.a b', '3388.a/../b', 'x.3388']) {
      await expect(buildSaveJwt({ ...BASE, objectType: 'genericObject', objectId })).rejects.toThrow(/Identifiant/);
    }
  });

  it('origine : https://hôte seulement', async () => {
    for (const origin of ['http://rangvia.fr', 'https://rangvia.fr/', 'https://rangvia.fr/e']) {
      await expect(buildSaveJwt({ ...BASE, origin, objectType: 'genericObject', objectId: QUEUE_OBJECT })).rejects.toThrow(/Origine/);
    }
  });

  it('lien trop long : refusé plutôt que tronqué', () => {
    expect(() => saveUrl('x'.repeat(1800))).toThrow(/trop long/);
  });
});
