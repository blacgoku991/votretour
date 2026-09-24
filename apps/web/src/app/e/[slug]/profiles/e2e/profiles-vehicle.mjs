// Recette « atelier véhicule » : dépôt, étapes, devis (et son 409), rideau
// en direct, « J'arrive », rendu. Paramètres : voir bench.mjs.
import { BASE, PLACES, check, currentStage, openClient, recipe, resetPlace, see, staff, thresholdOf } from './bench.mjs';

const place = PLACES.vehicle;

await recipe('atelier véhicule', async () => {
  resetPlace(place);
  const client = await openClient(place);
  const { page } = client;

  // Inscription : la plaque vide montre le format en fantôme ; la saisie
  // se met en forme pendant la frappe.
  await see(page, 'Suivez votre véhicule');
  await client.shot('inscription');
  await page.locator('#immatriculation').pressSequentially('fx482kl', { delay: 20 });
  check((await page.locator('#immatriculation').inputValue()) === 'FX-482-KL', 'plaque mise en forme pendant la frappe');
  await page.locator('#modele').fill('Peugeot 208');
  const freins = page.getByRole('button', { name: 'Freins', exact: true });
  await freins.click();
  check((await freins.getAttribute('aria-pressed')) === 'true', 'motif choisi (bascule)');
  if (await page.locator('#prenom').count()) await page.locator('#prenom').fill('Camille');
  await client.shot('saisie');
  await page.getByRole('button', { name: 'Déposer mon véhicule' }).click();

  // Suivi : l'étiquette de clé, le rail, l'étape « Reçu ».
  await see(page, 'Fiche atelier');
  await see(page, 'Où en est votre véhicule');
  check((await currentStage(page)).startsWith('Reçu'), 'étape courante « Reçu »');
  await client.shot('recu');

  // Le pro passe au diagnostic, puis envoie un devis : reçu en direct.
  await staff(place, 'set_stage', { stage: 'diagnosis' });
  await page.waitForFunction(() => !document.querySelector('[aria-current="step"]')?.textContent?.startsWith('Reçu'));
  await staff(place, 'send_quote', { amountCents: 23500, label: 'Plaquettes et disques avant' });
  await see(page, 'Devis à valider');
  await client.shot('devis');

  // Le garage modifie le devis sans que la page le sache encore : l'accord
  // sur l'ancien montant est refusé (409), la carte le dit et montre le nouveau.
  await staff(place, 'send_quote', { amountCents: 24500, label: 'Plaquettes et disques avant' }, { silent: true });
  await page.getByRole('button', { name: 'Accepter le devis' }).click();
  await page.getByRole('button', { name: 'Confirmer l’accord' }).click();
  await see(page, 'vient de modifier le devis');
  await see(page, '245');
  await client.shot('devis-modifie');

  // Accord sur le bon devis : la carte ET le rail le disent (plus de
  // « Devis à valider » en relief au-dessus de « Devis accepté »).
  await page.getByRole('button', { name: 'Accepter le devis' }).click();
  await page.getByRole('button', { name: 'Confirmer l’accord' }).click();
  await see(page, 'Devis accepté');
  check((await currentStage(page)) === 'Devis accepté · le garage reprend la main', 'latte courante après accord');
  await client.shot('accord');

  // Réparation, promesse du garage, puis « Prêt · prévenir » : le rideau
  // tombe page ouverte, depuis l'étiquette.
  await staff(place, 'set_stage', { stage: 'in_repair' });
  await staff(place, 'set_eta', { readyEta: new Date(Date.now() + 3 * 3600_000).toISOString() });
  await see(page, 'annoncé par le garage');
  await client.shot('reparation');

  // Même téléphone, page d'une file de barbiers du même établissement :
  // la fiche d'atelier reste une fiche (étapes, plaque), jamais une latte.
  const walkinPage = await page.context().newPage();
  await walkinPage.goto(`${BASE}/e/${PLACES.walkin.slug}`, { waitUntil: 'networkidle', timeout: 90_000 });
  await see(walkinPage, 'Où en est votre véhicule');
  check((await walkinPage.getByText('devant vous').count()) === 0, 'page walkin : pas de Rang pour une fiche d’atelier');
  await walkinPage.close();
  await staff(place, 'call', {}, { event: 'called' });
  await page.getByRole('heading', { name: 'Votre véhicule est prêt' }).waitFor({ timeout: 10_000 });
  check((await thresholdOf(page)) === 'Réception atelier', 'linteau « Réception atelier »');
  await client.shot('pret');

  await page.getByRole('button', { name: 'J’arrive' }).click();
  await see(page, 'Le garage sait que vous arrivez');
  await client.shot('j-arrive');

  await staff(place, 'complete', {}, { event: 'completed' });
  await see(page, 'Merci pour votre confiance');
  check(await page.getByRole('link', { name: 'Laisser un avis Google' }).isVisible(), 'avis Google proposé au garage');
  await client.shot('rendu');
  await client.close();
});
