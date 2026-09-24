import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applePassToken, parseApplePassAuthorization, redactApplePass, redactWalletLog, verifyApplePassToken,
} from '../../src/server/wallet/apple/tokens';

/**
 * Jeton ApplePass : dérivé, déterministe, jamais stocké, comparé en temps
 * constant. Apple interdit de le changer une fois le pass installé : la
 * même série doit TOUJOURS redonner le même jeton.
 */

const SECRET = 'secret-de-test-des-jetons-applepass-0123456789';
const SERIAL = 'q7Kx2mP9vLr4Tz8Wn3Hb5c';

describe('dérivation', () => {
  it('base64url(HMAC-SHA256(secret, "wallet-auth:v1:" + série)), 43 caractères', () => {
    const token = applePassToken(SERIAL, SECRET);
    expect(token).toBe(createHmac('sha256', SECRET).update(`wallet-auth:v1:${SERIAL}`).digest('base64url'));
    expect(token).toHaveLength(43);
    expect(token.length).toBeGreaterThanOrEqual(16); // exigence d'Apple
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('déterministe, propre à chaque série et à chaque secret', () => {
    expect(applePassToken(SERIAL, SECRET)).toBe(applePassToken(SERIAL, SECRET));
    expect(applePassToken('Zp4aaaaaaaaaaaaaaaaaaa', SECRET)).not.toBe(applePassToken(SERIAL, SECRET));
    expect(applePassToken(SERIAL, `${SECRET}x`)).not.toBe(applePassToken(SERIAL, SECRET));
  });

  it('refuse un secret vide', () => {
    expect(() => applePassToken(SERIAL, '')).toThrow();
  });
});

describe('vérification', () => {
  const good = `ApplePass ${applePassToken(SERIAL, SECRET)}`;

  it('accepte le bon jeton, quelle que soit la casse du mot-clé', () => {
    expect(verifyApplePassToken(SERIAL, good, SECRET)).toBe(true);
    expect(verifyApplePassToken(SERIAL, good.replace('ApplePass', 'applepass'), SECRET)).toBe(true);
    expect(verifyApplePassToken(SERIAL, `  ${good}  `, SECRET)).toBe(true);
  });

  it('refuse tout le reste, sans lever', () => {
    const cases: (string | null | undefined)[] = [
      null, undefined, '', 'ApplePass', 'ApplePass ', 'Bearer abc',
      `Bearer ${applePassToken(SERIAL, SECRET)}`,
      `ApplePass ${applePassToken(SERIAL, SECRET)}x`,
      `ApplePass ${applePassToken('Zp4aaaaaaaaaaaaaaaaaaa', SECRET)}`,
      `ApplePass ${'a'.repeat(200)}`,
      `ApplePass ${applePassToken(SERIAL, SECRET)} extra`,
    ];
    for (const header of cases) expect(verifyApplePassToken(SERIAL, header, SECRET)).toBe(false);
  });

  it('série mal formée ou secret absent : refus', () => {
    expect(verifyApplePassToken('court', `ApplePass ${applePassToken('court', SECRET)}`, SECRET)).toBe(false);
    expect(verifyApplePassToken(SERIAL, good, null)).toBe(false);
    expect(verifyApplePassToken(SERIAL, good, '')).toBe(false);
  });

  it('analyse stricte de l’en-tête', () => {
    expect(parseApplePassAuthorization('ApplePass abcdefghijklmnop')).toBe('abcdefghijklmnop');
    expect(parseApplePassAuthorization('ApplePass abc')).toBeNull(); // < 16 caractères
    expect(parseApplePassAuthorization('ApplePass abc/def+ghi=jklmnop')).toBeNull(); // pas du base64url
  });
});

describe('journaux', () => {
  it('masque les jetons', () => {
    expect(redactApplePass('Authorization: ApplePass abcdefghijklmnopqrstu refusé')).toBe('Authorization: ApplePass *** refusé');
  });

  it('journal de Wallet : jetons, identifiants d’appareil, séries et jetons push masqués', () => {
    const device = '6b8a2c4e1f0d9a7b3c5e';
    const push = 'ab'.repeat(32);
    const line = `Register task (for device ${device}, pass type pass.fr.rangvia.ticket, serial number ${SERIAL}; `
      + `with web service url https://rangvia.fr/api/wallet/apple/v1/devices/${device}/registrations/pass.fr.rangvia.ticket/${SERIAL}) `
      + `encountered error: Authentication failure (ApplePass ${applePassToken(SERIAL, SECRET)}) push ${push}`;
    const out = redactWalletLog(line);
    for (const secret of [device, SERIAL, push, applePassToken(SERIAL, SECRET)]) expect(out).not.toContain(secret);
    expect(out).toContain('pass.fr.rangvia.ticket');
    expect(out).toContain('encountered error: Authentication failure');
    expect(out).toContain('/devices/***/registrations/pass.fr.rangvia.ticket/***');
  });

  it('journal de Wallet : un message sans identifiant reste intact', () => {
    const plain = 'Web service at https://rangvia.fr/api/wallet/apple returned 503';
    expect(redactWalletLog(plain)).toBe(plain);
  });
});
