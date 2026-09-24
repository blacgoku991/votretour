import { generateKeyPairSync, randomBytes } from 'node:crypto';
import forge from 'node-forge';
import type { AppleConfigInput } from '../../src/server/wallet/apple/config';

/**
 * AC de TEST, générée à la volée (jamais versionnée, jamais écrite hors du
 * dossier temporaire d'un test) : une fausse « Apple Root CA », un faux
 * WWDR et un certificat feuille qui imite un Pass Type ID
 * (UID=pass.test.rangvia, OU=TESTTEAM01). Elle valide la structure
 * complète (contrôles, manifest, CMS, zip) ; seul un iPhone réel, avec le
 * vrai certificat d'Apple, valide l'acceptation par Wallet (recette).
 *
 * Clés RSA générées par node:crypto (natif, rapide) ; certificats
 * construits et signés par node-forge, comme le ferait une AC.
 */

export const TEST_PASS_TYPE = 'pass.test.rangvia';
export const TEST_TEAM = 'TESTTEAM01';
export const TEST_PASSPHRASE = 'phrase-de-test-0123456789';
export const TEST_SECRET = 'secret-de-test-des-jetons-applepass-0123456789';

type Attr = { shortName?: string; type?: string; value: string };

export interface TestCert {
  certPem: string;
  keyPem: string;
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
}

function rsaPair(): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

let serialCounter = 1;

export function issue(options: {
  subject: Attr[];
  issuer?: TestCert;
  ca?: boolean;
  notBefore?: Date;
  notAfter?: Date;
  key?: { publicPem: string; privatePem: string };
  /** Noms DNS (certificat de serveur TLS de test). */
  dnsNames?: string[];
}): TestCert {
  const pair = options.key ?? rsaPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(pair.publicPem);
  // Premier octet 0x01..0x7f : un INTEGER DER positif, sans zéro de tête
  // superflu (OpenSSL refuse « illegal padding »).
  cert.serialNumber = `${(0x10 + (serialCounter++ % 0x60)).toString(16)}${randomBytes(8).toString('hex')}`;
  cert.validity.notBefore = options.notBefore ?? new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = options.notAfter ?? new Date(Date.now() + 365 * 24 * 3600 * 1000);
  cert.setSubject(options.subject);
  cert.setIssuer(options.issuer ? options.issuer.cert.subject.attributes : options.subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: Boolean(options.ca), critical: Boolean(options.ca) },
    { name: 'keyUsage', digitalSignature: true, keyCertSign: Boolean(options.ca), cRLSign: Boolean(options.ca) },
    { name: 'subjectKeyIdentifier' },
    ...(options.dnsNames ? [{ name: 'subjectAltName', altNames: options.dnsNames.map((value) => ({ type: 2, value })) }] : []),
  ]);
  const key = forge.pki.privateKeyFromPem(pair.privatePem);
  cert.sign(options.issuer ? options.issuer.key : key, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: pair.privatePem, cert, key };
}

export const ROOT_SUBJECT: Attr[] = [
  { shortName: 'CN', value: 'Apple Root CA' },
  { shortName: 'OU', value: 'Apple Certification Authority' },
  { shortName: 'O', value: 'Apple Inc.' },
  { shortName: 'C', value: 'US' },
];

export const WWDR_SUBJECT: Attr[] = [
  { shortName: 'CN', value: 'Apple Worldwide Developer Relations Certification Authority (TEST)' },
  { shortName: 'OU', value: 'G4' },
  { shortName: 'O', value: 'Apple Inc.' },
  { shortName: 'C', value: 'US' },
];

export function passSubject(passTypeId = TEST_PASS_TYPE, team: string | null = TEST_TEAM): Attr[] {
  const subject: Attr[] = [
    { type: '0.9.2342.19200300.100.1.1', value: passTypeId },
    { shortName: 'CN', value: `Pass Type ID: ${passTypeId}` },
  ];
  if (team) subject.push({ shortName: 'OU', value: team });
  subject.push({ shortName: 'O', value: 'Rangvia Test' }, { shortName: 'C', value: 'FR' });
  return subject;
}

export interface TestPki {
  root: TestCert;
  wwdr: TestCert;
  leaf: TestCert;
  /** Clé de la feuille chiffrée (PKCS#8 AES-256), comme la produit le script d'import. */
  encryptedKeyPem: string;
}

export function encrypt(privatePem: string, passphrase = TEST_PASSPHRASE): string {
  return forge.pki.encryptRsaPrivateKey(forge.pki.privateKeyFromPem(privatePem), passphrase, { algorithm: 'aes256' });
}

export function makePki(options: { notAfter?: Date; notBefore?: Date; passTypeId?: string; team?: string | null } = {}): TestPki {
  const root = issue({ subject: ROOT_SUBJECT, ca: true, notAfter: new Date(Date.now() + 20 * 365 * 24 * 3600 * 1000) });
  const wwdr = issue({ subject: WWDR_SUBJECT, issuer: root, ca: true, notAfter: new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000) });
  const leaf = issue({
    subject: passSubject(options.passTypeId, options.team === undefined ? TEST_TEAM : options.team),
    issuer: wwdr,
    notBefore: options.notBefore,
    notAfter: options.notAfter,
  });
  return { root, wwdr, leaf, encryptedKeyPem: encrypt(leaf.keyPem) };
}

export function configInput(pki: TestPki, overrides: Partial<AppleConfigInput> = {}): AppleConfigInput {
  return {
    passTypeId: TEST_PASS_TYPE,
    certPem: pki.leaf.certPem,
    keyPem: pki.encryptedKeyPem,
    keyPassphrase: TEST_PASSPHRASE,
    wwdrPem: pki.wwdr.certPem,
    teamId: null,
    siteUrl: 'https://rangvia.test',
    authSecret: TEST_SECRET,
    production: true,
    unreadable: [],
    ...overrides,
  };
}
