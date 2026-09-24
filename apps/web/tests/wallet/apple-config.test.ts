import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkAppleConfig, evaluateAppleConfig, parseAppleConfig, parseAppleConfigCached, resetAppleConfigCache,
} from '../../src/server/wallet/apple/config';
import { appleProvider, appleStatus } from '../../src/server/wallet/apple/provider';
import {
  ROOT_SUBJECT, TEST_PASS_TYPE, TEST_TEAM, WWDR_SUBJECT, configInput, encrypt, issue, makePki, passSubject, type TestPki,
} from './apple-fixtures';

/**
 * Contrôles de configuration Apple Wallet : chaque pièce manquante ou
 * incohérente rend le fournisseur « non prêt », avec la bonne raison.
 * Un pass mal signé échouerait en silence sur l'iPhone du client : c'est
 * ici qu'on le refuse, et la raison n'apparaît que chez le super-admin.
 */

const NOW = new Date();
let pki: TestPki;

beforeAll(() => {
  pki = makePki();
});

describe('configuration complète et cohérente', () => {
  it('est prête, avec les détails de la carte super-admin', () => {
    const check = checkAppleConfig(configInput(pki), NOW);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.config.passTypeId).toBe(TEST_PASS_TYPE);
    expect(check.config.teamId).toBe(TEST_TEAM);
    expect(check.config.webServiceUrl).toBe('https://rangvia.test/api/wallet/apple');
    expect(check.details.certExpiresAt).toBe(pki.leaf.cert.validity.notAfter.toISOString().replace(/\.\d{3}Z$/, '.000Z'));
    expect(typeof check.details.certExpiresAt).toBe('string');
    expect(new Date(check.details.certExpiresAt as string).toISOString()).toBe(check.details.certExpiresAt);
    expect(check.details).toMatchObject({ passTypeId: TEST_PASS_TYPE, teamId: TEST_TEAM, expiresSoon: false });
    expect(check.details.daysLeft).toBeGreaterThan(300);
    // Aucun secret dans les détails affichés.
    const shown = JSON.stringify(check.details);
    expect(shown).not.toContain('PRIVATE');
    expect(shown).not.toContain('secret-de-test');
  });

  it('accepte une clé non chiffrée et la surcharge Team ID identique', () => {
    const check = checkAppleConfig(configInput(pki, { keyPem: pki.leaf.keyPem, keyPassphrase: null, teamId: TEST_TEAM }), NOW);
    expect(check.ok).toBe(true);
  });

  it('garde la clé déchiffrée en mémoire pour TLS (jamais la phrase de passe)', () => {
    const check = checkAppleConfig(configInput(pki), NOW);
    if (!check.ok) throw new Error(check.reason);
    expect(check.config.tls.key).toContain('BEGIN PRIVATE KEY');
    expect(check.config.tls.key).not.toContain('ENCRYPTED');
  });
});

describe('chaque défaut rend le fournisseur non prêt, avec la bonne raison', () => {
  const cases: [string, () => Parameters<typeof checkAppleConfig>[0], string, RegExp][] = [
    ['rien de configuré', () => configInput(pki, { passTypeId: null, certPem: null, keyPem: null, wwdrPem: null }), 'missing', /Non configuré/],
    ['certificat absent', () => configInput(pki, { certPem: null }), 'missing', /APPLE_WALLET_CERT_PEM/],
    ['WWDR absent', () => configInput(pki, { wwdrPem: null }), 'missing', /APPLE_WALLET_WWDR_PEM/],
    ['variable illisible', () => configInput(pki, { certPem: null, unreadable: ['APPLE_WALLET_CERT_PEM'] }), 'unreadable', /Illisible.*CERT/],
    ['identifiant mal formé', () => configInput(pki, { passTypeId: 'com.rangvia.ticket' }), 'pass_type_id', /pass\./],
    ['secret absent', () => configInput(pki, { authSecret: null }), 'secret', /WALLET_AUTH_SECRET/],
    ['secret trop court', () => configInput(pki, { authSecret: 'court' }), 'secret', /trop court/],
    ['site en clair en production', () => configInput(pki, { siteUrl: 'http://rangvia.test' }), 'site', /HTTPS/],
    ['site en clair hors boucle locale', () => configInput(pki, { siteUrl: 'http://rangvia.test', production: false }), 'site', /HTTPS/],
    ['UID différent', () => configInput(pki, { passTypeId: 'pass.autre.rangvia' }), 'uid', /pass\.test\.rangvia.*pass\.autre\.rangvia/],
    ['Team ID surchargé différent', () => configInput(pki, { teamId: 'AUTRETEAM9' }), 'team', /OU=TESTTEAM01/],
    ['phrase de passe absente', () => configInput(pki, { keyPassphrase: null }), 'key_passphrase', /PASSPHRASE est vide/],
    ['phrase de passe fausse', () => configInput(pki, { keyPassphrase: 'mauvaise' }), 'key_passphrase', /incorrecte/],
    ['clé illisible', () => configInput(pki, { keyPem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----' }), 'key', /illisible/],
    ['certificat illisible', () => configInput(pki, { certPem: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----' }), 'cert', /illisible/],
  ];

  for (const [name, input, issue, reason] of cases) {
    it(name, () => {
      const check = checkAppleConfig(input(), NOW);
      expect(check.ok).toBe(false);
      if (check.ok) return;
      expect(check.issue).toBe(issue);
      expect(check.reason).toMatch(reason);
    });
  }

  it('clé d’un autre certificat', () => {
    const other = makePki();
    const check = checkAppleConfig(configInput(pki, { keyPem: other.encryptedKeyPem }), NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue).toBe('key_mismatch');
  });

  it('clé qui n’est pas RSA', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const check = checkAppleConfig(configInput(pki, { keyPem: ec, keyPassphrase: null }), NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue).toBe('key_not_rsa');
  });

  it('certificat sans OU (pas un certificat Pass Type ID)', () => {
    const noTeam = makePki({ team: null });
    const check = checkAppleConfig(configInput(noTeam), NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue).toBe('team');
  });

  it('certificat émis par un autre WWDR', () => {
    const other = makePki();
    const check = checkAppleConfig(configInput(pki, { wwdrPem: other.wwdr.certPem }), NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issue).toBe('chain');
      expect(check.reason).toMatch(/intermédiaire incohérent/);
    }
  });

  it('WWDR qui n’est pas une autorité', () => {
    const check = checkAppleConfig(configInput(pki, { wwdrPem: pki.leaf.certPem }), NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue).toBe('wwdr');
  });

  it('WWDR qui n’est pas émis par Apple Root CA', () => {
    const fakeRoot = issue({ subject: [{ shortName: 'CN', value: 'Autre Root CA' }, { shortName: 'O', value: 'Ailleurs' }], ca: true });
    const wwdr = issue({ subject: WWDR_SUBJECT, issuer: fakeRoot, ca: true });
    const leaf = issue({ subject: passSubject(), issuer: wwdr });
    const check = checkAppleConfig(configInput(pki, { certPem: leaf.certPem, keyPem: encrypt(leaf.keyPem), wwdrPem: wwdr.certPem }), NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue).toBe('wwdr_root');
  });

  it('certificat expiré : non prêt, échéance toujours visible', () => {
    const expired = makePki({ notBefore: new Date(Date.now() - 400 * 86400_000), notAfter: new Date(Date.now() - 86400_000) });
    const check = checkAppleConfig(configInput(expired), NOW);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.issue).toBe('cert_expired');
    expect(check.reason).toMatch(/expiré le \d{4}-\d{2}-\d{2}/);
    // Échéance à la seconde (X.509 ne porte pas de millisecondes).
    expect(check.details.certExpiresAt).toBe(expired.leaf.cert.validity.notAfter.toISOString().replace(/\.\d{3}Z$/, '.000Z'));
    expect(check.details.expiresSoon).toBe(true);
  });

  it('certificat pas encore valide', () => {
    const future = makePki({ notBefore: new Date(Date.now() + 86400_000), notAfter: new Date(Date.now() + 400 * 86400_000) });
    const check = checkAppleConfig(configInput(future), NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue).toBe('cert_not_yet_valid');
  });

  it('alerte à J-30 sans bloquer', () => {
    const soon = makePki({ notAfter: new Date(Date.now() + 10 * 86400_000) });
    const check = checkAppleConfig(configInput(soon), NOW);
    expect(check.ok).toBe(true);
    expect(check.details.expiresSoon).toBe(true);
    expect(check.details.daysLeft).toBeLessThanOrEqual(10);
  });

  it('WWDR expiré', () => {
    const parsed = parseAppleConfig(configInput(pki));
    const later = new Date(Date.now() + 6 * 365 * 86400_000);
    // Le certificat feuille expire avant : on vérifie l'ordre des contrôles
    // sur une configuration dont seul le WWDR a expiré.
    if (!parsed.ok) throw new Error(parsed.reason);
    const onlyWwdr = { ok: true as const, config: { ...parsed.config, certNotAfter: new Date(later.getTime() + 86400_000) } };
    const check = evaluateAppleConfig(onlyWwdr, later);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue).toBe('wwdr_expired');
  });
});

describe('développement local', () => {
  it('HTTP accepté seulement en boucle locale hors production (réglage développeur d’iOS)', () => {
    expect(checkAppleConfig(configInput(pki, { siteUrl: 'http://127.0.0.1:3145', production: false }), NOW).ok).toBe(true);
    expect(checkAppleConfig(configInput(pki, { siteUrl: 'http://localhost:3000', production: true }), NOW).ok).toBe(false);
  });
});

describe('mémorisation', () => {
  it('relit si une variable change', () => {
    resetAppleConfigCache();
    const a = parseAppleConfigCached(configInput(pki));
    expect(parseAppleConfigCached(configInput(pki))).toBe(a);
    const b = parseAppleConfigCached(configInput(pki, { passTypeId: 'pass.autre.rangvia' }));
    expect(b).not.toBe(a);
    expect(b.ok).toBe(false);
  });
});

describe('sans configuration (cas actuel du propriétaire)', () => {
  it('le fournisseur n’est pas prêt et dit pourquoi', async () => {
    const status = await appleStatus();
    expect(status.ready).toBe(false);
    expect(status.reason).toMatch(/Non configuré/);
    expect((await appleProvider.status()).ready).toBe(false);
  });

  it('les routes du service web répondent 404, et rien d’autre', async () => {
    const register = await import('../../src/app/api/wallet/apple/v1/devices/[deviceId]/registrations/[passTypeId]/[serial]/route');
    const list = await import('../../src/app/api/wallet/apple/v1/devices/[deviceId]/registrations/[passTypeId]/route');
    const pass = await import('../../src/app/api/wallet/apple/v1/passes/[passTypeId]/[serial]/route');
    const log = await import('../../src/app/api/wallet/apple/v1/log/route');
    const base = 'https://votretour.test/api/wallet/apple/v1';
    const serial = 'q7Kx2mP9vLr4Tz8Wn3Hb5c';
    const params = { deviceId: 'device-0001', passTypeId: 'pass.fr.rangvia.ticket', serial };
    const responses = await Promise.all([
      register.POST(new Request(`${base}/devices/x/registrations/y/z`, { method: 'POST', body: '{"pushToken":"ab"}' }), { params: Promise.resolve(params) }),
      register.DELETE(new Request(`${base}/devices/x/registrations/y/z`, { method: 'DELETE' }), { params: Promise.resolve(params) }),
      list.GET(new Request(`${base}/devices/x/registrations/y`), { params: Promise.resolve(params) }),
      pass.GET(new Request(`${base}/passes/y/z`), { params: Promise.resolve(params) }),
      log.POST(new Request(`${base}/log`, { method: 'POST', body: '{"logs":["x"]}' })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
  });

  it('la sous-racine de la fausse AC a bien le nom attendu (garde-fou du test)', () => {
    expect(ROOT_SUBJECT[0]?.value).toBe('Apple Root CA');
  });
});
