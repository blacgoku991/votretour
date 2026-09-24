import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEAD_TOKEN_REASONS, RETRIABLE_REASONS } from '../../src/server/notifications/apns';
import {
  PUSH_TTL_SECONDS, buildWalletPushRequest, classifyPush, closeWalletApnsSessions, http2Transport, pushPassUpdate,
  type PushRequest, type PushResponse, type PushTransport,
} from '../../src/server/wallet/apple/apns';
import { checkAppleConfig, type AppleWalletConfig } from '../../src/server/wallet/apple/config';
import { buildApplePass } from '../../src/server/wallet/apple/pass';
import { processAppleJob, type AppleProcessDeps } from '../../src/server/wallet/apple/provider';
import type { AppleStore } from '../../src/server/wallet/apple/store';
import { buildWalletView } from '../../src/server/wallet/view';
import type { ClaimedJob, WalletSnapshot } from '../../src/server/wallet/types';
import { TEST_PASS_TYPE, configInput, issue, makePki, type TestPki } from './apple-fixtures';
import { SITE, snapshot } from './fixtures';

/**
 * Pushes Apple Wallet et traitement d'une ligne de la file d'envoi, sans
 * réseau : requête construite (chemin, apns-topic, corps {}), classement
 * des réponses, jetons morts supprimés, certificat refusé qui arrête le
 * tour, signal d'annulation relayé. Puis un vrai échange HTTP/2 + TLS
 * client, contre un serveur LOCAL qui joue APNs.
 */

const NOW = new Date('2026-09-24T12:30:00Z');
const T1 = 'a'.repeat(64);
const T2 = 'b'.repeat(64);
const T3 = 'c'.repeat(64);
let pki: TestPki;
let config: AppleWalletConfig;

beforeAll(() => {
  pki = makePki();
  const check = checkAppleConfig(configInput(pki), new Date());
  if (!check.ok) throw new Error(check.reason);
  config = check.config;
});

describe('requête APNs', () => {
  it('POST /3/device/<jeton>, topic = passTypeIdentifier, corps {}, expiration à 1 h', () => {
    const req = buildWalletPushRequest(T1, TEST_PASS_TYPE, NOW);
    expect(req.body).toBe('{}');
    expect(req.headers).toEqual({
      ':method': 'POST',
      ':path': `/3/device/${T1}`,
      'apns-topic': TEST_PASS_TYPE,
      'apns-expiration': Math.floor(NOW.getTime() / 1000) + PUSH_TTL_SECONDS,
      'content-type': 'application/json',
      'content-length': 2,
    });
    // Ni apns-push-type ni priorité [à vérifier en recette], jamais d'autorisation par jeton .p8.
    expect(req.headers).not.toHaveProperty('apns-push-type');
    expect(req.headers).not.toHaveProperty('authorization');
  });

  it('refuse un jeton mal formé (jamais injecté dans le chemin)', () => {
    expect(() => buildWalletPushRequest('../../x', TEST_PASS_TYPE, NOW)).toThrow();
  });
});

describe('classement des réponses', () => {
  const table: [PushResponse, string][] = [
    [{ status: 200, reason: null }, 'ok'],
    [{ status: 410, reason: 'Unregistered' }, 'dead'],
    [{ status: 400, reason: 'BadDeviceToken' }, 'dead'],
    [{ status: 400, reason: 'DeviceTokenNotForTopic' }, 'dead'],
    [{ status: 410, reason: 'ExpiredToken' }, 'dead'],
    [{ status: 403, reason: 'BadCertificate' }, 'halt'],
    [{ status: 403, reason: 'BadCertificateEnvironment' }, 'halt'],
    [{ status: 403, reason: 'Forbidden' }, 'halt'],
    [{ status: 400, reason: 'TopicDisallowed' }, 'halt'],
    [{ status: 429, reason: 'TooManyRequests' }, 'retry'],
    [{ status: 500, reason: 'InternalServerError' }, 'retry'],
    [{ status: 503, reason: 'ServiceUnavailable' }, 'retry'],
    [{ status: 0, reason: 'Timeout' }, 'retry'],
    [{ status: 0, reason: 'Aborted' }, 'aborted'],
    [{ status: 400, reason: 'BadExpirationDate' }, 'fail'],
  ];
  for (const [response, outcome] of table) {
    it(`${response.status} ${response.reason} → ${outcome}`, () => expect(classifyPush(response)).toBe(outcome));
  }

  it('listes partagées avec les pushes de l’App Clip', () => {
    for (const reason of ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']) {
      expect(DEAD_TOKEN_REASONS.has(reason)).toBe(true);
    }
    expect(RETRIABLE_REASONS.has('TooManyRequests')).toBe(true);
  });
});

describe('envoi à plusieurs appareils', () => {
  it('jetons dédoublonnés, mal formés ignorés, une issue par jeton', async () => {
    const seen: string[] = [];
    const transport: PushTransport = async (req) => {
      seen.push(String(req.headers[':path']));
      return req.headers[':path'] === `/3/device/${T2}` ? { status: 410, reason: 'Unregistered' } : { status: 200, reason: null };
    };
    const results = await pushPassUpdate([T1, T1, T2, 'zz'], { topic: TEST_PASS_TYPE, transport, signal: new AbortController().signal, now: NOW });
    expect(seen.sort()).toEqual([`/3/device/${T1}`, `/3/device/${T2}`]);
    expect(results.map((r) => [r.token, r.outcome]).sort()).toEqual([[T1, 'ok'], [T2, 'dead']]);
  });

  it('signal déjà annulé : rien ne part', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const results = await pushPassUpdate([T1, T2], {
      topic: TEST_PASS_TYPE, transport: async () => { calls += 1; return { status: 200, reason: null }; }, signal: controller.signal, now: NOW,
    });
    expect(calls).toBe(0);
    expect(results.every((r) => r.outcome === 'aborted')).toBe(true);
  });

  it('une exception du transport devient un échec passager', async () => {
    const results = await pushPassUpdate([T1], {
      topic: TEST_PASS_TYPE, transport: async () => { throw new Error('ECONNRESET'); }, signal: new AbortController().signal, now: NOW,
    });
    expect(results[0]).toMatchObject({ outcome: 'retry', reason: 'ECONNRESET' });
  });
});

/* ====================================================================
   Traitement d'une ligne de la file d'envoi
   ==================================================================== */

function job(kind: 'sync' | 'scrub' = 'sync'): ClaimedJob {
  return {
    id: 7, walletPassId: '7b0f3c1e-2a44-4c1b-9d0e-5f6a7b8c9d01', provider: 'apple', queueId: 'q', job: kind,
    reasons: ['position'], priority: 1, attempts: 1, runAfter: NOW.toISOString(), createdAt: NOW.toISOString(),
  };
}

interface Rig {
  deps: AppleProcessDeps;
  calls: string[];
  requests: PushRequest[];
  signals: AbortSignal[];
  reports: string[];
}

function rig(tokens: string[], respond: (token: string) => PushResponse = () => ({ status: 200, reason: null })): Rig {
  const r: Rig = { calls: [], requests: [], signals: [], reports: [], deps: undefined as unknown as AppleProcessDeps };
  const store: AppleStore = {
    recordRender: async (id, hash) => { r.calls.push(`record ${id} ${hash.slice(0, 8)}`); return { versionSeq: 2, versionAt: NOW.toISOString() }; },
    pushTargets: async () => { r.calls.push('targets'); return tokens; },
    dropTokens: async (dead) => { r.calls.push(`drop ${dead.map((t) => t[0]).join(',')}`); return dead.length; },
    register: async () => 'created',
    unregister: async () => true,
    serials: async () => [],
    lookup: async () => null,
  };
  r.deps = {
    config,
    store,
    transport: async (req, signal) => {
      r.requests.push(req);
      r.signals.push(signal);
      return respond(String(req.headers[':path']).split('/').pop()!);
    },
    report: (message) => { r.reports.push(message); },
    sources: { logo: null, cover: null },
  };
  return r;
}

async function run(snap: WalletSnapshot, r: Rig, signal = new AbortController().signal, kind: 'sync' | 'scrub' = 'sync') {
  const view = buildWalletView(snap, NOW, { siteUrl: SITE });
  return processAppleJob(job(kind), snap, NOW, view, signal, r.deps);
}

describe('traitement Apple', () => {
  it('rendu changé : nouvelle version, push {} à chaque appareil, moment signalé', async () => {
    const r = rig([T1, T2]);
    const snap = snapshot({ entry: { peopleAhead: 2 } });
    const result = await run(snap, r);
    expect(result).toMatchObject({ ok: true, alertKind: 'ahead_two', alertNotified: true });
    expect(r.calls[0]).toMatch(/^record 7b0f3c1e/);
    expect(r.requests).toHaveLength(2);
    expect(r.requests.every((q) => q.body === '{}' && q.headers['apns-topic'] === TEST_PASS_TYPE)).toBe(true);
  });

  it('rendu inchangé depuis le dernier envoi : aucun push', async () => {
    const snap = snapshot({ entry: { peopleAhead: 6 } });
    const view = buildWalletView(snap, NOW, { siteUrl: SITE });
    const built = await buildApplePass({ snap, view, now: NOW, config, sources: { logo: null, cover: null } });
    const r = rig([T1]);
    const result = await run(snapshot({ entry: { peopleAhead: 6 }, pass: { syncedHash: built.hash } }), r);
    expect(result).toEqual({ ok: true, syncedHash: built.hash });
    expect(r.calls).toEqual([]);
    expect(r.requests).toEqual([]);
  });

  it('moment déjà inscrit au registre : envoyé, mais pas compté deux fois', async () => {
    const r = rig([T1]);
    const result = await run(snapshot({ entry: { peopleAhead: 2 }, pass: { alerts: { ahead_two: '2026-09-24T12:20:00Z' } } }), r);
    expect(result).toMatchObject({ ok: true, alertKind: 'ahead_two', alertNotified: false });
    expect(r.requests).toHaveLength(1);
  });

  it('jetons morts supprimés ; les autres appareils servis', async () => {
    const r = rig([T1, T2, T3], (token) => (token === T2 ? { status: 410, reason: 'Unregistered' } : { status: 200, reason: null }));
    const result = await run(snapshot({ entry: { peopleAhead: 1 } }), r);
    expect(result).toMatchObject({ ok: true, alertKind: 'ahead_one', alertNotified: true });
    expect(r.calls).toContain('drop b');
  });

  it('tous les appareils morts : terminé, sans alerte comptée', async () => {
    const r = rig([T1], () => ({ status: 400, reason: 'BadDeviceToken' }));
    const result = await run(snapshot({ entry: { peopleAhead: 1 } }), r);
    expect(result).toMatchObject({ ok: true, alertNotified: false });
    expect(r.calls).toContain('drop a');
  });

  it('certificat refusé par APNs : arrêt du tour, incident remonté', async () => {
    const r = rig([T1], () => ({ status: 403, reason: 'BadCertificate' }));
    const result = await run(snapshot({ entry: { peopleAhead: 1 } }), r);
    expect(result).toMatchObject({ ok: false, haltProvider: true, dead: false });
    expect(r.reports[0]).toMatch(/Certificat refusé par APNs/);
    // Jamais un jeton complet dans un message.
    expect(r.reports.join(' ')).not.toContain(T1);
  });

  it('APNs surchargé : nouvel essai', async () => {
    const r = rig([T1, T2], (token) => (token === T1 ? { status: 429, reason: 'TooManyRequests' } : { status: 200, reason: null }));
    const result = await run(snapshot({ entry: { peopleAhead: 1 } }), r);
    expect(result).toMatchObject({ ok: false, dead: false, retryAfterSeconds: 30 });
  });

  it('requête refusée (400) partout : abandon, pas de boucle', async () => {
    const r = rig([T1], () => ({ status: 400, reason: 'BadExpirationDate' }));
    const result = await run(snapshot({ entry: { peopleAhead: 1 } }), r);
    expect(result).toMatchObject({ ok: false, dead: true });
  });

  it('plus aucun appareil : version prête, rien à pousser', async () => {
    const r = rig([]);
    const result = await run(snapshot({ entry: { peopleAhead: 3 } }), r);
    expect(result).toMatchObject({ ok: true, alertNotified: false });
    expect(r.requests).toEqual([]);
  });

  it('effacement (scrub) : aucun push, la base retire les inscriptions', async () => {
    const r = rig([T1]);
    expect(await run(snapshot(), r, undefined, 'scrub')).toEqual({ ok: true });
    expect(r.calls).toEqual([]);
  });

  it('Merci : le pass devient final et l’archivage est programmé à +2 h', async () => {
    const r = rig([T1]);
    const result = await run(snapshot({ entry: { status: 'completed', completedAt: '2026-09-24T12:20:00Z' } }), r);
    expect(result).toMatchObject({ ok: true, final: true, nextRunAfter: '2026-09-24T14:20:00.000Z', alertKind: 'visit_completed' });
  });

  it('le signal d’annulation de process() est relayé au transport', async () => {
    const controller = new AbortController();
    const r = rig([T1]);
    await run(snapshot({ entry: { peopleAhead: 2 } }), r, controller.signal);
    expect(r.signals[0]).toBe(controller.signal);
    controller.abort();
    await expect(run(snapshot({ entry: { peopleAhead: 1 } }), rig([T1]), controller.signal)).rejects.toThrow();
  });
});

/* ====================================================================
   HTTP/2 réel, contre un serveur local qui joue APNs
   ==================================================================== */

describe('transport HTTP/2 avec certificat client', () => {
  let server: http2.Http2SecureServer;
  let host = '';
  const received: { path: string; topic: string; body: string; clientUid: string | null; pushType: string | null }[] = [];
  let tlsCa = '';

  beforeAll(async () => {
    const serverCert = issue({ subject: [{ shortName: 'CN', value: 'localhost' }], issuer: pki.root, dnsNames: ['localhost'] });
    tlsCa = pki.root.certPem;
    server = http2.createSecureServer({
      key: serverCert.keyPem,
      cert: serverCert.certPem,
      ca: [pki.root.certPem, pki.wwdr.certPem],
      requestCert: true,
      rejectUnauthorized: true,
    });
    server.on('stream', (stream, headers) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        const peer = (stream.session?.socket as TLSSocket | undefined)?.getPeerCertificate();
        const subject = (peer?.subject ?? {}) as unknown as Record<string, string>;
        const path = String(headers[':path']);
        received.push({
          path,
          topic: String(headers['apns-topic']),
          body: Buffer.concat(chunks).toString(),
          clientUid: subject.UID ?? null,
          pushType: (headers['apns-push-type'] as string | undefined) ?? null,
        });
        if (path.endsWith(T2)) {
          stream.respond({ ':status': 410, 'content-type': 'application/json' });
          stream.end(JSON.stringify({ reason: 'Unregistered' }));
        } else if (path.endsWith(T3)) {
          // Ne répond jamais : le signal d'annulation doit couper le flux.
        } else {
          stream.respond({ ':status': 200, 'apns-id': 'test' });
          stream.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    host = `https://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    closeWalletApnsSessions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('présente le certificat Pass Type ID, envoie {} au bon topic, lit la raison', async () => {
    const transport = http2Transport(config.tls, { host, ca: tlsCa });
    const results = await pushPassUpdate([T1, T2], { topic: TEST_PASS_TYPE, transport, signal: new AbortController().signal, now: NOW });
    expect(results.map((r) => [r.token, r.status, r.outcome]).sort()).toEqual([[T1, 200, 'ok'], [T2, 410, 'dead']]);
    expect(results.find((r) => r.token === T2)?.reason).toBe('Unregistered');
    expect(received).toHaveLength(2);
    for (const r of received) {
      expect(r.topic).toBe(TEST_PASS_TYPE);
      expect(r.body).toBe('{}');
      expect(r.clientUid).toBe(TEST_PASS_TYPE);
      expect(r.pushType).toBeNull();
    }
  });

  it('annulation en cours de flux : issue « aborted », sans attendre APNs', async () => {
    const transport = http2Transport(config.tls, { host, ca: tlsCa });
    const controller = new AbortController();
    const pending = pushPassUpdate([T3], { topic: TEST_PASS_TYPE, transport, signal: controller.signal, now: NOW });
    setTimeout(() => controller.abort(), 100);
    const [result] = await pending;
    expect(result?.outcome).toBe('aborted');
  });
});
