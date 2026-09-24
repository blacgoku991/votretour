// Recette du poste de GUICHET (accueil administratif et santé, lot P3) —
// voir profiles-lib.mjs.
//
// 1. « Appeler le suivant » : le volet tombe sur le numéro, et le poste
//    dit si la personne a vraiment été prévenue (« Prévenu 14:32 ✓ »,
//    « Non joignable », « Envoi indisponible », « Aucun envoi »).
// 2. Guichet libre : les cases du tableau portent un tiret (pas des cases
//    vides, qui se liraient comme un chargement).
// 3. Santé : aucun prénom, nulle part sur la page, même quand la base en a.
import { join } from 'node:path';
import { check, finish, goto, HONEST, noOverflow, open, ORG, OUT, queueId, seed } from './profiles-lib.mjs';

seed();
const session = await open({ width: 390, height: 844 });
const { page } = session;

console.log('▸ Mairie : appeler le suivant');
const mairie = `/app/${ORG}/file?file=${queueId('Mairie du 11e — Accueil')}`;
await goto(page, mairie);
await noOverflow(page, '390 px');
const select = page.getByLabel('Mon guichet');
if (!(await select.inputValue())) await select.selectOption({ index: 1 });
const station = page.locator('section[aria-labelledby="mon-guichet"]');
if ((await station.getAttribute('data-state')) !== 'free') {
  // Un appel est déjà en cours à ce guichet : on le termine d'abord.
  await station.getByRole('button', { name: 'Terminer' }).click();
  await page.waitForTimeout(1500);
}
if ((await station.getAttribute('data-state')) === 'free') {
  const idle = await station.evaluate((s) => s.querySelector('[class*="idleNumber"]')?.textContent ?? '');
  check(/–/.test(idle), 'guichet libre : un tiret dans les cases du tableau');
  await station.getByRole('button', { name: /Appeler le suivant/i }).click();
}
await station.getByText(HONEST).waitFor({ timeout: 30_000 }).catch(() => {});
const text = await station.innerText();
check(/Appelé il y a/.test(text), 'la carte montre l’appel en cours');
check(HONEST.test(text), `« Appeler le suivant » dit ce qui s’est passé : ${text.match(HONEST)?.[0] ?? 'rien'}`);
await page.screenshot({ path: join(OUT, 'desk-appel-390.png'), fullPage: true });

console.log('▸ Santé : jamais de prénom');
const sante = `/app/${ORG}/file?file=${queueId('Centre de santé Voltaire')}`;
for (const width of [390, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  await goto(page, sante);
  const body = await page.locator('main').innerText();
  const seen = ['Albert', 'Brigitte', 'Chantal', 'Denis', 'Émile', 'Fanny'].filter((n) => body.includes(n));
  check(seen.length === 0, `${width} px : aucun prénom de patient (${seen.join(', ') || 'aucun'})`);
  await noOverflow(page, `${width} px`);
}
await page.screenshot({ path: join(OUT, 'desk-sante-1440.png'), fullPage: true });

await finish(session, 'profiles-desk');
