import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash, verify } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signManifest } from '../../src/server/wallet/apple/signature';
import { makePki, type TestPki } from './apple-fixtures';

/**
 * Signature CMS détachée du manifest, vérifiée SANS node-forge : analyse
 * ASN.1 champ par champ, signature RSA recalculée avec node:crypto, puis
 * OpenSSL (smime et cms) quand le binaire est là. forge ne sert qu'à
 * fabriquer ; il ne juge jamais son propre travail.
 */

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  data: '1.2.840.113549.1.7.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha1: '1.3.14.3.2.26',
};

const work = mkdtempSync(path.join(tmpdir(), 'rangvia-cms-'));
let pki: TestPki;
const manifest = Buffer.from(JSON.stringify({ 'pass.json': 'a9993e364706816aba3e25717850c26c9cd0d89d', 'icon.png': 'da39a3ee5e6b4b0d3255bfef95601890afd80709' }));
const signingTime = new Date('2026-09-24T12:05:07Z');

beforeAll(() => {
  pki = makePki();
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

const signerOf = () => ({ certificate: pki.leaf.cert, privateKey: pki.leaf.key, wwdr: pki.wwdr.cert });

type Node = forge.asn1.Asn1;
const kids = (node: Node): Node[] => node.value as Node[];
const oidOf = (node: Node): string => forge.asn1.derToOid(node.value as string);

function parse(der: Buffer) {
  const root = forge.asn1.fromDer(der.toString('binary'));
  const [contentType, wrapper] = kids(root);
  const signedData = kids(wrapper!)[0]!;
  const parts = kids(signedData);
  const encap = parts[2]!;
  const certificates = parts.find((p) => p.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && p.type === 0)!;
  const signerInfos = parts[parts.length - 1]!;
  const signer = kids(kids(signerInfos)[0]!);
  const attributes = signer.find((p) => p.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && p.type === 0)!;
  return { root, contentType, signedData, parts, encap, certificates, signer, attributes };
}

function attributeMap(attributes: Node): Map<string, Node> {
  const map = new Map<string, Node>();
  for (const attribute of kids(attributes)) {
    const [type, values] = kids(attribute);
    map.set(oidOf(type!), kids(values!)[0]!);
  }
  return map;
}

function which(binary: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => existsSync(path.join(dir, binary)));
}

describe('structure CMS', () => {
  it('SignedData détaché : pas d’eContent, deux certificats (feuille + WWDR)', () => {
    const der = signManifest(manifest, signerOf(), { signingTime });
    const { contentType, encap, certificates } = parse(der);
    expect(oidOf(contentType!)).toBe(OID.signedData);
    // encapContentInfo = { eContentType } seul : le manifest est à côté, dans l'archive.
    expect(kids(encap)).toHaveLength(1);
    expect(oidOf(kids(encap)[0]!)).toBe(OID.data);
    expect(kids(certificates)).toHaveLength(2);
    const embedded = kids(certificates).map((c) => forge.pki.certificateFromAsn1(c));
    const fingerprints = embedded.map((c) => forge.pki.certificateToPem(c));
    expect(fingerprints).toContain(forge.pki.certificateToPem(pki.leaf.cert));
    expect(fingerprints).toContain(forge.pki.certificateToPem(pki.wwdr.cert));
  });

  it('signataire = certificat Pass Type ID (émetteur et numéro de série)', () => {
    const { signer } = parse(signManifest(manifest, signerOf(), { signingTime }));
    const [issuer, serial] = kids(signer[1]!);
    const x509 = new X509Certificate(pki.leaf.certPem);
    expect(Buffer.from(forge.asn1.toDer(issuer!).getBytes(), 'binary').toString('hex'))
      .toBe(Buffer.from(forge.asn1.toDer(forge.pki.distinguishedNameToAsn1(pki.wwdr.cert.subject)).getBytes(), 'binary').toString('hex'));
    expect(Buffer.from(serial!.value as string, 'binary').toString('hex').toUpperCase().replace(/^0+/, ''))
      .toBe(x509.serialNumber.toUpperCase().replace(/^0+/, ''));
  });

  it('attributs : contentType = data, messageDigest = SHA-256 du manifest, signingTime', () => {
    const { attributes, signer } = parse(signManifest(manifest, signerOf(), { signingTime }));
    const map = attributeMap(attributes);
    expect(oidOf(map.get(OID.contentType)!)).toBe(OID.data);
    expect(Buffer.from(map.get(OID.messageDigest)!.value as string, 'binary').equals(createHash('sha256').update(manifest).digest())).toBe(true);
    expect(forge.asn1.utcTimeToDate(map.get(OID.signingTime)!.value as string).toISOString()).toBe(signingTime.toISOString());
    expect(oidOf(kids(signer[2]!)[0]!)).toBe(OID.sha256);
  });

  it('signature RSA vérifiée par node:crypto sur le DER des attributs retagué en SET', () => {
    const { attributes, signer } = parse(signManifest(manifest, signerOf(), { signingTime }));
    const der = Buffer.from(forge.asn1.toDer(attributes).getBytes(), 'binary');
    der[0] = 0x31; // [0] IMPLICIT → SET OF, comme le prévoit la RFC 5652 pour la signature
    const signature = Buffer.from(signer[signer.length - 1]!.value as string, 'binary');
    expect(verify('sha256', der, pki.leaf.certPem, signature)).toBe(true);
    const tampered = Buffer.from(der);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 1, tampered.length - 1);
    expect(verify('sha256', tampered, pki.leaf.certPem, signature)).toBe(false);
  });

  it('un autre manifest donne un autre condensat', () => {
    const a = attributeMap(parse(signManifest(manifest, signerOf(), { signingTime })).attributes).get(OID.messageDigest)!;
    const b = attributeMap(parse(signManifest(Buffer.from('{}'), signerOf(), { signingTime })).attributes).get(OID.messageDigest)!;
    expect(a.value).not.toBe(b.value);
  });

  it('repli SHA-1 par constante (si la recette l’exigeait)', () => {
    const { attributes, signer } = parse(signManifest(manifest, signerOf(), { signingTime, digest: 'sha1' }));
    expect(oidOf(kids(signer[2]!)[0]!)).toBe(OID.sha1);
    expect(Buffer.from(attributeMap(attributes).get(OID.messageDigest)!.value as string, 'binary')
      .equals(createHash('sha1').update(manifest).digest())).toBe(true);
  });
});

describe.skipIf(!which('openssl'))('OpenSSL', () => {
  function files(der: Buffer, content: Buffer = manifest) {
    const dir = mkdtempSync(path.join(work, 'case-'));
    const paths = {
      signature: path.join(dir, 'signature'),
      manifest: path.join(dir, 'manifest.json'),
      root: path.join(dir, 'root.pem'),
      out: path.join(dir, 'out'),
    };
    writeFileSync(paths.signature, der);
    writeFileSync(paths.manifest, content);
    writeFileSync(paths.root, pki.root.certPem);
    return paths;
  }

  it('smime -verify -noverify : signature valide sur le manifest', () => {
    const p = files(signManifest(manifest, signerOf(), { signingTime }));
    execFileSync('openssl', ['smime', '-verify', '-inform', 'DER', '-in', p.signature, '-content', p.manifest, '-binary', '-noverify', '-out', p.out], { stdio: 'pipe' });
  });

  it('cms -verify : chaîne complète jusqu’à la racine de test (WWDR tiré de la signature)', () => {
    const p = files(signManifest(manifest, signerOf(), { signingTime }));
    execFileSync('openssl', ['cms', '-verify', '-inform', 'DER', '-in', p.signature, '-content', p.manifest, '-binary', '-CAfile', p.root, '-purpose', 'any', '-out', p.out], { stdio: 'pipe' });
  });

  it('manifest altéré : OpenSSL refuse', () => {
    const p = files(signManifest(manifest, signerOf(), { signingTime }), Buffer.from(`${manifest.toString()} `));
    expect(() => execFileSync('openssl', ['smime', '-verify', '-inform', 'DER', '-in', p.signature, '-content', p.manifest, '-binary', '-noverify', '-out', p.out], { stdio: 'pipe' })).toThrow();
  });
});
