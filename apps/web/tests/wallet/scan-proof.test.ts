import { describe, expect, it } from 'vitest';
import {
  signWalletQrCode, totp, verifyWalletProof, walletQrUrl, walletTotpKey, walletTotpPattern,
} from '../../src/lib/wallet/scan-proof';

/** Preuves de QR des billets Wallet : RFC 6238, fenêtre, liaison au pass. */

const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');
const TOKEN = 'f'.repeat(64);
const PASS_A = '7b0f3c1e-2a44-4c1b-9d0e-5f6a7b8c9d01';
const PASS_B = '8c1f4d2f-3b55-4d2c-8e1f-6a7b8c9d0e12';

describe('TOTP (RFC 6238, SHA-1, 8 chiffres)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [1111111111, '14050471'],
    [2000000000, '69279037'],
  ])('T = %i → %s', (seconds, expected) => {
    expect(totp(RFC_KEY, Math.floor(seconds / 30))).toBe(expected);
  });

  it('clé en hexadécimal équivalente à la clé brute', () => {
    expect(totp(RFC_KEY.toString('hex'), 1)).toBe('94287082');
  });
});

describe('dérivations', () => {
  it('code statique : 32 caractères, lié à l’accès ET au pass', () => {
    const code = signWalletQrCode(TOKEN, PASS_A);
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(signWalletQrCode(TOKEN, PASS_A)).toBe(code);
    expect(signWalletQrCode(TOKEN, PASS_B)).not.toBe(code);
    expect(signWalletQrCode('e'.repeat(64), PASS_A)).not.toBe(code);
  });

  it('clé TOTP : 20 octets, propre à chaque pass', () => {
    expect(walletTotpKey(TOKEN, PASS_A)).toMatch(/^[0-9a-f]{40}$/);
    expect(walletTotpKey(TOKEN, PASS_A)).not.toBe(walletTotpKey(TOKEN, PASS_B));
  });

  it('URL du QR et modèle Google', () => {
    expect(walletQrUrl('https://rangvia.fr/', 'Kp3Access01', 'abc')).toBe('https://rangvia.fr/scan/Kp3Access01?w=abc');
    expect(walletTotpPattern('https://rangvia.fr', 'Kp3Access01'))
      .toBe('https://rangvia.fr/scan/Kp3Access01?t={totp_timestamp_seconds}&otp={totp_value_0}');
  });
});

describe('verifyWalletProof', () => {
  const now = new Date('2026-09-24T12:30:00Z');
  const nowS = Math.floor(now.getTime() / 1000);
  const otpAt = (passId: string, t: number) => totp(walletTotpKey(TOKEN, passId), Math.floor(t / 30));

  it('code statique du bon pass accepté, d’un autre pass ou d’un autre accès refusé', () => {
    const w = signWalletQrCode(TOKEN, PASS_B);
    expect(verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [PASS_A, PASS_B], proof: { kind: 'wallet', w } })).toBe(PASS_B);
    expect(verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [PASS_A], proof: { kind: 'wallet', w } })).toBeNull();
    // Nouvelle vague = nouveau token_hash : l'ancien code ne vaut plus rien.
    expect(verifyWalletProof({ tokenHash: 'e'.repeat(64), walletPassIds: [PASS_B], proof: { kind: 'wallet', w } })).toBeNull();
    // Pass effacé ou révoqué : l'appelant ne le transmet plus.
    expect(verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [], proof: { kind: 'wallet', w } })).toBeNull();
    expect(verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [PASS_B], proof: { kind: 'wallet', w: `${w.slice(0, 31)}x` } })).toBeNull();
    expect(verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [PASS_B], proof: { kind: 'wallet', w: 'court' } })).toBeNull();
  });

  it('TOTP : fenêtre −90 s / +30 s', () => {
    const ok = (t: number) =>
      verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [PASS_A], proof: { kind: 'totp', t, otp: otpAt(PASS_A, t) }, now });
    expect(ok(nowS)).toBe(PASS_A);
    expect(ok(nowS - 90)).toBe(PASS_A);
    expect(ok(nowS - 91)).toBeNull();
    expect(ok(nowS + 30)).toBe(PASS_A);
    expect(ok(nowS + 31)).toBeNull();
  });

  it('TOTP : code d’un autre pass, ou horodatage retouché, refusé', () => {
    const t = nowS - 10;
    expect(verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [PASS_A], proof: { kind: 'totp', t, otp: otpAt(PASS_B, t) }, now })).toBeNull();
    expect(verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [PASS_A], proof: { kind: 'totp', t: t - 60, otp: otpAt(PASS_A, t) }, now })).toBeNull();
    expect(verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [PASS_A], proof: { kind: 'totp', t, otp: '1234' }, now })).toBeNull();
  });

  it('secret différent : plus rien ne passe (rotation de SESSION_HASH_SECRET)', () => {
    const w = signWalletQrCode(TOKEN, PASS_A);
    expect(verifyWalletProof({ tokenHash: TOKEN, walletPassIds: [PASS_A], proof: { kind: 'wallet', w }, secret: 'autre-secret' })).toBeNull();
  });
});
