// Outils communs des recettes « profiles-<profil>.mjs » (lot P3).
//
// Chaque recette rejoue un parcours RÉEL du poste d'un métier sur le banc
// local (PostgreSQL migré, PostgREST, passerelle « façon Supabase »,
// application), avec le jeu de données `profiles-seed.sql`. Elle échoue
// (code 1) sur une assertion fausse, une erreur JavaScript, un
// avertissement d'hydratation, une réponse 5xx ou un débordement
// horizontal de la page.
//
//   E2E_BASE_URL=http://127.0.0.1:3000 \
//   E2E_DATABASE_URL=postgresql://postgres@127.0.0.1:54399/votretour_e2e \
//   node scripts/e2e/pro/profiles-vehicle.mjs
//
// Comme `walkin-baseline.mjs` : banc local seulement (127.0.0.1), jamais la
// base `votretour_verify`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
export const DB = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54399/votretour_e2e';
export const ORG = 'p3-banc-metiers';
export const OUT = join(HERE, '.out');
const CHROMIUM = process.env.E2E_CHROMIUM
  ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

function refuse(message) {
  console.error(`✗ Configuration refusée : ${message}`);
  process.exit(2);
}
{
  const db = new URL(DB);
  if (db.hostname !== '127.0.0.1' && db.hostname !== 'localhost') refuse('la base doit être sur 127.0.0.1');
  for (const k of ['host', 'hostaddr', 'service']) if (db.searchParams.has(k)) refuse(`paramètre « ${k} » interdit dans l’URI`);
  if (db.pathname.replace(/^\//, '') === 'votretour_verify') refuse('votretour_verify est la base du banc partagé');
  const app = new URL(BASE);
  if (app.hostname !== '127.0.0.1' && app.hostname !== 'localhost') refuse('l’application doit être sur 127.0.0.1');
}

const PSQL_ENV = { ...process.env };
for (const k of ['PGHOST', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete PSQL_ENV[k];

/** Une requête SQL, une valeur par ligne. */
export function sql(query) {
  return execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-tAc', query], { env: PSQL_ENV }).toString().trim();
}

/** Rejoue le jeu de données (supprime puis recrée l'organisation de test). */
export function seed() {
  execFileSync('psql', [DB, '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(HERE, 'profiles-seed.sql')], { env: PSQL_ENV, stdio: ['ignore', 'ignore', 'inherit'] });
}

/**
 * La file d'un établissement de l'organisation de test, par son nom : les
 * slugs d'URL d'un passage précédent restent réservés, ceux du nouveau
 * passage reçoivent un suffixe.
 */
export function queueId(locationName) {
  const id = sql(`select q.id from public.queues q
    join public.locations l on l.id = q.location_id
    join public.organizations o on o.id = q.organization_id
    where o.slug = '${ORG}' and l.name = '${locationName.replace(/'/g, "''")}' limit 1`);
  if (!id) throw new Error(`file introuvable pour « ${locationName} » : le jeu de données est-il chargé ?`);
  return id;
}

let failures = 0;
export function check(ok, label) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`);
  if (!ok) failures += 1;
}

/**
 * Ouvre le navigateur, connecte le pro (connexion émulée du banc) et rend
 * une page surveillée. `problems` recueille erreurs JS, hydratation, 5xx.
 */
export async function open({ width = 1440, height = 900, reduced = true } = {}) {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: width < 700 ? 2 : 1,
    hasTouch: width < 700,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const problems = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`JS : ${e.message.split('\n')[0]}`));
  page.on('console', (m) => {
    const t = m.text();
    if (/hydrat/i.test(t)) problems.push(`hydratation : ${t.split('\n')[0].slice(0, 200)}`);
    else if (m.type() === 'error' && !/Failed to load resource|WebSocket|favicon/.test(t)) problems.push(`console : ${t.split('\n')[0].slice(0, 200)}`);
  });
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/connexion`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.fill('#email', 'owner@barberhouse.test');
  await page.fill('#password', 'banc');
  await page.getByRole('button', { name: /connecter/i }).click();
  await page.waitForURL(/\/app\//, { timeout: 120_000, waitUntil: 'commit' });
  return { browser, context, page, problems };
}

export async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForTimeout(400);
}

export async function noOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `${label} : aucun débordement horizontal (${overflow} px)`);
}

/** Le texte « honnête » d'un envoi, tel que le poste l'affiche. */
export const HONEST = /Prévenu \d{2}:\d{2} ✓|Non joignable|Envoi indisponible|Échec de l’envoi|Aucun envoi/;

/** Nombre de pages d'un PDF (objets /Type /Page, hors /Pages). */
export function pdfPages(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

/** Taille (points) de la première page d'un PDF. */
export function pdfSize(buffer) {
  const m = buffer.toString('latin1').match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return m ? { w: Number(m[3]) - Number(m[1]), h: Number(m[4]) - Number(m[2]) } : null;
}

/**
 * L'ÉTIQUETTE IMPRIMÉE (atelier) : en média print, l'étiquette est
 * visible et elle seule ; le PDF fait UNE page de 62 × 100 mm ; sans QR,
 * ni carré vide ni « Scannez ». Capture à 234 × 378 px (62 × 100 mm à 96 ppp).
 */
export async function checkLabelPrint(page, { entryId, name, expectTitle }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, `/app/${ORG}/file/etiquette/${entryId}`);
  check((await page.title()).startsWith(expectTitle), `${name} : onglet « ${expectTitle} »`);
  await page.emulateMedia({ media: 'print' });
  // Laisser une image au navigateur pour recalculer les styles « print ».
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const label = document.querySelector('article[aria-label]');
    if (!label) return null;
    const r = label.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 3);
    const qr = label.querySelector('[class*="qrZone"]');
    return {
      visibility: getComputedStyle(label).visibility,
      hitInside: !!hit && label.contains(hit),
      qrShown: !!qr && getComputedStyle(qr).display !== 'none',
      bodyBg: getComputedStyle(document.body).backgroundColor,
      text: label.innerText,
    };
  });
  check(!!state, `${name} : étiquette présente`);
  if (!state) return;
  check(state.visibility === 'visible', `${name} : visible en média print (${state.visibility})`);
  check(state.hitInside, `${name} : au premier plan (elementFromPoint dans l’étiquette)`);
  check(!state.qrShown, `${name} : sans QR émis, ni carré vide ni « Scannez »`);
  check(/rgb\(255, 255, 255\)|rgba\(0, 0, 0, 0\)/.test(state.bodyBg), `${name} : fond blanc à l’impression (${state.bodyBg})`);
  await page.setViewportSize({ width: 234, height: 378 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, `${name}-impression.png`) });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = pdfPages(pdf);
  const size = pdfSize(pdf);
  check(pages === 1, `${name} : PDF d’une seule page (${pages})`);
  // 62 × 100 mm = 175,7 × 283,5 pt.
  check(!!size && Math.abs(size.w - 175.7) < 2 && Math.abs(size.h - 283.5) < 2, `${name} : page de 62 × 100 mm (${size ? `${size.w.toFixed(1)} × ${size.h.toFixed(1)} pt` : '?'})`);
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1440, height: 900 });
  return state;
}

export async function finish({ browser, problems }, name) {
  await browser.close();
  for (const p of problems) console.log(`  ✗ ${p}`);
  const bad = failures + problems.length;
  console.log(bad === 0 ? `✓ ${name} : parcours vert` : `✗ ${name} : ${bad} problème(s)`);
  process.exit(bad === 0 ? 0 : 1);
}
