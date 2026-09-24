#!/usr/bin/env node
// =====================================================================
// Rangvia — base du banc de démonstration
// ---------------------------------------------------------------------
//   node scripts/demo/bench/db.mjs create   # recrée et migre la base
//   node scripts/demo/bench/db.mjs drop     # la supprime
//
// Même recette que scripts/verify-db.sh (environnement Supabase simulé,
// puis toutes les migrations, dans l'ordre), SANS les tests : la base
// sert au tournage, pas à la vérification. Elle est dédiée
// (votretour_demo par défaut, DEMO_DATABASE_URL sinon) : jamais
// votretour_verify, que verify-db.sh efface et que d'autres bancs lisent.
//
// Avec un vrai Supabase local (`supabase start`), cette étape est inutile :
// `supabase db reset` applique déjà les migrations.
// =====================================================================

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, assertLocalDatabase, DEFAULT_DATABASE_URL, psqlEnv, runGuarded } from './guard.mjs';

function psql(url, args, input) {
  return execFileSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    input,
    encoding: 'utf8',
    env: psqlEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function main() {
  const action = process.argv[2];
  if (!['create', 'drop'].includes(action)) {
    console.error('Usage : node scripts/demo/bench/db.mjs create|drop');
    process.exit(2);
  }
  const db = assertLocalDatabase(process.env.DEMO_DATABASE_URL ?? DEFAULT_DATABASE_URL);

  // Le nom est validé par la garde ([a-z0-9_]) : il peut être écrit tel
  // quel dans l'ordre SQL.
  psql(db.adminUrl, ['-c', `drop database if exists ${db.database} with (force)`]);
  if (action === 'drop') {
    console.log(`✓ Base ${db.database} supprimée.`);
    return;
  }
  psql(db.adminUrl, ['-c', `create database ${db.database}`]);

  // Les avis (NOTICE) du shim et des migrations ne disent rien d'utile ici.
  psql(db.url, ['-f', join(REPO_ROOT, 'supabase', 'tests', '00_supabase_shim.sql')]);
  const dir = join(REPO_ROOT, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      psql(db.url, ['-f', join(dir, file)]);
    } catch (error) {
      const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : String(error);
      throw new Error(`la migration ${file} a échoué :\n${detail}`);
    }
  }
  console.log(`✓ Base ${db.database} créée : ${files.length} migrations appliquées.`);
}

await runGuarded(main);
