// =====================================================================
// Scénario « Barbiers » — trame commune de [SEO § 10.2]
// ---------------------------------------------------------------------
// Barber House (commerce fictif), file par professionnel. Karim est en
// pause ; Sofia coiffe Hugo, Léo et Adam attendent pour elle. Camille
// arrive, choisit Sofia et suit sa place jusqu'au fauteuil, puis jusqu'à
// l'avis Google.
//
// Chaque étape attend un état RÉEL de l'écran, avec des textes importés du
// vocabulaire du produit (voir lib/vocab.mjs). Les actions du pro sont de
// vrais touchers sur son poste ; celles de Camille, sur son téléphone.
// =====================================================================

import { tap, type } from '../lib/cursor.mjs';
import { Timeline } from '../lib/timeline.mjs';
import {
  CLIENT_STATUS_LABEL,
  STAFF_STATUS_LABEL,
  notificationCopy,
  peopleAheadLabel,
  profiles,
  ui,
  waitingCountLabel,
} from '../lib/vocab.mjs';

const CLIENT = 'app/e/[slug]/ClientExperience.tsx';
const CLIENT_NAME = 'Camille';
const BARBER = 'Sofia';

/**
 * Légendes des plans (bande sous la tablette). Ce sont des phrases de
 * montage, pas des textes du produit : le montage les relit ici, une
 * retouche ne demande donc pas de retourner.
 */
const CAPTIONS = {
  arrivee: { title: 'Après le scan de la plaque', body: 'Le client voit la file avant de la rejoindre.' },
  inscription: { title: 'Rien à installer', body: 'Un prénom, sa barbière, et il est dans la file.' },
  avance: { title: 'La file avance', body: 'Sofia termine une coupe : le chiffre tombe, en direct.' },
  retour: { title: 'Il prévient qu’il revient', body: 'Un geste, et le poste le sait tout de suite.' },
  tour: { title: 'C’est son tour', body: 'Impossible à manquer, même d’un coup d’œil.' },
  fin: { title: 'Visite terminée', body: 'Le lien vers l’avis Google, au bon moment.' },
};

export const scenario = {
  id: 'barbiers',
  /** Scène posée par bench/seed-demo.mjs. */
  seed: 'barbiers',
  /** Page métier qui montre la vidéo (/pour/barbiers). */
  metier: 'barbiers',
  /** Ce que montre la vidéo, dans l'ordre (légende et manifeste). */
  chapters: [
    'Après le scan de la plaque, le client voit la file : trois personnes.',
    'Il tape son prénom, choisit Sofia et rejoint la file, sans rien installer.',
    'Sofia termine ses coupes : le chiffre tombe en direct, jusqu’à « plus qu’une personne ».',
    'Il touche « Je suis de retour » : le poste affiche « Revient ».',
    'Son tour arrive : l’écran passe au rideau « C’est votre tour ».',
    'Fin de visite : le lien vers l’avis Google s’affiche.',
  ],
  captions: CAPTIONS,
  teaser: ['retour', 'tour'],
  cards: {
    title: {
      kicker: 'Démonstration · barbiers',
      title: 'Filmé sur le vrai produit.',
      // Espaces insécables après « À » : pas de lettre seule en fin de ligne.
      body: 'À gauche, le poste du barbier. À droite, le téléphone de son client. Rien n’est accéléré.',
      client: CLIENT_NAME,
      clientHint: 'Vous',
      foot: 'Barber House est un commerce fictif.',
    },
    end: {
      kicker: 'Rangvia',
      title: 'Ouvrez votre file.',
      body: 'Une plaque au comptoir, et vos clients attendent où ils veulent.',
      cta: 'rangvia.com/inscription',
      client: CLIENT_NAME,
      clientHint: 'À vous',
      foot: 'Démonstration filmée sur le vrai produit, avec un commerce fictif.',
    },
  },
  run,
};

/**
 * Avant le premier plan, hors tournage : les deux écrans sont chargés et
 * dans leur état de départ. Renvoie la fonction qui joue le scénario.
 */
async function run({ phone, tablet, scene, baseUrl, record }) {
  const locationName = scene.location.name;
  const complete = profiles.walkin.vocab.complete;
  const finish = () => tablet.getByRole('button', { name: complete, exact: true, disabled: false }).first();

  await tablet.goto(`${baseUrl}/app/${scene.org.slug}/file`, { waitUntil: 'networkidle' });
  await finish().waitFor();
  await phone.goto(`${baseUrl}/e/${scene.plateCode}`, { waitUntil: 'networkidle' });
  // « 3 personnes dans la file » : Hugo au fauteuil, Léo et Adam.
  await phone.getByText(waitingCountLabel(3), { exact: true }).waitFor({ state: 'attached' });
  await Promise.all([phone, tablet].map((p) => p.evaluate(() => document.fonts.ready)));

  const tl = await record();

  // Rythme : chaque plan laisse ~0,6 s pour lire sa légende avant le
  // premier geste, puis une pause de lecture après chaque changement.
  await tl.beat('arrivee', CAPTIONS.arrivee, async () => {
    await Timeline.read(3600);
  });

  await tl.beat('inscription', CAPTIONS.inscription, async () => {
    await Timeline.read(600);
    await type(phone.locator('#prenom'), CLIENT_NAME);
    await Timeline.read(600);
    await tap(phone.getByRole('button', { name: new RegExp(`^${BARBER}\\b`) }));
    await Timeline.read(800);
    await tap(phone.getByRole('button', { name: ui(CLIENT, 'Rejoindre la file'), exact: true }));
    await phone.getByText(peopleAheadLabel(3), { exact: true }).waitFor({ state: 'attached' });
    // Camille apparaît au poste, en temps réel, sans rechargement.
    await tablet.getByText(CLIENT_NAME, { exact: true }).waitFor();
    await Timeline.read(2800);
  });

  await tl.beat('avance', CAPTIONS.avance, async () => {
    await Timeline.read(600);
    await tap(finish());
    await phone.getByText(peopleAheadLabel(2), { exact: true }).waitFor({ state: 'attached' });
    await Timeline.read(2000);
    await tap(finish());
    await phone.getByText(peopleAheadLabel(1), { exact: true }).waitFor({ state: 'attached' });
    // Le bandeau du téléphone porte mot pour mot le texte de la notification.
    const aheadOne = notificationCopy('ahead_one', { locationName });
    await phone.getByText(aheadOne.body, { exact: true }).waitFor();
    await Timeline.read(1200);
    await tl.overlay('notification', 4.2, {
      kicker: 'Notification · texte réel',
      title: aheadOne.title,
      body: aheadOne.body,
      note: 'Envoyée si le client l’a activée. La bannière du téléphone n’est pas filmée.',
    });
  });

  await tl.beat('retour', CAPTIONS.retour, async () => {
    await Timeline.read(700);
    await tap(phone.getByRole('button', { name: ui(CLIENT, 'Je suis de retour'), exact: true }));
    await phone.getByText(ui(CLIENT, 'Le salon sait que vous revenez'), { exact: true }).waitFor();
    await tablet.getByText(STAFF_STATUS_LABEL.returning, { exact: true }).waitFor();
    await Timeline.read(2800);
  });

  await tl.beat('tour', CAPTIONS.tour, async () => {
    await Timeline.read(600);
    await tap(finish());
    await phone.getByRole('region', { name: CLIENT_STATUS_LABEL.serving }).waitFor();
    await tablet.getByText(CLIENT_NAME, { exact: true }).first().waitFor();
    await Timeline.read(1800);
    tl.mark('poster');
    await Timeline.read(2200);
  });

  await tl.beat('fin', CAPTIONS.fin, async () => {
    await Timeline.read(600);
    await tap(finish());
    await phone.getByRole('heading', { name: notificationCopy('visit_completed', { locationName }).title }).waitFor();
    await Timeline.read(2200);
    // La page Google n'est ni filmée ni imitée : la navigation est
    // bloquée (voir film.mjs) et un carton dit ce qui se passerait.
    await tap(phone.getByRole('link', { name: ui(CLIENT, 'Laisser un avis Google') }));
    await tl.overlay('offscreen', 3.6, {
      on: 'phone',
      kicker: 'Hors du produit · non filmé',
      title: 'La fiche Google de l’établissement s’ouvre.',
      body: 'Le client y laisse son avis. Rangvia n’imite pas la page de Google.',
    });
  });

  return tl;
}
