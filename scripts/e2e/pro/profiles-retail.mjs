// Recette du poste de BOUTIQUE (conseil et retraits, lot P3) — voir
// profiles-lib.mjs.
//
// 1. Compteurs accordés au nombre (« 1 commande prête »).
// 2. « Sortir de la file » (conseil) demande une confirmation en ligne :
//    un seul toucher ne retire jamais personne.
// 3. L'étiquette de sac porte son attache (pas un cercle creux isolé).
// 4. « Commande prête » : la commande passe dans « Prêtes », avec l'état
//    réel de l'envoi.
import { join } from 'node:path';
import { check, finish, goto, HONEST, noOverflow, open, ORG, OUT, queueId, seed } from './profiles-lib.mjs';

seed();
const board = `/app/${ORG}/file?file=${queueId('Maison Lune')}`;
const session = await open({ width: 1440, height: 900 });
const { page } = session;
await goto(page, board);
await noOverflow(page, '1440 px');

console.log('▸ Compteurs');
const labels = (await page.locator('dl dt').allInnerTexts()).map((t) => t.trim().toLowerCase());
const values = (await page.locator('dl dd .sr-only').allTextContents()).map((t) => Number(t.match(/\d+/)?.[0]));
const ready = labels.findIndex((l) => l.startsWith('commande'));
check(ready >= 0 && (values[ready] >= 2 ? labels[ready] === 'commandes prêtes' : labels[ready] === 'commande prête'), `« ${values[ready]} ${labels[ready]} » accordé`);

console.log('▸ Étiquette de sac');
const cord = await page.evaluate(() => {
  const e = document.querySelector('[class*="bagEyelet"]');
  return e ? getComputedStyle(e, '::after').height : null;
});
check(!!cord && parseFloat(cord) > 8, `l’œillet porte son attache (${cord})`);

console.log('▸ Sortir de la file : confirmation');
const advice = page.locator('section[aria-labelledby="boutique-conseil"]');
const before = await advice.locator('li[data-kind="advice"]').count();
const first = advice.locator('li[data-kind="advice"]').first();
await first.getByRole('button', { name: 'Sortir de la file' }).click();
check((await advice.locator('li[data-kind="advice"]').count()) === before, 'un premier toucher ne retire personne');
const dialog = first.getByRole('alertdialog');
check((await dialog.count()) === 1, 'une confirmation en ligne s’ouvre');
await dialog.getByRole('button', { name: 'Annuler' }).click();
check((await advice.locator('li[data-kind="advice"]').count()) === before && (await first.getByRole('alertdialog').count()) === 0, '« Annuler » referme sans rien retirer');
const name = (await first.locator('[class*="motif"]').innerText()).trim();
await first.getByRole('button', { name: 'Sortir de la file' }).click();
await first.getByRole('alertdialog').getByRole('button', { name: 'Sortir de la file' }).click();
// (Le moteur peut aussitôt faire avancer le suivant : on suit le client
// retiré, pas le nombre de lignes.)
await advice.getByText(name, { exact: true }).waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
check((await advice.getByText(name, { exact: true }).count()) === 0, `confirmé : ${name} sort de la file`);

console.log('▸ Commande prête');
const todo = page.locator('[data-tone="todo"] li, [data-tone="preparing"] li').first();
const ref = (await todo.innerText()).match(/n°\s*(\S+)/)?.[1];
await todo.getByRole('button', { name: /Commande\sprête/ }).click();
const readyRow = page.locator('[data-tone="ready"] li').filter({ hasText: ref ?? '' });
await readyRow.getByText(HONEST).waitFor({ timeout: 30_000 }).catch(() => {});
check(HONEST.test(await readyRow.innerText().catch(() => '')), `commande ${ref} prête, et l’envoi est dit`);

await page.screenshot({ path: join(OUT, 'retail-bureau-1440.png'), fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await goto(page, board);
await noOverflow(page, '390 px');
await page.screenshot({ path: join(OUT, 'retail-telephone-390.png'), fullPage: true });

await finish(session, 'profiles-retail');
