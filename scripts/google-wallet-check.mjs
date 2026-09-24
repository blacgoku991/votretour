#!/usr/bin/env node
/**
 * Diagnostic MANUEL de la configuration Google Wallet.
 *
 * À lancer à la main, sur le serveur ou sur un poste, après avoir rempli
 * les variables GOOGLE_WALLET_* :
 *
 *   node --env-file=deploy/.env scripts/google-wallet-check.mjs
 *   node --env-file=deploy/.env scripts/google-wallet-check.mjs --objet 3388….rangvia_q_…
 *
 * Une ligne par vérification, dans l'ordre où une panne en cache une autre :
 *   1. variables présentes et lisibles (JSON brut ou base64) ;
 *   2. clé privée du compte de service importable ;
 *   3. site public en HTTPS (Google télécharge les images du pass) ;
 *   4. jeton OAuth (portée wallet_object.issuer) : la clé est acceptée ;
 *   5. classe de file lisible chez Google : le compte de service est bien
 *      « Développeur » de l'émetteur, et le cron a créé la classe ;
 *   6. lien d'enregistrement : JWT léger < 1 800 caractères, et, avec
 *      --objet, validé par Google (walletobjects/v1/jwt/validate).
 *
 * N'écrit RIEN chez Google ni en base. N'affiche jamais de secret (ni clé,
 * ni jeton, ni assertion). Jamais exécuté en CI : il appelle Google pour
 * de vrai et n'a de sens qu'avec les identifiants de production.
 * Dépendances : aucune (node:crypto seulement), pour tourner aussi dans
 * l'image Docker de production.
 */

import { createPrivateKey, createSign } from 'node:crypto';

const API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const TIMEOUT_MS = 10_000;

if (process.env.CI && process.env.CI !== 'false') {
  console.log('google-wallet-check : ignoré en CI (diagnostic manuel, appelle Google pour de vrai).');
  process.exit(0);
}

const args = process.argv.slice(2);
const objectArg = (() => {
  const index = args.findIndex((a) => a === '--objet' || a === '--object');
  return index >= 0 ? args[index + 1] ?? null : null;
})();

let failures = 0;
const WIDTH = 30;
function line(state, label, detail = '') {
  const tag = { ok: '[ok]    ', fail: '[échec] ', skip: '[—]     ', info: '[info]  ' }[state];
  if (state === 'fail') failures += 1;
  console.log(`${tag}${label.padEnd(WIDTH)}${detail}`);
}

function stop() {
  console.log('');
  console.log(failures === 0 ? 'Google Wallet : prêt.' : `Google Wallet : ${failures} point(s) à corriger (voir SETUP.md, § 18.2).`);
  process.exit(failures === 0 ? 0 : 1);
}

const b64url = (input) => Buffer.from(input).toString('base64url');

function signJwt(header, payload, key) {
  const head = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256').update(head).sign(key).toString('base64url');
  return `${head}.${signature}`;
}

async function call(url, init) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let body = null;
    try {
      body = await response.json();
    } catch {
      /* corps vide ou illisible */
    }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: null, error: error instanceof Error ? error.name : 'erreur' };
  }
}

function googleMessage(result) {
  if (result.status === 0) return `Google injoignable (${result.error})`;
  const message = result.body?.error?.message ?? result.body?.error_description ?? result.body?.error ?? '';
  return `${result.status}${message ? ` ${String(message).slice(0, 160)}` : ''}`;
}

/* 1. Variables ------------------------------------------------------- */

const issuer = process.env.GOOGLE_WALLET_ISSUER_ID?.trim() ?? '';
const rawJson = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON?.trim() ?? '';
const prefix = process.env.GOOGLE_WALLET_CLASS_PREFIX?.trim() || 'rangvia';
const mode = process.env.GOOGLE_WALLET_MODE?.trim().toLowerCase() === 'production' ? 'production' : 'démo';
const site = (process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? '').replace(/\/+$/, '');

const missing = [];
if (!issuer) missing.push('GOOGLE_WALLET_ISSUER_ID');
if (!rawJson) missing.push('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON');
if (missing.length > 0) {
  line('fail', 'variables', `manquantes : ${missing.join(', ')}`);
  stop();
}
if (!/^\d{5,30}$/.test(issuer)) line('fail', 'identifiant d’émetteur', 'doit être numérique (Google Pay & Wallet Console)');
if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(prefix)) line('fail', 'préfixe de classe', `« ${prefix} » invalide`);

let account = null;
for (const candidate of [rawJson, (() => { try { return Buffer.from(rawJson, 'base64').toString('utf8'); } catch { return ''; } })()]) {
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object') {
      account = parsed;
      break;
    }
  } catch {
    /* forme suivante */
  }
}
if (!account) {
  line('fail', 'compte de service', 'JSON illisible (ni en clair, ni en base64)');
  stop();
}
const email = typeof account.client_email === 'string' ? account.client_email : '';
const keyId = typeof account.private_key_id === 'string' ? account.private_key_id : '';
const tokenUri = typeof account.token_uri === 'string' && account.token_uri ? account.token_uri : 'https://oauth2.googleapis.com/token';
if (!email || !keyId || typeof account.private_key !== 'string') {
  line('fail', 'compte de service', 'client_email, private_key ou private_key_id manquant');
  stop();
}
if (!/^https:\/\/(oauth2|accounts)\.googleapis\.com\//.test(tokenUri)) {
  line('fail', 'compte de service', 'token_uri ne pointe pas vers oauth2.googleapis.com');
  stop();
}
line('ok', 'variables', `émetteur ${issuer}, préfixe ${prefix}, mode ${mode}, compte …@${email.split('@')[1] ?? '?'}`);

/* 2. Clé privée ------------------------------------------------------ */

let key;
try {
  key = createPrivateKey(account.private_key.replace(/\\n/g, '\n'));
  if (key.asymmetricKeyType !== 'rsa') throw new Error('type');
  line('ok', 'clé privée', `RSA ${key.asymmetricKeyDetails?.modulusLength ?? '?'} bits, kid ${keyId.slice(0, 6)}…`);
} catch {
  line('fail', 'clé privée', 'illisible (PKCS#8 RSA attendu : -----BEGIN PRIVATE KEY-----)');
  stop();
}

/* 3. Site ------------------------------------------------------------ */

let origin = '';
try {
  const url = new URL(site);
  origin = url.origin;
  if (url.protocol === 'https:') line('ok', 'site public', origin);
  else line('fail', 'site public', `${origin} : HTTPS obligatoire (images du pass, origine du lien)`);
} catch {
  line('fail', 'site public', 'NEXT_PUBLIC_SITE_URL absente ou illisible');
}

/* 4. Jeton OAuth ----------------------------------------------------- */

const iat = Math.floor(Date.now() / 1000);
const assertion = signJwt(
  { alg: 'RS256', typ: 'JWT', kid: keyId },
  { iss: email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 },
  key,
);
const token = await call(tokenUri, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
});
const accessToken = typeof token.body?.access_token === 'string' ? token.body.access_token : null;
if (!accessToken) {
  line('fail', 'jeton OAuth', `${googleMessage(token)} : clé révoquée ou compte supprimé ?`);
  stop();
}
line('ok', 'jeton OAuth', `portée wallet_object.issuer, valable ${token.body.expires_in ?? '?'} s`);

const auth = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };

/* 5. Classe de file -------------------------------------------------- */

const queueClass = `${issuer}.${prefix}_file_v1`;
const cls = await call(`${API}/genericClass/${encodeURIComponent(queueClass)}`, { headers: auth });
if (cls.status === 200) line('ok', 'classe de file', `${queueClass} lisible`);
else if (cls.status === 404) line('fail', 'classe de file', `${queueClass} absente : le cron la crée dans la minute qui suit le déploiement`);
else if (cls.status === 403) line('fail', 'classe de file', '403 : ajoutez le compte de service comme « Développeur » de l’émetteur (Google Pay & Wallet Console)');
else line('fail', 'classe de file', googleMessage(cls));

/* 6. Lien d'enregistrement ------------------------------------------- */

const sampleId = objectArg ?? `${issuer}.${prefix}_q_${'0'.repeat(32)}`;
const objectType = /_e_[0-9a-f]{32}$/.test(sampleId) ? 'eventTicketObjects' : 'genericObjects';
const saveJwt = signJwt(
  { alg: 'RS256', typ: 'JWT', kid: keyId },
  { iss: email, aud: 'google', typ: 'savetowallet', iat, origins: origin ? [origin] : [], payload: { [objectType]: [{ id: sampleId }] } },
  key,
);
const link = `https://pay.google.com/gp/v/save/${saveJwt}`;
if (link.length < 1800) line('ok', 'lien d’enregistrement', `${link.length} caractères (< 1 800)`);
else line('fail', 'lien d’enregistrement', `${link.length} caractères : trop long`);

if (!objectArg) {
  line('skip', 'validation par Google', 'ajoutez --objet <identifiant d’un pass existant> pour la lancer');
} else {
  const validation = await call(`${API}/jwt/validate`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jwtResource: { jwt: saveJwt } }),
  });
  if (validation.status === 200) line('ok', 'validation par Google', `JWT accepté pour ${objectArg}`);
  else line('fail', 'validation par Google', googleMessage(validation));
}

if (mode === 'démo') {
  line('info', 'mode démo', 'seuls les comptes de test déclarés dans la console peuvent enregistrer un pass (« [TEST ONLY] »)');
}

stop();
