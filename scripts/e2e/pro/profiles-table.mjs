// Recette du poste de SALLE (restaurant, lot P3) — voir profiles-lib.mjs.
//
// 1. « Table libre pour 4 » propose un groupe selon la règle transparente,
//    et la raison se lit sans deux-points orphelin (espace insécable).
// 2. La touche d'appel est d'une seule casse : « APPELER KARIM · 4 ».
// 3. L'appel : le groupe passe dans « Appelés », avec un compte à rebours
//    (minuteur) et l'état réel de l'envoi.
// 4. Les compteurs disent « à placer » (appelés compris), comme la base.
import { join } from 'node:path';
import { check, finish, goto, HONEST, noOverflow, open, ORG, OUT, queueId, seed } from './profiles-lib.mjs';

seed();
const qid = queueId('Chez Paul');
const board = `/app/${ORG}/file?file=${qid}`;
const session = await open({ width: 390, height: 844 });
const { page } = session;

await goto(page, board);
await noOverflow(page, '390 px');

console.log('▸ Compteurs');
const labels = (await page.locator('dl dt').allInnerTexts()).map((t) => t.trim().toLowerCase());
check(labels[0] === 'groupes à placer' && labels[1] === 'couverts à placer', `compteurs : ${labels.join(', ')}`);

console.log('▸ Table libre pour 4');
await page.getByRole('group', { name: 'Taille de la table libérée' }).getByRole('button', { name: /^4/ }).click();
const suggestion = page.locator('[aria-live="polite"] p').first();
await suggestion.waitFor({ timeout: 20_000 });
const reason = await suggestion.textContent();
check(!!reason && !/ [:;?!]/.test(reason), `la raison garde son deux-points attaché : « ${reason} »`);
const key = page.locator('button.btn--key');
const keyStyle = await key.evaluate((b) => ({ transform: getComputedStyle(b).textTransform, text: b.innerText }));
check(keyStyle.transform === 'uppercase' && keyStyle.text === keyStyle.text.toUpperCase(), `touche d’une seule casse : « ${keyStyle.text} »`);
await page.screenshot({ path: join(OUT, 'table-suggestion-390.png'), fullPage: true });

console.log('▸ Appeler');
const who = keyStyle.text.replace(/\s+/g, ' ').match(/APPELER (.+) · \d+/i)?.[1] ?? '';
await key.click();
const row = page.locator('#salle-appeles ~ ul > li').filter({ hasText: new RegExp(who, 'i') });
await row.first().waitFor({ timeout: 30_000 }).catch(() => {});
check((await row.count()) === 1, `${who} passe dans « Appelés »`);
check((await row.locator('[role="timer"]').count()) === 1, 'compte à rebours annoncé comme minuteur');
await row.getByText(HONEST).waitFor({ timeout: 20_000 }).catch(() => {});
check(HONEST.test(await row.innerText()), 'l’état réel de l’envoi est affiché');

console.log('▸ Liste et compteurs alignés');
const waiting = Number((await page.locator('#salle-attente').innerText()).match(/\d+/)?.[0]);
const called = await page.locator('#salle-appeles ~ ul > li').count();
const groups = Number((await page.locator('dl dd .sr-only').first().textContent()).match(/\d+/)?.[0]);
check(groups === waiting + called, `« groupes à placer » = en attente + appelés (${groups} = ${waiting} + ${called})`);

await page.setViewportSize({ width: 1440, height: 900 });
await goto(page, board);
await noOverflow(page, '1440 px');
await page.screenshot({ path: join(OUT, 'table-bureau-1440.png'), fullPage: true });

await finish(session, 'profiles-table');
