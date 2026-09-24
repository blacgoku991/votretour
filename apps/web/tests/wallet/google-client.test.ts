import { describe, expect, it, vi } from 'vitest';
import type { AccessTokenSource, FetchLike } from '../../src/server/wallet/google/auth';
import {
  GoogleWalletClient, TokenBucket, WALLET_API_BASE, type Clock, type GoogleMessage,
} from '../../src/server/wallet/google/client';
import { GoogleWalletError, isNotificationQuotaError, parseRetryAfter } from '../../src/server/wallet/google/errors';

/**
 * Client REST walletobjects v1, sans réseau : `fetch` simulé, jeton
 * simulé, seau à horloge simulée. On vérifie les chemins, les en-têtes,
 * le classement des erreurs et le débit.
 */

const OBJECT_ID = '3388000000012345678.rangvia_q_9f2c0a1b2c3d4e5f60718293a4b5c6d7';

function fakeAuth(tokens = ['jeton-1', 'jeton-2', 'jeton-3']): AccessTokenSource & { invalidations: number } {
  let index = 0;
  const auth = {
    invalidations: 0,
    async token() { return tokens[Math.min(index, tokens.length - 1)]!; },
    invalidate() { auth.invalidations += 1; index += 1; },
  };
  return auth;
}

/** Seau sans attente réelle : l'horloge avance d'elle-même quand on dort. */
function instantBucket(): TokenBucket {
  const clock = { t: 0 };
  return new TokenBucket(1000, { now: () => clock.t, sleep: async (ms) => { clock.t += ms; } });
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function client(responses: Array<Response | (() => Promise<Response>)>, options: { auth?: ReturnType<typeof fakeAuth>; timeoutMs?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('appel inattendu');
    return typeof next === 'function' ? next() : next;
  });
  const auth = options.auth ?? fakeAuth();
  return { api: new GoogleWalletClient({ auth, fetch, bucket: instantBucket(), timeoutMs: options.timeoutMs }), calls, fetch, auth };
}

const MESSAGE: GoogleMessage = {
  id: 'your_turn', header: 'C’est votre tour', body: 'Présentez-vous maintenant chez Barber House Bastille.', messageType: 'TEXT_AND_NOTIFY',
};

describe('Chemins et en-têtes', () => {
  it('PATCH d’un objet Generic : chemin, jeton Bearer, JSON', async () => {
    const { api, calls } = client([json(200, { id: OBJECT_ID })]);
    await api.patchObject('genericObject', OBJECT_ID, { state: 'ACTIVE' });
    expect(calls[0]!.url).toBe(`${WALLET_API_BASE}/genericObject/${encodeURIComponent(OBJECT_ID)}`);
    expect(calls[0]!.url).toBe('https://walletobjects.googleapis.com/walletobjects/v1/genericObject/3388000000012345678.rangvia_q_9f2c0a1b2c3d4e5f60718293a4b5c6d7');
    expect(calls[0]!.init.method).toBe('PATCH');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jeton-1');
    expect(headers['Content-Type']).toMatch(/^application\/json/);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ state: 'ACTIVE' });
  });

  it('addMessage : POST …/{id}/addMessage avec { message }', async () => {
    const { api, calls } = client([json(200, { resource: { id: OBJECT_ID, messages: [MESSAGE] } })]);
    const result = await api.addMessage('eventTicketObject', OBJECT_ID, MESSAGE);
    expect(calls[0]!.url).toBe(`${WALLET_API_BASE}/eventTicketObject/${OBJECT_ID}/addMessage`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ message: MESSAGE });
    expect(result.status).toBe('added');
    expect(result.resource?.messages).toHaveLength(1);
  });

  it('insert, get, classes : bons verbes et chemins', async () => {
    const { api, calls } = client([json(200, {}), json(200, { id: OBJECT_ID }), json(200, {}), json(200, {}), json(200, {})]);
    await api.insertObject('genericObject', { id: OBJECT_ID });
    await api.getObject('genericObject', OBJECT_ID);
    await api.insertClass('eventTicketClass', { id: '1.c' });
    await api.getClass('genericClass', '1.c');
    await api.patchClass('eventTicketClass', '1.c', {});
    expect(calls.map((c) => `${c.init.method} ${c.url.replace(WALLET_API_BASE, '')}`)).toEqual([
      'POST /genericObject',
      `GET /genericObject/${OBJECT_ID}`,
      'POST /eventTicketClass',
      'GET /genericClass/1.c',
      'PATCH /eventTicketClass/1.c',
    ]);
    expect(calls[1]!.init.body).toBeUndefined();
  });
});

describe('Réponses qui ne sont pas des échecs', () => {
  it('insert 409 → « existe déjà » (l’appelant fait un PATCH)', async () => {
    const { api } = client([json(409, { error: { code: 409, message: 'Resource already exists', status: 'ALREADY_EXISTS' } })]);
    expect(await api.insertObject('genericObject', { id: OBJECT_ID })).toEqual({ status: 'exists' });
  });

  it('addMessage 409 → « déjà ajouté » (envoi rejoué)', async () => {
    const { api } = client([json(409, { error: { code: 409, message: 'duplicate' } })]);
    expect(await api.addMessage('genericObject', OBJECT_ID, MESSAGE)).toEqual({ status: 'duplicate', resource: null });
  });

  it('get 404 → null', async () => {
    const { api } = client([json(404, { error: { code: 404, message: 'not found' } })]);
    expect(await api.getObject('genericObject', OBJECT_ID)).toBeNull();
  });
});

describe('Classement des erreurs', () => {
  it('401 → jeton invalidé, UN seul nouvel essai, réussi', async () => {
    const { api, calls, auth } = client([json(401, { error: { code: 401 } }), json(200, {})]);
    await api.patchObject('genericObject', OBJECT_ID, {});
    expect(auth.invalidations).toBe(1);
    expect(calls).toHaveLength(2);
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe('Bearer jeton-2');
  });

  it('401 deux fois → non autorisé, pas de troisième appel', async () => {
    const { api, calls } = client([json(401, {}), json(401, {})]);
    const error = (await api.patchObject('genericObject', OBJECT_ID, {}).catch((e: unknown) => e)) as GoogleWalletError;
    expect(error.kind).toBe('unauthorized');
    expect(error.configuration).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('429 avec Retry-After: 7 → réessayable dans 7 s', async () => {
    const { api } = client([json(429, { error: { code: 429, message: 'Too many requests' } }, { 'Retry-After': '7' })]);
    const error = (await api.patchObject('genericObject', OBJECT_ID, {}).catch((e: unknown) => e)) as GoogleWalletError;
    expect(error).toBeInstanceOf(GoogleWalletError);
    expect(error.kind).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(7);
  });

  it('403 → compte de service non autorisé, non réessayable', async () => {
    const { api } = client([json(403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } })]);
    const error = (await api.patchObject('genericObject', OBJECT_ID, {}).catch((e: unknown) => e)) as GoogleWalletError;
    expect(error.kind).toBe('forbidden');
    expect(error.retryable).toBe(false);
    expect(error.configuration).toBe(true);
    expect(error.message).toContain('The caller does not have permission');
    expect(error.message).not.toContain('jeton-1');
  });

  it('400 → défaut de construction, 404 sur PATCH → introuvable, 5xx → réessayable', async () => {
    const { api } = client([json(400, { error: { message: 'Invalid header' } }), json(404, {}), json(503, {})]);
    const kinds = [];
    for (let i = 0; i < 3; i += 1) {
      const error = (await api.patchObject('genericObject', OBJECT_ID, {}).catch((e: unknown) => e)) as GoogleWalletError;
      kinds.push([error.kind, error.retryable]);
    }
    expect(kinds).toEqual([['invalid', false], ['not_found', false], ['server', true]]);
  });

  it('délai dépassé → réessayable', async () => {
    // Google ne répond jamais : seul notre délai (ici 20 ms) coupe la requête.
    const fetch = vi.fn<FetchLike>((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')));
    }));
    const api = new GoogleWalletClient({ auth: fakeAuth(), fetch, bucket: instantBucket(), timeoutMs: 20 });
    const error = (await api.patchObject('genericObject', OBJECT_ID, {}).catch((e: unknown) => e)) as GoogleWalletError;
    expect(error.kind).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('signal d’annulation de l’appelant relayé à fetch → « aborted »', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<FetchLike>((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const api = new GoogleWalletClient({ auth: fakeAuth(), fetch, bucket: instantBucket() });
    const pending = api.patchObject('genericObject', OBJECT_ID, {}, controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted', retryable: true });
  });

  it('déjà annulé : aucun appel', async () => {
    const { api, fetch } = client([]);
    const controller = new AbortController();
    controller.abort();
    await expect(api.patchObject('genericObject', OBJECT_ID, {}, controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('réseau coupé → réessayable', async () => {
    const fetch = vi.fn<FetchLike>(async () => { throw new TypeError('fetch failed'); });
    const api = new GoogleWalletClient({ auth: fakeAuth(), fetch, bucket: instantBucket() });
    await expect(api.getObject('genericObject', OBJECT_ID)).rejects.toMatchObject({ kind: 'network', retryable: true });
  });
});

describe('Quota de notifications et Retry-After', () => {
  it('quota de notifications reconnu, quota de débit exclu', () => {
    expect(isNotificationQuotaError(new GoogleWalletError('rate_limited', 'POST … : 429 QuotaExceededException', 429))).toBe(true);
    expect(isNotificationQuotaError(new GoogleWalletError('invalid', 'x', 400, null, 'quotaExceeded'))).toBe(true);
    expect(isNotificationQuotaError(new GoogleWalletError('rate_limited', "Quota exceeded for quota metric 'Requests' per minute", 429))).toBe(false);
    expect(isNotificationQuotaError(new GoogleWalletError('server', 'quota', 500))).toBe(false);
    expect(isNotificationQuotaError(new Error('quota'))).toBe(false);
  });

  it('Retry-After : secondes ou date HTTP, borné à [1 s, 1 h]', () => {
    expect(parseRetryAfter('7')).toBe(7);
    expect(parseRetryAfter('0')).toBe(1);
    expect(parseRetryAfter('999999')).toBe(3600);
    expect(parseRetryAfter(new Date(1_000_000 + 30_000).toUTCString(), 1_000_000)).toBe(30);
    expect(parseRetryAfter('bientôt')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe('Seau de débit', () => {
  /** Horloge figée : `sleep` note le départ prévu sans attendre. */
  function frozen(): { clock: Clock; starts: number[]; t: { now: number } } {
    const t = { now: 0 };
    const starts: number[] = [];
    return {
      t,
      starts,
      clock: { now: () => t.now, sleep: async (ms) => { starts.push(t.now + ms); } },
    };
  }

  it('jamais plus de N départs sur une seconde glissante', async () => {
    const { clock, starts, t } = frozen();
    const bucket = new TokenBucket(10, clock);
    const planned: number[] = [];
    for (let i = 0; i < 35; i += 1) {
      const before = starts.length;
      await bucket.take();
      planned.push(starts.length > before ? starts[starts.length - 1]! : t.now);
      if (i === 17) t.now = 450; // des appels arrivent aussi en cours de route
    }
    planned.sort((a, b) => a - b);
    for (const s of planned) {
      const inWindow = planned.filter((x) => x > s - 1000 && x <= s).length;
      expect(inWindow).toBeLessThanOrEqual(10);
    }
    // Rafale initiale immédiate, puis 10 par seconde.
    expect(planned.filter((x) => x === 0)).toHaveLength(10);
    expect(planned.at(-1)).toBe(3000);
  });

  it('fenêtre écoulée : de nouveau immédiat', async () => {
    const { clock, starts, t } = frozen();
    const bucket = new TokenBucket(2, clock);
    await bucket.take();
    await bucket.take();
    t.now = 1001;
    await bucket.take();
    expect(starts).toEqual([]);
  });

  it('attente annulée : erreur « aborted »', async () => {
    const bucket = new TokenBucket(1);
    await bucket.take();
    const controller = new AbortController();
    const pending = bucket.take(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
});
