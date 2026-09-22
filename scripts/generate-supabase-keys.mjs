#!/usr/bin/env node
/**
 * Génère les secrets d'une installation auto-hébergée.
 *
 * Les clés « anon » et « service_role » de Supabase ne sont pas des
 * chaînes arbitraires : ce sont des JWT signés avec JWT_SECRET, dont le
 * claim `role` désigne le rôle PostgreSQL que PostgREST endossera. Les
 * trois services (GoTrue, PostgREST, Realtime) partagent ce même secret.
 *
 * Usage :  node scripts/generate-supabase-keys.mjs [--years 10]
 */

import { SignJWT } from 'jose';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const yearsArg = args.indexOf('--years');
const years = yearsArg >= 0 ? Number(args[yearsArg + 1]) : 10;
if (!Number.isFinite(years) || years < 1 || years > 50) {
  console.error('--years doit être un nombre entre 1 et 50.');
  process.exit(1);
}

/**
 * Chaîne alphanumérique d'une longueur EXACTE.
 *
 * Filtrer puis tronquer ne suffit pas : base64 produit des caractères
 * écartés, et le résultat peut être plus court que demandé. Phoenix
 * refuse de démarrer si SECRET_KEY_BASE fait 63 caractères au lieu de
 * 64, et Realtime exige exactement 16 caractères pour DB_ENC_KEY. On
 * tire donc jusqu'à avoir le compte.
 */
const secret = (length) => {
  let out = '';
  while (out.length < length) {
    out += randomBytes(length).toString('base64').replace(/[^A-Za-z0-9]/g, '');
  }
  return out.slice(0, length);
};

const jwtSecret = secret(64);
const key = new TextEncoder().encode(jwtSecret);

const now = Math.floor(Date.now() / 1000);
const exp = now + Math.round(years * 365.25 * 24 * 3600);

const sign = (role) => new SignJWT({ role })
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setIssuer('supabase')
  .setIssuedAt(now)
  .setExpirationTime(exp)
  .sign(key);

const [anonKey, serviceKey] = await Promise.all([sign('anon'), sign('service_role')]);

const out = {
  POSTGRES_PASSWORD: secret(32),
  JWT_SECRET: jwtSecret,
  ANON_KEY: anonKey,
  SERVICE_ROLE_KEY: serviceKey,
  // Realtime : clé de chiffrement des identifiants de locataire.
  // Elle DOIT faire exactement 16 caractères.
  REALTIME_DB_ENC_KEY: secret(16),
  // Phoenix refuse de démarrer en dessous de 64 caractères.
  SECRET_KEY_BASE: secret(64),
  // Poivre du hachage des sessions clients. À NE JAMAIS changer ensuite.
  SESSION_HASH_SECRET: randomBytes(48).toString('base64'),
  CRON_SECRET: randomBytes(32).toString('hex'),
};

if (args.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
}
