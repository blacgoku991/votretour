#!/usr/bin/env node
// =====================================================================
// Rangvia — données fictives du tournage
// ---------------------------------------------------------------------
//   node scripts/demo/bench/seed-demo.mjs barbiers   # pose la scène, l'affiche
//
// Le tournage (`film.mjs`) importe `seedDemo()` et l'appelle lui-même :
// le compte pro est créé avec un mot de passe ALÉATOIRE, gardé en mémoire
// le temps de la connexion et jamais écrit (ni fichier, ni journal, ni
// argument de processus). Lancé seul, ce script pose la même scène pour
// l'inspecter ; le mot de passe n'est pas affiché, le compte ne sert donc
// qu'à regarder la base.
//
// Tout passe par l'API du banc, comme l'application : PostgREST et la clé
// service_role LOCALE (`provision_organization`, `add_walkin`,
// `staff_queue_action`, `set_queue_status`), plus l'API d'administration
// de GoTrue pour le compte. Aucune écriture SQL directe, aucun état
// fabriqué : les personnes « de fond » entrent par les fonctions du moteur.
//
// Les commerces, prénoms et adresses sont fictifs. Les numéros de
// téléphone sont pris dans la plage que l'ARCEP réserve à la fiction
// (01 99 00 xx xx) : un spectateur qui les composerait n'appellerait
// personne.
// =====================================================================

import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { benchConfig, runGuarded } from './guard.mjs';
import { supabaseClient, inList } from './supabase.mjs';

/** Préfixe de toute organisation du tournage : `reset.mjs` les retrouve par lui. */
export const DEMO_SLUG_PREFIX = 'demo-';
/** Domaine réservé (.test, RFC 2606) des comptes éphémères du tournage. */
export const DEMO_EMAIL_DOMAIN = 'demo.rangvia.test';

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

/**
 * Les scènes. Chaque personne « de fond » a un prénom fictif, un
 * professionnel et des heures plausibles (minutes avant le tournage) :
 * sans elles, le poste afficherait « depuis 0 min » partout.
 */
export const SCENES = {
  barbiers: {
    slug: 'demo-barbiers',
    orgName: 'Barber House',
    activity: 'barber',
    locationName: 'Barber House — Paris 11',
    queueMode: 'per_staff',
    location: {
      address_line1: '42 rue Oberkampf',
      postal_code: '75011',
      city: 'Paris',
      phone: '01 99 00 42 11',
      google_review_url: 'https://search.google.com/local/writereview?placeid=DEMO-BARBER-HOUSE',
    },
    queue: {
      allow_staff_choice: true,
      allow_service_choice: false,
      advance_mode: 'auto_serve',
      ask_client_name: true,
    },
    // Karim est en pause : le poste tient sur l'écran de la tablette (une
    // seule prestation en cours) et Camille choisit Sofia, sa barbière.
    staff: [
      { name: 'Karim', title: 'Barbier', accent: 'signal', onBreak: true },
      { name: 'Sofia', title: 'Barbière', accent: 'jade' },
    ],
    // Dans l'ordre d'arrivée. `serving` : au fauteuil depuis N minutes.
    people: [
      { name: 'Hugo', staff: 'Sofia', joined: 27, serving: 16 },
      { name: 'Léo', staff: 'Sofia', joined: 11 },
      { name: 'Adam', staff: 'Sofia', joined: 5 },
    ],
  },
  evenements: {
    slug: 'demo-evenements',
    orgName: 'Atelier Rivoli',
    activity: 'event',
    locationName: 'Atelier Rivoli — Paris 4',
    queueMode: 'shared',
    location: {
      address_line1: '18 rue de Rivoli',
      postal_code: '75004',
      city: 'Paris',
      phone: '01 99 00 18 04',
      google_review_url: null,
    },
    queue: {
      allow_staff_choice: false,
      allow_service_choice: false,
      advance_mode: 'auto_serve',
      ask_client_name: true,
    },
    staff: [{ name: 'Inès', title: 'Contrôle', accent: 'signal' }],
    people: [
      { name: 'Yanis', staff: null, joined: 14 },
      { name: 'Clara', staff: null, joined: 12 },
      { name: 'Samir', staff: null, joined: 9 },
    ],
    event: {
      name: 'Drop Rivoli 04',
      heroTitle: 'Drop Rivoli 04',
      rulesText: 'Un laisser-passer par personne, valable 20 minutes après son envoi.',
      waveSize: 4,
      passValidMinutes: 20,
      graceMinutes: 5,
    },
  },
};

/** Mot de passe tiré à chaque tournage : 24 octets, jamais écrit. */
function randomPassword() {
  return randomBytes(24).toString('base64url');
}

/**
 * Pose la scène d'un métier et renvoie de quoi la filmer. Toute scène
 * précédente du même slug est d'abord supprimée : un tournage interrompu
 * se relance sans nettoyage manuel.
 */
export async function seedDemo(metier, { config = benchConfig(), log = () => {} } = {}) {
  const scene = SCENES[metier];
  if (!scene) throw new Error(`scène inconnue : ${metier} (connues : ${Object.keys(SCENES).join(', ')})`);
  const db = supabaseClient(config);

  await removeDemoOrganizations(db, { slugs: [scene.slug], log });

  // Adresse fixe, lisible à l'image (bas de la barre latérale du poste).
  // Un compte resté orphelin d'un tournage interrompu avant la création de
  // l'organisation est supprimé d'abord : la création ne bute pas dessus.
  const email = `${metier}@${DEMO_EMAIL_DOMAIN}`;
  for (const orphan of await db.select('profiles', `select=id&email=eq.${encodeURIComponent(email)}`)) {
    await db.deleteUser(orphan.id);
  }
  const password = randomPassword();
  const user = await db.createUser(email, password, { full_name: 'Compte de démonstration' });
  const ownerId = user.id ?? user.user?.id;
  if (!ownerId) throw new Error('création du compte pro : identifiant absent de la réponse');

  const provision = await db.rpc('provision_organization', {
    p_user_id: ownerId,
    p_org_name: scene.orgName,
    p_activity: scene.activity,
    p_location_name: scene.locationName,
    p_queue_mode: scene.queueMode,
    p_plan_code: 'pro',
  });
  const orgId = provision.organization.id;
  const locationId = provision.location.id;
  const queueId = provision.queue.id;
  const plateCode = provision.plate.code;

  // Slug connu d'avance (reset.mjs retrouve les organisations par lui) ;
  // parcours d'accueil terminé ; essai loin dans le futur, pour qu'aucun
  // bandeau d'abonnement n'apparaisse à l'image.
  await db.update('organizations', `id=eq.${orgId}`, { slug: scene.slug, onboarding_step: 'done' });
  const far = new Date(Date.now() + 3650 * 86_400_000).toISOString();
  await db.update('subscriptions', `organization_id=eq.${orgId}`, { trial_ends_at: far, current_period_end: far });
  await db.update('locations', `id=eq.${locationId}`, scene.location);
  await db.update('queues', `id=eq.${queueId}`, scene.queue);

  const staffRows = scene.staff.length
    ? await db.insert('staff', scene.staff.map((s, i) => ({
      organization_id: orgId,
      location_id: locationId,
      display_name: s.name,
      role_title: s.title,
      accent: s.accent,
      is_on_break: Boolean(s.onBreak),
      sort_order: i,
    })))
    : [];
  const staffIds = Object.fromEntries(staffRows.map((row) => [row.display_name, row.id]));

  await db.rpc('set_queue_status', { p_queue_id: queueId, p_status: 'open', p_actor_user_id: ownerId });

  // Les personnes de fond, par le moteur (`add_walkin`, puis
  // `start_serving` pour celles qui sont au fauteuil).
  const entries = {};
  for (const person of scene.people) {
    const added = await db.rpc('add_walkin', {
      p_queue_id: queueId,
      p_client_name: person.name,
      p_staff_id: person.staff ? staffIds[person.staff] : null,
      p_service_id: null,
      p_actor_user_id: ownerId,
    });
    const publicId = added?.entry?.id ?? added?.id ?? added?.entry?.publicId;
    if (!publicId) throw new Error(`add_walkin(${person.name}) : identifiant absent (${JSON.stringify(added).slice(0, 200)})`);
    entries[person.name] = publicId;
  }
  for (const person of scene.people.filter((p) => p.serving != null)) {
    await db.rpc('staff_queue_action', {
      p_entry_public_id: entries[person.name],
      p_action: 'start_serving',
      p_actor_user_id: ownerId,
      p_actor_staff_id: staffIds[person.staff] ?? null,
      p_options: {},
    });
  }
  // Heures plausibles : seule retouche hors moteur, sur des tickets
  // fictifs, AVANT le tournage (le poste lit « depuis 09:36 », pas
  // « à l'instant » pour quelqu'un arrivé il y a une demi-heure).
  for (const person of scene.people) {
    const patch = { joined_at: minutesAgo(person.joined), created_at: minutesAgo(person.joined) };
    if (person.serving != null) {
      patch.service_started_at = minutesAgo(person.serving);
      patch.called_at = minutesAgo(person.serving);
    }
    await db.update('queue_entries', `public_id=eq.${encodeURIComponent(entries[person.name])}`, patch);
  }

  // Le tournage rejoint la file depuis 127.0.0.1 à chaque passage : on
  // remet à zéro le compteur de débit des inscriptions, sur ce banc
  // seulement (la garde a vérifié l'adresse).
  await db.remove('rate_limits', 'bucket_key=like.join:ip:*').catch(() => {});

  let eventInfo = null;
  if (scene.event) eventInfo = await seedEvent(db, { scene, orgId, locationId, queueId, ownerId, log });

  log(`scène « ${metier} » posée : organisation ${scene.slug}, plaque ${plateCode}`);
  return {
    metier,
    scene,
    org: { id: orgId, slug: scene.slug, name: scene.orgName },
    location: { id: locationId, name: scene.locationName, city: scene.location.city },
    queue: { id: queueId },
    plateCode,
    staff: staffIds,
    entries,
    event: eventInfo,
    owner: { id: ownerId, email, password },
  };
}

/**
 * Événement : la campagne, liée à la file. Les réglages (taille de
 * vague, validité du laisser-passer, délai de grâce) sont ceux que le pro
 * choisit dans son écran « Événements ».
 */
async function seedEvent(db, { scene, orgId, locationId, queueId, ownerId }) {
  const e = scene.event;
  const [campaign] = await db.insert('event_campaigns', [{
    organization_id: orgId,
    location_id: locationId,
    queue_id: queueId,
    name: e.name,
    hero_title: e.heroTitle,
    rules_text: e.rulesText,
    wave_size: e.waveSize,
    pass_valid_minutes: e.passValidMinutes,
    grace_minutes: e.graceMinutes,
    status: 'live',
    started_at: new Date().toISOString(),
    created_by: ownerId,
  }]);
  return { id: campaign.id, name: e.name };
}

/**
 * Supprime des organisations du tournage (slug `demo-*`), leurs slugs
 * d'URL et les comptes éphémères qui les ont créées. Les tables filles
 * (files, tickets, plaques…) partent par cascade.
 */
export async function removeDemoOrganizations(db, { slugs = null, log = () => {} } = {}) {
  const filter = slugs ? `slug=${inList(slugs)}` : `slug=like.${DEMO_SLUG_PREFIX}*`;
  const orgs = (await db.select('organizations', `select=id,slug,created_by&${filter}`))
    .filter((o) => o.slug.startsWith(DEMO_SLUG_PREFIX));
  if (orgs.length === 0) return [];
  const ids = orgs.map((o) => o.id);
  // L'organisation d'abord (ses établissements et plaques partent avec
  // elle), puis les slugs d'URL qu'ils réservaient : dans l'autre ordre,
  // la clé étrangère locations.slug refuserait la suppression.
  await db.remove('organizations', `id=${inList(ids)}`);
  await db.remove('slug_registry', `organization_id=${inList(ids)}`);
  // Seuls les comptes éphémères du tournage sont supprimés : jamais le
  // créateur d'une organisation demo-* posée à la main par quelqu'un.
  const owners = [...new Set(orgs.map((o) => o.created_by).filter(Boolean))];
  if (owners.length > 0) {
    const profiles = await db.select('profiles', `select=id,email&id=${inList(owners)}`);
    for (const profile of profiles) {
      if (String(profile.email ?? '').endsWith(`@${DEMO_EMAIL_DOMAIN}`)) await db.deleteUser(profile.id);
    }
  }
  for (const o of orgs) log(`organisation ${o.slug} supprimée`);
  return orgs.map((o) => o.slug);
}

// Lancement direct : pose la scène pour l'inspecter.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runGuarded(async () => {
    const metier = process.argv[2];
    if (!metier || !SCENES[metier]) {
      console.error(`Usage : node scripts/demo/bench/seed-demo.mjs <${Object.keys(SCENES).join('|')}>`);
      process.exit(2);
    }
    const result = await seedDemo(metier, { log: (m) => console.log(`  ${m}`) });
    console.log(`✓ Scène prête. Client : /e/${result.plateCode} · Poste : /app/${result.org.slug}/file`);
    console.log('  (Le mot de passe du compte pro n’est jamais affiché ; `reset.mjs` nettoie.)');
  });
}
