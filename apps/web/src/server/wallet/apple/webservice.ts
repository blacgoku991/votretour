import 'server-only';
import type { AppleWalletConfig } from './config';
import type { AppleStore } from './store';
import { APPLE_SERIAL, redactApplePass, verifyApplePassToken } from './tokens';
import { PKPASS_TYPE, httpDate } from './pass';

/**
 * Service web Apple Wallet : la logique des 5 routes de
 * /api/wallet/apple/v1/…, testable sans Next, sans base ni réseau
 * (toutes les dépendances sont injectées).
 *
 *   POST   /v1/devices/{appareil}/registrations/{type}/{série}   inscription
 *   GET    /v1/devices/{appareil}/registrations/{type}?passesUpdatedSince=
 *   GET    /v1/passes/{type}/{série}                               dernière version
 *   DELETE /v1/devices/{appareil}/registrations/{type}/{série}   désinscription
 *   POST   /v1/log                                                 journal de l'iPhone
 *
 * Règles communes :
 *  - intégration non prête, ou type de pass qui n'est pas le nôtre : 404,
 *    partout, sans rien dire de plus (aucune simulation) ;
 *  - chaque segment est validé par expression régulière AVANT toute
 *    requête SQL ;
 *  - jeton ApplePass recalculé et comparé en temps constant ; inconnu,
 *    révoqué, effacé ou faux jeton : la MÊME réponse 401 ;
 *  - limites de débit (condensat d'adresse, jamais l'adresse) ;
 *  - le journal de l'iPhone ne va que dans les journaux applicatifs,
 *    tronqué, jetons masqués : jamais en base.
 */

export const DEVICE_ID = /^[A-Za-z0-9._-]{8,128}$/;
export const PUSH_TOKEN = /^[0-9a-fA-F]{32,200}$/;
const SINCE_TAG = /^\d{1,19}$/;

export const LIMITS = {
  ip: { max: 300, window: 300 },
  serial: { max: 60, window: 300 },
  log: { max: 20, window: 300 },
} as const;

/** Rendu servi à un appareil : .pkpass signé de la version courante. */
export interface RenderedPass {
  pkpass: Buffer;
  versionSeq: number;
  versionAt: string;
}

export interface WebServiceDeps {
  /** Configuration prête, ou null : tout le service répond 404. */
  config(): Promise<AppleWalletConfig | null>;
  store: AppleStore;
  /** Condensat de l'adresse du demandeur (jamais l'adresse elle-même). */
  ipHash(request: Request): Promise<string | null>;
  /** Vrai si la requête passe la limite (consume_rate_limit ; ouvert en cas de panne). */
  allow(key: string, max: number, windowSeconds: number): Promise<boolean>;
  /** Instantané → vue → pass → wallet_record_render → .pkpass (null : pass introuvable). */
  render(passId: string, config: AppleWalletConfig): Promise<RenderedPass | null>;
  report(message: string, context: Record<string, unknown>): void;
  log(lines: string[]): void;
}

const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } as const;

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...BASE_HEADERS, ...extra } });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' } });
}

const notFound = () => empty(404);
const unauthorized = () => empty(401);
const tooMany = () => empty(429, { 'Retry-After': '60' });

async function limited(request: Request, deps: WebServiceDeps, serial: string | null): Promise<boolean> {
  const ip = await deps.ipHash(request);
  if (ip && !(await deps.allow(`wallet-ws:ip:${ip}`, LIMITS.ip.max, LIMITS.ip.window))) return true;
  if (serial && !(await deps.allow(`wallet-ws:serial:${serial}`, LIMITS.serial.max, LIMITS.serial.window))) return true;
  return false;
}

interface RegistrationParams {
  deviceId: string;
  passTypeId: string;
  serial: string;
}

/**
 * Préambule commun des routes authentifiées par ApplePass : service prêt,
 * notre type de pass, segments valides, débit, jeton. Renvoie la
 * configuration, ou la réponse à rendre telle quelle.
 */
async function authenticate(
  request: Request,
  params: { passTypeId: string; serial: string; deviceId?: string },
  deps: WebServiceDeps,
): Promise<AppleWalletConfig | Response> {
  const config = await deps.config();
  if (!config) return notFound();
  if (params.passTypeId !== config.passTypeId) return notFound();
  if (params.deviceId !== undefined && !DEVICE_ID.test(params.deviceId)) return notFound();
  if (!APPLE_SERIAL.test(params.serial)) return unauthorized();
  if (await limited(request, deps, params.serial)) return tooMany();
  if (!verifyApplePassToken(params.serial, request.headers.get('authorization'), config.authSecret)) return unauthorized();
  return config;
}

/** POST /v1/devices/{appareil}/registrations/{type}/{série} */
export async function registerDevice(request: Request, params: RegistrationParams, deps: WebServiceDeps): Promise<Response> {
  const auth = await authenticate(request, params, deps);
  if (auth instanceof Response) return auth;

  let pushToken: unknown;
  try {
    pushToken = ((await request.json()) as { pushToken?: unknown } | null)?.pushToken;
  } catch {
    return empty(400);
  }
  if (typeof pushToken !== 'string' || !PUSH_TOKEN.test(pushToken)) return empty(400);

  switch (await deps.store.register(params.serial, params.deviceId, pushToken)) {
    case 'created':
      return empty(201);
    case 'exists':
      return empty(200);
    case 'limit':
      // Au-delà de 5 appareils (iPhone, Apple Watch, iPad…) : refus.
      return tooMany();
    case 'gone':
      return unauthorized();
  }
}

/** DELETE /v1/devices/{appareil}/registrations/{type}/{série} */
export async function unregisterDevice(request: Request, params: RegistrationParams, deps: WebServiceDeps): Promise<Response> {
  const auth = await authenticate(request, params, deps);
  if (auth instanceof Response) return auth;
  // Idempotent : une désinscription déjà faite répond aussi 200.
  await deps.store.unregister(params.serial, params.deviceId);
  return empty(200);
}

/**
 * GET /v1/devices/{appareil}/registrations/{type}?passesUpdatedSince=
 * L'identifiant de bibliothèque est lui-même le secret partagé (Apple).
 */
export async function listUpdatedSerials(
  request: Request,
  params: { deviceId: string; passTypeId: string },
  deps: WebServiceDeps,
): Promise<Response> {
  const config = await deps.config();
  if (!config) return notFound();
  if (params.passTypeId !== config.passTypeId || !DEVICE_ID.test(params.deviceId)) return notFound();
  const sinceRaw = new URL(request.url).searchParams.get('passesUpdatedSince');
  if (sinceRaw !== null && sinceRaw !== '' && !SINCE_TAG.test(sinceRaw)) return empty(400);
  if (await limited(request, deps, null)) return tooMany();

  const since = sinceRaw ? Number(sinceRaw) : null;
  const rows = await deps.store.serials(params.deviceId, config.passTypeId, since);
  if (rows.length === 0) return empty(204);
  const lastUpdated = rows.reduce((max, row) => Math.max(max, row.versionSeq), since ?? 0);
  return json(200, { serialNumbers: rows.map((row) => row.serial), lastUpdated: String(lastUpdated) });
}

/** GET /v1/passes/{type}/{série} */
export async function getLatestPass(
  request: Request,
  params: { passTypeId: string; serial: string },
  deps: WebServiceDeps,
): Promise<Response> {
  const auth = await authenticate(request, params, deps);
  if (auth instanceof Response) return auth;

  const pass = await deps.store.lookup(params.serial);
  if (!pass || (pass.state !== 'active' && pass.state !== 'final')) return unauthorized();

  let rendered: RenderedPass | null;
  try {
    rendered = await deps.render(pass.id, auth);
  } catch (error) {
    // Certificat expiré, image corrompue… Wallet réessaiera.
    deps.report('Génération du pass impossible', { error: error instanceof Error ? error.message : 'inconnue' });
    return empty(503, { 'Retry-After': '300' });
  }
  if (!rendered) return unauthorized();

  const lastModified = httpDate(rendered.versionAt);
  const since = Date.parse(request.headers.get('if-modified-since') ?? '');
  if (Number.isFinite(since) && Math.floor(since / 1000) >= Math.floor(Date.parse(rendered.versionAt) / 1000)) {
    return empty(304, { 'Last-Modified': lastModified });
  }
  return new Response(new Uint8Array(rendered.pkpass), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Cache-Control': 'private, no-store',
      'Content-Type': PKPASS_TYPE,
      'Content-Length': String(rendered.pkpass.length),
      'Last-Modified': lastModified,
    },
  });
}

/** POST /v1/log : { logs: string[] } → journaux applicatifs seulement. */
export async function receiveLog(request: Request, deps: WebServiceDeps): Promise<Response> {
  const config = await deps.config();
  if (!config) return notFound();
  const ip = await deps.ipHash(request);
  if (ip && !(await deps.allow(`wallet-log:ip:${ip}`, LIMITS.log.max, LIMITS.log.window))) return tooMany();
  let logs: unknown;
  try {
    logs = ((await request.json()) as { logs?: unknown } | null)?.logs;
  } catch {
    return empty(200);
  }
  if (Array.isArray(logs)) {
    const lines = logs
      .filter((line): line is string => typeof line === 'string')
      .slice(0, 10)
      .map((line) => redactApplePass(line).replace(/[\r\n\t]+/g, ' ').slice(0, 300));
    if (lines.length > 0) deps.log(lines);
  }
  return empty(200);
}

/* ====================================================================
   Cache des .pkpass signés : l'iPhone et la montre demandent la même
   version à quelques secondes d'intervalle, une seule signature suffit.
   ==================================================================== */

export const RENDER_CACHE_TTL_MS = 60_000;
export const RENDER_CACHE_MAX = 500;

export class PkpassCache {
  private readonly entries = new Map<string, { value: Buffer; until: number }>();

  constructor(private readonly ttlMs = RENDER_CACHE_TTL_MS, private readonly max = RENDER_CACHE_MAX) {}

  get(serial: string, versionSeq: number, now: number): Buffer | null {
    const key = `${serial}:${versionSeq}`;
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.until <= now) {
      this.entries.delete(key);
      return null;
    }
    return hit.value;
  }

  set(serial: string, versionSeq: number, value: Buffer, now: number): void {
    const key = `${serial}:${versionSeq}`;
    this.entries.delete(key);
    this.entries.set(key, { value, until: now + this.ttlMs });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
