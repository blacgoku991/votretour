import { describe, expect, it } from 'vitest';
import { assertPassFileName, buildManifest, sha1Hex } from '../../src/server/wallet/apple/pkpass';

/**
 * manifest.json : SHA-1 de chaque fichier du pass (imposé par Apple),
 * sauf manifest.json et signature. Mêmes fichiers → mêmes octets : c'est
 * l'empreinte de rendu qui décide s'il faut pousser une mise à jour.
 */

describe('SHA-1', () => {
  it('vecteur connu', () => {
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Hex(Buffer.from('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });
});

describe('manifest', () => {
  const files = new Map<string, Buffer>([
    ['pass.json', Buffer.from('{"formatVersion":1}')],
    ['icon@2x.png', Buffer.from('icône')],
    ['icon.png', Buffer.from('abc')],
  ]);

  it('tous les fichiers, et eux seuls, avec leur SHA-1', () => {
    const manifest = JSON.parse(buildManifest(files).toString('utf8')) as Record<string, string>;
    expect(Object.keys(manifest)).toEqual(['icon.png', 'icon@2x.png', 'pass.json']);
    expect(manifest['icon.png']).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(manifest['pass.json']).toBe(sha1Hex('{"formatVersion":1}'));
    expect(manifest).not.toHaveProperty('manifest.json');
    expect(manifest).not.toHaveProperty('signature');
  });

  it('déterministe, quel que soit l’ordre d’insertion', () => {
    const reversed = new Map([...files].reverse());
    expect(buildManifest(reversed).equals(buildManifest(files))).toBe(true);
  });

  it('refuse manifest.json et signature fournis de l’extérieur', () => {
    expect(() => buildManifest(new Map([['manifest.json', Buffer.from('{}')]]))).toThrow();
    expect(() => buildManifest(new Map([['signature', Buffer.from('x')]]))).toThrow();
  });

  it('refuse fichiers cachés, dossiers et remontées', () => {
    for (const name of ['.DS_Store', 'fr.lproj/pass.strings', '../pass.json', 'a..png', '']) {
      expect(() => assertPassFileName(name)).toThrow();
    }
    for (const name of ['pass.json', 'thumbnail@3x.png', 'strip.png']) {
      expect(() => assertPassFileName(name)).not.toThrow();
    }
  });
});
