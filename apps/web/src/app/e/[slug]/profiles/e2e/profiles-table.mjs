// Recette « table » : couverts, groupes avant vous, table prête en direct
// avec le vrai délai, « J'arrive », installé sans demande d'avis.
// Paramètres : voir bench.mjs.
import { PLACES, check, openClient, recipe, resetPlace, see, staff, thresholdOf } from './bench.mjs';

const place = PLACES.table;

await recipe('table', async () => {
  resetPlace(place);
  const client = await openClient(place);
  const { page } = client;

  await see(page, 'Liste ouverte');
  await page.getByRole('button', { name: 'Un couvert de plus' }).click();
  await page.getByRole('button', { name: 'Un couvert de plus' }).click();
  await page.getByRole('radio', { name: 'Terrasse' }).check();
  check(await page.getByRole('radio', { name: 'Terrasse' }).isChecked(), 'préférence Terrasse');
  await page.locator('#prenom').fill('Karim');
  await client.shot('saisie');
  await page.getByRole('button', { name: 'M’inscrire sur la liste' }).click();

  await see(page, 'avant vous');
  await see(page, '4 couverts');
  await client.shot('suivi');

  await staff(place, 'call', {}, { event: 'called' });
  await page.getByRole('heading', { name: 'Votre table est prête' }).waitFor({ timeout: 10_000 });
  check((await thresholdOf(page)) === 'Accueil', 'linteau « Accueil »');
  await see(page, 'Encore');
  await client.shot('prete');

  await page.getByRole('button', { name: 'J’arrive' }).click();
  await see(page, 'L’accueil sait que vous arrivez');

  await staff(place, 'complete', {}, { event: 'completed' });
  await see(page, 'Bon appétit');
  // L'avis part plus tard, après le repas, par le serveur : jamais ici.
  check((await page.getByText('Laisser un avis Google').count()) === 0, 'pas d’avis à l’installation');
  await client.shot('installe');
  await client.close();
});
