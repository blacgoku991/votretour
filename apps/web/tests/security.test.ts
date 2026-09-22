import { describe, it, expect } from 'vitest';
import {
  generateSessionToken, hashSessionToken, hashIp, hashUserAgent,
  endpointFingerprint, constantTimeEquals, generateInviteToken, hashInviteToken,
} from '@/lib/crypto';
import { toAppError, AppError } from '@/lib/errors';

describe('identité client anonyme', () => {
  it('produit des jetons imprévisibles et de longueur suffisante', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      // 32 octets en base64url
      expect(token.length).toBeGreaterThanOrEqual(42);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('hache le jeton de façon déterministe et irréversible', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toBe(hashSessionToken(token));
    expect(hash).toHaveLength(64);
    // Le jeton ne doit jamais apparaître dans son propre condensat.
    expect(hash).not.toContain(token.slice(0, 12));
  });

  it('ne stocke jamais une adresse IP en clair', () => {
    const hash = hashIp('203.0.113.42');
    expect(hash).not.toContain('203');
    expect(hash).toHaveLength(32);
    expect(hashIp(null)).toBeNull();
  });

  it('distingue deux appareils différents', () => {
    expect(hashSessionToken('a')).not.toBe(hashSessionToken('b'));
    expect(hashIp('1.1.1.1')).not.toBe(hashIp('1.1.1.2'));
    expect(hashUserAgent('Safari')).not.toBe(hashUserAgent('Chrome'));
  });

  it('distingue deux destinataires push', () => {
    const a = endpointFingerprint('web_push', 'https://fcm.googleapis.com/aaa');
    const b = endpointFingerprint('web_push', 'https://fcm.googleapis.com/bbb');
    expect(a).not.toBe(b);
    // Le même point d'accès sur deux canaux reste distinct.
    expect(endpointFingerprint('apns_appclip', 'abc')).not.toBe(
      endpointFingerprint('apns_app', 'abc'),
    );
  });

  it('compare les secrets sans fuite de longueur exploitable', () => {
    expect(constantTimeEquals('secret', 'secret')).toBe(true);
    expect(constantTimeEquals('secret', 'secreT')).toBe(false);
    expect(constantTimeEquals('secret', 'court')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });

  it("ne stocke qu'un condensat du jeton d'invitation", () => {
    const { token, hash } = generateInviteToken();
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).not.toContain(token);
  });
});

/**
 * Les erreurs métier viennent de PostgreSQL sous forme de SQLSTATE.
 * L'utilisateur ne doit jamais voir « VT001 » : il doit lire une phrase.
 */
describe('traduction des erreurs métier', () => {
  it('traduit une file fermée', () => {
    const error = toAppError({ code: 'VT001', message: 'La file est fermée' });
    expect(error.code).toBe('queue_closed');
    expect(error.status).toBe(409);
    expect(error.message).toBe('La file est fermée pour le moment.');
  });

  it('traduit un ticket appartenant à un autre appareil', () => {
    const error = toAppError({ code: 'VT009', message: '...' });
    expect(error.code).toBe('session_mismatch');
    expect(error.status).toBe(403);
  });

  it('traduit un professionnel déjà occupé', () => {
    expect(toAppError({ code: 'VT010' }).code).toBe('staff_busy');
  });

  it('traduit une violation d’unicité en conflit, pas en erreur serveur', () => {
    const error = toAppError({ code: '23505', message: 'duplicate key' });
    expect(error.status).toBe(409);
  });

  it('traduit un refus de privilège en accès refusé', () => {
    expect(toAppError({ code: '42501' }).status).toBe(403);
  });

  it('laisse passer une AppError déjà construite', () => {
    const original = new AppError('quota', 'Limite atteinte.', 402);
    expect(toAppError(original)).toBe(original);
  });

  it('retombe sur une erreur serveur générique sans divulguer la pile', () => {
    const error = toAppError(new Error('connexion Postgres perdue'));
    expect(error.status).toBe(500);
    expect(error.code).toBe('internal');
  });
});
