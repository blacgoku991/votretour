// =====================================================================
// Rangvia — cartons du montage, rendus par Chromium
// ---------------------------------------------------------------------
// Le ffmpeg disponible n'a pas `drawtext` : les textes du montage sont
// des pages HTML (cards/*.html) capturées en PNG transparent, puis
// superposées. Avantage décisif : ils utilisent la VRAIE feuille de style
// du site, compilée par `next build` (jetons « Le Rang en relief »,
// Archivo à axes variables, auto-hébergée) : aucune couleur ni police
// recopiée, donc aucune dérive entre le site et sa vidéo.
//
// Les pages sont servies sous une origine fictive interceptée par
// Playwright (rien ne sort sur le réseau) ; les valeurs sont échappées.
// =====================================================================

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { WEB_ROOT } from './bench/guard.mjs';
import { CHROMIUM } from './lib/contexts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = join(HERE, 'cards');
const STATIC_DIR = join(WEB_ROOT, '.next', 'static');
const ORIGIN = 'http://cartons.rangvia.test';

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * La feuille globale compilée (celle qui porte les jetons et la police)
 * et la classe qui pose `--font-archivo`.
 */
function siteStyles() {
  const cssDir = join(STATIC_DIR, 'css');
  if (!existsSync(cssDir)) {
    throw new Error(`feuilles compilées introuvables (${cssDir}) : lancez \`next build\` dans apps/web.`);
  }
  for (const file of readdirSync(cssDir).filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(join(cssDir, file), 'utf8');
    const fontClass = /\.(__variable_[a-z0-9]+)\{--font-archivo:/.exec(css)?.[1];
    if (css.includes('--ink-900:') && fontClass) return { href: `/_next/static/css/${file}`, fontClass };
  }
  throw new Error('feuille globale du site introuvable dans .next/static/css (jetons et Archivo).');
}

/**
 * Le glyphe de la marque, lu dans `components/Wordmark.tsx` (JSX → SVG) :
 * le logo des cartons est celui du site.
 */
function wordmarkSvg(size) {
  const source = readFileSync(join(WEB_ROOT, 'src', 'components', 'Wordmark.tsx'), 'utf8');
  const jsx = /<svg[\s\S]*?<\/svg>/.exec(source)?.[0];
  if (!jsx) throw new Error('glyphe introuvable dans Wordmark.tsx');
  const svg = jsx
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/className=\{styles\.signal\}/g, 'fill="var(--signal-500)"')
    .replace(/className=\{styles\.\w+\}/g, '')
    .replace(/width="26" height="26"/, `width="${size}" height="${size}"`);
  if (/[{}]/.test(svg)) throw new Error('Wordmark.tsx : conversion du glyphe impossible (expression JSX).');
  return svg.replace('<svg', '<svg style="color: var(--bone-100)"');
}

/** Remplit un gabarit : `{{nom}}` reçoit la valeur échappée. */
function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`carton : valeur « ${key} » manquante`);
    return escapeHtml(vars[key]);
  });
}

/**
 * Rend une liste de cartons : `{ template, out, width, height, vars }`.
 * Un carton transparent garde sa transparence (PNG RGBA).
 */
export async function renderCards(jobs) {
  const { href, fontClass } = siteStyles();
  const head = `<link rel="stylesheet" href="${href}"><link rel="stylesheet" href="/cards/cards.css">`;
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'dark' });
    let current = '';
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      if (url.pathname === '/card') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: current });
      if (url.pathname === '/cards/cards.css') {
        return route.fulfill({ contentType: 'text/css', body: readFileSync(join(CARDS_DIR, 'cards.css')) });
      }
      if (url.pathname.startsWith('/_next/static/')) {
        const file = normalize(join(STATIC_DIR, url.pathname.slice('/_next/static/'.length)));
        if (!file.startsWith(STATIC_DIR) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
        return route.fulfill({ contentType: type, body: readFileSync(file) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    for (const job of jobs) {
      const template = readFileSync(join(CARDS_DIR, `${job.template}.html`), 'utf8');
      current = fill(template, { fontClass, width: job.width, height: job.height, ...job.vars })
        .replace('<!--head-->', head)
        .replace('<!--wordmark-->', wordmarkSvg(40));
      await page.setViewportSize({ width: job.width, height: job.height });
      await page.goto(`${ORIGIN}/card`, { waitUntil: 'load' });
      // Chargement explicite : une page sans texte (le fond) ne demanderait
      // jamais la police, et `check()` répondrait non.
      const archivo = await page.evaluate(async () => {
        await document.fonts.load('800 40px Archivo', 'Rangvia');
        await document.fonts.ready;
        return document.fonts.check('800 40px Archivo', 'Rangvia');
      });
      if (!archivo) throw new Error(`carton ${job.template} : la police Archivo n’est pas chargée.`);
      // Texte coupé : plus large que sa boîte, ou qui déborde du carton qui
      // le contient (une ligne de trop pousse la note hors de la carte).
      const overflow = await page.evaluate(() => [...document.querySelectorAll('p, h1, b')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          const holder = (el.closest('.k-quote, .k-offscreen, .k-caption, .k-frame') ?? document.body).getBoundingClientRect();
          return el.scrollWidth > el.clientWidth + 1
            || box.right > Math.min(innerWidth, holder.right) + 1
            || box.bottom > Math.min(innerHeight, holder.bottom) + 1
            || box.top < -1;
        })
        .map((el) => el.textContent?.trim().slice(0, 40)));
      if (overflow.length > 0) throw new Error(`carton ${job.template} : texte coupé (${overflow.join(' | ')})`);
      await page.screenshot({ path: job.out, omitBackground: true, clip: { x: 0, y: 0, width: job.width, height: job.height } });
    }
  } finally {
    await browser.close();
  }
}
