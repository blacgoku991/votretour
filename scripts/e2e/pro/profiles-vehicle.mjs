// Recette du poste ATELIER VÉHICULE (lot P3) — voir profiles-lib.mjs.
//
// 1. Le planning tient dans la largeur, de 1280 à 1920 px : quatre
//    colonnes, la touche « Prêt · prévenir » visible, sans défilement
//    horizontal. Au téléphone (390 px), le pupitre montre ses quatre
//    stations et la colonne choisie est retenue au rechargement.
// 2. Parcours : recherche par plaque partielle, prise en charge, « Prêt ·
//    prévenir » (le poste dit ce qui s'est vraiment passé), « Rendu au
//    client » (la bande « Rendus aujourd'hui » compte la fiche).
// 3. L'étiquette de clé s'imprime : une page de 62 × 100 mm, sans QR puis
//    avec le QR de suivi émis au geste « Imprimer ».
import { join } from 'node:path';
import { check, checkLabelPrint, finish, goto, HONEST, noOverflow, open, ORG, OUT, pdfPages, queueId, seed, sql } from './profiles-lib.mjs';

seed();
const qid = queueId('Garage des Tilleuls');
const board = `/app/${ORG}/file?file=${qid}`;
const session = await open({ width: 1440, height: 900 });
const { page } = session;

console.log('▸ Planning au bureau');
for (const width of [1280, 1440, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  await goto(page, board);
  const m = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('section[data-lane]')].filter((s) => s.id.startsWith('colonne-'));
    const vw = document.documentElement.clientWidth;
    const key = [...document.querySelectorAll('button')].find((b) => /Prêt\s·\sprévenir/.test(b.textContent ?? ''));
    const kr = key?.getBoundingClientRect();
    return {
      columns: cols.length,
      inView: cols.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 150 && r.left >= 0 && r.right <= vw; }).length,
      titles: cols.map((c) => c.querySelector('h2')?.textContent?.replace(/\d+$/, '').trim()),
      keyInView: !!kr && kr.left >= 0 && kr.right <= vw && kr.width > 0 && key.scrollWidth <= key.clientWidth + 1,
      stripShown: getComputedStyle(document.querySelector('nav[aria-label="Colonnes de l’atelier"]')).display !== 'none',
    };
  });
  check(m.columns === 4 && m.inView === 4, `${width} px : les quatre colonnes dans la largeur (${m.inView}/${m.columns})`);
  check(m.keyInView, `${width} px : « Prêt · prévenir » visible et entier`);
  check(!m.stripShown, `${width} px : pas de pupitre (les colonnes sont toutes là)`);
  await noOverflow(page, `${width} px`);
  if (width === 1440) {
    check(JSON.stringify(m.titles) === JSON.stringify(['À prendre en charge', 'En atelier', 'En attente client / pièce', 'Prêts à récupérer']), `titres de colonnes : ${m.titles.join(' | ')}`);
    await page.screenshot({ path: join(OUT, 'vehicle-bureau-1440.png'), fullPage: true });
  }
}

console.log('▸ Compteurs accordés');
const counters = await page.locator('dl dt').allInnerTexts().catch(() => []);
check(counters.some((t) => /^prêt$/i.test(t.trim())), `« 1 prêt » au singulier (${counters.join(', ')})`);

console.log('▸ Filtre par étape en tête de colonne');
await page.getByRole('button', { name: /^Réparation/ }).click();
const filtered = await page.locator('#colonne-workshop article').count();
check(filtered === 2, `« En atelier », filtre « Réparation » : 2 fiches (${filtered})`);
await page.getByRole('button', { name: /^Réparation/ }).click();

console.log('▸ Recherche par plaque partielle');
await page.fill('input[type="search"]', 'ab 123-c');
await page.waitForTimeout(300);
check((await page.locator('article[aria-label^="Fiche"]').count()) === 1, '« ab 123-c » trouve AB-123-CD, et elle seule');
await page.fill('input[type="search"]', '');

console.log('▸ Prendre en charge');
const gh = page.locator('article[aria-label^="Fiche GH-907-TB"]');
await gh.getByRole('button', { name: 'Prendre en charge' }).click();
await page.locator('#colonne-workshop article[aria-label^="Fiche GH-907-TB"]').waitFor({ timeout: 30_000 }).catch(() => {});
check((await page.locator('#colonne-workshop article[aria-label^="Fiche GH-907-TB"]').count()) === 1, 'GH-907-TB passe dans « En atelier »');

console.log('▸ Prêt · prévenir');
const ab = page.locator('article[aria-label^="Fiche AB-123-CD"]');
await ab.getByRole('button', { name: /Prêt\s·\sprévenir/ }).click();
const abReady = page.locator('#colonne-ready article[aria-label^="Fiche AB-123-CD"]');
await abReady.waitFor({ timeout: 30_000 }).catch(() => {});
await abReady.getByText(HONEST).waitFor({ timeout: 30_000 }).catch(() => {});
check((await abReady.count()) === 1, 'AB-123-CD passe dans « Prêts à récupérer »');
const notice = (await abReady.innerText().catch(() => '')).match(HONEST)?.[0] ?? null;
check(!!notice, `le poste dit ce qui s’est passé : ${notice ?? 'rien'}`);

console.log('▸ Rendu au client');
await abReady.getByRole('button', { name: 'Rendu au client' }).click();
await abReady.waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
const band = page.getByRole('button', { name: /rendus? aujourd’hui/i });
await band.click();
const bandText = await page.locator('#rendus-liste').innerText().catch(() => '');
check(/AB-123-CD/.test(bandText), 'la bande « Rendus aujourd’hui » liste AB-123-CD');

console.log('▸ Téléphone : le pupitre et la colonne retenue');
await page.setViewportSize({ width: 390, height: 844 });
await goto(page, board);
const strip = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="Colonnes de l’atelier"]');
  const vw = document.documentElement.clientWidth;
  const stations = [...nav.querySelectorAll('button')];
  return { n: stations.length, inView: stations.filter((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= vw; }).length };
});
check(strip.n === 4 && strip.inView === 4, `390 px : quatre stations visibles (${strip.inView}/${strip.n})`);
await page.getByRole('button', { name: /Prêts à récupérer/ }).click();
await goto(page, board);
check((await page.locator('#colonne-ready').isVisible()) && !(await page.locator('#colonne-intake').isVisible()), 'au rechargement, « Prêts » reste ouverte');
await noOverflow(page, '390 px');
await page.screenshot({ path: join(OUT, 'vehicle-telephone-390.png'), fullPage: true });

console.log('▸ Étiquette de clé');
const keyEntry = sql(`select e.public_id from public.queue_entries e where e.queue_id = '${qid}' and e.details->>'registration' = 'EZ-311-QA'`);
const plain = await checkLabelPrint(page, { entryId: keyEntry, name: 'vehicle-etiquette', expectTitle: 'Étiquette de clé' });
check(!!plain && /Réf\./.test(plain.text) && !/EZ-311-QA/.test(plain.text), 'étiquette de clé : référence, plaque masquée (jamais en clair)');
// Avec le QR : émis au geste « Imprimer » ; la boîte d'impression est remplacée.
await goto(page, `/app/${ORG}/file/etiquette/${keyEntry}`);
await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed ?? 0) + 1; }; });
await page.getByRole('button', { name: 'Imprimer avec le QR de suivi' }).click();
await page.waitForFunction(() => window.__printed === 1, null, { timeout: 30_000 }).catch(() => {});
check(await page.evaluate(() => window.__printed === 1), 'l’impression part une fois le QR posé');
await page.emulateMedia({ media: 'print' });
const withQr = await page.evaluate(() => {
  const qr = document.querySelector('article[aria-label] [class*="qrZone"]');
  return !!qr && getComputedStyle(qr).display !== 'none' && !!qr.querySelector('svg');
});
check(withQr, 'avec le QR : le QR et « Scannez » sont imprimés');
const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
check(pdfPages(pdf) === 1, `avec le QR : une seule page (${pdfPages(pdf)})`);
await page.setViewportSize({ width: 234, height: 378 });
await page.screenshot({ path: join(OUT, 'vehicle-etiquette-qr-impression.png') });
await page.emulateMedia({ media: 'screen' });

await finish(session, 'profiles-vehicle');
