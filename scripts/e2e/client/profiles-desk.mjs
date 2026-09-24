// Recette « guichet » : service administratif, puis santé (aucun prénom,
// aucun avis). Numéro, appel au guichet reçu en direct (numéro DANS le
// Seuil, linteau « Guichet »), fin « Reprendre un numéro ».
// Paramètres : voir bench.mjs.
import { PLACES, check, openClient, recipe, resetPlace, see, staff, thresholdOf } from './bench.mjs';

for (const [label, place, sensitive] of [
  ['guichet (mairie)', PLACES.desk, false],
  ['guichet (santé)', PLACES.health, true],
]) {
  await recipe(label, async () => {
    resetPlace(place);
    const client = await openClient(place);
    const { page } = client;

    await see(page, 'Votre numéro');
    if (sensitive) check((await page.locator('#prenom').count()) === 0, 'santé : aucun prénom demandé');
    const motif = page.getByRole('group').getByRole('button').first();
    if (await motif.count()) await motif.click();
    await client.shot('saisie');
    await page.getByRole('button', { name: 'Prendre un numéro' }).click();

    await see(page, 'devant vous');
    await client.shot('suivi');

    await staff(place, 'call', { deskLabel: 'Guichet 4' }, { event: 'called' });
    await page.getByRole('heading', { name: 'Guichet 4' }).waitFor({ timeout: 10_000 });
    check((await thresholdOf(page)) === 'Guichet', 'linteau « Guichet »');
    // Le numéro appelé est dans le cadre, sous le titre.
    const inside = await page.locator('.seuil').first().getByText(/^Ticket [A-Z]+-\d+$/).count();
    check(inside === 1, 'numéro dans le Seuil');
    await client.shot('appel');

    await staff(place, 'complete', {}, { event: 'completed' });
    await see(page, 'Merci de votre visite');
    await see(page, 'Reprendre un numéro');
    check((await page.getByText('Comptoir', { exact: true }).count()) === 0, 'pas de « Comptoir » au guichet');
    if (sensitive) check((await page.getByText('Laisser un avis Google').count()) === 0, 'santé : aucune demande d’avis');
    await client.shot('fin');
    await client.close();
  });
}
