// Banc des recettes Playwright de l'écran client par métier (lot P4).
//
// Chaque recette (`profiles-<profil>.mjs`, à côté) joue le parcours réel
// d'un client sur `/e/<plaque>` : inscription, avancement par le pro
// (`staff_queue_action`, exactement ce qu'appelle le poste), devis et son
// 409, rideau reçu EN DIRECT (page ouverte, sans recharger), « J'arrive »,
// fin. Rien ne dépend d'une organisation pilote : le banc crée et active
// ce qu'il lui faut (organisation « E2E Profils », `features.profiles`).
//
// Paramètres (variables d'environnement) :
//   E2E_BASE              URL de l'application          (défaut http://127.0.0.1:3000)
//   E2E_DB                URI PostgreSQL de SA base     (OBLIGATOIRE : jamais de défaut
//                          partagé, le banc y écrit)
//   E2E_SUPABASE_URL      passerelle Supabase de cette base, pour la diffusion
//                          temps réel (OBLIGATOIRE : c'est elle que la page écoute)
//   E2E_SERVICE_ROLE_KEY  clé service_role de cette passerelle (facultatif sur un banc local)
//   E2E_CHROMIUM          chemin d'un Chromium (facultatif)
//   E2E_SHOTS             dossier où déposer les captures (facultatif)
//   E2E_WIDTH / E2E_HEIGHT viewport (défaut 390 × 844)
//   E2E_REDUCED=1         mouvement réduit
//
// Lancement (depuis la racine) : E2E_DB=… E2E_SUPABASE_URL=… node scripts/e2e/client/profiles-vehicle.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

export const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const DB = process.env.E2E_DB;
const SUPABASE_URL = process.env.E2E_SUPABASE_URL;
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? '';
const SHOTS = process.env.E2E_SHOTS ?? null;
const WIDTH = Number(process.env.E2E_WIDTH ?? 390);
const HEIGHT = Number(process.env.E2E_HEIGHT ?? 844);
const REDUCED = process.env.E2E_REDUCED === '1';

if (!DB) throw new Error('E2E_DB est obligatoire (la base du banc, jamais une base partagée par défaut).');
if (!SUPABASE_URL) throw new Error('E2E_SUPABASE_URL est obligatoire (la passerelle temps réel de cette base).');

// Le banc écrit dans sa base : jamais ailleurs qu'en local, jamais sur le banc partagé.
{
  const db = new URL(DB);
  if (!['127.0.0.1', 'localhost'].includes(db.hostname)) throw new Error('E2E_DB doit viser 127.0.0.1.');
  for (const k of ['host', 'hostaddr', 'service']) {
    if (db.searchParams.has(k)) throw new Error(`E2E_DB : paramètre « ${k} » interdit.`);
  }
  if (db.pathname.replace(/^\//, '') === 'votretour_verify') throw new Error('votretour_verify est la base du banc partagé.');
}

const ORG_SLUG = 'e2e-profils';
const OWNER_ID = '4f000000-0000-4000-8000-0000000000e2';

/** Requête SQL sur la base du banc ; renvoie la sortie brute (-At). */
export function sql(query) {
  return execFileSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-Atc', query], { encoding: 'utf8' }).trim();
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Les lieux du banc, un par parcours. `sensitive` : santé (aucun prénom,
 * aucun avis). Idempotent : l'organisation n'est créée qu'une fois ;
 * chaque recette repart d'une file ouverte et vide.
 */
export const PLACES = {
  vehicle: { slug: 'e2e-garage', name: 'Garage des Tilleuls', activity: 'garage' },
  device: { slug: 'e2e-phonefix', name: 'PhoneFix Bastille', activity: 'phone_repair' },
  table: { slug: 'e2e-chez-paul', name: 'Chez Paul', activity: 'restaurant' },
  desk: { slug: 'e2e-mairie', name: 'Mairie du 11e — Accueil', activity: 'admin_service' },
  health: { slug: 'e2e-labo', name: 'Laboratoire Voltaire', activity: 'health' },
  retail: { slug: 'e2e-boutique', name: 'Atelier Oberkampf', activity: 'shop' },
  // Une file de barbiers dans la même organisation : une fiche d'atelier
  // suivie sur ce téléphone doit y rester une fiche (aiguillage P4.0).
  walkin: { slug: 'e2e-barbier', name: 'Salon du Coin', activity: 'barber' },
};

export function ensureBench() {
  const exists = sql(`select count(*) from public.organizations where slug = ${lit(ORG_SLUG)}`) === '1';
  if (!exists) {
    sql(`insert into auth.users (id, email) values (${lit(OWNER_ID)}, 'e2e-profils@bench.test') on conflict do nothing`);
    sql(`select public.provision_organization(${lit(OWNER_ID)}, 'E2E Profils', 'garage', null)`);
  }
  const org = sql(`select id from public.organizations where slug = ${lit(ORG_SLUG)}`);
  if (!org) throw new Error('Organisation du banc introuvable après création.');
  // Profils disponibles pour CETTE organisation seulement : jamais par
  // les capacités publiques (lot P9), jamais pour une autre.
  sql(`insert into public.organization_settings (organization_id) values (${lit(org)}) on conflict do nothing`);
  sql(`update public.organization_settings set features = coalesce(features, '{}'::jsonb) || '{"profiles": true}'
       where organization_id = ${lit(org)}`);
  for (const place of Object.values(PLACES)) {
    const has = sql(`select count(*) from public.slug_registry where slug = ${lit(place.slug)}`) !== '0';
    if (!has) {
      sql(`select public.create_location(${lit(org)}, ${lit(place.name)}, ${lit(place.activity)}, '12 rue des Tilleuls',
           '75011', 'Paris', 'FR', 'Europe/Paris', 'https://g.page/r/exemple/review', 'shared', null, ${lit(place.slug)})`);
    }
  }
  // Depuis 0042, une file naît toujours au passage : le métier est
  // attribué ensuite par l'équipe Rangvia (switch_queue_profile, comme
  // l'action super-admin). Idempotent : un métier déjà posé ne change pas.
  for (const [key, place] of Object.entries(PLACES)) {
    const profile = key === 'health' ? 'desk' : key;
    if (profile === 'walkin') continue;
    const queue = sql(`select q.id from public.queues q join public.slug_registry sr on sr.ref_id = q.location_id
                       where sr.slug = ${lit(place.slug)} and q.is_default`);
    if (sql(`select profile from public.queues where id = ${lit(queue)}`) === profile) continue;
    resetPlace(place);
    sql(`select public.switch_queue_profile(${lit(queue)}, ${lit(profile)}, null)`);
    // L'organisation du banc est déclarée « garage » : l'activité propre du
    // lieu (santé, mairie, restaurant…) est redite ici, comme create_location
    // le faisait en 0037 (données de santé, pas d'avis en mairie).
    if (place.activity !== 'garage') {
      sql(`select internal.apply_profile_defaults(${lit(queue)}, ${lit(profile)}, ${lit(place.activity)})`);
    }
  }
  sql(`update public.locations set phone = '+33143000000' where organization_id = ${lit(org)}`);
  // Ouvert toute la journée : la recette ne dépend pas de l'heure.
  sql(`update public.opening_hours set opens_at = '00:00', closes_at = '23:59', is_closed = false
       where organization_id = ${lit(org)}`);
  // Deux guichets pour les files à guichet.
  sql(`insert into public.staff (organization_id, location_id, display_name, desk_label, sort_order)
       select l.organization_id, l.id, x.n, x.d, x.o from public.locations l
       cross join (values ('Agent 1', 'Guichet 1', 1), ('Agent 4', 'Guichet 4', 4)) as x(n, d, o)
       where l.id in (select ref_id from public.slug_registry where slug in (${lit(PLACES.desk.slug)}, ${lit(PLACES.health.slug)}))
         and not exists (select 1 from public.staff s where s.location_id = l.id and s.desk_label = x.d)`);
  return org;
}

/** File du lieu : ouverte, vidée de tout ticket actif. */
export function resetPlace(place) {
  const loc = sql(`select ref_id from public.slug_registry where slug = ${lit(place.slug)}`);
  sql(`update public.queues set status = 'open', pause_reason = null where location_id = ${lit(loc)}`);
  const ids = sql(`select public_id from public.queue_entries where location_id = ${lit(loc)} and public.entry_is_active(status)`)
    .split('\n').filter(Boolean);
  for (const id of ids) sql(`select public.staff_queue_action(${lit(id)}, 'cancel', null, null, '{}'::jsonb)`);
  // Toutes les recettes s'inscrivent depuis la même adresse : sur la base
  // du banc (et seulement elle), on repart d'un compteur d'inscriptions vide
  // pour ne pas buter sur la limite de débit de `api/client/join`.
  sql(`delete from public.rate_limits where bucket_key like 'join:%'`);
  return loc;
}

/** Le dernier ticket actif du lieu (celui du client de la recette). */
function lastEntry(place) {
  const row = sql(`select e.public_id || '|' || e.queue_id from public.queue_entries e
                   join public.slug_registry sr on sr.ref_id = e.location_id
                   where sr.slug = ${lit(place.slug)} order by e.joined_at desc limit 1`);
  const [publicId, queueId] = row.split('|');
  if (!publicId) throw new Error(`Aucun ticket pour ${place.slug}`);
  return { publicId, queueId };
}

/** Diffusion comme le serveur après une action : état public, puis événement du ticket. */
async function broadcast(queueId, publicId, event = 'updated') {
  const state = JSON.parse(sql(`select public.public_queue_state(${lit(queueId)})::text`));
  const headers = { 'Content-Type': 'application/json' };
  if (SERVICE_KEY) Object.assign(headers, { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` });
  const response = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messages: [
        { topic: `queue:${queueId}`, event: 'state', payload: state, private: false },
        { topic: `queue:${queueId}`, event: 'ticket', payload: { entryId: publicId, event }, private: false },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Diffusion refusée : ${response.status}`);
}

/**
 * Le geste du pro, tel que le poste l'envoie : `staff_queue_action`, puis
 * la diffusion (sauf `silent`, pour simuler un devis modifié que la page
 * n'a pas encore reçu).
 */
export async function staff(place, action, options = {}, { silent = false, event = 'updated' } = {}) {
  const { publicId, queueId } = lastEntry(place);
  const opts = { ...options };
  if (opts.deskLabel) {
    opts.staffId = sql(`select s.id from public.staff s join public.slug_registry sr on sr.ref_id = s.location_id
                        where sr.slug = ${lit(place.slug)} and s.desk_label = ${lit(opts.deskLabel)}`);
    delete opts.deskLabel;
  }
  sql(`select public.staff_queue_action(${lit(publicId)}, ${lit(action)}, null, null, ${lit(JSON.stringify(opts))}::jsonb)`);
  sql(`select public.recompute_queue_positions(${lit(queueId)})`);
  if (!silent) await broadcast(queueId, publicId, event);
}

/** Navigateurs ouverts par la recette en cours : fermés même en cas d'échec. */
const browsers = new Set();

/** Navigateur d'un client : un téléphone, une session, les erreurs relevées. */
export async function openClient(place) {
  const browser = await chromium.launch({
    ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}),
    args: ['--no-sandbox'],
  });
  browsers.add(browser);
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: WIDTH < 700 ? 2 : 1,
    hasTouch: WIDTH < 700,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    reducedMotion: REDUCED ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`JS : ${e.message.split('\n')[0]}`));
  page.on('console', (m) => {
    const text = m.text();
    if (/hydrat/i.test(text)) problems.push(`hydratation : ${text.slice(0, 200)}`);
    else if (m.type() === 'error' && !/Failed to load resource|WebSocket|favicon/.test(text)) problems.push(`console : ${text.slice(0, 200)}`);
  });
  await page.goto(`${BASE}/e/${place.slug}`, { waitUntil: 'networkidle', timeout: 90_000 });

  let step = 0;
  const run = {
    page,
    problems,
    /** Capture (si E2E_SHOTS) et contrôle du débordement horizontal. */
    async shot(name) {
      await page.waitForTimeout(REDUCED ? 300 : 1400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) problems.push(`débordement horizontal de ${overflow} px (${name})`);
      if (!SHOTS) return;
      mkdirSync(SHOTS, { recursive: true });
      step += 1;
      const file = `${SHOTS}/${place.slug}-${String(step).padStart(2, '0')}-${name}-${WIDTH}${REDUCED ? '-reduit' : ''}.png`;
      await page.screenshot({ path: file });
    },
    async close() {
      browsers.delete(browser);
      await browser.close();
      if (problems.length) throw new Error(`Problèmes relevés :\n  ${problems.join('\n  ')}`);
    },
  };
  return run;
}

/** Attente d'un texte visible (temps réel compris). */
export async function see(page, text, timeout = 10_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
}

export function check(condition, message) {
  if (!condition) throw new Error(`Échec : ${message}`);
}

/** Le mot écrit sur le linteau du rideau. */
export async function thresholdOf(page) {
  return (await page.locator('.seuil__label').first().textContent())?.trim() ?? null;
}

/** Libellé de la latte courante du rail d'étapes. */
export async function currentStage(page) {
  return (await page.locator('[aria-current="step"]').first().innerText()).split('\n')[0].trim();
}

/** Exécute une recette, affiche le verdict, code de sortie non nul en cas d'échec. */
export async function recipe(name, body) {
  const started = Date.now();
  try {
    ensureBench();
    await body();
    console.log(`✓ ${name} (${Math.round((Date.now() - started) / 1000)} s)`);
  } catch (error) {
    console.error(`✗ ${name}\n${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
    // L'écran au moment de l'échec, pour comprendre sans rejouer.
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      for (const browser of browsers) {
        for (const context of browser.contexts()) {
          for (const [i, page] of context.pages().entries()) {
            await page.screenshot({ path: `${SHOTS}/echec-${Date.now()}-${i}.png` }).catch(() => {});
          }
        }
      }
    }
  } finally {
    for (const browser of browsers) await browser.close().catch(() => {});
    browsers.clear();
  }
}
