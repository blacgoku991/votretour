// =====================================================================
// Rangvia — garde du banc de démonstration
// ---------------------------------------------------------------------
// Le tournage crée un compte, des organisations et des tickets, puis les
// supprime. Il ne doit JAMAIS parler à autre chose qu'un banc local :
// ni à la production, ni à une préproduction, ni à la base partagée
// votretour_verify (verify-db.sh l'efface et d'autres bancs la lisent).
//
// Toute adresse (application, passerelle Supabase, base PostgreSQL) passe
// par ce module avant la première requête. Un refus arrête le processus
// avec le code 2 et un message qui dit quoi corriger.
// =====================================================================

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Racine du dépôt (scripts/demo/bench → ../../..). */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const WEB_ROOT = join(REPO_ROOT, 'apps', 'web');

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Base dédiée au tournage : jamais celle de verify-db.sh. */
export const DEFAULT_DATABASE_URL = 'postgresql://postgres@127.0.0.1:54399/votretour_demo';
const FORBIDDEN_DATABASES = new Set(['votretour_verify', 'postgres', 'template0', 'template1']);

export class BenchRefused extends Error {}

function refuse(message) {
  throw new BenchRefused(`Banc local uniquement : ${message}`);
}

/**
 * Lit `apps/web/.env.local` sans écraser l'environnement. Le fichier du
 * banc porte la clé service_role LOCALE (signée par le secret du banc) :
 * c'est elle que le tournage utilise, jamais une clé de production, que
 * la garde d'adresse rendrait de toute façon inutilisable.
 */
function readEnvLocal() {
  const file = join(WEB_ROOT, '.env.local');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** Une adresse http(s) sur la machine locale, sans identifiants. */
export function assertLocalHttp(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return refuse(`${name} n’est pas une URL (${raw}).`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) refuse(`${name} doit être en http(s).`);
  if (url.username || url.password) refuse(`${name} ne doit pas contenir d’identifiants.`);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    refuse(`${name} vise ${url.hostname} ; seuls 127.0.0.1 et localhost sont acceptés.`);
  }
  return url.origin;
}

/**
 * Une base PostgreSQL locale et dédiée. Le nom d'hôte de l'URI ne suffit
 * pas : libpq accepte aussi l'hôte en paramètre (?host=, ?hostaddr=), par
 * un fichier de service (?service=) ou par l'environnement (PGHOSTADDR
 * l'emporte sur l'URI). Ces paramètres sont refusés et psql est lancé
 * sans ces variables (`psqlEnv`).
 */
export function assertLocalDatabase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return refuse('DEMO_DATABASE_URL n’est pas une URI postgresql://.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) refuse('DEMO_DATABASE_URL doit être une URI postgresql://.');
  if (!LOCAL_HOSTS.has(url.hostname)) refuse('DEMO_DATABASE_URL doit viser 127.0.0.1.');
  const hostParams = [...url.searchParams.keys()].filter((k) => ['host', 'hostaddr', 'service'].includes(k));
  if (hostParams.length > 0) refuse(`paramètre ${hostParams.join(', ')} interdit dans DEMO_DATABASE_URL.`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^[a-z0-9_]+$/.test(database)) refuse('nom de base invalide (lettres minuscules, chiffres, _).');
  if (FORBIDDEN_DATABASES.has(database)) {
    refuse(`la base ${database} n’est pas une base de tournage (votretour_demo par défaut).`);
  }
  return { url: url.toString(), database, adminUrl: withDatabase(url, 'postgres') };
}

function withDatabase(url, database) {
  const copy = new URL(url.toString());
  copy.pathname = `/${database}`;
  return copy.toString();
}

/** Environnement de psql sans les variables qui redirigent l'hôte. */
export function psqlEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !['PGHOST', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE'].includes(k)),
  );
}

/**
 * Le rôle porté par une clé JWT, sans vérifier la signature (on ne
 * connaît pas le secret ici). Sert à refuser une clé anon passée par
 * erreur à la place de la clé service_role du banc.
 */
function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Configuration du banc, vérifiée. Ordre de lecture : variables DEMO_*,
 * puis celles de l'application (`NEXT_PUBLIC_SUPABASE_URL`,
 * `SUPABASE_SERVICE_ROLE_KEY`), puis `apps/web/.env.local`.
 */
export function benchConfig({ needsDatabase = false } = {}) {
  const file = readEnvLocal();
  const pick = (...keys) => {
    for (const key of keys) {
      if (process.env[key]) return process.env[key];
      if (file[key]) return file[key];
    }
    return undefined;
  };
  const supabaseUrl = pick('DEMO_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = pick('DEMO_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  const baseUrl = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:3000';
  if (!supabaseUrl) refuse('DEMO_SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) est absente.');
  if (!serviceKey) refuse('DEMO_SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_ROLE_KEY) est absente.');
  if (jwtRole(serviceKey) !== 'service_role') refuse('la clé fournie n’est pas une clé service_role.');
  const config = {
    supabaseUrl: assertLocalHttp(supabaseUrl, 'DEMO_SUPABASE_URL'),
    serviceKey,
    baseUrl: assertLocalHttp(baseUrl, 'DEMO_BASE_URL'),
    // Secret de session DU BANC (celui que lit `next start`) : le scénario
    // « événements » s'en sert pour ouvrir le lien que porte la
    // notification d'accès, que le banc ne peut pas recevoir.
    sessionSecret: pick('DEMO_SESSION_SECRET', 'SESSION_HASH_SECRET') ?? null,
    database: null,
  };
  if (needsDatabase) config.database = assertLocalDatabase(process.env.DEMO_DATABASE_URL ?? DEFAULT_DATABASE_URL);
  return config;
}

/** Point d'entrée des scripts : un refus devient un message et le code 2. */
export async function runGuarded(main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof BenchRefused) {
      console.error(`✗ ${error.message}`);
      process.exit(2);
    }
    console.error(`✗ ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  }
}
