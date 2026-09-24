import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { packPkpass, readZip, zipStored } from '../../src/server/wallet/apple/pkpass';

/**
 * Archive zip « stockée » écrite à la main : relue par notre lecteur, puis
 * par les outils du système (unzip, zipfile de Python) quand ils existent.
 * Une archive que l'iPhone refuse ne le dit à personne : on la vérifie
 * ici octet par octet.
 */

const work = mkdtempSync(path.join(tmpdir(), 'rangvia-zip-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function which(binary: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, binary);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const entries: [string, Buffer][] = [
  ['pass.json', Buffer.from(JSON.stringify({ formatVersion: 1, description: 'Ticket de file chez Café Zéphyr' }))],
  ['icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 255])],
  ['vide.txt', Buffer.alloc(0)],
  ['gros.bin', Buffer.alloc(200_000, 7)],
];

describe('zip stocké', () => {
  const zip = zipStored(entries);

  it('relu : noms, tailles, CRC et méthode « stockée »', () => {
    const read = readZip(zip);
    expect(read.map((e) => e.info.name)).toEqual(entries.map(([name]) => name));
    for (const [i, entry] of read.entries()) {
      const [, data] = entries[i]!;
      expect(entry.info.method).toBe(0);
      expect(entry.info.size).toBe(data.length);
      expect(entry.info.compressedSize).toBe(data.length);
      expect(entry.info.crc).toBe(crc32(data) >>> 0);
      expect(entry.data.equals(data)).toBe(true);
    }
  });

  it('déterministe (date fixe) : même contenu, mêmes octets', () => {
    expect(zipStored(entries).equals(zip)).toBe(true);
  });

  it('refuse un nom en double', () => {
    expect(() => zipStored([['a', Buffer.from('1')], ['a', Buffer.from('2')]])).toThrow();
  });

  it('pass.json en tête, manifest.json et signature à la fin', () => {
    const files = new Map<string, Buffer>([['logo.png', Buffer.from('l')], ['pass.json', Buffer.from('{}')], ['icon.png', Buffer.from('i')]]);
    const names = readZip(packPkpass(files, Buffer.from('{}'), Buffer.from('sig'))).map((e) => e.info.name);
    expect(names).toEqual(['pass.json', 'icon.png', 'logo.png', 'manifest.json', 'signature']);
  });

  it.skipIf(!which('unzip'))('unzip -t la déclare intacte', () => {
    const file = path.join(work, 'test.pkpass');
    writeFileSync(file, zip);
    const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    expect(out).toMatch(/No errors detected/);
    const listing = execFileSync('zipinfo', [file], { encoding: 'utf8' });
    expect(listing).toMatch(/pass\.json/);
    expect(listing).toMatch(/stor/);
  });

  it.skipIf(!which('python3'))('zipfile (Python) relit les mêmes données', () => {
    const file = path.join(work, 'py.pkpass');
    writeFileSync(file, zip);
    const script = 'import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([[i.filename,i.file_size,i.compress_type] for i in z.infolist()]));assert z.testzip() is None';
    const listed = JSON.parse(execFileSync('python3', ['-c', script, file], { encoding: 'utf8' })) as [string, number, number][];
    expect(listed).toEqual(entries.map(([name, data]) => [name, data.length, 0]));
  });
});
