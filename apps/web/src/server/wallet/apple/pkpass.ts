import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

/**
 * Paquet .pkpass : manifest SHA-1 et archive zip « stockée ».
 *
 * Aucune dépendance : un .pkpass est un zip ordinaire qui contient
 * pass.json, les images, manifest.json (SHA-1 de chaque fichier, imposé
 * par Apple) et `signature` (CMS détaché du manifest, signature.ts).
 * Les entrées sont STOCKÉES, sans compression : les PNG sont déjà
 * compressés, le JSON pèse quelques ko, et c'est ce que produisent les
 * outils éprouvés (do-not-zip, utilisé par passkit-generator). Moins de
 * code, donc moins de manières de produire une archive que l'iPhone
 * refuserait sans rien dire.
 */

export type PassFiles = ReadonlyMap<string, Buffer>;

/** Nom de fichier accepté dans un pass : pas de dossier, pas de fichier caché. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9@._-]{0,63}$/;
const RESERVED = new Set(['manifest.json', 'signature']);

export function assertPassFileName(name: string): void {
  if (!FILE_NAME.test(name) || name.includes('..')) throw new Error(`Nom de fichier de pass refusé : ${name}`);
}

export function sha1Hex(data: Buffer | string): string {
  return createHash('sha1').update(data).digest('hex');
}

/**
 * manifest.json : { "chemin": "sha1 hexadécimal" } pour chaque fichier,
 * sauf manifest.json et signature. Clés triées : même contenu, mêmes
 * octets, donc même empreinte de rendu.
 */
export function buildManifest(files: PassFiles): Buffer {
  const manifest: Record<string, string> = {};
  for (const name of [...files.keys()].sort()) {
    if (RESERVED.has(name)) throw new Error(`${name} est calculé, pas fourni`);
    assertPassFileName(name);
    manifest[name] = sha1Hex(files.get(name)!);
  }
  return Buffer.from(JSON.stringify(manifest), 'utf8');
}

/* ====================================================================
   Zip « stocké » (APPNOTE 6.3 : en-têtes locaux, répertoire central)
   ==================================================================== */

/** Date MS-DOS fixe (1er janvier 2020) : une archive ne dépend que de son contenu. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
/** Bit 11 : noms en UTF-8. Nos noms sont ASCII, on le déclare quand même. */
const FLAGS = 0x0800;

export interface ZipEntryInfo {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export function zipStored(entries: ReadonlyArray<readonly [string, Buffer]>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (const [name, data] of entries) {
    if (seen.has(name)) throw new Error(`Fichier en double dans le pass : ${name}`);
    seen.add(name);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version nécessaire : 2.0
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(0, 8);             // méthode 0 : stocké
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, data);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);             // version d'origine
    head.writeUInt16LE(20, 6);             // version nécessaire
    head.writeUInt16LE(FLAGS, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(DOS_TIME, 12);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt16LE(0, 30);             // champ supplémentaire
    head.writeUInt16LE(0, 32);             // commentaire
    head.writeUInt16LE(0, 34);             // disque
    head.writeUInt16LE(0, 36);             // attributs internes
    head.writeUInt32LE(0, 38);             // attributs externes
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(seen.size, 8);
  end.writeUInt16LE(seen.size, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

/**
 * Relecture du répertoire central : sert aux tests (et à rien d'autre).
 * Renvoie les entrées et leurs données, CRC recalculé à part.
 */
export function readZip(zip: Buffer): { info: ZipEntryInfo; data: Buffer }[] {
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('Fin de répertoire central introuvable');
  const count = zip.readUInt16LE(endAt + 10);
  let at = zip.readUInt32LE(endAt + 16);
  const out: { info: ZipEntryInfo; data: Buffer }[] = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('Répertoire central invalide');
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const localName = zip.readUInt16LE(offset + 26);
    const localExtra = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    out.push({ info: { name, method, crc, compressedSize, size, offset }, data: zip.subarray(start, start + compressedSize) });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

/** Ordre des entrées : pass.json d'abord, puis les images, manifest et signature à la fin. */
export function packPkpass(files: PassFiles, manifest: Buffer, signature: Buffer): Buffer {
  const names = [...files.keys()].sort((a, b) => (a === 'pass.json' ? -1 : b === 'pass.json' ? 1 : a.localeCompare(b)));
  return zipStored([
    ...names.map((name) => [name, files.get(name)!] as const),
    ['manifest.json', manifest] as const,
    ['signature', signature] as const,
  ]);
}
