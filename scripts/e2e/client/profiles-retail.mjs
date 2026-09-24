// Recette « boutique » : retrait de commande — étiquette de sac, rail
// Préparation → Prête, rideau en direct (commande DANS le Seuil, linteau
// « Caisse »), remise. Paramètres : voir bench.mjs.
import { PLACES, check, openClient, recipe, resetPlace, see, staff, thresholdOf } from './bench.mjs';

const place = PLACES.retail;

await recipe('boutique (retrait)', async () => {
  resetPlace(place);
  const client = await openClient(place);
  const { page } = client;

  await see(page, 'Vous venez pour');
  await page.getByRole('button', { name: 'Retirer une commande', exact: true }).click();
  await page.locator('#commande').fill('cmd-1234');
  if (await page.locator('#prenom').count()) await page.locator('#prenom').fill('Léa');
  await client.shot('saisie');
  await page.getByRole('button', { name: 'Rejoindre la file' }).click();

  await see(page, 'devant vous');
  await staff(place, 'set_stage', { stage: 'preparing' });
  await see(page, 'Où en est votre commande');
  await see(page, 'Me prévenir quand elle est prête');
  await client.shot('preparation');

  await staff(place, 'call', {}, { event: 'called' });
  await page.getByRole('heading', { name: 'Votre commande est prête' }).waitFor({ timeout: 10_000 });
  check((await thresholdOf(page)) === 'Caisse', 'linteau « Caisse »');
  check((await page.locator('.seuil').first().getByText('n° CMD-1234').count()) === 1, 'commande dans le Seuil');
  await client.shot('prete');

  await staff(place, 'complete', {}, { event: 'completed' });
  await see(page, 'Commande remise');
  await client.shot('remise');
  await client.close();
});
