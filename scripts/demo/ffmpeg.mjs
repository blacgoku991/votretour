// =====================================================================
// Rangvia — ffmpeg du montage : résolution, exécution, contrôles
// ---------------------------------------------------------------------
// Ordre de recherche ([SEO § 10.5]) : FFMPEG_PATH, puis `ffmpeg` dans le
// PATH, puis le binaire statique du paquet Python imageio-ffmpeg. Un
// binaire sans libx264 est REJETÉ : c'est le cas de celui que Playwright
// livre (VP8 seulement), inutilisable pour le MP4 du site.
//
// ffprobe est facultatif : sans lui, `probe()` lit la description que
// `ffmpeg -i` écrit sur sa sortie d'erreur, et `mp4Boxes()` lit l'ordre
// des boîtes du MP4 directement (faststart : `moov` avant `mdat`).
// =====================================================================

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const INSTALL_HINT = 'installez-en un : `sudo apt-get install ffmpeg` ou `pip install imageio-ffmpeg`.';

function encodersOf(bin) {
  try {
    return execFileSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function candidates() {
  const list = [];
  if (process.env.FFMPEG_PATH) list.push(['FFMPEG_PATH', process.env.FFMPEG_PATH]);
  list.push(['PATH', 'ffmpeg']);
  try {
    const bin = execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (bin) list.push(['imageio-ffmpeg', bin]);
  } catch {
    /* paquet absent : on passe au suivant */
  }
  return list;
}

let resolved = null;

/**
 * Le premier ffmpeg complet trouvé. `require` : encodeurs indispensables
 * au montage (le MP4 du site, le WebM, les affiches).
 */
export function resolveFfmpeg({ require = ['libx264', 'libvpx-vp9', 'libwebp', 'libaom-av1'] } = {}) {
  if (resolved) return resolved;
  const rejected = [];
  for (const [origin, bin] of candidates()) {
    const encoders = encodersOf(bin);
    if (!encoders) continue;
    const missing = require.filter((name) => !new RegExp(`\\s${name}\\s`).test(encoders));
    if (missing.length === 0) {
      const probeBin = join(dirname(bin), 'ffprobe');
      resolved = { bin, origin, ffprobe: bin !== 'ffmpeg' && existsSync(probeBin) ? probeBin : findOnPath('ffprobe') };
      return resolved;
    }
    rejected.push(`${bin} (${origin}) : il manque ${missing.join(', ')}`);
  }
  throw new Error(`aucun ffmpeg complet${rejected.length ? ` (écartés : ${rejected.join(' ; ')})` : ''} ; ${INSTALL_HINT}`);
}

function findOnPath(name) {
  try {
    execFileSync(name, ['-version'], { stdio: 'ignore' });
    return name;
  } catch {
    return null;
  }
}

/** Lance ffmpeg ; rejette avec la fin de sa sortie d'erreur en cas d'échec. */
export function ffmpeg(args, { label = 'ffmpeg' } = {}) {
  const { bin } = resolveFfmpeg();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-6000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} a échoué (code ${code}) :\n${err.trim()}`));
    });
  });
}

/**
 * Description d'un média : codec, profil, format de pixels, taille,
 * cadence et durée de la première piste vidéo.
 */
export function probe(file) {
  const { bin, ffprobe } = resolveFfmpeg();
  if (ffprobe) {
    const out = JSON.parse(execFileSync(ffprobe, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate:format=duration',
      '-of', 'json', file,
    ], { encoding: 'utf8' }));
    const s = out.streams?.[0] ?? {};
    const [num, den] = String(s.r_frame_rate ?? '0/1').split('/').map(Number);
    return {
      codec: s.codec_name, profile: s.profile, pixFmt: s.pix_fmt,
      width: s.width, height: s.height, fps: den ? num / den : null,
      duration: Number(out.format?.duration ?? NaN), source: 'ffprobe',
    };
  }
  let text = '';
  try {
    execFileSync(bin, ['-hide_banner', '-i', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // Sans fichier de sortie, `ffmpeg -i` sort en erreur : c'est attendu.
    text = String(error.stderr ?? '');
  }
  // « Stream #0:0[0x1](und): Video: h264 (High) (avc1 / …), yuv420p(tv, …), 1920x1080 […], 30 fps, … »
  const line = /Stream #\d+:\d+[^\n]*: Video: ([^\n]+)/.exec(text)?.[1] ?? '';
  const codec = /^(\w+)(?: \(([^)]+)\))?/.exec(line);
  const pixFmt = /, ([a-z0-9]+)(?:\([^)]*\))?, \d+x\d+/.exec(line);
  const dims = /, (\d+)x(\d+)/.exec(line);
  const fps = /, ([\d.]+) fps/.exec(line);
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  return {
    codec: codec?.[1] ?? null,
    profile: codec?.[2] ?? null,
    pixFmt: pixFmt?.[1] ?? null,
    width: dims ? Number(dims[1]) : null,
    height: dims ? Number(dims[2]) : null,
    fps: fps ? Number(fps[1]) : null,
    duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : NaN,
    source: 'ffmpeg -i',
  };
}

/**
 * Les boîtes de premier niveau d'un MP4, dans l'ordre du fichier. Suffit
 * à vérifier le « faststart » (`moov` avant `mdat`) sans aucun outil.
 */
export function mp4Boxes(file) {
  const fd = openSync(file, 'r');
  const size = statSync(file).size;
  const boxes = [];
  const head = Buffer.alloc(16);
  try {
    let offset = 0;
    while (offset + 8 <= size && boxes.length < 64) {
      readSync(fd, head, 0, 16, offset);
      let length = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (length === 1) length = Number(head.readBigUInt64BE(8));
      else if (length === 0) length = size - offset;
      if (length < 8) break;
      boxes.push(type);
      offset += length;
    }
  } finally {
    closeSync(fd);
  }
  return boxes;
}

// Lancement direct : affiche le binaire retenu (diagnostic du poste).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const found = resolveFfmpeg();
    console.log(`✓ ffmpeg : ${found.bin} (${found.origin}) ; ffprobe : ${found.ffprobe ?? 'absent (lecture de ffmpeg -i)'}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
