import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { APPLE_ROOT_CA_SHA256, appleRootCa } from '../../src/server/wallet/apple/apple-root';
import {
  checkAppleConfig, evaluateAppleConfig, parseAppleConfig, parseAppleConfigCached, resetAppleConfigCache,
} from '../../src/server/wallet/apple/config';
import { appleProvider, appleStatus, appleStatusOf } from '../../src/server/wallet/apple/provider';
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
    expect(check.details).toMatchObject({ passTypeId: TEST_PASS_TYPE, teamId: TEST_TEAM, expiresSoon: false, chain: 'apple' });
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

/* ====================================================================
   Racine épinglée : un NOM ne prouve rien
   ==================================================================== */

/**
 * WWDR G4 d'Apple, certificat PUBLIC (https://www.apple.com/certificateauthority/,
 * AppleWWDRCAG4.cer, empreinte SHA-256 EA:47:57:88:…:E1:4C) : la vraie
 * chaîne, vérifiée contre la racine embarquée.
 */
const APPLE_WWDR_G4 = `-----BEGIN CERTIFICATE-----
MIIEVTCCAz2gAwIBAgIUE9x3lVJx5T3GMujM/+Uh88zFztIwDQYJKoZIhvcNAQEL
BQAwYjELMAkGA1UEBhMCVVMxEzARBgNVBAoTCkFwcGxlIEluYy4xJjAkBgNVBAsT
HUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRYwFAYDVQQDEw1BcHBsZSBS
b290IENBMB4XDTIwMTIxNjE5MzYwNFoXDTMwMTIxMDAwMDAwMFowdTFEMEIGA1UE
Aww7QXBwbGUgV29ybGR3aWRlIERldmVsb3BlciBSZWxhdGlvbnMgQ2VydGlmaWNh
dGlvbiBBdXRob3JpdHkxCzAJBgNVBAsMAkc0MRMwEQYDVQQKDApBcHBsZSBJbmMu
MQswCQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBANAf
eKp6JzKwRl/nF3bYoJ0OKY6tPTKlxGs3yeRBkWq3eXFdDDQEYHX3rkOPR8SGHgjo
v9Y5Ui8eZ/xx8YJtPH4GUnadLLzVQ+mxtLxAOnhRXVGhJeG+bJGdayFZGEHVD41t
QSo5SiHgkJ9OE0/QjJoyuNdqkh4laqQyziIZhQVg3AJK8lrrd3kCfcCXVGySjnYB
5kaP5eYq+6KwrRitbTOFOCOL6oqW7Z+uZk+jDEAnbZXQYojZQykn/e2kv1MukBVl
PNkuYmQzHWxq3Y4hqqRfFcYw7V/mjDaSlLfcOQIA+2SM1AyB8j/VNJeHdSbCb64D
YyEMe9QbsWLFApy9/a8CAwEAAaOB7zCB7DASBgNVHRMBAf8ECDAGAQH/AgEAMB8G
A1UdIwQYMBaAFCvQaUeUdgn+9GuNLkCm90dNfwheMEQGCCsGAQUFBwEBBDgwNjA0
BggrBgEFBQcwAYYoaHR0cDovL29jc3AuYXBwbGUuY29tL29jc3AwMy1hcHBsZXJv
b3RjYTAuBgNVHR8EJzAlMCOgIaAfhh1odHRwOi8vY3JsLmFwcGxlLmNvbS9yb290
LmNybDAdBgNVHQ4EFgQUW9n6HeeaGgujmXYiUIY+kchbd6gwDgYDVR0PAQH/BAQD
AgEGMBAGCiqGSIb3Y2QGAgEEAgUAMA0GCSqGSIb3DQEBCwUAA4IBAQA/Vj2e5bbD
eeZFIGi9v3OLLBKeAuOugCKMBB7DUshwgKj7zqew1UJEggOCTwb8O0kU+9h0UoWv
p50h5wESA5/NQFjQAde/MoMrU1goPO6cn1R2PWQnxn6NHThNLa6B5rmluJyJlPef
x4elUWY0GzlxOSTjh2fvpbFoe4zuPfeutnvi0v/fYcZqdUmVIkSoBPyUuAsuORFJ
EtHlgepZAE9bPFo22noicwkJac3AfOriJP6YRLj477JxPxpd1F1+M02cHSS+APCQ
A1iZQT0xWmJArzmoUUOSqwSonMJNsUvSq3xKX+udO7xPiEAGE/+QF4oIRynoYpgp
pU8RBWk6z/Kf
-----END CERTIFICATE-----
`;

describe('racine Apple Root CA épinglée', () => {
  it('la racine embarquée a l’empreinte publiée par Apple', () => {
    const root = appleRootCa();
    expect(root.fingerprint256).toBe(APPLE_ROOT_CA_SHA256);
    expect(root.subject).toContain('CN=Apple Root CA');
    expect(root.ca).toBe(true);
  });

  it('le vrai WWDR G4 est signé par elle', () => {
    const g4 = new X509Certificate(APPLE_WWDR_G4);
    expect(g4.fingerprint256.startsWith('EA:47:57:88')).toBe(true);
    expect(g4.checkIssued(appleRootCa())).toBe(true);
    expect(g4.verify(appleRootCa().publicKey)).toBe(true);
  });

  it('production : une fausse « Apple Root CA » (même nom, même organisation) est refusée', () => {
    // Chaîne de test SANS ancre déclarée : exactement ce que verrait un
    // serveur de production à qui l'on donnerait les certificats de test.
    const check = checkAppleConfig(configInput(pki, { trustAnchorPem: null, production: true }), NOW);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.issue).toBe('wwdr_root');
    expect(check.reason).toMatch(/pas signé par la vraie racine d’Apple/);
    expect(appleStatusOf(check).ready).toBe(false);
  });

  it('hors production : acceptée pour le banc local, marquée « test »', () => {
    const check = checkAppleConfig(configInput(pki, { trustAnchorPem: null, production: false }), NOW);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.config.chain).toBe('test');
    expect(check.details.chain).toBe('test');
  });

  it('hors production : une racine qui ne se dit même pas Apple reste refusée', () => {
    const fakeRoot = issue({ subject: [{ shortName: 'CN', value: 'Autre Root CA' }, { shortName: 'O', value: 'Ailleurs' }], ca: true });
    const wwdr = issue({ subject: WWDR_SUBJECT, issuer: fakeRoot, ca: true });
    const leaf = issue({ subject: passSubject(), issuer: wwdr });
    const check = checkAppleConfig(configInput(pki, {
      certPem: leaf.certPem, keyPem: encrypt(leaf.keyPem), wwdrPem: wwdr.certPem, trustAnchorPem: null, production: false,
    }), NOW);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue).toBe('wwdr_root');
  });

  const hasOpenssl = (process.env.PATH ?? '').split(path.delimiter).some((d) => existsSync(path.join(d, 'openssl')));
  it.skipIf(!hasOpenssl)('les certificats de scripts/wallet-dev-certs.sh : refusés en production, « test » sur le banc', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rangvia-devcerts-'));
    try {
      const script = path.resolve(__dirname, '../../../../scripts/wallet-dev-certs.sh');
      execFileSync('sh', [script, path.join(dir, 'out')], { stdio: 'pipe', timeout: 60_000 });
      const vars = Object.fromEntries(readFileSync(path.join(dir, 'out', 'wallet-dev.env'), 'utf8').split('\n')
        .filter((line) => line.startsWith('APPLE_WALLET_'))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
      const pem = (name: string) => Buffer.from(vars[name] ?? '', 'base64').toString('utf8');
      const input = {
        passTypeId: vars.APPLE_WALLET_PASS_TYPE_ID ?? null,
        certPem: pem('APPLE_WALLET_CERT_PEM'),
        keyPem: pem('APPLE_WALLET_KEY_PEM'),
        keyPassphrase: vars.APPLE_WALLET_KEY_PASSPHRASE ?? null,
        wwdrPem: pem('APPLE_WALLET_WWDR_PEM'),
        teamId: null,
        siteUrl: 'https://rangvia.fr',
        authSecret: 'z'.repeat(40),
      };
      // Certificats tout juste émis : l'heure d'APRÈS leur création.
      const now = new Date();
      const prod = checkAppleConfig({ ...input, production: true }, now);
      expect(prod.ok).toBe(false);
      if (!prod.ok) expect(prod.issue).toBe('wwdr_root');
      const bench = checkAppleConfig({ ...input, production: false }, now);
      expect(bench.ok ? 'ok' : `${bench.issue} ${bench.reason}`).toBe('ok');
      expect(bench.details.chain).toBe('test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});

describe('statut du fournisseur, configuration valide', () => {
  it('prêt, signature d’essai réussie, détails de la carte', () => {
    const status = appleStatusOf(checkAppleConfig(configInput(pki), NOW));
    expect(status).toMatchObject({ ready: true, reason: null });
    expect(status.details).toMatchObject({ passTypeId: TEST_PASS_TYPE, chain: 'apple' });
    expect(typeof status.details?.certExpiresAt).toBe('string');
  });

  it('certificat expiré : non prêt, raison et échéance', () => {
    const expired = makePki({ notBefore: new Date(Date.now() - 400 * 86400_000), notAfter: new Date(Date.now() - 86400_000) });
    const status = appleStatusOf(checkAppleConfig(configInput(expired), NOW));
    expect(status.ready).toBe(false);
    expect(status.reason).toMatch(/expiré/);
    expect(status.details?.certExpiresAt).toBeTruthy();
  });
});
