import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';
import type { GoogleMessage, GoogleResource } from '../../src/server/wallet/google/client';
import { parseGoogleWalletConfig, type GoogleWalletConfig } from '../../src/server/wallet/google/config';
import { GoogleWalletError } from '../../src/server/wallet/google/errors';
import { queueClassBody, renderGoogleObject, renderHash } from '../../src/server/wallet/google/objects';
import {
  FINAL_RETRY_WINDOW_MS, MAINTENANCE_BUDGET_MS, MAX_ATTEMPTS, REVIEW_RECHECK_MS, STALE_POSITION_MS, backoffSeconds,
  ensureEventClass, ensureQueueClass, eventClassAtClick, failureResult, insertObjectAndGoLive, processGoogleJob,
  refreshReviewedClasses, resetGoogleSyncState, runGoogleMaintenance, syncDirtyClasses,
  type GoogleApi, type GoogleClassRow, type GoogleDueClass, type GoogleStore, type GoogleSyncDeps,
} from '../../src/server/wallet/google/sync';
import { DISTRIBUTE_TIMEOUT_MS, distributeGoogle } from '../../src/server/wallet/google/provider';
import { buildWalletView } from '../../src/server/wallet/view';
import type { ClaimedJob, DistributeContext, IssuedWalletPass, WalletNaming, WalletSnapshot } from '../../src/server/wallet/types';
import { SITE, eventSnapshot, snapshot, type Overrides } from './fixtures';

/**
 * Synchronisation Google, sans réseau ni base : API et registre simulés.
 * On vérifie ce qui part chez Google (PATCH seulement si le rendu change,
 * messages et sonneries selon les règles communes), ce qui revient au
 * vidage (JobResult) et le classement des pannes.
 */

const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const parsed = parseGoogleWalletConfig({
  issuerId: '3388000000012345678',
  serviceAccountJson: JSON.stringify({
    type: 'service_account',
    client_email: 'wallet@rangvia-test.iam.gserviceaccount.com',
    private_key: await exportPKCS8(privateKey),
    private_key_id: 'kid-0123456789',
  }),
  mode: 'demo',
  classPrefix: 'rangvia',
  rotatingBarcode: false,
  siteUrl: SITE,
  sessionSecretPresent: true,
});
if (!parsed.ok) throw new Error(parsed.reason);
const CONFIG: GoogleWalletConfig = parsed.config;

const NOW = new Date('2026-09-24T12:30:00Z');
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_CLASS = '3388000000012345678.rangvia_evt_44444444444444448444444444444444';

type Call = { method: string; args: unknown[] };

function fakeApi(overrides: Partial<Record<keyof GoogleApi, (...args: unknown[]) => Promise<unknown>>> = {}) {
  const calls: Call[] = [];
  const defaults: Record<keyof GoogleApi, (...args: unknown[]) => Promise<unknown>> = {
    insertObject: async () => ({ status: 'created' }),
    getObject: async () => ({ messages: [] }),
    patchObject: async () => ({}),
    addMessage: async () => ({ status: 'added', resource: { messages: [] } }),
    insertClass: async () => ({ status: 'created', resource: { reviewStatus: 'APPROVED' } }),
    getClass: async () => null,
    patchClass: async () => ({ reviewStatus: 'APPROVED' }),
  };
  const api = {} as Record<keyof GoogleApi, (...args: unknown[]) => Promise<unknown>>;
  for (const key of Object.keys(defaults) as (keyof GoogleApi)[]) {
    api[key] = async (...args: unknown[]) => {
      calls.push({ method: key, args });
      return (overrides[key] ?? defaults[key])(...args);
    };
  }
  return { api: api as unknown as GoogleApi, calls, only: (method: string) => calls.filter((c) => c.method === method) };
}

function classRow(overrides: Partial<GoogleClassRow> = {}): GoogleClassRow {
  return {
    classId: CONFIG.naming.queueClassId, kind: 'queue', eventId: null, reviewStatus: null, syncedHash: null,
    dirty: true, dirtyAt: '2026-09-24T12:00:00.000Z', syncedAt: null, lastError: null, ...overrides,
  };
}

function fakeStore(rows: GoogleClassRow[] = [], due: GoogleDueClass[] = [], options: { markLive?: (passId: string, hash: string) => boolean } = {}) {
  const table = new Map(rows.map((r) => [r.classId, { ...r }]));
  const log = { synced: [] as { classId: string; result: Parameters<GoogleStore['classSynced']>[1] }[], live: [] as { passId: string; hash: string }[], upserts: [] as string[] };
  const store: GoogleStore = {
    classById: async (id) => table.get(id) ?? null,
    classByEvent: async (eventId) => [...table.values()].find((r) => r.eventId === eventId) ?? null,
    classesDue: async () => due,
    classesUnderReview: async (before, limit) => [...table.values()]
      .filter((r) => r.kind === 'event' && r.reviewStatus === 'UNDER_REVIEW' && !r.dirty && !r.lastError && r.syncedAt && Date.parse(r.syncedAt) < before.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r })),
    upsertClass: async (classId, kind, eventId) => {
      log.upserts.push(classId);
      const row = table.get(classId) ?? classRow({ classId, kind, eventId });
      table.set(classId, row);
      return row;
    },
    classSynced: async (classId, result) => {
      log.synced.push({ classId, result });
      const row = table.get(classId);
      // Mêmes règles que wallet_google_class_synced : null garde la valeur.
      if (row && !result.error) Object.assign(row, { syncedHash: result.hash ?? row.syncedHash, reviewStatus: result.reviewStatus ?? row.reviewStatus, dirty: false, syncedAt: NOW.toISOString(), lastError: null });
      else if (row) row.lastError = result.error;
    },
    eventBrand: async (eventId) => (eventId === EVENT_ID ? {
      eventId, name: 'Drop Aurore', logoUrl: null, coverUrl: 'https://cdn.example.com/aurore.jpg', accentHex: '#18143C',
      rulesText: 'Une paire par personne.', startedAt: '2026-09-24T10:00:00Z',
      location: { name: 'Sneaker Lab', addressLine1: '12 rue X', addressLine2: null, postalCode: '75011', city: 'Paris', countryCode: 'FR', timezone: 'Europe/Paris', logoUrl: null },
      organization: { name: 'Sneaker Lab', logoUrl: null, brandAccent: 'signal' },
    } : null),
    markLive: async (passId, hash) => { log.live.push({ passId, hash }); return options.markLive?.(passId, hash) ?? true; },
  };
  return { store, log, table };
}

function deps(api: GoogleApi, store: GoogleStore, extra: Partial<GoogleSyncDeps> = {}) {
  const reports: string[] = [];
  const degraded: string[] = [];
  const d: GoogleSyncDeps = {
    config: CONFIG, api, store, now: () => NOW, random: () => 0.5,
    report: (m) => { reports.push(m); }, degrade: (r) => { degraded.push(r); }, ...extra,
  };
  return { deps: d, reports, degraded };
}

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: 7, walletPassId: 'pass', provider: 'google', queueId: 'q', job: 'sync', reasons: ['position'],
    priority: 0, attempts: 1, runAfter: NOW.toISOString(), createdAt: NOW.toISOString(), ...overrides,
  };
}

function queueSnap(overrides: Overrides = {}): WalletSnapshot {
  return snapshot({
    ...overrides,
    pass: {
      provider: 'google', externalId: '3388000000012345678.rangvia_q_' + 'a'.repeat(32), classRef: CONFIG.naming.queueClassId,
      live: true, createdAt: '2026-09-24T12:05:00Z', ...(overrides.pass ?? {}),
    },
  });
}

async function run(snap: WalletSnapshot, api: GoogleApi, j: ClaimedJob = job(), store = fakeStore().store, signal = new AbortController().signal) {
  const view = buildWalletView(snap, NOW, { siteUrl: SITE });
  const h = deps(api, store);
  const result = await processGoogleJob(h.deps, j, snap, NOW, view, signal);
  return { result, ...h };
}

beforeEach(() => resetGoogleSyncState());

describe('process() : PATCH seulement si le rendu change', () => {
  it('premier envoi : PATCH du bloc complet, empreinte rendue au vidage', async () => {
    const { api, only } = fakeApi();
    const snap = queueSnap();
    const { result } = await run(snap, api);
    const expected = renderGoogleObject(snap, buildWalletView(snap, NOW, { siteUrl: SITE }), { siteUrl: SITE, rotatingBarcode: false, now: NOW });
    expect(only('patchObject')).toHaveLength(1);
    expect(only('patchObject')[0]!.args.slice(0, 2)).toEqual(['genericObject', snap.pass.externalId]);
    expect(result).toEqual({ ok: true, syncedHash: expected.hash, alertKind: null, alertNotified: false });
  });

  it('même rendu : aucun appel', async () => {
    const snap = queueSnap();
    const hash = renderGoogleObject(snap, buildWalletView(snap, NOW, { siteUrl: SITE }), { siteUrl: SITE, rotatingBarcode: false, now: NOW }).hash;
    const { api, calls } = fakeApi();
    const { result } = await run(queueSnap({ pass: { syncedHash: hash } }), api);
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, syncedHash: hash });
  });

  it('le signal d’annulation du vidage est relayé à chaque appel', async () => {
    const { api, calls } = fakeApi();
    const controller = new AbortController();
    await run(queueSnap({ entry: { peopleAhead: 1 } }), api, job(), fakeStore().store, controller.signal);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) expect(call.args.at(-1)).toBe(controller.signal);
  });

  it('pass non tenu à jour (jamais créé, effacé) : rien n’est envoyé', async () => {
    const { api, calls } = fakeApi();
    expect((await run(queueSnap({ pass: { live: false } }), api)).result).toMatchObject({ ok: true });
    expect((await run(queueSnap({ pass: { state: 'scrubbed' } }), api)).result).toMatchObject({ ok: true });
    expect(calls).toHaveLength(0);
  });
});

describe('process() : moments clés et sonneries', () => {
  it('« plus qu’une personne », aucun autre canal : TEXT_AND_NOTIFY, texte commun', async () => {
    const { api, only } = fakeApi();
    const { result } = await run(queueSnap({ entry: { peopleAhead: 1 } }), api);
    const [call] = only('addMessage');
    const message = call!.args[2] as GoogleMessage;
    expect(message).toMatchObject({ id: 'ahead_one', messageType: 'TEXT_AND_NOTIFY', header: 'Barber House Bastille', body: 'Plus qu’une personne devant vous. Commencez à revenir.' });
    expect(result).toMatchObject({ ok: true, alertKind: 'ahead_one', alertNotified: true });
  });

  it('déjà livré par Web Push : message au dos, sans sonnerie', async () => {
    const { api, only } = fakeApi();
    const { result } = await run(queueSnap({ entry: { peopleAhead: 1 }, deliveredKinds: { web_push: ['ahead_one'] } }), api);
    expect((only('addMessage')[0]!.args[2] as GoogleMessage).messageType).toBe('TEXT');
    expect(result).toMatchObject({ alertKind: 'ahead_one', alertNotified: false });
  });

  it('« c’est votre tour » sonne même si Web Push l’a livré, mais pas au-delà du budget 3 / 24 h', async () => {
    const turn = { entry: { status: 'next' as const, peopleAhead: 0 }, deliveredKinds: { web_push: ['your_turn'] } };
    let fake = fakeApi();
    expect((await run(queueSnap(turn), fake.api)).result).toMatchObject({ alertKind: 'your_turn', alertNotified: true });
    fake = fakeApi();
    const log = ['2026-09-24T01:00:00Z', '2026-09-24T05:00:00Z', '2026-09-24T09:00:00Z'];
    const { result } = await run(queueSnap({ ...turn, pass: { notifyLog: log } }), fake.api);
    expect((fake.only('addMessage')[0]!.args[2] as GoogleMessage).messageType).toBe('TEXT');
    expect(result).toMatchObject({ alertKind: 'your_turn', alertNotified: false });
    // Un horodatage de plus de 24 h ne compte plus.
    fake = fakeApi();
    await run(queueSnap({ ...turn, pass: { notifyLog: ['2026-09-23T10:00:00Z', ...log.slice(1)] } }), fake.api);
    expect((fake.only('addMessage')[0]!.args[2] as GoogleMessage).messageType).toBe('TEXT_AND_NOTIFY');
  });

  it('moment déjà signalé (registre) : pas de second message', async () => {
    const { api, only } = fakeApi();
    const { result } = await run(queueSnap({ entry: { peopleAhead: 1 }, pass: { alerts: { your_turn: '2026-09-24T12:10:00.000Z' } } }), api);
    expect(only('addMessage')).toHaveLength(0);
    expect(result).toMatchObject({ alertKind: null });
  });

  it('mode Événement (drop en cours) : aucune alerte de rang', async () => {
    const { api, only } = fakeApi();
    await run(queueSnap({ entry: { peopleAhead: 1 }, queue: { runningEventId: EVENT_ID } }), api);
    expect(only('addMessage')).toHaveLength(0);
  });

  it('quota de notifications dépassé chez Google : renvoyé en TEXT', async () => {
    let first = true;
    const { api, only } = fakeApi({
      addMessage: async () => {
        if (first) { first = false; throw new GoogleWalletError('rate_limited', 'addMessage : 429 QuotaExceededException', 429); }
        return { status: 'added', resource: null };
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = await run(queueSnap({ entry: { peopleAhead: 1 } }), api);
    expect(only('addMessage').map((c) => (c.args[2] as GoogleMessage).messageType)).toEqual(['TEXT_AND_NOTIFY', 'TEXT']);
    expect(result).toMatchObject({ ok: true, alertKind: 'ahead_one', alertNotified: false });
    // Chaque bascule est journalisée avec le motif exact (à confirmer en recette).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/quota de notifications/);
    expect(String(warn.mock.calls[0]![1])).toContain('QuotaExceededException');
    warn.mockRestore();
  });

  it('409 sur addMessage (envoi rejoué) : succès', async () => {
    const { api } = fakeApi({ addMessage: async () => ({ status: 'duplicate', resource: null }) });
    expect((await run(queueSnap({ entry: { peopleAhead: 1 } }), api)).result).toMatchObject({ ok: true, alertKind: 'ahead_one', alertNotified: true });
  });

  it('ligne de remplacement (attempts = 1) après un addMessage perdu : message déjà là → aucun second envoi', async () => {
    // fail_wallet_outbox clôt la ligne dont la réponse s'est perdue dès
    // qu'une autre attend pour ce pass : la suivante repart à attempts = 1.
    const { api, only } = fakeApi({ getObject: async () => ({ messages: [{ id: 'your_turn', messageType: 'TEXT_AND_NOTIFY' }] }) });
    const { result } = await run(queueSnap({ entry: { status: 'next', peopleAhead: 0 } }), api, job({ id: 365, attempts: 1 }));
    expect(only('getObject')).toHaveLength(1);
    expect(only('addMessage')).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, alertKind: 'your_turn', alertNotified: true });
  });

  it('objet relu avant CHAQUE message, même au premier essai', async () => {
    const { api, calls } = fakeApi();
    await run(queueSnap({ entry: { status: 'next', peopleAhead: 0 } }), api, job({ attempts: 1 }));
    expect(calls.map((c) => c.method)).toEqual(['patchObject', 'getObject', 'addMessage']);
  });

  it('nouvel essai : message déjà présent sur l’objet → ne sonne pas deux fois', async () => {
    const { api, only } = fakeApi({ getObject: async () => ({ messages: [{ id: 'ahead_one', messageType: 'TEXT_AND_NOTIFY' }] }) });
    const { result } = await run(queueSnap({ entry: { peopleAhead: 1 } }), api, job({ attempts: 2 }));
    expect(only('addMessage')).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, alertKind: 'ahead_one', alertNotified: true });
  });

  it('6 messages au dos : élagage AVANT l’ajout (5 plus récents, en TEXT), 6 au plus ensuite', async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, messageType: 'TEXT_AND_NOTIFY', displayInterval: { start: { date: `2026-09-24T0${i}:00:00Z` } } }));
    const { api, calls } = fakeApi({ getObject: async () => ({ messages: six }) });
    await run(queueSnap({ entry: { peopleAhead: 1 } }), api);
    expect(calls.map((c) => c.method)).toEqual(['patchObject', 'getObject', 'patchObject', 'addMessage']);
    const prune = calls[2]!.args[2] as { messages: { id: string; messageType: string }[] };
    expect(prune.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(prune.messages.every((m) => m.messageType === 'TEXT')).toBe(true);
  });

  it('5 messages au dos : rien à élaguer', async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, messageType: 'TEXT' }));
    const { api, calls } = fakeApi({ getObject: async () => ({ messages: five }) });
    await run(queueSnap({ entry: { peopleAhead: 1 } }), api);
    expect(calls.map((c) => c.method)).toEqual(['patchObject', 'getObject', 'addMessage']);
  });

  it('« Merci » : état final et archivage programmé à +2 h', async () => {
    const { api } = fakeApi();
    const { result } = await run(queueSnap({ entry: { status: 'completed', completedAt: '2026-09-24T12:20:00Z' } }), api);
    expect(result).toMatchObject({ ok: true, final: true, nextRunAfter: '2026-09-24T14:20:00.000Z', alertKind: 'visit_completed' });
  });

  it('ticket remis en file après un TERMINER annulé : réouverture', async () => {
    const { api } = fakeApi();
    const { result } = await run(queueSnap({ pass: { state: 'final', finalAt: '2026-09-24T12:25:00Z' } }), api);
    expect(result).toMatchObject({ ok: true, reopen: true });
  });
});

describe('process() : effacement', () => {
  it('PATCH d’effacement, état final gardé', async () => {
    const { api, only } = fakeApi();
    const snap = queueSnap({ entry: { status: 'expired' }, pass: { state: 'final' } });
    const { result } = await run(snap, api, job({ job: 'scrub' }));
    const body = only('patchObject')[0]!.args[2] as GoogleResource;
    expect(body).toMatchObject({ state: 'EXPIRED', textModulesData: [{ id: 'donnees' }], messages: [{ id: 'efface', messageType: 'TEXT' }], heroImage: null });
    expect(body.linksModuleData).toEqual({ uris: [{ id: 'rangvia', uri: 'https://rangvia.test/', description: 'Rangvia' }] });
    expect(result).toEqual({ ok: true, syncedHash: renderHash(body) });
  });

  it('objet inconnu de Google : rien à effacer, succès', async () => {
    const { api } = fakeApi({ patchObject: async () => { throw new GoogleWalletError('not_found', '404', 404); } });
    expect((await run(queueSnap(), api, job({ job: 'scrub' }))).result).toMatchObject({ ok: true });
  });
});

describe('process() : classement des pannes', () => {
  const failing = (error: GoogleWalletError) => fakeApi({ patchObject: async () => { throw error; } }).api;

  it('403 : abandon, arrêt du tour, boutons masqués, alerte', async () => {
    const { result, degraded, reports } = await run(queueSnap(), failing(new GoogleWalletError('forbidden', '403', 403)));
    expect(result).toMatchObject({ ok: false, dead: true, haltProvider: true });
    expect(degraded[0]).toMatch(/non autorisé sur l’émetteur/);
    expect(reports).toHaveLength(1);
  });

  it('404 sur PATCH et 400 : abandon et alerte, sans arrêter le tour', async () => {
    for (const error of [new GoogleWalletError('not_found', '404', 404), new GoogleWalletError('invalid', '400', 400)]) {
      const { result, reports } = await run(queueSnap(), failing(error));
      expect(result).toMatchObject({ ok: false, dead: true });
      expect('haltProvider' in result && result.haltProvider).toBeFalsy();
      expect(reports).toHaveLength(1);
    }
  });

  it('429 Retry-After: 7 → nouvel essai dans 7 s', async () => {
    const { result } = await run(queueSnap(), failing(new GoogleWalletError('rate_limited', '429', 429, 7)));
    expect(result).toEqual({ ok: false, error: '429', retryAfterSeconds: 7, dead: false });
  });

  it('5xx sans Retry-After : 2^n × 5 s avec gigue', async () => {
    const { result } = await run(queueSnap(), failing(new GoogleWalletError('server', '503', 503)), job({ attempts: 3 }));
    expect(result).toMatchObject({ ok: false, dead: false, retryAfterSeconds: 40 });
    expect(backoffSeconds(3, () => 0)).toBe(32);
    expect(backoffSeconds(3, () => 0.999)).toBe(48);
    expect(backoffSeconds(40, () => 0.5)).toBe(1800);
  });

  it('mise à jour de position de plus de 30 min, ou 6ᵉ essai : abandonnée', () => {
    const d = deps(fakeApi().api, fakeStore().store).deps;
    const retry = new GoogleWalletError('server', '503', 503);
    const old = new Date(NOW.getTime() - STALE_POSITION_MS - 1000).toISOString();
    expect(failureResult(retry, job({ createdAt: old }), { final: false }, d)).toMatchObject({ dead: true });
    expect(failureResult(retry, job({ attempts: MAX_ATTEMPTS }), { final: false }, d)).toMatchObject({ dead: true });
    expect(failureResult(retry, job({ attempts: MAX_ATTEMPTS - 1 }), { final: false }, d)).toMatchObject({ dead: false });
  });

  it('transition finale : retentée pendant 24 h, quel que soit le nombre d’essais', () => {
    const d = deps(fakeApi().api, fakeStore().store).deps;
    const retry = new GoogleWalletError('timeout', 'délai', null);
    const fiveHours = new Date(NOW.getTime() - 5 * 3600_000).toISOString();
    expect(failureResult(retry, job({ createdAt: fiveHours, attempts: 20 }), { final: true }, d)).toMatchObject({ dead: false });
    const dayAgo = new Date(NOW.getTime() - FINAL_RETRY_WINDOW_MS - 1000).toISOString();
    expect(failureResult(retry, job({ createdAt: dayAgo }), { final: true }, d)).toMatchObject({ dead: true });
  });

  it('erreur inattendue : nouvel essai borné, jamais d’exception', async () => {
    const { api } = fakeApi({ patchObject: async () => { throw new Error('bogue'); } });
    expect((await run(queueSnap(), api)).result).toMatchObject({ ok: false, error: 'bogue', dead: false });
  });
});

describe('Billets de drop : classe de l’événement', () => {
  const dropSnap = (overrides: Overrides = {}) => eventSnapshot({
    ...overrides,
    pass: { provider: 'google', externalId: '3388000000012345678.rangvia_e_' + 'b'.repeat(32), classRef: EVENT_CLASS, live: true, ...(overrides.pass ?? {}) },
  });

  it('classe absente : créée (reviewStatus UNDER_REVIEW) avant le PATCH du billet', async () => {
    const { api, calls } = fakeApi();
    const { store, log } = fakeStore();
    const { result } = await run(dropSnap(), api, job(), store);
    expect(calls.map((c) => c.method)).toEqual(['insertClass', 'patchObject']);
    expect(calls[0]!.args[0]).toBe('eventTicketClass');
    expect(calls[0]!.args[1]).toMatchObject({ id: EVENT_CLASS, reviewStatus: 'UNDER_REVIEW', eventId: '44444444444444448444444444444444' });
    expect(calls[1]!.args[0]).toBe('eventTicketObject');
    expect(log.upserts).toEqual([EVENT_CLASS]);
    expect(log.synced[0]).toMatchObject({ classId: EVENT_CLASS, result: { reviewStatus: 'APPROVED', error: null, dirtyAt: '2026-09-24T12:00:00.000Z' } });
    expect(result).toMatchObject({ ok: true });
  });

  it('classe à jour : aucun appel de classe, et mise en cache', async () => {
    const { api, only } = fakeApi();
    const { store } = fakeStore([classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: false, syncedAt: NOW.toISOString(), reviewStatus: 'APPROVED' })]);
    await run(dropSnap(), api, job(), store);
    expect(only('insertClass')).toHaveLength(0);
    expect(only('patchClass')).toHaveLength(0);
  });

  it('classe refusée par Google : billet abandonné, alerte', async () => {
    const { api, only } = fakeApi();
    const { store } = fakeStore([classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: false, syncedAt: NOW.toISOString(), reviewStatus: 'REJECTED' })]);
    const { result, reports } = await run(dropSnap(), api, job(), store);
    expect(result).toMatchObject({ ok: false, dead: true });
    expect(only('patchObject')).toHaveLength(0);
    expect(reports).toHaveLength(1);
  });

  it('classe salie (marque modifiée) : PATCH de la classe, puis du billet', async () => {
    const { api, calls } = fakeApi();
    const { store } = fakeStore([classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: true, syncedAt: '2026-09-24T11:00:00Z', syncedHash: 'ancien', reviewStatus: 'APPROVED' })]);
    await run(dropSnap(), api, job(), store);
    expect(calls.map((c) => c.method)).toEqual(['patchClass', 'patchObject']);
    expect(calls[0]!.args[2]).toMatchObject({ reviewStatus: 'UNDER_REVIEW' });
  });

  it('vague de 8 billets, classe salie : UN seul PATCH de classe, partagé', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { api, only } = fakeApi({ patchClass: async () => { await gate; return { reviewStatus: 'APPROVED' }; } });
    const { store } = fakeStore([classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: true, syncedAt: '2026-09-24T11:00:00Z', syncedHash: 'ancien', reviewStatus: 'APPROVED' })]);
    const h = deps(api, store);
    const runs = Array.from({ length: 8 }, (_, i) => {
      const snap = dropSnap({ pass: { id: `pass-${i}`, externalId: `3388000000012345678.rangvia_e_${String(i).repeat(32)}` } });
      return processGoogleJob(h.deps, job({ id: i }), snap, NOW, buildWalletView(snap, NOW, { siteUrl: SITE }), new AbortController().signal);
    });
    release();
    const results = await Promise.all(runs);
    expect(only('patchClass')).toHaveLength(1);
    expect(only('patchObject')).toHaveLength(8);
    expect(results.every((r) => r.ok)).toBe(true);
    // Puis en cache : le billet suivant ne relit même plus la classe.
    const next = dropSnap();
    await processGoogleJob(h.deps, job(), next, NOW, buildWalletView(next, NOW, { siteUrl: SITE }), new AbortController().signal);
    expect(only('patchClass')).toHaveLength(1);
  });

  it('classe refusée : UNE alerte pour toute la vague, pas une par billet', async () => {
    const { api } = fakeApi();
    const { store } = fakeStore([classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: false, syncedAt: NOW.toISOString(), reviewStatus: 'REJECTED' })]);
    const h = deps(api, store);
    for (let i = 0; i < 5; i += 1) {
      const snap = dropSnap();
      const result = await processGoogleJob(h.deps, job({ id: i }), snap, NOW, buildWalletView(snap, NOW, { siteUrl: SITE }), new AbortController().signal);
      expect(result).toMatchObject({ ok: false, dead: true });
    }
    expect(h.reports).toHaveLength(1);
  });

  it('classe d’un autre émetteur : indisponible (configuration changée)', async () => {
    const { store } = fakeStore([classRow({ classId: '999.autre_evt_x', kind: 'event', eventId: EVENT_ID })]);
    expect(await ensureEventClass(deps(fakeApi().api, store).deps, EVENT_ID)).toBe('unavailable');
  });
});

describe('Classe de file et entretien', () => {
  it('première fois : ligne créée, insertion chez Google, empreinte inscrite', async () => {
    const { api, calls } = fakeApi();
    const { store, log } = fakeStore();
    const outcome = await ensureQueueClass(deps(api, store).deps);
    expect(outcome).toEqual({ classId: '3388000000012345678.rangvia_file_v1', created: true });
    expect(calls.map((c) => c.method)).toEqual(['insertClass']);
    expect(calls[0]!.args[0]).toBe('genericClass');
    expect(log.synced[0]!.result).toEqual({ hash: renderHash(queueClassBody(CONFIG.naming)), reviewStatus: null, error: null, dirtyAt: '2026-09-24T12:00:00.000Z' });
  });

  it('déjà créée ailleurs (409) : PATCH', async () => {
    const { api, calls } = fakeApi({ insertClass: async () => ({ status: 'exists', resource: null }) });
    await ensureQueueClass(deps(api, fakeStore().store).deps);
    expect(calls.map((c) => c.method)).toEqual(['insertClass', 'patchClass']);
  });

  it('à jour : aucun appel ; dessin modifié : PATCH', async () => {
    const hash = renderHash(queueClassBody(CONFIG.naming));
    let fake = fakeApi();
    await ensureQueueClass(deps(fake.api, fakeStore([classRow({ dirty: false, syncedAt: NOW.toISOString(), syncedHash: hash })]).store).deps);
    expect(fake.calls).toHaveLength(0);
    fake = fakeApi();
    const outcome = await ensureQueueClass(deps(fake.api, fakeStore([classRow({ dirty: false, syncedAt: NOW.toISOString(), syncedHash: 'ancien' })]).store).deps);
    expect(fake.calls.map((c) => c.method)).toEqual(['patchClass']);
    expect(outcome.created).toBe(false);
  });

  it('échec : erreur inscrite en base, puis relevée', async () => {
    const { api } = fakeApi({ insertClass: async () => { throw new GoogleWalletError('forbidden', '403', 403); } });
    const { store, log } = fakeStore();
    await expect(ensureQueueClass(deps(api, store).deps)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(log.synced[0]!.result.error).toBe('403');
  });

  it('classes dues : événement sans classe créé, classe d’un autre émetteur écartée', async () => {
    const due: GoogleDueClass[] = [
      { classId: null, kind: 'event', eventId: EVENT_ID, reviewStatus: null, syncedHash: null, dirty: true, dirtyAt: null, syncedAt: null, lastError: null },
      { classId: '999.autre_file_v1', kind: 'queue', eventId: null, reviewStatus: null, syncedHash: null, dirty: true, dirtyAt: null, syncedAt: null, lastError: null },
    ];
    const { api, only } = fakeApi();
    const { store, log } = fakeStore([], due);
    const summary = await syncDirtyClasses(deps(api, store).deps);
    expect(summary).toEqual({ synced: 1, failed: 0, skipped: 1, halted: false });
    expect(only('insertClass')[0]!.args[1]).toMatchObject({ id: EVENT_CLASS });
    expect(log.synced.find((s) => s.classId === '999.autre_file_v1')!.result.error).toMatch(/autre émetteur/);
  });

  it('compte de service refusé pendant l’entretien : arrêt, boutons masqués', async () => {
    const due: GoogleDueClass[] = [0, 1].map(() => ({ classId: null, kind: 'event' as const, eventId: EVENT_ID, reviewStatus: null, syncedHash: null, dirty: true, dirtyAt: null, syncedAt: null, lastError: null }));
    const { api, only } = fakeApi({ insertClass: async () => { throw new GoogleWalletError('forbidden', '403', 403); } });
    const h = deps(api, fakeStore([], due).store);
    const summary = await syncDirtyClasses(h.deps);
    expect(summary).toMatchObject({ halted: true, failed: 1 });
    expect(only('insertClass')).toHaveLength(1);
    expect(h.degraded).toHaveLength(1);
  });
});

describe('Entretien : budget, alertes, classes en revue', () => {
  const due = (n: number): GoogleDueClass[] => Array.from({ length: n }, () => ({
    classId: null, kind: 'event' as const, eventId: EVENT_ID, reviewStatus: null, syncedHash: null, dirty: true, dirtyAt: null, syncedAt: null, lastError: null,
  }));

  it('Google lent : UN signal relayé à chaque appel, arrêt au budget (6 s + un appel au plus)', async () => {
    let clock = NOW.getTime();
    const start = clock;
    const controller = new AbortController();
    const signals: unknown[] = [];
    // Chaque appel dure 4 s ; au-delà de 6 s, le signal tombe (comme
    // AbortSignal.timeout) et le client répond « annulé ».
    const slow = <T>(value: T) => async (...args: unknown[]) => {
      signals.push(args.at(-1));
      clock += 4000;
      if (clock - start > MAINTENANCE_BUDGET_MS) {
        controller.abort();
        throw new GoogleWalletError('aborted', 'Requête Google annulée');
      }
      return value;
    };
    const { api, calls } = fakeApi({
      insertClass: slow({ status: 'created', resource: { reviewStatus: 'UNDER_REVIEW' } }),
      patchClass: slow({ reviewStatus: 'UNDER_REVIEW' }),
      getClass: slow({ reviewStatus: 'APPROVED' }),
    });
    const { store, log } = fakeStore([], due(3));
    const h = deps(api, store, { now: () => new Date(clock) });
    const outcome = await runGoogleMaintenance(h.deps, { budgetMs: MAINTENANCE_BUDGET_MS, signal: controller.signal });
    expect(clock - start).toBeLessThanOrEqual(MAINTENANCE_BUDGET_MS + 8000);
    expect(calls).toHaveLength(2);
    expect(signals).toHaveLength(2);
    for (const signal of signals) expect(signal).toBe(controller.signal);
    expect(outcome).toMatchObject({ queueClass: 'créée', classes: { synced: 0, failed: 1, halted: false } });
    // Annulée par NOTRE budget : aucune erreur inscrite (la classe serait écartée 10 min).
    expect(log.synced.filter((x) => x.result.error)).toHaveLength(0);
  });

  it('sans signal fourni : borné quand même (AbortSignal.timeout), jamais undefined', async () => {
    const { api, calls } = fakeApi();
    await syncDirtyClasses(deps(api, fakeStore([], due(1)).store).deps, { budgetMs: 6000 });
    await ensureQueueClass(deps(api, fakeStore().store).deps);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.args.at(-1)).toBeInstanceOf(AbortSignal);
  });

  it('403 persistant pendant l’entretien : boutons masqués à chaque minute, UNE alerte par heure', async () => {
    const { api } = fakeApi({ insertClass: async () => { throw new GoogleWalletError('forbidden', '403', 403); } });
    const h = deps(api, fakeStore().store);
    await runGoogleMaintenance(h.deps);
    await runGoogleMaintenance(h.deps);
    expect(h.degraded).toHaveLength(2);
    expect(h.reports).toHaveLength(1);
  });

  it('refus décidé plus tard par Google : relu, inscrit (marque en attente préservée), alerte, billets bloqués', async () => {
    const old = new Date(NOW.getTime() - REVIEW_RECHECK_MS - 60_000).toISOString();
    const { api, only } = fakeApi({ getClass: async () => ({ reviewStatus: 'rejected' }) });
    const { store, log, table } = fakeStore([classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: false, syncedAt: old, syncedHash: 'h-classe', reviewStatus: 'UNDER_REVIEW' })]);
    const h = deps(api, store);
    expect(await ensureEventClass(h.deps, EVENT_ID)).toBe('ok');
    expect(await refreshReviewedClasses(h.deps)).toEqual({ checked: 1, changed: 1, failed: 0 });
    expect(only('getClass')[0]!.args.slice(0, 2)).toEqual(['eventTicketClass', EVENT_CLASS]);
    expect(log.synced.at(-1)).toEqual({ classId: EVENT_CLASS, result: { hash: null, reviewStatus: 'REJECTED', error: null, dirtyAt: '2026-09-24T12:00:00.000Z' } });
    expect(table.get(EVENT_CLASS)!.syncedHash).toBe('h-classe');
    expect(h.reports).toHaveLength(1);
    // Le cache « prête » est oublié : le billet suivant voit le refus.
    expect(await ensureEventClass(h.deps, EVENT_ID)).toBe('rejected');
  });

  it('approuvée : inscrite sans alerte ; relue il y a moins de 10 min ou salie : pas de relecture', async () => {
    const old = new Date(NOW.getTime() - REVIEW_RECHECK_MS - 60_000).toISOString();
    const recent = new Date(NOW.getTime() - 60_000).toISOString();
    const { api, only } = fakeApi({ getClass: async () => ({ reviewStatus: 'APPROVED' }) });
    const { store, table } = fakeStore([
      classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: false, syncedAt: old, reviewStatus: 'UNDER_REVIEW' }),
      classRow({ classId: `${EVENT_CLASS}2`, kind: 'event', eventId: 'e2', dirty: false, syncedAt: recent, reviewStatus: 'UNDER_REVIEW' }),
      classRow({ classId: `${EVENT_CLASS}3`, kind: 'event', eventId: 'e3', dirty: true, syncedAt: old, reviewStatus: 'UNDER_REVIEW' }),
    ]);
    const h = deps(api, store);
    expect(await refreshReviewedClasses(h.deps)).toEqual({ checked: 1, changed: 1, failed: 0 });
    expect(only('getClass')).toHaveLength(1);
    expect(table.get(EVENT_CLASS)!.reviewStatus).toBe('APPROVED');
    expect(h.reports).toHaveLength(0);
  });

  it('classe supprimée côté console : erreur inscrite, recréée par un entretien suivant', async () => {
    const old = new Date(NOW.getTime() - REVIEW_RECHECK_MS - 60_000).toISOString();
    const { api } = fakeApi({ getClass: async () => null });
    const { store, log } = fakeStore([classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: false, syncedAt: old, reviewStatus: 'UNDER_REVIEW' })]);
    await refreshReviewedClasses(deps(api, store).deps);
    expect(log.synced.at(-1)!.result.error).toMatch(/introuvable/);
  });

  it('entretien complet : classe de file, classes dues, puis relecture des classes en revue', async () => {
    const old = new Date(NOW.getTime() - REVIEW_RECHECK_MS - 60_000).toISOString();
    const { api, calls } = fakeApi();
    const { store } = fakeStore([classRow({ classId: `${EVENT_CLASS}9`, kind: 'event', eventId: 'e9', dirty: false, syncedAt: old, reviewStatus: 'UNDER_REVIEW' })], due(1));
    const outcome = await runGoogleMaintenance(deps(api, store).deps);
    expect(calls.map((c) => [c.method, c.args[0]])).toEqual([
      ['insertClass', 'genericClass'], ['insertClass', 'eventTicketClass'], ['getClass', 'eventTicketClass'],
    ]);
    expect(outcome).toMatchObject({ queueClass: 'créée', classes: { synced: 1 }, review: { checked: 1 } });
  });
});

describe('Insertion au clic', () => {
  it('objet créé puis déclaré tenu à jour avec son empreinte', async () => {
    const { api, calls } = fakeApi();
    const { store, log } = fakeStore();
    const snap = queueSnap({ pass: { live: false } });
    const view = buildWalletView(snap, NOW, { siteUrl: SITE });
    const out = await insertObjectAndGoLive(deps(api, store).deps, snap, view);
    expect(calls.map((c) => c.method)).toEqual(['insertObject']);
    const body = calls[0]!.args[1] as GoogleResource;
    expect(body).toMatchObject({ id: snap.pass.externalId, classId: CONFIG.naming.queueClassId, state: 'ACTIVE' });
    expect(Object.values(body).includes(null)).toBe(false);
    expect(log.live).toEqual([{ passId: snap.pass.id, hash: out.hash }]);
  });

  it('double clic (409) : PATCH du contenu courant, puis tenu à jour', async () => {
    const { api, calls } = fakeApi({ insertObject: async () => ({ status: 'exists' }) });
    const { store, log } = fakeStore();
    const snap = queueSnap({ pass: { live: false } });
    await insertObjectAndGoLive(deps(api, store).deps, snap, buildWalletView(snap, NOW, { siteUrl: SITE }));
    expect(calls.map((c) => c.method)).toEqual(['insertObject', 'patchObject']);
    expect(log.live).toHaveLength(1);
  });

  it('changement PENDANT l’insertion (client appelé) : relu après « tenu à jour », PATCH et nouvelle empreinte', async () => {
    const { api, calls } = fakeApi();
    const { store, log } = fakeStore();
    const snap = queueSnap({ entry: { peopleAhead: 1 }, pass: { live: false } });
    const fresh = queueSnap({ entry: { status: 'next', peopleAhead: 0 } });
    const out = await insertObjectAndGoLive(deps(api, store).deps, snap, buildWalletView(snap, NOW, { siteUrl: SITE }), undefined, async () => fresh);
    const stale = renderGoogleObject(snap, buildWalletView(snap, NOW, { siteUrl: SITE }), { siteUrl: SITE, rotatingBarcode: false, now: NOW });
    const current = renderGoogleObject(fresh, buildWalletView(fresh, NOW, { siteUrl: SITE }), { siteUrl: SITE, rotatingBarcode: false, now: NOW });
    expect(stale.hash).not.toBe(current.hash);
    expect(calls.map((c) => c.method)).toEqual(['insertObject', 'patchObject']);
    expect(calls[1]!.args[2]).toEqual(current.patch);
    expect(log.live.map((l) => l.hash)).toEqual([stale.hash, current.hash]);
    expect(out.hash).toBe(current.hash);
  });

  it('rien n’a changé pendant l’insertion : aucune requête de plus', async () => {
    const { api, calls } = fakeApi();
    const { store, log } = fakeStore();
    const snap = queueSnap({ pass: { live: false } });
    await insertObjectAndGoLive(deps(api, store).deps, snap, buildWalletView(snap, NOW, { siteUrl: SITE }), undefined, async () => queueSnap());
    expect(calls.map((c) => c.method)).toEqual(['insertObject']);
    expect(log.live).toHaveLength(1);
  });

  it('pass révoqué entre l’émission et l’insertion : objet vidé au mieux, échec (aucun lien)', async () => {
    const { api, calls } = fakeApi();
    const { store } = fakeStore([], [], { markLive: () => false });
    const snap = queueSnap({ pass: { live: false } });
    await expect(insertObjectAndGoLive(deps(api, store).deps, snap, buildWalletView(snap, NOW, { siteUrl: SITE }))).rejects.toThrow(/révoqué/);
    expect(calls.map((c) => c.method)).toEqual(['insertObject', 'patchObject']);
    expect(calls[1]!.args[2]).toMatchObject({ state: 'INACTIVE', messages: [{ id: 'efface' }] });
  });

  it('même empreinte à la distribution (config.siteUrl) et au vidage (env.siteUrl avec barre finale) : aucun PATCH', async () => {
    const { store, log } = fakeStore();
    const snap = queueSnap({ entry: { peopleAhead: 3 }, pass: { live: false } });
    await insertObjectAndGoLive(deps(fakeApi().api, store).deps, snap, buildWalletView(snap, NOW, { siteUrl: CONFIG.siteUrl }));
    const synced = queueSnap({ entry: { peopleAhead: 3 }, pass: { syncedHash: log.live[0]!.hash } });
    const later = new Date(NOW.getTime() + 60_000);
    const { api, calls } = fakeApi();
    const result = await processGoogleJob(deps(api, store).deps, job(), synced, later, buildWalletView(synced, later, { siteUrl: `${SITE}/` }), new AbortController().signal);
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, syncedHash: log.live[0]!.hash });
  });

  it('échec de Google : jamais déclaré tenu à jour', async () => {
    const { api } = fakeApi({ insertObject: async () => { throw new GoogleWalletError('server', '503', 503); } });
    const { store, log } = fakeStore();
    const snap = queueSnap({ pass: { live: false } });
    await expect(insertObjectAndGoLive(deps(api, store).deps, snap, buildWalletView(snap, NOW, { siteUrl: SITE }))).rejects.toBeInstanceOf(GoogleWalletError);
    expect(log.live).toHaveLength(0);
  });
});

describe('Distribution (clic sur « Ajouter à Google Wallet »)', () => {
  const production = { ...CONFIG, mode: 'production' as const };

  function ctx(snap: WalletSnapshot, issued: Partial<IssuedWalletPass> = {}) {
    const issue = vi.fn(async (naming: WalletNaming): Promise<IssuedWalletPass> => {
      void naming;
      return {
        id: snap.pass.id, provider: 'google', externalId: snap.pass.externalId, classRef: snap.pass.classRef,
        kind: snap.pass.kind, state: 'active', created: true, live: false, ...issued,
      };
    });
    const context: DistributeContext = {
      request: new Request('https://rangvia.test/api/client/wallet/google?entry=Tk42abcdEFGH'),
      provider: 'google', entryPublicId: snap.entry.publicId, organizationId: snap.organization.id,
      clientSessionId: '55555555-5555-4555-8555-555555555555', eventPassPublicId: null, from: 'entry',
      returnTo: '/e/barber-house-bastille', now: NOW, issue, snapshot: async () => snap,
    };
    return { context, issue };
  }

  function runtime(api: GoogleApi, store: GoogleStore, config: GoogleWalletConfig = production) {
    const h = deps(api, store, { config });
    return { rt: { config, auth: { signingKey: async () => privateKey }, deps: h.deps }, ...h };
  }

  const back = '/e/barber-house-bastille?wallet=indisponible&wp=google';

  it('ticket neuf : objet créé, tenu à jour, 302 vers pay.google.com avec un JWT léger', async () => {
    const snap = queueSnap({ pass: { live: false } });
    const { api, only } = fakeApi();
    const { store, log } = fakeStore();
    const { context, issue } = ctx(snap);
    const response = await distributeGoogle(context, runtime(api, store).rt, { isTester: async () => false });
    expect(response.status).toBe(302);
    const location = response.headers.get('location')!;
    expect(location.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);
    expect(location.length).toBeLessThan(1800);
    expect(decodeJwt(location.slice('https://pay.google.com/gp/v/save/'.length))).toMatchObject({
      typ: 'savetowallet', aud: 'google', origins: ['https://rangvia.test'], payload: { genericObjects: [{ id: snap.pass.externalId }] },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(issue.mock.calls[0]![0]).toEqual({
      provider: 'google', objectPrefix: '3388000000012345678.rangvia_', queueClass: '3388000000012345678.rangvia_file_v1',
      eventClassPrefix: '3388000000012345678.rangvia_evt_',
    });
    expect(only('insertObject')).toHaveLength(1);
    expect(log.live).toHaveLength(1);
  });

  it('le ticket change pendant l’insertion : l’instantané est relu, Google reçoit l’état courant', async () => {
    const first = queueSnap({ entry: { peopleAhead: 1 }, pass: { live: false } });
    const fresh = queueSnap({ entry: { status: 'next', peopleAhead: 0 } });
    const { api, only } = fakeApi();
    const { store, log } = fakeStore();
    const { context } = ctx(first);
    let reads = 0;
    context.snapshot = async () => (++reads === 1 ? first : fresh);
    const response = await distributeGoogle(context, runtime(api, store).rt, { isTester: async () => true });
    expect(response.status).toBe(302);
    expect(reads).toBe(2);
    expect(only('patchObject')).toHaveLength(1);
    expect(log.live).toHaveLength(2);
  });

  it('pass révoqué pendant l’insertion : retour avec ?wallet=indisponible, aucun lien', async () => {
    const snap = queueSnap({ pass: { live: false } });
    const { store } = fakeStore([], [], { markLive: () => false });
    const response = await distributeGoogle(ctx(snap).context, runtime(fakeApi().api, store).rt, { isTester: async () => true });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(back);
  });

  it('pass déjà tenu à jour : pas de nouvelle insertion, juste le lien', async () => {
    const snap = queueSnap();
    const { api, calls } = fakeApi();
    const { context } = ctx(snap, { live: true, created: false });
    const response = await distributeGoogle(context, runtime(api, fakeStore().store).rt, { isTester: async () => false });
    expect(response.status).toBe(302);
    expect(calls).toHaveLength(0);
  });

  it('mode démo : réservé aux membres connectés ; sinon retour, rien d’émis', async () => {
    const snap = queueSnap({ pass: { live: false } });
    const demo = runtime(fakeApi().api, fakeStore().store, CONFIG);
    const stranger = ctx(snap);
    const refused = await distributeGoogle(stranger.context, demo.rt, { isTester: async () => false });
    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toBe(back);
    expect(stranger.issue).not.toHaveBeenCalled();
    const member = ctx(snap);
    expect((await distributeGoogle(member.context, demo.rt, { isTester: async () => true })).status).toBe(302);
  });

  it('Google en panne : retour avec ?wallet=indisponible, jamais tenu à jour', async () => {
    const snap = queueSnap({ pass: { live: false } });
    const { api } = fakeApi({ insertObject: async () => { throw new GoogleWalletError('server', '503', 503); } });
    const { store, log } = fakeStore();
    const response = await distributeGoogle(ctx(snap).context, runtime(api, store).rt, { isTester: async () => true });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(back);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(log.live).toHaveLength(0);
  });

  it('Google muet : retour au bout du délai (8 s en production)', async () => {
    const snap = queueSnap({ pass: { live: false } });
    const { api } = fakeApi({ insertObject: () => new Promise(() => undefined) });
    const started = Date.now();
    const response = await distributeGoogle(ctx(snap).context, runtime(api, fakeStore().store).rt, { isTester: async () => true, timeoutMs: 30 });
    expect(response.status).toBe(303);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(DISTRIBUTE_TIMEOUT_MS).toBe(8000);
  });

  it('compte de service refusé : retour, et boutons masqués', async () => {
    const snap = queueSnap({ pass: { live: false } });
    const { api } = fakeApi({ insertObject: async () => { throw new GoogleWalletError('forbidden', '403', 403); } });
    const h = runtime(api, fakeStore().store);
    expect((await distributeGoogle(ctx(snap).context, h.rt, { isTester: async () => true })).status).toBe(303);
    expect(h.degraded).toHaveLength(1);
  });

  it('billet de drop dont la classe est refusée : aucun lien', async () => {
    const snap = eventSnapshot({ pass: { provider: 'google', externalId: '3388000000012345678.rangvia_e_' + 'b'.repeat(32), classRef: EVENT_CLASS, live: false } });
    const { api, only } = fakeApi();
    const { store } = fakeStore([classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: false, syncedAt: NOW.toISOString(), reviewStatus: 'REJECTED' })]);
    const response = await distributeGoogle(ctx(snap).context, runtime(api, store).rt, { isTester: async () => true });
    expect(response.status).toBe(303);
    expect(only('insertObject')).toHaveLength(0);
  });

  it('billet de drop, classe en place : eventTicketObjects dans le JWT, aucun appel de classe au clic', async () => {
    const snap = eventSnapshot({ pass: { provider: 'google', externalId: '3388000000012345678.rangvia_e_' + 'b'.repeat(32), classRef: EVENT_CLASS, live: false } });
    const { api, calls } = fakeApi();
    // Salie (marque modifiée) : le vidage s'en charge, pas le clic.
    const { store } = fakeStore([classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, dirty: true, syncedAt: NOW.toISOString(), reviewStatus: 'UNDER_REVIEW' })]);
    const response = await distributeGoogle(ctx(snap).context, runtime(api, store).rt, { isTester: async () => true });
    expect(calls.map((c) => c.method)).toEqual(['insertObject']);
    const jwt = response.headers.get('location')!.split('/save/')[1]!;
    expect(decodeJwt(jwt).payload).toEqual({ eventTicketObjects: [{ id: snap.pass.externalId }] });
  });

  it('billet de drop dont la classe n’existe pas encore chez Google : refus (§ 8.1), rien de créé au clic', async () => {
    const snap = eventSnapshot({ pass: { provider: 'google', externalId: '3388000000012345678.rangvia_e_' + 'b'.repeat(32), classRef: EVENT_CLASS, live: false } });
    for (const rows of [[], [classRow({ classId: EVENT_CLASS, kind: 'event', eventId: EVENT_ID, syncedAt: null })]]) {
      const { api, calls } = fakeApi();
      const { store, log } = fakeStore(rows);
      const response = await distributeGoogle(ctx(snap).context, runtime(api, store).rt, { isTester: async () => true });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(back);
      expect(calls).toHaveLength(0);
      expect(log.upserts).toHaveLength(0);
    }
    const { store } = fakeStore([classRow({ classId: '999.autre_evt_x', kind: 'event', eventId: EVENT_ID, syncedAt: NOW.toISOString() })]);
    expect(await eventClassAtClick({ config: CONFIG, store }, EVENT_ID)).toBe('unavailable');
  });
});
