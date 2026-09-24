// Recette du poste ATELIER APPAREILS (lot P3) — voir profiles-lib.mjs.
//
// 1. Le « ticket de dépôt » (conception, § 4.3) : pas d'œillet de clé, un
//    bord droit dentelé par un masque, une souche marquée d'un pointillé.
// 2. Le vocabulaire d'un téléphone : « Étiquette de dépôt », jamais « de
//    clé » (menu, onglet, surtitre, nom accessible) ; sur l'étiquette, pas
//    de ligne « Réf. » qui répéterait le numéro de dossier.
// 3. Parcours : devis envoyé (« en attente depuis »), recherche d'un
//    dossier sans ses zéros, étiquette imprimée sur une page.
import { join } from 'node:path';
import { check, checkLabelPrint, finish, goto, noOverflow, open, ORG, OUT, queueId, seed, sql } from './profiles-lib.mjs';

seed();
const qid = queueId('PhoneFix République');
const board = `/app/${ORG}/file?file=${qid}`;
const session = await open({ width: 1440, height: 900 });
const { page } = session;

// Un devis envoyé il y a 42 minutes, sans réponse.
sql(`update public.queue_entries set details = jsonb_set(details, '{quote,sentAt}', to_jsonb(now() - interval '42 minutes'))
     where queue_id = '${qid}' and ticket_no = 3`);

console.log('▸ Le ticket de dépôt');
await goto(page, board);
const look = await page.evaluate(() => {
  const card = document.querySelector('article[aria-label^="Dossier"]');
  const cs = getComputedStyle(card);
  return {
    eyelets: document.querySelectorAll('article[aria-label^="Dossier"] [class*="eyelet"]').length,
    mask: `${cs.maskImage || ''} ${cs.webkitMaskImage || ''}`,
    stub: getComputedStyle(card, '::after').borderLeftStyle,
  };
});
check(look.eyelets === 0, 'pas d’œillet de clé sur un appareil');
check(/radial-gradient/.test(look.mask), 'bord droit dentelé (masque radial)');
check(look.stub === 'dashed', 'souche marquée d’un pointillé');
await noOverflow(page, '1440 px');
await page.screenshot({ path: join(OUT, 'device-bureau-1440.png'), fullPage: true });

console.log('▸ Devis en attente');
const quote = await page.locator('article[aria-label^="Dossier 0003"]').innerText();
check(/Devis 89,00\s€/.test(quote) && /en attente depuis 4[23]\smin/.test(quote), 'puce de devis : « Devis 89,00 € · en attente depuis 42 min »');

console.log('▸ Recherche d’un dossier sans ses zéros');
await page.fill('input[type="search"]', '4');
await page.waitForTimeout(300);
check((await page.locator('article[aria-label^="Dossier"]').count()) === 1, '« 4 » trouve le dossier 0004');
await page.fill('input[type="search"]', '');

console.log('▸ Vocabulaire de l’étiquette');
const card = page.locator('article[aria-label^="Dossier 0002"]');
await card.getByRole('button', { name: /Plus d’actions/ }).click();
const menu = await card.innerText();
check(/Étiquette de dépôt/.test(menu) && !/clé/i.test(menu.replace(/Clés reçues|Clés rendues/g, '')), 'menu : « Étiquette de dépôt », jamais « de clé »');
await page.keyboard.press('Escape');

const entry = sql(`select public_id from public.queue_entries where queue_id = '${qid}' and ticket_no = 2`);
await goto(page, `/app/${ORG}/file/etiquette/${entry}`);
const screen = await page.evaluate(() => ({
  eyebrow: document.querySelector('main .t-label, [class*="intro"] .t-label')?.textContent,
  aria: document.querySelector('article[aria-label]')?.getAttribute('aria-label'),
  text: document.querySelector('article[aria-label]')?.innerText ?? '',
}));
check(screen.eyebrow === 'Étiquette de dépôt', `surtitre : ${screen.eyebrow}`);
check(/^Étiquette de dépôt, dossier 0002/.test(screen.aria ?? ''), `nom accessible : ${screen.aria}`);
check(!/Réf\./.test(screen.text), 'pas de « Réf. » sous le numéro de dossier');
await checkLabelPrint(page, { entryId: entry, name: 'device-etiquette', expectTitle: 'Étiquette de dépôt' });

console.log('▸ Téléphone');
await page.setViewportSize({ width: 390, height: 844 });
await goto(page, board);
await noOverflow(page, '390 px');
await page.screenshot({ path: join(OUT, 'device-telephone-390.png'), fullPage: true });

await finish(session, 'profiles-device');
