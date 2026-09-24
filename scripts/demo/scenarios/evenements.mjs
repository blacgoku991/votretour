// =====================================================================
// Scénario « Événements et drops » — variante de [SEO § 10.2]
// ---------------------------------------------------------------------
// Atelier Rivoli (commerce fictif) lance « Drop Rivoli 04 » : entrée par
// vagues de quatre, laisser-passer de 20 minutes. Trois personnes
// attendent déjà. Camille s'inscrit, le pro ouvre la vague, le
// laisser-passer s'ouvre sur son téléphone, le personnel le contrôle, et
// le même QR présenté une seconde fois est refusé.
//
// Deux gestes ne sont pas filmables sur le banc (voir lib/event-links.mjs) :
// la notification d'accès (Chromium sans affichage n'en reçoit pas) et
// l'appareil photo du personnel. Ils sont DITS par un carton et une coupe
// visible ; les liens qu'ils ouvriraient sont vérifiés par le serveur, et
// le QR affiché est comparé octet pour octet à l'URL de contrôle.
// =====================================================================

import { tap, type } from '../lib/cursor.mjs';
import { accessPath, scanUrlShownBy } from '../lib/event-links.mjs';
import { Timeline } from '../lib/timeline.mjs';
import { notificationCopy, peopleAheadLabel, ui, waitingCountLabel } from '../lib/vocab.mjs';

const CLIENT = 'app/e/[slug]/ClientExperience.tsx';
const PANEL = 'app/app/[org]/evenements/EventsPanel.tsx';
const PASS = 'app/pass/EventPassCard.tsx';
const SCAN = 'app/scan/[token]/ScanPassCard.tsx';
const CLIENT_NAME = 'Camille';

const CAPTIONS = {
  arrivee: { title: 'Après le scan du QR', body: 'La file officielle du drop, sans rien installer.' },
  inscription: { title: 'Elle prend sa place', body: 'Un prénom, et elle peut attendre ailleurs.' },
  vague: { title: 'Le pro ouvre une vague', body: 'Quatre accès d’un geste, dans l’ordre d’arrivée.' },
  pass: { title: 'Son laisser-passer s’ouvre', body: 'Un QR qui change toutes les 30 s, à usage unique.' },
  controle: { title: 'Contrôle à l’entrée', body: 'Le personnel scanne, vérifie le prénom, valide.' },
  reutilise: { title: 'Une seule entrée par pass', body: 'Présenté une seconde fois, le même QR est refusé.' },
};

export const scenario = {
  id: 'evenements',
  seed: 'evenements',
  metier: 'evenements-et-drops',
  chapters: [
    'Après le scan du QR de l’événement, le public voit la file : trois personnes.',
    'Camille s’inscrit avec son prénom, sans application.',
    'Le pro ouvre la vague suivante : quatre accès, dans l’ordre d’arrivée.',
    'Son laisser-passer s’ouvre : un QR tournant, valable 20 minutes.',
    'À l’entrée, le personnel scanne et valide : « Accès validé ».',
    'Le même QR présenté une seconde fois est refusé.',
  ],
  captions: CAPTIONS,
  teaser: ['pass', 'controle'],
  cards: {
    title: {
      kicker: 'Démonstration · événements et drops',
      title: 'Filmé sur le vrai produit.',
      body: 'À gauche, le poste du pro. À droite, le téléphone d’une participante. Rien n’est accéléré.',
      client: CLIENT_NAME,
      clientHint: 'Vague 1',
      foot: 'Atelier Rivoli est un commerce fictif.',
    },
    end: {
      kicker: 'Rangvia',
      title: 'Faites entrer par vagues.',
      body: 'Pas de campement devant la boutique, pas de pass revendu deux fois.',
      cta: 'rangvia.com/inscription',
      client: CLIENT_NAME,
      clientHint: 'Accès validé',
      foot: 'Démonstration filmée sur le vrai produit, avec un commerce fictif.',
    },
  },
  run,
};

async function run({ phone, tablet, scene, baseUrl, bench, record }) {
  if (!bench.sessionSecret) throw new Error('SESSION_HASH_SECRET du banc introuvable (DEMO_SESSION_SECRET).');
  const locationName = scene.location.name;
  const waveButton = () => tablet.getByRole('button', { name: new RegExp(`^${ui(PANEL, 'Ouvrir la vague suivante')}`) });

  await tablet.goto(`${baseUrl}/app/${scene.org.slug}/evenements`, { waitUntil: 'networkidle' });
  await waveButton().waitFor();
  await phone.goto(`${baseUrl}/e/${scene.plateCode}?event=${scene.event.id}`, { waitUntil: 'networkidle' });
  await phone.getByText(waitingCountLabel(3), { exact: true }).waitFor({ state: 'attached' });
  await Promise.all([phone, tablet].map((p) => p.evaluate(() => document.fonts.ready)));

  const tl = await record();

  await tl.beat('arrivee', CAPTIONS.arrivee, async () => {
    await Timeline.read(3600);
  });

  await tl.beat('inscription', CAPTIONS.inscription, async () => {
    await Timeline.read(600);
    await type(phone.locator('#prenom'), CLIENT_NAME);
    await Timeline.read(700);
    await tap(phone.getByRole('button', { name: ui(CLIENT, 'Rejoindre la file'), exact: true }));
    await phone.getByText(peopleAheadLabel(3), { exact: true }).waitFor({ state: 'attached' });
    await Timeline.read(2600);
  });

  // Coupe visible : le tableau des événements ne se met pas à jour seul,
  // le pro le recharge pour voir la quatrième inscrite.
  await tablet.reload({ waitUntil: 'networkidle' });
  await waveButton().waitFor();

  let entryPass = null;
  await tl.beat('vague', CAPTIONS.vague, async () => {
    await Timeline.read(900);
    await tap(waveButton());
    // Le retour du produit, tel quel : sur le banc, aucun téléphone n'est
    // abonné aux notifications (« 0 notification envoyée »).
    await tablet.getByText(/accès créés/).waitFor();
    entryPass = await passOf(bench.db, scene.event.id);
    await Timeline.read(1400);
    const access = notificationCopy('event_access', { locationName });
    await tl.overlay('notification', 5.0, {
      kicker: 'Notification · texte réel',
      title: access.title,
      body: access.body,
      note: 'Aucun téléphone n’est abonné sur le banc, d’où « 0 notification envoyée ». Un téléphone abonné la reçoit à cet instant.',
    });
  });

  // Coupe visible : le geste « toucher la notification » n'est pas filmé ;
  // le téléphone ouvre le lien qu'elle porte.
  await phone.goto(`${baseUrl}${accessPath(bench.sessionSecret, entryPass.public_id, entryPass.grace_until)}`, { waitUntil: 'networkidle' });
  await phone.getByRole('heading', { name: scene.event.name }).waitFor();
  await phone.locator('img[src^="/api/pass/qr"]').waitFor();
  await phone.evaluate(() => document.fonts.ready);

  await tl.beat('pass', CAPTIONS.pass, async () => {
    await Timeline.read(3800);
  });

  // Coupe visible : l'appareil photo du personnel n'est pas filmé ; la
  // tablette ouvre l'URL que le QR du téléphone encode réellement.
  const target = await scanUrlShownBy(phone, {
    secret: bench.sessionSecret,
    siteUrl: baseUrl,
    publicId: entryPass.public_id,
    tokenHash: entryPass.token_hash,
  });
  await tablet.goto(target, { waitUntil: 'networkidle' });
  await tablet.getByText(ui(SCAN, 'Pass valide'), { exact: true }).waitFor();

  await tl.beat('controle', CAPTIONS.controle, async () => {
    await Timeline.read(1600);
    tl.mark('poster');
    await Timeline.read(600);
    await tap(tablet.getByRole('button', { name: ui(SCAN, 'Valider l’entrée') }));
    await tablet.getByText(ui(SCAN, 'Entrée validée'), { exact: true }).waitFor();
    // Le téléphone l'apprend seul (interrogation toutes les 3 s).
    await phone.getByRole('heading', { name: ui(PASS, 'Accès validé') }).waitFor({ timeout: 15_000 });
    await Timeline.read(2600);
  });

  // Coupe visible : le même QR est présenté une seconde fois.
  await tablet.goto(target, { waitUntil: 'networkidle' });
  await tablet.getByText(ui(SCAN, 'Pass déjà utilisé'), { exact: true }).waitFor();

  await tl.beat('reutilise', CAPTIONS.reutilise, async () => {
    await Timeline.read(3800);
  });

  return tl;
}

/**
 * Le laisser-passer émis pour Camille (lu dans la base du banc : ses
 * identifiants ne voyagent que dans la notification, non filmable).
 */
async function passOf(db, eventId) {
  const rows = await db.select(
    'event_access_passes',
    'select=public_id,token_hash,grace_until,status,queue_entries!inner(client_name)'
      + `&event_id=eq.${eventId}&status=eq.issued`
      + `&queue_entries.client_name=eq.${encodeURIComponent(CLIENT_NAME)}`,
  );
  if (rows.length !== 1) throw new Error(`laisser-passer de ${CLIENT_NAME} : ${rows.length} trouvé(s), 1 attendu`);
  return rows[0];
}
