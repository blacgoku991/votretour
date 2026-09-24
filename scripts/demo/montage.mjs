#!/usr/bin/env node
// =====================================================================
// Rangvia — montage d'une vidéo de démonstration
// ---------------------------------------------------------------------
//   node scripts/demo/montage.mjs barbiers
//
// Part du tournage (scripts/demo/out/<scénario>/raw/, voir film.mjs) et
// produit :
//   apps/web/public/videos/<métier>/demo-16x9.<hash8>.{mp4,webm}
//                                   poster.<hash8>.{avif,webp,jpg}
//                                   teaser.<hash8>.{mp4,webm}
//   apps/web/src/lib/metiers/videos.json          (entrée du métier)
//   scripts/demo/out/<scénario>/social/demo-9x16.mp4   (réseaux, non publié)
//   scripts/demo/out/<scénario>/contact.png            (planche contact)
//   scripts/demo/out/<scénario>/keyframes/*.png        (images clés, relecture)
//
// Chaîne, sans perte jusqu'au dernier encodage (FFV1 en RVB : aucune
// conversion de couleurs intermédiaire, les cartons gardent les teintes
// exactes du site) :
//   1. pistes : images horodatées → vidéo à 30 i/s, par appareil ;
//   2. plans : fond, tablette, téléphone, bagues, légendes et cartons ;
//   3. film : carton d'ouverture, plans, carton de fin, en fondus ;
//   4. diffusion : H.264 (High, yuv420p, BT.709, faststart), VP9,
//      aperçu en boucle, affiches, contrôles et budgets.
//
// Honnêteté ([SEO § 10.1]) : aucune accélération. Les plans consécutifs
// du tournage s'enchaînent sans coupe ; s'il y a un trou entre deux plans
// (temps mort retiré), la coupe se voit : fondu de 200 ms.
// =====================================================================

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WEB_ROOT } from './bench/guard.mjs';
import { renderCards } from './cards.mjs';
import { ffmpeg, mp4Boxes, probe, resolveFfmpeg } from './ffmpeg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(HERE, 'out');
const PUBLIC_VIDEOS = join(WEB_ROOT, 'public', 'videos');
const MANIFEST = join(WEB_ROOT, 'src', 'lib', 'metiers', 'videos.json');

const FPS = 30;
/** Budgets de [SEO § 10.5], vérifiés aussi par tests/videos-manifest.test.ts. */
export const BUDGETS = { mp4: 4_000_000, webm: 3_000_000, poster: 60_000, teaser: 600_000 };
/** Fondus : entre deux plans (coupe visible), et vers / depuis les cartons. */
const CUT_FADE = 0.2;
const CARD_FADE = 0.5;
const TITLE_SECONDS = 3.4;
const END_SECONDS = 4.2;
/** Deux plans séparés de moins que ceci sont contigus : pas de coupe. */
const CONTIGUOUS = 0.15;

/**
 * Mises en page. Les écrans filmés ne sont jamais agrandis : téléphone
 * 780×1688 → 440×952, tablette 2049×1536 → 1152×864.
 */
const LAYOUTS = {
  '16x9': {
    width: 1920, height: 1080,
    tablet: { x: 96, y: 64, w: 1152, h: 864, ring: 14, radius: 18 },
    phone: { x: 1380, y: 64, w: 440, h: 952, ring: 12, radius: 44 },
    caption: { x: 96, y: 968, w: 820, h: 96 },
    honest: { right: 1920 - 1262, top: 1019 },
    note: { x: 458, y: 595, w: 820, h: 360, pad: 40 },
  },
  '9x16': {
    width: 1080, height: 1920,
    tablet: { x: 60, y: 248, w: 960, h: 720, ring: 12, radius: 16 },
    phone: { x: 340, y: 1004, w: 400, h: 866, ring: 12, radius: 40 },
    caption: { x: 60, y: 76, w: 960, h: 150 },
    honest: { right: 60, top: 30 },
    note: { x: 220, y: 612, w: 820, h: 360, pad: 40 },
  },
};

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const px = (n) => `${Math.round(n)}px`;

function frameStyles(L) {
  const body = (d) => `left: ${px(d.x - d.ring)}; top: ${px(d.y - d.ring)}; width: ${px(d.w + 2 * d.ring)}; `
    + `height: ${px(d.h + 2 * d.ring)}; border-radius: ${px(d.radius + d.ring)}`;
  const bezel = (d) => `left: ${px(d.x)}; top: ${px(d.y)}; width: ${px(d.w)}; height: ${px(d.h)}; `
    + `border-radius: ${px(d.radius)}; --ring: ${px(d.ring)}; --radius: ${px(d.radius)}`;
  return {
    tabletBody: body(L.tablet),
    phoneBody: body(L.phone),
    tabletBezel: bezel(L.tablet),
    phoneBezel: bezel(L.phone),
    tabletLens: `left: ${px(L.tablet.x + L.tablet.w / 2 - 4)}; top: ${px(L.tablet.y - L.tablet.ring / 2 - 4)}`,
    honestPos: `right: ${px(L.honest.right)}; top: ${px(L.honest.top)}`,
  };
}

/**
 * Où poser un carton : la note de notification a sa place (sur le bas de
 * la tablette, près du téléphone) ; un écran « hors du produit » couvre
 * exactement l'écran de l'appareil concerné.
 */
function overlayPlace(L, overlay) {
  if (overlay.card === 'notification') return { x: L.note.x, y: L.note.y, w: L.note.w, h: L.note.h };
  if (overlay.card === 'offscreen') {
    const d = overlay.data.on === 'tablet' ? L.tablet : L.phone;
    return { x: d.x, y: d.y, w: d.w, h: d.h };
  }
  throw new Error(`carton inconnu : ${overlay.card}`);
}

/* ------------------------------------------------------------------ */
/* 1. Pistes : images horodatées → vidéo à cadence fixe                 */
/* ------------------------------------------------------------------ */

/**
 * Rééchantillonnage à cadence fixe, fait ICI et non par ffmpeg : l'image
 * n de la piste (à `t0 + n / 30`) est la dernière capture affichée à cet
 * instant. Le démultiplexeur « concat » d'ffmpeg, essayé d'abord, étirait
 * la piste du téléphone (60 captures/s plus courtes que la durée propre
 * d'une image, 1/25 s) : l'écran filmé prenait jusqu'à 4 s de retard sur la
 * tablette. Le temps 0 est `t0` pour les deux appareils : synchrones à
 * l'image près.
 */
function resample(frames, t0, t1) {
  const count = Math.round((t1 - t0) * FPS);
  const picked = [];
  let k = 0;
  for (let n = 0; n < count; n += 1) {
    const at = t0 + n / FPS;
    while (k + 1 < frames.length && frames[k + 1].t <= at) k += 1;
    picked.push(frames[k].file);
  }
  return picked;
}

async function buildTrack(rawDir, workDir, name, t0, t1) {
  const index = JSON.parse(readFileSync(join(rawDir, name, 'frames.json'), 'utf8'));
  if (index.frames.length === 0) throw new Error(`piste ${name} vide`);
  const picked = resample(index.frames, t0, t1);
  const listFile = join(workDir, `${name}.frames`);
  const content = `${picked.join('\n')}\n`;
  const out = join(workDir, `${name}.mkv`);
  // Piste déjà construite pour ce tournage : on la garde (la reconstruire
  // prend plus d'une minute, et relancer le montage seul est courant).
  if (existsSync(out) && existsSync(listFile) && readFileSync(listFile, 'utf8') === content) return out;
  // Une suite numérotée de liens vers les captures : image2 la lit à 30 i/s.
  const seq = join(workDir, `seq-${name}`);
  rmSync(seq, { recursive: true, force: true });
  mkdirSync(seq, { recursive: true });
  picked.forEach((file, n) => symlinkSync(join(rawDir, name, file), join(seq, `${String(n).padStart(6, '0')}.png`)));
  await ffmpeg([
    '-framerate', String(FPS), '-i', join(seq, '%06d.png'),
    '-vf', 'format=gbrp', '-c:v', 'ffv1', '-level', '3', out,
  ], { label: `piste ${name}` });
  // Garde-fou de synchronisation : la piste dure exactement ce que la
  // feuille de tournage couvre (à une image près).
  const { duration } = probe(out);
  if (!(Math.abs(duration - picked.length / FPS) <= 2 / FPS)) {
    throw new Error(`piste ${name} : ${duration} s pour ${picked.length} images à ${FPS} i/s`);
  }
  writeFileSync(listFile, content);
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Plans                                                              */
/* ------------------------------------------------------------------ */

/** Plans contigus fusionnés en segments ; un trou devient une coupe visible. */
function segmentsOf(beats) {
  const segments = [];
  for (const beat of beats) {
    const last = segments.at(-1);
    if (last && beat.start - last.end < CONTIGUOUS) {
      last.end = beat.end;
      last.beats.push(beat);
    } else {
      segments.push({ start: beat.start, end: beat.end, beats: [beat] });
    }
  }
  return segments;
}

/** Apparition d'un calque : fondu d'opacité et montée de 14 px (transform). */
function riseY(y, start, dur = 0.4) {
  return `${y}+14*pow(1-clip((t-${round(start)})/${dur},0,1),3)`;
}

/**
 * Une image fixe devenue flux de `duration` secondes. La boucle se fait
 * DANS le graphe (filtre `loop`, tiré à la demande) et non au démultiplexeur
 * (`-loop 1`) : ce dernier produit ses images plus vite qu'elles ne sont
 * consommées, et la mémoire montait à plusieurs Go sur un plan de 40 s.
 */
const still = (input, duration) =>
  `[${input}:v]loop=loop=-1:size=1,fps=${FPS},trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS`;

async function buildSegment({ L, segment, index, tracks, t0, cards, workDir }) {
  const duration = segment.end - segment.start;
  const offset = segment.start - t0;
  const inputs = [
    '-i', cards.back,
    '-ss', offset.toFixed(3), '-t', duration.toFixed(3), '-i', tracks.tablet,
    '-ss', offset.toFixed(3), '-t', duration.toFixed(3), '-i', tracks.phone,
    '-i', cards.front,
  ];
  const { tablet, phone } = L;
  const graph = [
    `${still(0, duration)},format=gbrp[bg]`,
    `[1:v]scale=${tablet.w}:${tablet.h}:flags=lanczos,setsar=1[tab]`,
    `[2:v]scale=${phone.w}:${phone.h}:flags=lanczos,setsar=1[tel]`,
    `[bg][tab]overlay=${tablet.x}:${tablet.y}:format=gbrp[s0]`,
    `[s0][tel]overlay=${phone.x}:${phone.y}:format=gbrp[s1]`,
    // Image unique : l'overlay la répète (eof_action=repeat par défaut).
    `[s1][3:v]overlay=0:0:format=gbrp[s2]`,
  ];
  let last = 's2';
  let input = 4;
  const layer = (file, { x, y, from, to, fadeIn = true, fadeOut = true }) => {
    inputs.push('-i', file);
    const f = [];
    if (fadeIn) f.push(`fade=t=in:st=${round(from)}:d=0.35:alpha=1`);
    if (fadeOut) f.push(`fade=t=out:st=${round(to - 0.3)}:d=0.3:alpha=1`);
    const label = `l${input}`;
    graph.push(`${still(input, duration)},format=rgba${f.length ? `,${f.join(',')}` : ''}[${label}]`);
    const yExpr = fadeIn ? riseY(y, from) : String(y);
    graph.push(`[${last}][${label}]overlay=x=${x}:y='${yExpr}':eval=frame:format=gbrp:enable='between(t,${round(from)},${round(to)})'[o${input}]`);
    last = `o${input}`;
    input += 1;
  };
  segment.beats.forEach((beat, i) => {
    const from = beat.start - segment.start;
    const to = beat.end - segment.start;
    const isFirst = i === 0;
    const isLast = i === segment.beats.length - 1;
    // Au changement de plan, l'ancienne légende s'efface pendant que la
    // nouvelle monte ; en bord de segment, c'est le fondu du montage.
    layer(cards.captions[beat.id], {
      x: L.caption.x, y: L.caption.y,
      from: isFirst ? 0.25 : from - 0.15, to: isLast ? duration : to + 0.15,
      fadeOut: !isLast,
    });
    for (const o of beat.overlays) {
      const at = o.from - segment.start;
      const until = Math.min(duration, o.to - segment.start);
      const card = cards.overlays.get(o);
      layer(card.file, { x: card.x, y: card.y, from: at, to: until });
    }
  });
  const out = join(workDir, `segment-${L.name}-${index}.mkv`);
  await cachedFfmpeg(out, [...inputs, '-filter_complex', graph.join(';'), '-map', `[${last}]`,
    '-r', String(FPS), '-t', duration.toFixed(3), '-c:v', 'ffv1', '-level', '3'], `plan ${index}`);
  return { file: out, duration };
}

/**
 * Étape lourde (plusieurs minutes) rejouée seulement si quelque chose a
 * changé : la clé couvre les arguments et le CONTENU de chaque entrée.
 */
async function cachedFfmpeg(out, args, label) {
  const hash = createHash('sha256').update(JSON.stringify(args));
  args.forEach((arg, i) => {
    if (args[i - 1] !== '-i') return;
    // Les pistes et plans (centaines de Mo) : taille et date suffisent,
    // ils ne sont réécrits que par ce script. Les cartons : leur contenu.
    const { size, mtimeMs } = statSync(arg);
    hash.update(size > 16 * 1024 * 1024 ? `${arg}:${size}:${mtimeMs}` : readFileSync(arg));
  });
  const key = hash.digest('hex');
  const keyFile = `${out}.key`;
  if (existsSync(out) && existsSync(keyFile) && readFileSync(keyFile, 'utf8') === key) return;
  rmSync(keyFile, { force: true });
  await ffmpeg([...args, out], { label });
  writeFileSync(keyFile, key);
}

/* ------------------------------------------------------------------ */
/* 3. Film : cartons et plans en fondus                                   */
/* ------------------------------------------------------------------ */

async function buildMaster({ L, parts, workDir }) {
  const inputs = [];
  const graph = [];
  parts.forEach((part, i) => {
    inputs.push('-i', part.file);
    const source = part.still ? still(i, part.duration) : `[${i}:v]fps=${FPS}`;
    // `fps` en dernier : xfade exige une cadence déclarée, que setpts efface.
    graph.push(`${source},format=gbrp,setsar=1,fps=${FPS}[p${i}]`);
  });
  let label = 'p0';
  let length = parts[0].duration;
  const starts = [0];
  for (let i = 1; i < parts.length; i += 1) {
    const fade = parts[i].still || parts[i - 1].still ? CARD_FADE : CUT_FADE;
    const offset = length - fade;
    starts.push(offset);
    graph.push(`[${label}][p${i}]xfade=transition=fade:duration=${fade}:offset=${round(offset)}[x${i}]`);
    label = `x${i}`;
    length = offset + parts[i].duration;
  }
  const out = join(workDir, `master-${L.name}.mkv`);
  await cachedFfmpeg(out, [...inputs, '-filter_complex', graph.join(';'), '-map', `[${label}]`,
    '-t', length.toFixed(3), '-c:v', 'ffv1', '-level', '3'], 'film');
  return { file: out, duration: length, starts };
}

/* ------------------------------------------------------------------ */
/* 4. Diffusion                                                           */
/* ------------------------------------------------------------------ */

/** RVB → YUV en BT.709, plage limitée, et les étiquettes qui le disent. */
const TO_YUV = 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int';
const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

async function withinBudget(label, budget, steps, encode) {
  let lastSize = 0;
  for (const step of steps) {
    const file = await encode(step);
    lastSize = statSync(file).size;
    if (lastSize <= budget) return { file, step, size: lastSize };
  }
  throw new Error(`${label} : ${lastSize} octets au réglage le plus économe, budget ${budget}.`);
}

function encodeMp4(src, out, { crf, vf = [], extra = [] }) {
  return ffmpeg(['-i', src, '-vf', [...vf, TO_YUV, 'format=yuv420p'].join(','),
    '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', String(crf),
    '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
    ...COLOR_TAGS, '-movflags', '+faststart', '-an', ...extra, out], { label: `H.264 ${out}` }).then(() => out);
}

function encodeWebm(src, out, { crf, vf = [], extra = [] }) {
  return ffmpeg(['-i', src, '-vf', [...vf, TO_YUV, 'format=yuv420p'].join(','),
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2',
    '-r', String(FPS), '-g', String(FPS * 4), '-pix_fmt', 'yuv420p', ...COLOR_TAGS, '-an', ...extra, out], { label: `VP9 ${out}` }).then(() => out);
}

async function encodePosters(png, workDir) {
  const posters = {};
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    const scale = `scale=${w}:${h}:flags=lanczos`;
    try {
      posters.jpg = await withinBudget('affiche JPEG', BUDGETS.poster, [3, 4, 5, 6, 8], async (q) => {
        const out = join(workDir, `poster-${w}.jpg`);
        await ffmpeg(['-i', png, '-vf', `${scale},format=yuvj420p`, '-q:v', String(q), '-frames:v', '1', out]);
        return out;
      });
      posters.webp = await withinBudget('affiche WebP', BUDGETS.poster, [86, 80, 74, 66, 58], async (q) => {
        const out = join(workDir, `poster-${w}.webp`);
        await ffmpeg(['-i', png, '-vf', scale, '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', '-frames:v', '1', out]);
        return out;
      });
      posters.avif = await withinBudget('affiche AVIF', BUDGETS.poster, [24, 28, 32, 36, 40], async (crf) => {
        const out = join(workDir, `poster-${w}.avif`);
        await ffmpeg(['-i', png, '-vf', `${scale},${TO_YUV},format=yuv420p`, '-c:v', 'libaom-av1', '-still-picture', '1',
          '-crf', String(crf), '-cpu-used', '4', ...COLOR_TAGS, '-frames:v', '1', out]);
        return out;
      });
      return { posters, width: w, height: h };
    } catch (error) {
      if (w === 1280) throw error;
      // Trop lourde en 1920 : même image, en 1280×720, pour les trois formats.
    }
  }
  throw new Error('affiches : budget impossible');
}

const hash8 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);

/* ------------------------------------------------------------------ */
/* Contrôles                                                              */
/* ------------------------------------------------------------------ */

function checkVideo(file, { width, height, duration, codec }) {
  const p = probe(file);
  const problems = [];
  if (p.codec !== codec) problems.push(`codec ${p.codec}, attendu ${codec}`);
  if (codec === 'h264' && !/^High/.test(p.profile ?? '')) problems.push(`profil ${p.profile}, attendu High`);
  if (p.pixFmt !== 'yuv420p') problems.push(`pixels ${p.pixFmt}, attendu yuv420p`);
  if (p.width !== width || p.height !== height) problems.push(`taille ${p.width}×${p.height}, attendue ${width}×${height}`);
  if (p.fps !== null && Math.abs(p.fps - FPS) > 0.01) problems.push(`${p.fps} i/s, attendu ${FPS}`);
  if (!(Math.abs(p.duration - duration) <= 0.5)) problems.push(`durée ${p.duration} s, attendue ${round(duration, 2)} ± 0,5`);
  if (codec === 'h264') {
    const boxes = mp4Boxes(file);
    if (!(boxes.indexOf('moov') >= 0 && boxes.indexOf('moov') < boxes.indexOf('mdat'))) {
      problems.push(`faststart absent (boîtes : ${boxes.join(', ')})`);
    }
  }
  if (problems.length) throw new Error(`${file} : ${problems.join(' ; ')}`);
  return p;
}

/* ------------------------------------------------------------------ */
/* Programme                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const id = process.argv[2];
  if (!/^[a-z-]+$/.test(id ?? '')) throw new Error('Usage : node scripts/demo/montage.mjs <scénario>');
  const found = resolveFfmpeg();
  console.log(`▸ ffmpeg : ${found.bin} (${found.origin})`);

  const root = join(OUT_ROOT, id);
  const rawDir = join(root, 'raw');
  const timelineFile = join(rawDir, 'timeline.json');
  if (!existsSync(timelineFile)) throw new Error(`tournage absent : ${timelineFile} (lancez film.mjs ${id})`);
  const tl = JSON.parse(readFileSync(timelineFile, 'utf8'));
  // Textes des cartons et chapitres : ceux du scénario tel qu'il est
  // aujourd'hui (une retouche de légende ne demande pas de retourner).
  // Le texte de la notification, lui, vient du tournage.
  const { scenario } = await import(pathToFileURL(join(HERE, 'scenarios', `${id}.mjs`)).href);
  // Dossier de travail conservé d'un passage à l'autre : seules les pistes
  // y sont réutilisées (voir buildTrack), tout le reste est réécrit.
  const workDir = join(root, 'work');
  mkdirSync(workDir, { recursive: true });

  // Temps 0 commun aux deux pistes : la première image de la première.
  const t0 = Math.min(tl.tracks.phone.first, tl.tracks.tablet.first);
  const t1 = Math.max(tl.ended, ...tl.beats.map((b) => b.end)) + 0.1;
  console.log('▸ Pistes');
  const tracks = {
    phone: await buildTrack(rawDir, workDir, 'phone', t0, t1),
    tablet: await buildTrack(rawDir, workDir, 'tablet', t0, t1),
  };
  const segments = segmentsOf(tl.beats);
  const steps = tl.beats.length;

  const results = {};
  for (const name of ['16x9', '9x16']) {
    const L = { name, ...LAYOUTS[name] };
    console.log(`▸ Cartons ${name}`);
    const cdir = join(workDir, `cards-${name}`);
    mkdirSync(cdir, { recursive: true });
    const cards = {
      back: join(cdir, 'back.png'), front: join(cdir, 'front.png'),
      title: join(cdir, 'title.png'), end: join(cdir, 'end.png'), captions: {}, overlays: new Map(),
    };
    const frame = frameStyles(L);
    const jobs = [
      { template: 'back', out: cards.back, width: L.width, height: L.height, vars: frame },
      { template: 'front', out: cards.front, width: L.width, height: L.height, vars: { ...frame, honestNote: 'filmé sur le vrai produit' } },
      {
        template: 'title', out: cards.title, width: L.width, height: L.height,
        vars: scenario.cards.title,
      },
      { template: 'end', out: cards.end, width: L.width, height: L.height, vars: scenario.cards.end },
    ];
    tl.beats.forEach((beat, i) => {
      cards.captions[beat.id] = join(cdir, `caption-${beat.id}.png`);
      jobs.push({
        template: 'caption', out: cards.captions[beat.id], width: L.caption.w, height: L.caption.h,
        vars: {
          captionStyle: '',
          step: String(i + 1).padStart(2, '0'), steps: String(steps).padStart(2, '0'),
          ...(scenario.captions?.[beat.id] ?? beat.caption),
        },
      });
      // Cartons posés pendant le plan : texte de notification cité, ou
      // écran « hors du produit » sur l'un des deux appareils.
      beat.overlays.forEach((o, k) => {
        const out = join(cdir, `overlay-${beat.id}-${k}.png`);
        const place = overlayPlace(L, o);
        cards.overlays.set(o, { file: out, ...place });
        if (o.card === 'notification') {
          jobs.push({
            template: 'notification', out, width: L.note.w, height: L.note.h,
            vars: { pad: L.note.pad, kicker: o.data.kicker, title: o.data.title, body: o.data.body, note: o.data.note },
          });
        } else {
          jobs.push({
            template: 'offscreen', out, width: place.w, height: place.h,
            vars: { kicker: o.data.kicker, title: o.data.title, body: o.data.body },
          });
        }
      });
    });
    // Le format vertical va aux réseaux sans cartons plein écran : il
    // s'ouvre directement sur les deux appareils.
    await renderCards(jobs.filter((j) => name === '16x9' || !['title', 'end'].includes(j.template)));

    console.log(`▸ Plans ${name}`);
    const parts = [];
    if (name === '16x9') parts.push({ file: cards.title, duration: TITLE_SECONDS, still: true });
    for (const [i, segment] of segments.entries()) {
      parts.push(await buildSegment({ L, segment, index: i, tracks, t0, cards, workDir }));
    }
    if (name === '16x9') parts.push({ file: cards.end, duration: END_SECONDS, still: true });
    const master = await buildMaster({ L, parts, workDir });
    results[name] = { L, master, parts };
  }

  /* ---- Temps de sortie d'un instant du tournage (film 16:9) ---- */
  const { master } = results['16x9'];
  const firstSegmentPart = 1; // après le carton d'ouverture
  const outTime = (raw) => {
    const k = segments.findIndex((s) => raw >= s.start - 1e-6 && raw <= s.end + 1e-6);
    if (k < 0) throw new Error('instant hors des plans');
    return master.starts[firstSegmentPart + k] + (raw - segments[k].start);
  };
  const beat = (bid) => tl.beats.find((b) => b.id === bid);

  console.log('▸ Diffusion');
  const pub = join(workDir, 'pub');
  mkdirSync(pub, { recursive: true });
  const mp4 = await withinBudget('MP4', BUDGETS.mp4, [20, 21, 22, 24, 26, 28, 30],
    (crf) => encodeMp4(master.file, join(pub, `demo-${crf}.mp4`), { crf }));
  const webm = await withinBudget('WebM', BUDGETS.webm, [30, 32, 34, 37, 40, 43],
    (crf) => encodeWebm(master.file, join(pub, `demo-${crf}.webm`), { crf }));
  checkVideo(mp4.file, { width: 1920, height: 1080, duration: master.duration, codec: 'h264' });
  checkVideo(webm.file, { width: 1920, height: 1080, duration: master.duration, codec: 'vp9' });

  // Aperçu en boucle : les plans que le scénario désigne (au plus 10 s).
  const [teaserFirst, teaserLast] = scenario.teaser ?? [tl.beats[0].id, tl.beats.at(-1).id];
  const teaserFrom = outTime(beat(teaserFirst).start);
  const teaserTo = Math.min(teaserFrom + 10, outTime(beat(teaserLast).end));
  const teaserLength = teaserTo - teaserFrom;
  const teaserVf = [
    `trim=start=${round(teaserFrom)}:end=${round(teaserTo)}`, 'setpts=PTS-STARTPTS',
    'scale=960:540:flags=lanczos',
    `fade=t=in:st=0:d=0.4:color=0x07090D`, `fade=t=out:st=${round(teaserLength - 0.4)}:d=0.4:color=0x07090D`,
  ];
  const teaserMp4 = await withinBudget('aperçu MP4', BUDGETS.teaser, [21, 23, 25, 27, 30, 33],
    (crf) => encodeMp4(master.file, join(pub, `teaser-${crf}.mp4`), { crf, vf: teaserVf }));
  const teaserWebm = await withinBudget('aperçu WebM', BUDGETS.teaser, [31, 34, 37, 40, 44],
    (crf) => encodeWebm(master.file, join(pub, `teaser-${crf}.webm`), { crf, vf: teaserVf }));
  checkVideo(teaserMp4.file, { width: 960, height: 540, duration: teaserLength, codec: 'h264' });

  // Affiche : le rideau « C'est votre tour » à côté du bouton Terminer.
  const posterMark = tl.marks.find((m) => m.label === 'poster');
  const posterAt = outTime(posterMark ? posterMark.t : tl.beats[Math.floor(steps / 2)].end - 0.5);
  const posterPng = join(workDir, 'poster.png');
  await ffmpeg(['-ss', posterAt.toFixed(3), '-i', master.file, '-frames:v', '1', posterPng]);
  const poster = await encodePosters(posterPng, workDir);

  // 9:16 pour les réseaux : jamais publié sur le site.
  const socialDir = join(root, 'social');
  rmSync(socialDir, { recursive: true, force: true });
  mkdirSync(socialDir, { recursive: true });
  const social = await encodeMp4(results['9x16'].master.file, join(socialDir, 'demo-9x16.mp4'), { crf: 22 });
  checkVideo(social, { width: 1080, height: 1920, duration: results['9x16'].master.duration, codec: 'h264' });

  /* ---- Publication ---- */
  const metier = tl.metier;
  const dir = join(PUBLIC_VIDEOS, metier);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const publish = (src, base, ext) => {
    const name = `${base}.${hash8(src)}.${ext}`;
    writeFileSync(join(dir, name), readFileSync(src));
    return { url: `/videos/${metier}/${name}`, bytes: statSync(src).size };
  };
  const files = {
    mp4: publish(mp4.file, 'demo-16x9', 'mp4'),
    webm: publish(webm.file, 'demo-16x9', 'webm'),
    poster: {
      jpg: publish(poster.posters.jpg.file, 'poster', 'jpg'),
      webp: publish(poster.posters.webp.file, 'poster', 'webp'),
      avif: publish(poster.posters.avif.file, 'poster', 'avif'),
    },
    teaser: {
      mp4: publish(teaserMp4.file, 'teaser', 'mp4'),
      webm: publish(teaserWebm.file, 'teaser', 'webm'),
    },
  };
  const urls = (node) => (node.url ? node.url : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, urls(v)])));
  const sizes = (node) => (node.url ? node.bytes : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, sizes(v)])));
  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    id: `${metier}-${today.slice(0, 7)}`,
    metier,
    duration: round(master.duration, 1),
    width: 1920,
    height: 1080,
    uploadDate: today,
    files: urls(files),
    bytes: sizes(files),
    chapters: scenario.chapters,
  };
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];
  const next = [...(Array.isArray(manifest) ? manifest : []).filter((e) => e?.metier !== metier), entry]
    .sort((a, b) => String(a.metier).localeCompare(String(b.metier)));
  writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);

  /* ---- Relecture : planche contact et images clés ---- */
  const finalMp4 = join(dir, files.mp4.url.split('/').pop());
  await ffmpeg(['-i', finalMp4, '-vf', 'fps=1/5,scale=480:-1:flags=lanczos,tile=4x3:padding=6:margin=6:color=0x05070A',
    '-frames:v', '1', join(root, 'contact.png')]);
  const keyDir = join(root, 'keyframes');
  rmSync(keyDir, { recursive: true, force: true });
  mkdirSync(keyDir, { recursive: true });
  const keys = [['00-ouverture', 1.5], ...tl.beats.map((b, i) => [`${String(i + 1).padStart(2, '0')}-${b.id}`, outTime(b.end) - 0.9]),
    ...tl.beats.flatMap((b) => b.overlays.map((o, k) => [`${b.id}-carton-${k}`, outTime((o.from + Math.min(o.to, b.end)) / 2)])),
    ['affiche', posterAt], ['99-fin', master.duration - 1]];
  for (const [label, at] of keys) {
    await ffmpeg(['-ss', at.toFixed(3), '-i', finalMp4, '-frames:v', '1', join(keyDir, `${label}.png`)]);
  }

  console.log(`✓ ${metier} : ${round(master.duration, 1)} s`);
  console.log(`  MP4  ${files.mp4.bytes} o (CRF ${mp4.step}) · WebM ${files.webm.bytes} o (CRF ${webm.step})`);
  console.log(`  aperçu ${files.teaser.mp4.bytes} / ${files.teaser.webm.bytes} o · affiches ${poster.width}×${poster.height} `
    + `${files.poster.jpg.bytes} / ${files.poster.webp.bytes} / ${files.poster.avif.bytes} o`);
  console.log(`  9:16 ${social} · planche ${join(root, 'contact.png')}`);
  console.log(`  manifeste ${MANIFEST}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await main();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
