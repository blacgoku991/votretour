import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DemoVideo } from '@/components/video/DemoVideo';
import {
  formatVideoDuration,
  parseVideoEntry,
  parseVideoManifest,
  videoForMetier,
  type DemoVideoEntry,
} from '@/components/video/manifest';
import { previewAllowed, readConnection, type PreviewContext } from '@/components/video/preview';
import { publishedMetiers } from '@/lib/metiers/registry';

/**
 * LA VIDÉO DE DÉMONSTRATION — rien ne se télécharge avant un geste.
 *
 * Le dépôt n'embarque pas de DOM simulé (jsdom) : le « avant le clic »
 * se vérifie donc sur le rendu serveur, qui EST le premier affichage du
 * navigateur (le lecteur démarre en mode « affiche », quelles que soient
 * les préférences) : aucun élément <video>, aucune <source>, aucune URL
 * de vidéo, et une affiche en chargement différé. Les conditions de
 * l'aperçu automatique sont une fonction pure, testée ici cas par cas.
 * Le passage au clic a été vérifié dans un vrai Chromium sur le banc
 * (voir le rapport du lot S3) ; le contrôle de bout en bout du lot Q le
 * rejoue ([SEO § 12.2]).
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (path: string) => readFileSync(`${SRC}${path}`, 'utf8');

const RAW = {
  id: 'barbiers-2026-10',
  metier: 'barbiers',
  duration: 52,
  width: 1920,
  height: 1080,
  uploadDate: '2026-10-02',
  files: {
    mp4: '/videos/barbiers/demo-16x9.1a2b3c4d.mp4',
    webm: '/videos/barbiers/demo-16x9.1a2b3c4d.webm',
    poster: {
      jpg: '/videos/barbiers/poster.1a2b3c4d.jpg',
      webp: '/videos/barbiers/poster.1a2b3c4d.webp',
      avif: '/videos/barbiers/poster.1a2b3c4d.avif',
    },
    teaser: { mp4: '/videos/barbiers/teaser.1a2b3c4d.mp4' },
  },
  chapters: ['Camille prend sa place en scannant la plaque.', 'Le barbier appuie sur Terminer.'],
};

const entry = (): DemoVideoEntry => {
  const parsed = parseVideoEntry(RAW);
  if (!parsed) throw new Error('entrée de référence invalide');
  return parsed;
};

describe('manifeste videos.json', () => {
  it('est vide tant qu’aucune vidéo n’a été tournée sur le vrai produit', () => {
    expect(JSON.parse(read('lib/metiers/videos.json'))).toEqual([]);
    for (const { slug } of publishedMetiers()) expect(videoForMetier(slug), slug).toBeNull();
  });

  it('lit une entrée complète', () => {
    const v = entry();
    expect(v.files.mp4).toBe(RAW.files.mp4);
    expect(v.files.teaser).toEqual({ mp4: RAW.files.teaser.mp4 });
    expect(v.chapters).toHaveLength(2);
  });

  it('ignore une entrée douteuse plutôt que de l’afficher de travers', () => {
    const bad: Array<[string, unknown]> = [
      ['fichier tiers', { ...RAW, files: { ...RAW.files, mp4: 'https://cdn.example.com/demo.mp4' } }],
      ['remontée de dossier', { ...RAW, files: { ...RAW.files, mp4: '/videos/../secret.mp4' } }],
      ['mauvaise extension', { ...RAW, files: { ...RAW.files, mp4: '/videos/barbiers/demo.webm' } }],
      ['affiche absente', { ...RAW, files: { ...RAW.files, poster: {} } }],
      ['aperçu mal formé', { ...RAW, files: { ...RAW.files, teaser: { webm: '/videos/a.webm' } } }],
      ['durée nulle', { ...RAW, duration: 0 }],
      ['date impossible', { ...RAW, uploadDate: 'hier' }],
      ['slug invalide', { ...RAW, metier: 'Barbiers !' }],
      ['pas un objet', 'barbiers'],
    ];
    for (const [label, raw] of bad) expect(parseVideoEntry(raw), label).toBeNull();
    expect(parseVideoManifest({ not: 'a list' })).toEqual([]);
    expect(parseVideoManifest([RAW, { ...RAW, duration: -1 }])).toHaveLength(1);
  });

  it('prend la vidéo la plus récente d’un métier', () => {
    const older = { ...entry(), id: 'barbiers-old', uploadDate: '2026-09-01' };
    const newer = { ...entry(), id: 'barbiers-new', uploadDate: '2026-11-01' };
    expect(videoForMetier('barbiers', [older, newer])?.id).toBe('barbiers-new');
    expect(videoForMetier('garages', [older, newer])).toBeNull();
  });

  it('annonce la durée comme un humain', () => {
    // Espaces insécables : « 52 s » ne se coupe jamais en fin de ligne.
    expect(formatVideoDuration(52)).toBe('52\u00a0s');
    expect(formatVideoDuration(60)).toBe('1\u00a0min');
    expect(formatVideoDuration(65)).toBe('1\u00a0min\u00a005');
    expect(formatVideoDuration(0.2)).toBe('1\u00a0s');
  });
});

describe('aperçu automatique : seulement si tout le permet', () => {
  const ok: PreviewContext = { hasTeaser: true, reducedMotion: false, visible: true, saveData: false, effectiveType: '4g' };

  it('permis quand toutes les conditions sont réunies', () => {
    expect(previewAllowed(ok)).toBe(true);
    expect(previewAllowed({ ...ok, effectiveType: null })).toBe(true);
    expect(previewAllowed({ ...ok, effectiveType: '3g' })).toBe(true);
  });

  it('refusé dès qu’une condition manque', () => {
    expect(previewAllowed({ ...ok, hasTeaser: false })).toBe(false);
    expect(previewAllowed({ ...ok, reducedMotion: true })).toBe(false);
    expect(previewAllowed({ ...ok, visible: false })).toBe(false);
    expect(previewAllowed({ ...ok, saveData: true })).toBe(false);
    expect(previewAllowed({ ...ok, effectiveType: '2g' })).toBe(false);
    expect(previewAllowed({ ...ok, effectiveType: 'slow-2g' })).toBe(false);
  });

  it('lit navigator.connection sans supposer qu’elle existe', () => {
    expect(readConnection(null)).toEqual({ saveData: false, effectiveType: null });
    expect(readConnection({})).toEqual({ saveData: false, effectiveType: null });
    expect(readConnection({ connection: { saveData: true, effectiveType: '2g' } })).toEqual({
      saveData: true,
      effectiveType: '2g',
    });
    expect(readConnection({ connection: { saveData: 'oui', effectiveType: 4 } })).toEqual({
      saveData: false,
      effectiveType: null,
    });
  });
});

describe('premier affichage : aucune requête média avant le clic', () => {
  const html = renderToStaticMarkup(createElement(DemoVideo, { video: entry(), subject: 'Barbiers' }));

  it('ni <video>, ni <source> de vidéo, ni URL de vidéo', () => {
    expect(html).not.toMatch(/<video\b/);
    expect(html).not.toMatch(/\.(mp4|webm)\b/);
    expect(html).not.toMatch(/preload=/);
    expect(html).not.toMatch(/autoplay/i);
  });

  it('une affiche en chargement différé, aux dimensions réservées', () => {
    expect(html).toMatch(/<img[^>]*loading="lazy"/);
    expect(html).toMatch(/<img[^>]*width="1920"[^>]*height="1080"|<img[^>]*height="1080"[^>]*width="1920"/);
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('type="image/webp"');
    expect(html).toContain('aspect-ratio:1920 / 1080');
  });

  it('un vrai bouton, qui annonce la durée', () => {
    expect(html).toMatch(/<button type="button"[^>]*>.*Voir la démo\s·\s52\ss/);
  });

  it('une légende honnête : ce que montre la vidéo, commerce fictif, sans son', () => {
    expect(html).toContain('<figcaption');
    expect(html).toContain('Ce que montre la vidéo');
    for (const chapter of RAW.chapters) expect(html).toContain(chapter);
    expect(html).toContain('commerce fictif');
    expect(html).toContain('Sans son');
  });

  it('aucun lecteur ni script tiers', () => {
    expect(html).not.toMatch(/youtube|vimeo|<iframe|<script/i);
  });

  it('le lecteur démarre toujours en mode affiche, et la vidéo complète ne part qu’au clic', () => {
    const player = read('components/video/DemoVideoPlayer.tsx');
    expect(player).toMatch(/useState<Mode>\('poster'\)/);
    // Le seul passage à « full » est le gestionnaire du bouton.
    expect(player.match(/setMode\('full'\)/g)).toHaveLength(1);
    expect(player).toMatch(/onClick=\{\(\) => setMode\('full'\)\}/);
    // L'aperçu passe par previewAllowed (mouvement, visibilité, données).
    expect(player).toMatch(/previewAllowed\(/);
  });
});
