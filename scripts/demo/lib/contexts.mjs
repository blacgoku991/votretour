// =====================================================================
// Rangvia — navigateurs, appareils filmés et enregistrement « HD »
// ---------------------------------------------------------------------
// Constat de la mini-étude V0 (Chromium 1194, Playwright 1.63) :
//
//  - `recordVideo` ne filme qu'en pixels CSS. Avec un téléphone à
//    `deviceScaleFactor: 2` et `size: 780×1688`, l'image est de 390×844,
//    posée dans le coin et complétée de gris (aucun agrandissement, mais
//    rien de net non plus), puis encodée en VP8 à 1 Mb/s ;
//  - le screencast CDP (`Page.startScreencast`) livre lui aussi des
//    images en pixels CSS… sauf si Chromium est lancé avec
//    `--force-device-scale-factor` : il rend alors en pixels physiques
//    (780×1688 pour le téléphone). En PNG, sans perte, jusqu'à 60 i/s.
//
// D'où le « mode HD » : un navigateur par appareil (le facteur d'échelle
// est un réglage du processus), un screencast PNG par page filmée, chaque
// image horodatée. Le montage recompose ensuite des vidéos à cadence fixe.
// =====================================================================

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { TOUCH_OVERLAY } from './cursor.mjs';

/** Chromium du poste (celui de Playwright 1.56) si présent, sinon celui de playwright-core. */
export const CHROMIUM = process.env.DEMO_CHROMIUM
  ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

/** Navigateur Android réaliste : le téléphone filmé n'est pas un iPhone (pas d'App Clip simulé). */
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

/**
 * Les appareils filmés. `scale` : facteur d'échelle forcé du processus,
 * donc la résolution des images (téléphone 780×1688, tablette 2049×1536).
 * La tablette du comptoir est à 1,5 et non 2 : à 2, le screencast tombait
 * à 10 i/s pendant un défilement, contre 21 à 1,5 (mesures V0).
 */
export const DEVICES = {
  phone: {
    scale: 2,
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: ANDROID_UA,
    },
  },
  tablet: {
    scale: 1.5,
    context: {
      viewport: { width: 1366, height: 1024 },
      deviceScaleFactor: 1.5,
      isMobile: false,
      hasTouch: true,
    },
  },
};

const COMMON = {
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  colorScheme: 'dark',
  // Les animations du produit (volet, rideau, lattes) font partie de ce
  // qu'on montre : le mouvement n'est pas réduit pendant le tournage.
  reducedMotion: 'no-preference',
};

export async function launchDevice(kind) {
  const device = DEVICES[kind];
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=none',
      `--force-device-scale-factor=${device.scale}`,
      '--hide-scrollbars',
    ],
  });
  return { browser, device };
}

/**
 * Contexte filmé. `blockHosts` : navigations vers l'extérieur, bloquées
 * (la fiche Google n'est jamais filmée ni simulée : un carton la remplace).
 */
export async function newDeviceContext({ browser, device }, { storageState, blockHosts = [], problems, label }) {
  const context = await browser.newContext({ ...COMMON, ...device.context, storageState });
  await context.addInitScript({ content: TOUCH_OVERLAY });
  for (const host of blockHosts) {
    await context.route(`https://${host}/**`, (route) => route.abort('blockedbyclient'));
  }
  context.on('page', (page) => watch(page, label, problems));
  return context;
}

/**
 * Surveille une page filmée : une erreur JavaScript, un avertissement
 * d'hydratation ou une réponse 5xx font échouer le tournage, même si
 * l'image semble juste.
 */
export function watch(page, label, problems) {
  page.on('pageerror', (error) => problems.push(`${label} — erreur JS : ${error.message.split('\n')[0]}`));
  page.on('console', (message) => {
    const text = message.text();
    if (/hydrat/i.test(text)) problems.push(`${label} — hydratation : ${text.split('\n')[0].slice(0, 200)}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) {
      problems.push(`${label} — réponse ${response.status()} sur ${new URL(response.url()).pathname}`);
    }
  });
}

/**
 * Connexion du pro dans un contexte NON filmé ; seul l'état de session
 * (cookies) passe au contexte filmé : l'écran de connexion et le mot de
 * passe n'apparaissent jamais à l'image.
 */
export async function loginState(browser, baseUrl, { email, password }) {
  const context = await browser.newContext({ ...COMMON, viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/connexion`, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.getByRole('button', { name: /connecter/i }).click();
    await page.waitForURL(/\/app\//, { timeout: 60_000 });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

/**
 * Enregistreur d'une page : screencast PNG, une image par changement
 * d'affichage, horodatée par Chromium (secondes depuis l'époque, même
 * horloge que `Date.now()`). Rien n'est envoyé quand l'écran ne bouge
 * pas : le montage tient la dernière image.
 */
export async function startRecorder(page, dir) {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  let size = null;
  let stopped = false;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    // Accusé de réception immédiat : Chromium n'envoie l'image suivante
    // qu'après lui ; l'écriture sur disque se fait en parallèle.
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (stopped) return;
    const buffer = Buffer.from(data, 'base64');
    if (!size) size = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    const file = `${String(frames.length).padStart(6, '0')}.png`;
    frames.push({ t: metadata.timestamp ?? Date.now() / 1000, file });
    writes.push(writeFile(join(dir, file), buffer));
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 4096, maxHeight: 4096, everyNthFrame: 1 });
  return {
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {});
      stopped = true;
      await Promise.all(writes);
      await cdp.detach().catch(() => {});
      const index = { size, frames };
      writeFileSync(join(dir, 'frames.json'), JSON.stringify(index));
      return index;
    },
  };
}
