// Recette « atelier appareil » : choix de l'appareil au clavier (vrais
// radios), ticket de dépôt « Dossier 0042 », devis, rideau en direct,
// « J'arrive », rendu. Paramètres : voir bench.mjs.
import { PLACES, check, openClient, recipe, resetPlace, see, staff, thresholdOf } from './bench.mjs';

const place = PLACES.device;

await recipe('atelier appareil', async () => {
  resetPlace(place);
  const client = await openClient(place);
  const { page } = client;

  await see(page, 'Suivez la réparation');
  // Un seul arrêt de tabulation pour le groupe ; les flèches changent d'appareil.
  const phone = page.getByRole('radio', { name: 'Téléphone' });
  await phone.focus();
  await page.keyboard.press('ArrowRight');
  check(await page.getByRole('radio', { name: 'Tablette' }).isChecked(), 'flèche droite : Tablette choisie');
  await page.keyboard.press('ArrowLeft');
  check(await phone.isChecked(), 'flèche gauche : retour à Téléphone');
  await page.locator('#modele').fill('iPhone 13');
  await page.getByRole('button', { name: 'Écran', exact: true }).click();
  if (await page.locator('#prenom').count()) await page.locator('#prenom').fill('Inès');
  await see(page, 'Ne saisissez jamais votre code');
  await client.shot('saisie');
  await page.getByRole('button', { name: 'Déposer mon appareil' }).click();

  // Le ticket de dépôt : pas d'anneau de porte-clés, « Dossier » en toutes lettres.
  await see(page, 'Ticket de dépôt');
  await see(page, 'Dossier');
  check((await page.getByText('Fiche atelier').count()) === 0, 'pas d’étiquette de clé pour un appareil');
  await client.shot('suivi');

  await staff(place, 'set_stage', { stage: 'diagnosis' });
  await staff(place, 'send_quote', { amountCents: 8900, label: 'Écran d’origine' });
  await see(page, 'Devis à valider');
  await page.getByRole('button', { name: 'Accepter le devis' }).click();
  await page.getByRole('button', { name: 'Confirmer l’accord' }).click();
  await see(page, 'l’atelier reprend la main');
  await client.shot('accord');

  await staff(place, 'set_stage', { stage: 'in_repair' });
  await staff(place, 'call', {}, { event: 'called' });
  await page.getByRole('heading', { name: 'Votre appareil est prêt' }).waitFor({ timeout: 10_000 });
  check((await thresholdOf(page)) === 'Comptoir', 'linteau « Comptoir » (vocabulaire appareil)');
  await client.shot('pret');

  await page.getByRole('button', { name: 'J’arrive' }).click();
  await see(page, 'L’atelier sait que vous arrivez');

  await staff(place, 'complete', {}, { event: 'completed' });
  await see(page, 'Merci pour votre confiance');
  await see(page, 'Rendu');
  await client.shot('rendu');
  await client.close();
});
