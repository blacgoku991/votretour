#!/usr/bin/env node
// =====================================================================
// Rangvia — captures de référence des écrans barbiers (lot R0)
// ---------------------------------------------------------------------
// Fige, au pixel près, ce que voient aujourd'hui un barbier et ses
// clients, avant le chantier « profils métier ». Chaque lot qui touche
// l'interface ou le serveur relance ce script : toute différence sur un
// écran walkin bloque la fusion.
//
//   node scripts/e2e/walkin-baseline.mjs            # compare aux références
//   node scripts/e2e/walkin-baseline.mjs --update   # réécrit les références
//   node scripts/e2e/walkin-baseline.mjs --only client-tour,ecran-tv
//   node scripts/e2e/walkin-baseline.mjs --keep     # garde l'organisation
//
// Variables (voir README.md) : E2E_BASE_URL, E2E_DATABASE_URL, E2E_CHROMIUM.
//
// Déterminisme : l'organisation « Barber Témoin » est jetable et
// entièrement mise en scène (noms, identifiants publics, heures). Le
// navigateur a une heure figée (SCENE), le mouvement réduit, les
// animations CSS arrêtées au moment de la capture ; toutes les heures
// de la base sont réécrites par rapport à SCENE avant chaque capture.
// =====================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, 'baseline');
const OUT_DIR = join(HERE, '.out');

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const KEEP = args.includes('--keep');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',').map((s) => s.trim())) : null;
})();

const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:54399/votretour_verify';
const CHROMIUM = process.env.E2E_CHROMIUM
  ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

/** Part de pixels différents tolérée par capture (0,1 %). */
const MAX_DIFF_RATIO = 0.001;
/** Sensibilité couleur de pixelmatch (0 = stricte, 1 = laxiste). */
const PIXEL_THRESHOLD = 0.1;

// ---------------------------------------------------------------------
// Garde-fou : ce script crée et supprime des données. Il ne parle qu'à
// un banc local, jamais à une base distante.
// ---------------------------------------------------------------------
const isLocal = (host) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
if (!isLocal(new URL(DB_URL).hostname) || !isLocal(new URL(BASE_URL).hostname)) {
  console.error('✗ Banc local uniquement : E2E_DATABASE_URL et E2E_BASE_URL doivent viser 127.0.0.1.');
  process.exit(2);
}

// ---------------------------------------------------------------------
// La scène : un mardi de mars à 9 h 42, heure de Paris. Hors de toute
// date réelle future, donc « terminés aujourd'hui » reste à zéro quel
// que soit le jour où le script tourne.
// ---------------------------------------------------------------------
const SCENE = new Date('2026-03-10T09:42:00+01:00');
const TZ = 'Europe/Paris';

const OWNER_ID = '0e2e0000-0000-4000-8000-000000000001';
const OWNER_EMAIL = 'temoin@e2e.rangvia.test';
const ORG_SLUG = 'e2e-walkin-temoin';
const LOCATION_SLUG = 'e2e-walkin-temoin-bastille';
const PLATE_CODE = 'e2e-walkin-temoin-comptoir';

/**
 * Heures de chaque ticket, en minutes avant SCENE, par colonne. Une
 * colonne remplie par le moteur mais absente d'ici prend l'heure
 * d'arrivée : aucune heure réelle ne survit à la normalisation.
 */
const TIMELINE = {
  Marc:  { joined_at: 41, service_started_at: 24, completed_at: 9 },
  'Léa': { joined_at: 33, cancelled_at: 12 },
  Hugo:  { joined_at: 27, cancelled_at: 11 },
  'Inès': { joined_at: 19, returning_at: 8, service_started_at: 6, called_at: 6 },
  Tom:   { joined_at: 16 },
  Nadia: { joined_at: 14, service_started_at: 5, called_at: 5 },
  Paul:  { joined_at: 12, called_at: 2 },
  'Zoé': { joined_at: 10 },
  Rayan: { joined_at: 9, absent_at: 3 },
  Lina:  { joined_at: 7 },
};
const TIME_COLUMNS = [
  'joined_at', 'called_at', 'returning_at', 'present_at', 'service_started_at',
  'completed_at', 'cancelled_at', 'absent_at', 'expired_at',
];

// ---------------------------------------------------------------------
// Base de données (psql, superutilisateur du banc)
// ---------------------------------------------------------------------
function sql(text) {
  return execFileSync('psql', [DB_URL, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], {
    input: text,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
const lit = (value) => (value === null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const sceneMinus = (minutes) => new Date(SCENE.getTime() - minutes * 60_000).toISOString();

/** Identifiant public du ticket (unique par prénom dans la scène). */
const entryRef = (name) =>
  `(select public_id from public.queue_entries e join public.organizations o on o.id = e.organization_id
     where o.slug = ${lit(ORG_SLUG)} and e.client_name = ${lit(name)} order by e.joined_at desc limit 1)`;
const queueRef = `(select q.id from public.queues q join public.organizations o on o.id = q.organization_id
                 where o.slug = ${lit(ORG_SLUG)} and q.is_default)`;
const staffRef = (name) =>
  `(select s.id from public.staff s join public.organizations o on o.id = s.organization_id
     where o.slug = ${lit(ORG_SLUG)} and s.display_name = ${lit(name)})`;

/** Action du pro, par le même moteur que l'application. */
function staffAction(name, action, staff = null, options = {}) {
  sql(`select public.staff_queue_action(${entryRef(name)}, ${lit(action)}, ${lit(OWNER_ID)},
         ${staff ? staffRef(staff) : 'null'}, ${lit(JSON.stringify(options))}::jsonb);`);
}
function walkin(name) {
  sql(`select public.add_walkin(${queueRef}, ${lit(name)}, null, null, ${lit(OWNER_ID)}, null);`);
}
function setQueueStatus(status) {
  sql(`select public.set_queue_status(${queueRef}, ${lit(status)}, ${lit(OWNER_ID)});`);
}

function cleanup() {
  sql(`
    begin;
    create temporary table e2e_orgs on commit drop as
      select id from public.organizations where slug = ${lit(ORG_SLUG)} or created_by = ${lit(OWNER_ID)};
    delete from public.organizations where id in (select id from e2e_orgs);
    delete from public.slug_registry where organization_id in (select id from e2e_orgs)
       or slug in (${lit(LOCATION_SLUG)}, ${lit(PLATE_CODE)});
    delete from auth.users where id = ${lit(OWNER_ID)};
    commit;`);
}

/**
 * Organisation jetable : un barbier en file commune, trois
 * professionnels (dont un en pause), une plaque au slug fixe.
 */
function setup() {
  cleanup();
  sql(`
    begin;
    insert into auth.users (id, email, raw_user_meta_data)
    values (${lit(OWNER_ID)}, ${lit(OWNER_EMAIL)}, '{"full_name":"Karim Témoin"}');

    do $$
    declare
      v_prov jsonb := public.provision_organization(
        ${lit(OWNER_ID)}, 'Barber Témoin', 'barber', 'Barber Témoin — Bastille', 'shared', 'pro');
      v_org  uuid := (v_prov -> 'organization' ->> 'id')::uuid;
      v_loc  uuid := (v_prov -> 'location' ->> 'id')::uuid;
      v_old_loc_slug text := v_prov -> 'location' ->> 'slug';
      v_old_plate    text := v_prov -> 'plate' ->> 'code';
    begin
      update public.organizations set slug = ${lit(ORG_SLUG)}, onboarding_step = 'done' where id = v_org;

      -- Slugs fixes (les contraintes vers slug_registry sont différées).
      insert into public.slug_registry (slug, kind, organization_id, ref_id)
        select ${lit(LOCATION_SLUG)}, kind, organization_id, ref_id from public.slug_registry where slug = v_old_loc_slug;
      update public.locations set slug = ${lit(LOCATION_SLUG)} where id = v_loc;
      delete from public.slug_registry where slug = v_old_loc_slug;
      insert into public.slug_registry (slug, kind, organization_id, ref_id)
        select ${lit(PLATE_CODE)}, kind, organization_id, ref_id from public.slug_registry where slug = v_old_plate;
      update public.plates set code = ${lit(PLATE_CODE)} where code = v_old_plate;
      delete from public.slug_registry where slug = v_old_plate;

      update public.locations
         set address_line1 = '12 rue de la Roquette', postal_code = '75011', city = 'Paris',
             phone = '01 43 55 00 00',
             google_review_url = 'https://search.google.com/local/writereview?placeid=E2E-TEMOIN'
       where id = v_loc;

      insert into public.staff (organization_id, location_id, display_name, role_title, sort_order, accent, is_on_break)
      values (v_org, v_loc, 'Karim', 'Barbier',  0, 'signal', false),
             (v_org, v_loc, 'Sofia', 'Barbière', 1, 'jade',   false),
             (v_org, v_loc, 'Yanis', 'Barbier',  2, 'cobalt', true);

      -- Les abonnements d'essai se comptent en jours réels : on les
      -- place loin dans le futur pour qu'aucun bandeau n'apparaisse.
      update public.subscriptions
         set trial_ends_at = now() + interval '3650 days', current_period_end = now() + interval '3650 days'
       where organization_id = v_org;
    end
    $$;
    -- Le banc est partagé par tous les tests locaux, depuis la même
    -- adresse : on remet à zéro le seul compteur que ce script consomme.
    delete from public.rate_limits where bucket_key like 'join:ip:%';
    commit;`);
  setQueueStatus('open');
}

/** Réécrit toutes les heures des tickets de la scène par rapport à SCENE. */
function normalizeTimes() {
  const blocks = Object.entries(TIMELINE).map(([name, times]) => {
    const sets = TIME_COLUMNS.map((col) => {
      const minutes = times[col] ?? times.joined_at;
      return `${col} = case when ${col} is null then null else ${lit(sceneMinus(minutes))}::timestamptz end`;
    });
    sets.push(`created_at = ${lit(sceneMinus(times.joined_at))}::timestamptz`);
    sets.push(`last_position_change_at = ${lit(sceneMinus(1))}::timestamptz`);
    return `update public.queue_entries set ${sets.join(', ')}
             where public_id = ${entryRef(name)};`;
  });
  sql(`begin; ${blocks.join('\n')} commit;`);
}

// ---------------------------------------------------------------------
// Navigateur
// ---------------------------------------------------------------------
const VIEWPORTS = {
  phone:   { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  tv:      { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};

const problems = [];
const results = [];

async function newContext(browser, kind, storageState = undefined) {
  const context = await browser.newContext({
    ...VIEWPORTS[kind],
    storageState,
    locale: 'fr-FR',
    timezoneId: TZ,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.clock.setFixedTime(SCENE);
  // L'indicateur de `next dev` n'existe pas en production : on le masque
  // pour que les captures soient les mêmes sur les deux serveurs.
  await context.addInitScript(() => {
    const hide = () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head.appendChild(style);
    };
    if (document.head) hide();
    else document.addEventListener('DOMContentLoaded', hide, { once: true });
  });
  return context;
}

function watch(page, label) {
  page.on('pageerror', (error) => problems.push(`${label} — erreur JS : ${error.message.split('\n')[0]}`));
  page.on('console', (message) => {
    const text = message.text();
    if (/hydrat/i.test(text)) problems.push(`${label} — hydratation : ${text.split('\n')[0].slice(0, 200)}`);
  });
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function open(page, path) {
  await page.goto(BASE_URL + path, { waitUntil: 'networkidle', timeout: 90_000 });
  await settle(page);
}

async function login(browser) {
  const context = await newContext(browser, 'desktop');
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/connexion`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.fill('#email', OWNER_EMAIL);
  await page.fill('#password', 'e2e-banc-local');
  await page.getByRole('button', { name: /connecter/i }).click();
  await page.waitForURL(/\/app\//, { timeout: 60_000 });
  const state = await context.storageState();
  await context.close();
  return state;
}

// ---------------------------------------------------------------------
// Capture et comparaison
// ---------------------------------------------------------------------
function encode(png) {
  return PNG.sync.write(png, { deflateLevel: 9, filterType: -1 });
}

async function capture(page, name, { fullPage = false } = {}) {
  if (ONLY && !ONLY.has(name)) return;
  await settle(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) problems.push(`${name} — débordement horizontal de ${overflow} px`);

  const buffer = await page.screenshot({ fullPage, animations: 'disabled', caret: 'hide', scale: 'device' });
  const actual = PNG.sync.read(buffer);
  const file = `${name}.png`;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, file), encode(actual));

  if (UPDATE) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(join(BASELINE_DIR, file), encode(actual));
    results.push({ name, status: 'écrite', detail: `${actual.width}×${actual.height}` });
    return;
  }

  const referencePath = join(BASELINE_DIR, file);
  if (!existsSync(referencePath)) {
    results.push({ name, status: 'ÉCHEC', detail: 'référence absente (lancer avec --update)' });
    return;
  }
  const expected = PNG.sync.read(readFileSync(referencePath));
  if (expected.width !== actual.width || expected.height !== actual.height) {
    results.push({
      name, status: 'ÉCHEC',
      detail: `taille ${actual.width}×${actual.height}, référence ${expected.width}×${expected.height}`,
    });
    return;
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const count = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, {
    threshold: PIXEL_THRESHOLD,
  });
  const ratio = count / (actual.width * actual.height);
  const ok = ratio <= MAX_DIFF_RATIO;
  if (!ok) writeFileSync(join(OUT_DIR, `${name}.diff.png`), encode(diff));
  results.push({
    name,
    status: ok ? 'ok' : 'ÉCHEC',
    detail: `${count} px différents (${(ratio * 100).toFixed(3)} %)`,
  });
}

/** Ramène la page au premier plan : le client recharge son ticket. */
async function resync(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(600);
}

async function joinAs(page, name) {
  await page.fill('#prenom', name);
  await page.getByRole('button', { name: 'Rejoindre la file' }).click();
  await page.getByText('En direct').waitFor({ timeout: 30_000 });
}

// ---------------------------------------------------------------------
// Le scénario
// ---------------------------------------------------------------------
async function run() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  setup();

  // Au fauteuil de Karim, et deux personnes qui attendent.
  walkin('Marc');
  staffAction('Marc', 'start_serving', 'Karim');
  walkin('Léa');
  walkin('Hugo');
  normalizeTimes();

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });

  try {
    const plate = `/e/${PLATE_CODE}`;

    // 1. Inscription : la file est ouverte, trois personnes y sont.
    const ines = await (await newContext(browser, 'phone')).newPage();
    watch(ines, 'client Inès');
    await open(ines, plate);
    await capture(ines, 'client-inscription');

    // 2. En file : Inès rejoint par le vrai parcours, puis recharge.
    await joinAs(ines, 'Inès');
    normalizeTimes();
    await open(ines, plate);
    await ines.getByText('En direct').waitFor();
    await capture(ines, 'client-en-file');

    // 3. Retiré : Tom rejoint, le pro le retire, son écran le dit.
    const tom = await (await newContext(browser, 'phone')).newPage();
    watch(tom, 'client Tom');
    await open(tom, plate);
    await joinAs(tom, 'Tom');
    staffAction('Tom', 'remove');
    normalizeTimes();
    await resync(tom);
    await tom.getByText('Retiré de la file', { exact: true }).waitFor({ timeout: 30_000 });
    await capture(tom, 'client-retire');
    await tom.context().close();

    // 4. Retour : Léa et Hugo partent, il ne reste que Marc devant Inès.
    //    Sans professionnel désigné, personne n'est promu.
    staffAction('Léa', 'cancel');
    staffAction('Hugo', 'cancel');
    await open(ines, plate);
    await ines.getByText('En direct').waitFor();
    await ines.getByRole('button', { name: 'Je suis de retour' }).click();
    await ines.getByText('Le salon sait que vous revenez').waitFor({ timeout: 30_000 });
    normalizeTimes();
    await open(ines, plate);
    await ines.getByText('En direct').waitFor();
    await capture(ines, 'client-retour');

    // 5. Tour : Karim termine Marc, Inès est promue à son fauteuil.
    staffAction('Marc', 'complete', 'Karim');
    normalizeTimes();
    await open(ines, plate);
    await capture(ines, 'client-tour');

    // 6. Le poste du pro et l'écran de salle, sur une file bien remplie.
    for (const name of ['Nadia', 'Paul', 'Zoé', 'Rayan', 'Lina']) walkin(name);
    staffAction('Nadia', 'start_serving', 'Sofia');
    staffAction('Paul', 'call', 'Sofia');
    staffAction('Zoé', 'note', 'Karim', { note: 'Dégradé bas, barbe taillée' });
    staffAction('Rayan', 'mark_absent', null, { policy: 'hold' });
    normalizeTimes();

    const auth = await login(browser);
    for (const [kind, name] of [['desktop', 'pro-file-bureau'], ['phone', 'pro-file-telephone']]) {
      const pro = await (await newContext(browser, kind, auth)).newPage();
      watch(pro, name);
      await open(pro, `/app/${ORG_SLUG}/file`);
      await capture(pro, name);
      await pro.context().close();
    }
    const tv = await (await newContext(browser, 'tv', auth)).newPage();
    watch(tv, 'écran TV');
    await open(tv, `/ecran/${ORG_SLUG}`);
    await tv.waitForTimeout(1200); // horloge et décalage anti-marquage, posés après montage
    await capture(tv, 'ecran-tv');
    await tv.context().close();

    // 7. Terminé : Karim termine Inès ; l'avis Google est proposé.
    //    completed_at reste l'heure réelle : le ticket terminé n'est
    //    retrouvé que pendant 30 minutes (find_active_ticket).
    staffAction('Inès', 'complete', 'Karim');
    await open(ines, plate);
    await ines.getByText('Merci pour votre visite').first().waitFor();
    await capture(ines, 'client-termine');
    await ines.context().close();

    // 8. Fermé : le soir, un nouveau client trouve la file fermée.
    setQueueStatus('closed');
    const late = await (await newContext(browser, 'phone')).newPage();
    watch(late, 'client file fermée');
    await open(late, plate);
    await capture(late, 'client-file-fermee');
    await late.context().close();

    // 9. Réglages de l'établissement, page entière.
    const settings = await (await newContext(browser, 'desktop', auth)).newPage();
    watch(settings, 'réglages');
    await open(settings, `/app/${ORG_SLUG}/reglages`);
    await capture(settings, 'pro-reglages', { fullPage: true });
    await settings.context().close();
  } finally {
    await browser.close();
    if (!KEEP) cleanup();
  }
}

try {
  await run();
} catch (error) {
  console.error(`✗ Scénario interrompu : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const width = Math.max(...results.map((r) => r.name.length), 10);
for (const r of results) console.log(`  ${r.status === 'ok' || r.status === 'écrite' ? '✓' : '✗'} ${r.name.padEnd(width)}  ${r.status.padEnd(6)} ${r.detail}`);
for (const p of problems) console.log(`  ✗ ${p}`);

const failed = results.some((r) => r.status === 'ÉCHEC') || problems.length > 0;
if (failed) {
  console.log(`✗ Écrans barbiers modifiés ou en erreur. Captures et différences : ${OUT_DIR}`);
  process.exit(1);
}
console.log(UPDATE ? `✓ ${results.length} références écrites dans ${BASELINE_DIR}` : `✓ ${results.length} écrans identiques aux références.`);
