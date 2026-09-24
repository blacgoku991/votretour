#!/usr/bin/env node
// =====================================================================
// Rangvia — tournage d'une vidéo de démonstration sur le vrai produit
// ---------------------------------------------------------------------
//   node scripts/demo/film.mjs barbiers          # tourne, puis nettoie
//   node scripts/demo/film.mjs barbiers --keep   # garde la scène (inspection)
//
// Règles ([SEO § 10.1]) : l'application est une compilation de production
// (`next start`) branchée sur un banc Supabase LOCAL ; aucune maquette,
// aucun état injecté dans l'interface ; la page Google n'est jamais
// filmée (navigation bloquée) ; chaque étape attend un texte réel.
//
// Sortie : scripts/demo/out/<scénario>/raw/ (ignoré par git)
//   phone/*.png, tablet/*.png   images horodatées (screencast HD)
//   phone/frames.json, …         leur index
//   timeline.json                les plans, les cartons, les repères
// Le montage (montage.mjs) part de là.
// =====================================================================

import { rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { benchConfig, runGuarded } from './bench/guard.mjs';
import { seedDemo, removeDemoOrganizations } from './bench/seed-demo.mjs';
import { supabaseClient } from './bench/supabase.mjs';
import { launchDevice, loginState, newDeviceContext, startRecorder, DEVICES } from './lib/contexts.mjs';
import { Timeline } from './lib/timeline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT_ROOT = join(HERE, 'out');

/** Hôtes jamais visités pendant le tournage : un carton les remplace. */
const BLOCKED_HOSTS = ['search.google.com', 'www.google.com', 'maps.google.com', 'www.google.fr'];

async function loadScenario(name) {
  if (!/^[a-z-]+$/.test(name ?? '')) throw new Error('Usage : node scripts/demo/film.mjs <scénario> [--keep]');
  try {
    const mod = await import(pathToFileURL(join(HERE, 'scenarios', `${name}.mjs`)).href);
    return mod.scenario;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') throw new Error(`scénario inconnu : ${name}`);
    throw error;
  }
}

/**
 * L'application lit-elle la base que l'on vient de remplir ? Sans cette
 * sonde, un `next start` branché sur une autre base ferait échouer chaque
 * étape sans dire pourquoi.
 */
async function checkAppReadsBench(baseUrl, scene) {
  const response = await fetch(`${baseUrl}/e/${scene.plateCode}`, { redirect: 'manual' }).catch((error) => {
    throw new Error(`application injoignable sur ${baseUrl} (${error instanceof Error ? error.message : error})`);
  });
  const html = await response.text();
  if (response.status !== 200 || !html.includes(scene.org.name)) {
    throw new Error(`/e/${scene.plateCode} répond ${response.status} sans « ${scene.org.name} » : `
      + `l’application sur ${baseUrl} ne lit pas le banc où la scène a été posée.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const scenario = await loadScenario(args.find((a) => !a.startsWith('--')));
  const config = benchConfig();
  const log = (m) => console.log(`  ${m}`);

  const outDir = join(OUT_ROOT, scenario.id, 'raw');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  console.log(`▸ Scène « ${scenario.seed} » sur le banc ${config.supabaseUrl}`);
  const scene = await seedDemo(scenario.seed, { config, log });
  const problems = [];
  let phoneDevice = null;
  let tabletDevice = null;
  const recorders = [];
  try {
    await checkAppReadsBench(config.baseUrl, scene);
    phoneDevice = await launchDevice('phone');
    tabletDevice = await launchDevice('tablet');

    // Connexion hors caméra ; le mot de passe quitte ensuite la mémoire.
    const storageState = await loginState(tabletDevice.browser, config.baseUrl, scene.owner);
    scene.owner.password = null;

    const phoneContext = await newDeviceContext(phoneDevice, { blockHosts: BLOCKED_HOSTS, problems, label: 'téléphone' });
    const tabletContext = await newDeviceContext(tabletDevice, { storageState, blockHosts: BLOCKED_HOSTS, problems, label: 'poste' });
    const [phone, tablet] = await Promise.all([phoneContext.newPage(), tabletContext.newPage()]);
    // Un lien externe (avis Google) s'ouvre dans un nouvel onglet : on le
    // referme aussitôt, il n'est pas filmé.
    phoneContext.on('page', (page) => { if (page !== phone) void page.close(); });

    console.log('▸ Tournage');
    const tl = await scenario.run({
      phone,
      tablet,
      scene,
      baseUrl: config.baseUrl,
      // Accès au banc (service_role locale) pour les scénarios qui doivent
      // lire une donnée que seul un canal non filmable transporte.
      bench: { db: supabaseClient(config), sessionSecret: config.sessionSecret },
      // Appelé par le scénario une fois les écrans prêts : les
      // enregistreurs démarrent, puis la feuille de tournage.
      record: async () => {
        recorders.push(['phone', await startRecorder(phone, join(outDir, 'phone'))]);
        recorders.push(['tablet', await startRecorder(tablet, join(outDir, 'tablet'))]);
        await Timeline.read(600);
        return new Timeline({ metier: scenario.metier, scenario: scenario.id });
      },
    }).catch(async (error) => {
      // Un état attendu n'est pas venu : les deux écrans, tels quels, pour
      // comprendre pourquoi (dans out/, jamais versionné).
      await phone.screenshot({ path: join(outDir, 'erreur-telephone.png') }).catch(() => {});
      await tablet.screenshot({ path: join(outDir, 'erreur-poste.png') }).catch(() => {});
      console.error(`  écrans au moment de l’échec : ${join(outDir, 'erreur-*.png')}`);
      throw error;
    });
    await Timeline.read(400);
    const tracks = {};
    for (const [name, recorder] of recorders.splice(0)) {
      const index = await recorder.stop();
      tracks[name] = {
        dir: name,
        size: index.size,
        frames: index.frames.length,
        viewport: DEVICES[name].context.viewport,
        first: index.frames[0]?.t ?? null,
        last: index.frames.at(-1)?.t ?? null,
      };
      log(`${name} : ${index.frames.length} images ${index.size?.width}×${index.size?.height}`);
    }
    if (problems.length > 0) throw new Error(`le produit a signalé des erreurs :\n  ${problems.join('\n  ')}`);
    tl.save(join(outDir, 'timeline.json'), {
      tracks,
      chapters: scenario.chapters,
      cards: scenario.cards,
      scene: { org: scene.org.name, location: scene.location.name },
    });
    console.log(`✓ Tournage terminé : ${tl.beats.length} plans, ${join(outDir, 'timeline.json')}`);
  } finally {
    for (const [, recorder] of recorders) await recorder.stop().catch(() => {});
    await phoneDevice?.browser.close();
    await tabletDevice?.browser.close();
    if (!keep) await removeDemoOrganizations(supabaseClient(config), { slugs: [scene.org.slug], log });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runGuarded(main);
}
