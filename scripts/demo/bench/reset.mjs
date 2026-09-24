#!/usr/bin/env node
// =====================================================================
// Rangvia — nettoyage du banc de démonstration
// ---------------------------------------------------------------------
//   node scripts/demo/bench/reset.mjs
//
// Supprime toutes les organisations `demo-*` du banc local (files,
// tickets, plaques et slugs d'URL compris) et les comptes éphémères du
// tournage (@demo.rangvia.test). Même fictives, ces données ne restent
// pas : le tournage les recrée à chaque passage.
//
// Même garde que le tournage : refus si l'adresse Supabase n'est pas
// 127.0.0.1 ou localhost.
// =====================================================================

import { benchConfig, runGuarded } from './guard.mjs';
import { removeDemoOrganizations } from './seed-demo.mjs';
import { supabaseClient } from './supabase.mjs';

await runGuarded(async () => {
  const config = benchConfig();
  const removed = await removeDemoOrganizations(supabaseClient(config), { log: (m) => console.log(`  ${m}`) });
  console.log(removed.length
    ? `✓ ${removed.length} organisation(s) de démonstration supprimée(s) sur ${config.supabaseUrl}.`
    : `✓ Aucune organisation de démonstration sur ${config.supabaseUrl}.`);
});
