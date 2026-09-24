import { beforeAll, describe, expect, it } from 'vitest';
import { checkAppleConfig, type AppleWalletConfig } from '../../src/server/wallet/apple/config';
import type { AppleStore, PassLookup, RegisterResult } from '../../src/server/wallet/apple/store';
import { applePassToken } from '../../src/server/wallet/apple/tokens';
import {
  LIMITS, LOG_MAX_BYTES, PkpassCache, deviceKey, getLatestPass, listUpdatedSerials, readJsonBounded, receiveLog, registerDevice,
  unregisterDevice,
  type RenderedPass, type WebServiceDeps,
} from '../../src/server/wallet/apple/webservice';
import { TEST_PASS_TYPE, TEST_SECRET, configInput, makePki } from './apple-fixtures';

/**
 * Service web Apple Wallet, sans base ni réseau : chaque cas du § 8.2 du
 * plan (201/200/401/404/429, 204/200 et lastUpdated, 304/200, 503), la
 * limite de débit, le journal masqué et le cache des .pkpass signés.
 */

const SERIAL = 'q7Kx2mP9vLr4Tz8Wn3Hb5c';
const OTHER = 'Zp4aaaaaaaaaaaaaaaaaaa';
const DEVICE = 'a1b2c3d4e5f6a7b8c9d0';
const PUSH = 'ab'.repeat(32);
const BASE = 'https://rangvia.test/api/wallet/apple/v1';
let config: AppleWalletConfig;

beforeAll(() => {
  const check = checkAppleConfig(configInput(makePki()), new Date());
  if (!check.ok) throw new Error(check.reason);
  config = check.config;
});

interface Harness {
  deps: WebServiceDeps;
  calls: string[];
  logs: string[][];
  reports: string[];
  limits: string[];
  denied: Set<string>;
  registrations: Map<string, RegisterResult>;
  passes: Map<string, PassLookup>;
  rendered: { value: RenderedPass | null; error?: Error };
  serials: { serial: string; versionSeq: number }[];
}

function harness(options: { ready?: boolean } = {}): Harness {
  const h: Harness = {
    calls: [], logs: [], reports: [], limits: [], denied: new Set(),
    registrations: new Map(),
    passes: new Map([[SERIAL, { id: 'pass-1', state: 'active', versionSeq: 41, versionAt: '2026-09-24T12:05:00Z', contentHash: 'h' }]]),
    rendered: { value: { pkpass: Buffer.from('PK-pass'), versionSeq: 42, versionAt: '2026-09-24T12:10:07Z' } },
    serials: [],
    deps: undefined as unknown as WebServiceDeps,
  };
  const store: AppleStore = {
    recordRender: async () => ({ versionSeq: 1, versionAt: '2026-09-24T12:00:00Z' }),
    pushTargets: async () => [],
    dropTokens: async () => 0,
    register: async (serial, device, token) => {
      h.calls.push(`register ${serial} ${device} ${token}`);
      return h.registrations.get(serial) ?? 'created';
    },
    unregister: async (serial, device) => {
      h.calls.push(`unregister ${serial} ${device}`);
      return true;
    },
    serials: async (device, passType, since) => {
      h.calls.push(`serials ${device} ${passType} ${since}`);
      return h.serials.filter((row) => row.versionSeq > (since ?? 0));
    },
    lookup: async (serial) => h.passes.get(serial) ?? null,
  };
  h.deps = {
    config: async () => (options.ready === false ? null : config),
    store,
    ipHash: async () => 'iphash',
    allow: async (key) => {
      h.limits.push(key);
      return !h.denied.has(key.split(':').slice(0, 2).join(':'));
    },
    render: async () => {
      if (h.rendered.error) throw h.rendered.error;
      return h.rendered.value;
    },
    report: (message) => { h.reports.push(message); },
    log: (lines) => { h.logs.push(lines); },
  };
  return h;
}

const auth = (serial = SERIAL) => ({ Authorization: `ApplePass ${applePassToken(serial, TEST_SECRET)}` });
const reg = (serial = SERIAL, device = DEVICE, passTypeId = TEST_PASS_TYPE) => ({ deviceId: device, passTypeId, serial });

function post(body: unknown, headers: Record<string, string> = auth()): Request {
  return new Request(`${BASE}/devices/${DEVICE}/registrations/${TEST_PASS_TYPE}/${SERIAL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('non prêt : 404 partout, sans rien toucher', () => {
  it('toutes les routes', async () => {
    const h = harness({ ready: false });
    const responses = await Promise.all([
      registerDevice(post({ pushToken: PUSH }), reg(), h.deps),
      unregisterDevice(new Request(BASE, { method: 'DELETE', headers: auth() }), reg(), h.deps),
      listUpdatedSerials(new Request(`${BASE}/devices/${DEVICE}/registrations/${TEST_PASS_TYPE}`), reg(), h.deps),
      getLatestPass(new Request(BASE, { headers: auth() }), reg(), h.deps),
      receiveLog(new Request(`${BASE}/log`, { method: 'POST', body: '{"logs":["x"]}' }), h.deps),
    ]);
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(h.calls).toEqual([]);
    expect(h.limits).toEqual([]);
  });

  it('un autre type de pass : 404', async () => {
    const h = harness();
    expect((await registerDevice(post({ pushToken: PUSH }), reg(SERIAL, DEVICE, 'pass.autre.rangvia'), h.deps)).status).toBe(404);
    expect((await listUpdatedSerials(new Request(BASE), reg(SERIAL, DEVICE, 'pass.autre.rangvia'), h.deps)).status).toBe(404);
    expect(h.calls).toEqual([]);
  });
});

describe('inscription', () => {
  it('201 à la première inscription, 200 ensuite', async () => {
    const h = harness();
    const created = await registerDevice(post({ pushToken: PUSH }), reg(), h.deps);
    expect(created.status).toBe(201);
    expect(h.calls).toEqual([`register ${SERIAL} ${DEVICE} ${PUSH}`]);
    h.registrations.set(SERIAL, 'exists');
    expect((await registerDevice(post({ pushToken: PUSH }), reg(), h.deps)).status).toBe(200);
  });

  it('401 identique : sans en-tête, faux jeton, jeton d’un autre pass, pass effacé', async () => {
    const h = harness();
    const noHeader = await registerDevice(post({ pushToken: PUSH }, {}), reg(), h.deps);
    const wrong = await registerDevice(post({ pushToken: PUSH }, { Authorization: 'ApplePass abcdefghijklmnopqrstuvwxyz' }), reg(), h.deps);
    const other = await registerDevice(post({ pushToken: PUSH }, auth(OTHER)), reg(), h.deps);
    h.registrations.set(SERIAL, 'gone');
    const gone = await registerDevice(post({ pushToken: PUSH }), reg(), h.deps);
    const statuses = [noHeader, wrong, other, gone].map((r) => r.status);
    expect(statuses).toEqual([401, 401, 401, 401]);
    const bodies = await Promise.all([noHeader, wrong, other, gone].map((r) => r.text()));
    expect(new Set(bodies).size).toBe(1);
    // Aucun accès à la base avant un jeton valide.
    expect(h.calls).toEqual([`register ${SERIAL} ${DEVICE} ${PUSH}`]);
  });

  it('segments invalides refusés AVANT tout SQL', async () => {
    const h = harness();
    expect((await registerDevice(post({ pushToken: PUSH }), reg('court', DEVICE), h.deps)).status).toBe(401);
    expect((await registerDevice(post({ pushToken: PUSH }), reg(SERIAL, 'x'), h.deps)).status).toBe(404);
    expect((await registerDevice(post({ pushToken: PUSH }), reg(SERIAL, "a'; drop table--"), h.deps)).status).toBe(404);
    expect(h.calls).toEqual([]);
  });

  it('corps invalide : 400', async () => {
    const h = harness();
    expect((await registerDevice(post('{pas du json'), reg(), h.deps)).status).toBe(400);
    expect((await registerDevice(post({ pushToken: 'zz' }), reg(), h.deps)).status).toBe(400);
    expect((await registerDevice(post({}), reg(), h.deps)).status).toBe(400);
    expect(h.calls).toEqual([]);
  });

  it('6ᵉ appareil : 429', async () => {
    const h = harness();
    h.registrations.set(SERIAL, 'limit');
    expect((await registerDevice(post({ pushToken: PUSH }), reg(), h.deps)).status).toBe(429);
  });

  it('limites de débit par adresse et par série : 429', async () => {
    const h = harness();
    await registerDevice(post({ pushToken: PUSH }), reg(), h.deps);
    expect(h.limits).toEqual([`wallet-ws:ip:iphash`, `wallet-ws:serial:${SERIAL}`]);
    h.denied.add('wallet-ws:serial');
    expect((await registerDevice(post({ pushToken: PUSH }), reg(), h.deps)).status).toBe(429);
    h.denied.clear();
    h.denied.add('wallet-ws:ip');
    expect((await getLatestPass(new Request(BASE, { headers: auth() }), reg(), h.deps)).status).toBe(429);
    // Plafond par adresse LARGE : un drop, c'est des centaines d'iPhones
    // derrière le même Wi-Fi ; la vraie borne est par pass et par appareil.
    expect(LIMITS).toMatchObject({
      ip: { max: 3000, window: 300 }, serial: { max: 60, window: 300 }, device: { max: 120, window: 300 }, log: { max: 20, window: 300 },
    });
  });

  it('corps démesuré : 400 sans le lire en entier, rien en base', async () => {
    const h = harness();
    const big = JSON.stringify({ pushToken: PUSH, pad: 'x'.repeat(4096) });
    expect((await registerDevice(post(big), reg(), h.deps)).status).toBe(400);
    expect(h.calls).toEqual([]);
  });
});

describe('désinscription', () => {
  it('200 avec le bon jeton (idempotente), 401 sinon', async () => {
    const h = harness();
    const ok = await unregisterDevice(new Request(BASE, { method: 'DELETE', headers: auth() }), reg(), h.deps);
    expect(ok.status).toBe(200);
    expect(h.calls).toEqual([`unregister ${SERIAL} ${DEVICE}`]);
    const ko = await unregisterDevice(new Request(BASE, { method: 'DELETE' }), reg(), h.deps);
    expect(ko.status).toBe(401);
  });
});

describe('liste des passes mis à jour', () => {
  const list = (since?: string) =>
    new Request(`${BASE}/devices/${DEVICE}/registrations/${TEST_PASS_TYPE}${since !== undefined ? `?passesUpdatedSince=${since}` : ''}`);

  it('204 sans nouveauté ; 200 avec les séries et lastUpdated = plus grande version', async () => {
    const h = harness();
    expect((await listUpdatedSerials(list(), reg(), h.deps)).status).toBe(204);
    h.serials = [{ serial: SERIAL, versionSeq: 42 }, { serial: OTHER, versionSeq: 57 }];
    const all = await listUpdatedSerials(list(), reg(), h.deps);
    expect(all.status).toBe(200);
    expect(await all.json()).toEqual({ serialNumbers: [SERIAL, OTHER], lastUpdated: '57' });
    const since = await listUpdatedSerials(list('42'), reg(), h.deps);
    expect(await since.json()).toEqual({ serialNumbers: [OTHER], lastUpdated: '57' });
    expect((await listUpdatedSerials(list('57'), reg(), h.deps)).status).toBe(204);
    expect(h.calls).toContain(`serials ${DEVICE} ${TEST_PASS_TYPE} 42`);
  });

  it('étiquette illisible ou hors de la plage exacte d’un nombre : 400, sans SQL', async () => {
    const h = harness();
    expect((await listUpdatedSerials(list('abc'), reg(), h.deps)).status).toBe(400);
    expect((await listUpdatedSerials(list('1;drop'), reg(), h.deps)).status).toBe(400);
    // 16 chiffres et plus : Number() perdrait des unités (au-delà de 2^53).
    expect((await listUpdatedSerials(list('9007199254740993'), reg(), h.deps)).status).toBe(400);
    expect((await listUpdatedSerials(list('9'.repeat(19)), reg(), h.deps)).status).toBe(400);
    expect(h.calls).toEqual([]);
    expect((await listUpdatedSerials(list('999999999999999'), reg(), h.deps)).status).toBe(204);
    expect(h.calls).toEqual([`serials ${DEVICE} ${TEST_PASS_TYPE} 999999999999999`]);
  });

  it('limite par appareil, sous une clé condensée (jamais l’identifiant en base)', async () => {
    const h = harness();
    await listUpdatedSerials(list(), reg(), h.deps);
    expect(h.limits).toEqual(['wallet-ws:ip:iphash', `wallet-ws:device:${deviceKey(DEVICE)}`]);
    expect(h.limits.join(' ')).not.toContain(DEVICE);
    expect(deviceKey(DEVICE)).toMatch(/^[0-9a-f]{32}$/);
    h.denied.add('wallet-ws:device');
    expect((await listUpdatedSerials(list(), reg(), h.deps)).status).toBe(429);
  });
});

describe('dernière version d’un pass', () => {
  const get = (headers: Record<string, string> = auth()) => new Request(`${BASE}/passes/${TEST_PASS_TYPE}/${SERIAL}`, { headers });

  it('200 : .pkpass, Last-Modified de la version, jamais en cache', async () => {
    const h = harness();
    const res = await getLatestPass(get(), reg(), h.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
    expect(res.headers.get('last-modified')).toBe('Thu, 24 Sep 2026 12:10:07 GMT');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('PK-pass');
  });

  it('304 si l’appareil a déjà cette version (ou plus récente), 200 sinon', async () => {
    const h = harness();
    const same = await getLatestPass(get({ ...auth(), 'If-Modified-Since': 'Thu, 24 Sep 2026 12:10:07 GMT' }), reg(), h.deps);
    expect(same.status).toBe(304);
    expect(same.headers.get('last-modified')).toBe('Thu, 24 Sep 2026 12:10:07 GMT');
    const later = await getLatestPass(get({ ...auth(), 'If-Modified-Since': 'Thu, 24 Sep 2026 12:11:00 GMT' }), reg(), h.deps);
    expect(later.status).toBe(304);
    const older = await getLatestPass(get({ ...auth(), 'If-Modified-Since': 'Thu, 24 Sep 2026 12:10:06 GMT' }), reg(), h.deps);
    expect(older.status).toBe(200);
    const garbage = await getLatestPass(get({ ...auth(), 'If-Modified-Since': 'hier' }), reg(), h.deps);
    expect(garbage.status).toBe(200);
  });

  it('401 : pass inconnu, effacé ou révoqué', async () => {
    const h = harness();
    h.passes.set(SERIAL, { id: 'pass-1', state: 'scrubbed', versionSeq: 1, versionAt: '2026-09-24T12:00:00Z', contentHash: null });
    expect((await getLatestPass(get(), reg(), h.deps)).status).toBe(401);
    h.passes.clear();
    expect((await getLatestPass(get(), reg(), h.deps)).status).toBe(401);
  });

  it('génération impossible : 503 + Retry-After, incident remonté', async () => {
    const h = harness();
    h.rendered.error = new Error('certificat expiré');
    const res = await getLatestPass(get(), reg(), h.deps);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('300');
    expect(h.reports).toHaveLength(1);
  });
});

describe('journal de l’iPhone', () => {
  it('200, au plus 10 lignes de 300 caractères, jetons masqués', async () => {
    const h = harness();
    const logs = [
      'Échec : Authorization ApplePass abcdefghijklmnopqrstuvwxyz0123456789 refusé',
      'x'.repeat(1000),
      ...Array.from({ length: 20 }, (_, i) => `ligne ${i}\nsuite`),
    ];
    const res = await receiveLog(new Request(`${BASE}/log`, { method: 'POST', body: JSON.stringify({ logs }) }), h.deps);
    expect(res.status).toBe(200);
    expect(h.logs).toHaveLength(1);
    const lines = h.logs[0]!;
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe('Échec : Authorization ApplePass *** refusé');
    expect(lines[1]).toHaveLength(300);
    expect(lines[2]).toBe('ligne 0 suite');
    expect(h.limits).toEqual(['wallet-log:ip:iphash']);
  });

  it('corps illisible : 200 quand même, rien d’écrit', async () => {
    const h = harness();
    expect((await receiveLog(new Request(`${BASE}/log`, { method: 'POST', body: 'nope' }), h.deps)).status).toBe(200);
    expect(h.logs).toEqual([]);
  });

  it('identifiants d’appareil et numéros de série masqués, pas seulement les jetons', async () => {
    const h = harness();
    const line = `Register task (for device ${DEVICE}, pass type ${TEST_PASS_TYPE}, serial number ${SERIAL}; with web service url `
      + `${BASE}/devices/${DEVICE}/registrations/${TEST_PASS_TYPE}/${SERIAL}) encountered error: Unexpected response code 401`;
    await receiveLog(new Request(`${BASE}/log`, { method: 'POST', body: JSON.stringify({ logs: [line] }) }), h.deps);
    const [logged] = h.logs[0]!;
    expect(logged).not.toContain(DEVICE);
    expect(logged).not.toContain(SERIAL);
    // Ce qui sert au diagnostic reste.
    expect(logged).toContain(TEST_PASS_TYPE);
    expect(logged).toContain('Unexpected response code 401');
  });

  it('corps de plus de 16 ko : ignoré sans être lu, 200', async () => {
    const h = harness();
    const logs = Array.from({ length: 100 }, () => 'y'.repeat(200));
    const res = await receiveLog(new Request(`${BASE}/log`, { method: 'POST', body: JSON.stringify({ logs }) }), h.deps);
    expect(res.status).toBe(200);
    expect(h.logs).toEqual([]);
  });
});

describe('lecture bornée d’un corps JSON', () => {
  const stream = (parts: string[]) => new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });
  const chunked = (parts: string[]) =>
    new Request(`${BASE}/log`, { method: 'POST', body: stream(parts), duplex: 'half' } as RequestInit & { duplex: 'half' });

  it('Content-Length annoncé au-delà de la borne : refus sans lecture', async () => {
    const req = new Request(`${BASE}/log`, { method: 'POST', body: '{"logs":[]}', headers: { 'Content-Length': String(LOG_MAX_BYTES + 1) } });
    expect(await readJsonBounded(req, LOG_MAX_BYTES)).toBeNull();
  });

  it('corps sans taille annoncée (chunked) : lecture arrêtée à la borne', async () => {
    expect(await readJsonBounded(chunked(['{"logs":["', 'z'.repeat(2000), '"]}']), 1024)).toBeNull();
    expect(await readJsonBounded(chunked(['{"logs":', '["ok"]}']), 1024)).toEqual({ logs: ['ok'] });
  });

  it('JSON invalide ou corps absent : null', async () => {
    expect(await readJsonBounded(chunked(['{pas']), 1024)).toBeNull();
    expect(await readJsonBounded(new Request(`${BASE}/log`, { method: 'POST' }), 1024)).toBeNull();
  });
});

describe('cache des .pkpass signés', () => {
  it('par (série, version), 60 s, 500 entrées au plus', () => {
    const cache = new PkpassCache();
    cache.set(SERIAL, 3, Buffer.from('v3'), 0);
    expect(cache.get(SERIAL, 3, 59_999)?.toString()).toBe('v3');
    expect(cache.get(SERIAL, 4, 1)).toBeNull();
    expect(cache.get(SERIAL, 3, 60_000)).toBeNull();
    for (let i = 0; i < 600; i += 1) cache.set(`s${i}`, 1, Buffer.from('x'), 0);
    expect(cache.size).toBe(500);
    expect(cache.get('s0', 1, 1)).toBeNull();
    expect(cache.get('s599', 1, 1)).not.toBeNull();
  });
});
