import { describe, expect, it, vi } from 'vitest';
import { decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { GoogleAuth, TOKEN_EARLY_REFRESH_MS, type FetchLike } from '../../src/server/wallet/google/auth';
import { WALLET_OBJECT_SCOPE, type GoogleServiceAccount } from '../../src/server/wallet/google/config';
import { GoogleWalletError } from '../../src/server/wallet/google/errors';

/**
 * Jeton OAuth du compte de service (JWT-bearer signé avec jose), sans
 * réseau : clé RSA générée à la volée, serveur de jetons simulé.
 */

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const ACCOUNT: GoogleServiceAccount = {
  clientEmail: 'wallet@rangvia-test.iam.gserviceaccount.com',
  privateKey: await exportPKCS8(privateKey),
  privateKeyId: 'kid-0123456789',
  tokenUri: 'https://oauth2.googleapis.com/token',
};

function tokenServer(responses: Array<() => Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('appel inattendu');
    return next();
  });
  return { fetch, calls };
}

const okToken = (value: string, expiresIn = 3600) => () =>
  new Response(JSON.stringify({ access_token: value, expires_in: expiresIn, token_type: 'Bearer' }), {
    headers: { 'Content-Type': 'application/json' },
  });

describe('Assertion JWT-bearer', () => {
  it('RS256, kid, iss, scope wallet_object.issuer, aud = token_uri, 1 h', async () => {
    const auth = new GoogleAuth(ACCOUNT, { now: () => 1_790_000_000_000 });
    const assertion = await auth.assertion();
    expect(decodeProtectedHeader(assertion)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-0123456789' });
    const { payload } = await jwtVerify(assertion, publicKey, {
      audience: 'https://oauth2.googleapis.com/token',
      issuer: ACCOUNT.clientEmail,
      currentDate: new Date(1_790_000_000_000),
    });
    expect(payload.scope).toBe(WALLET_OBJECT_SCOPE);
    expect(WALLET_OBJECT_SCOPE).toBe('https://www.googleapis.com/auth/wallet_object.issuer');
    expect(payload.iat).toBe(1_790_000_000);
    expect(payload.exp).toBe(1_790_003_600);
  });

  it('clé illisible : erreur de configuration, jamais la clé dans le message', async () => {
    const auth = new GoogleAuth({ ...ACCOUNT, privateKey: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' });
    const error = await auth.assertion().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleWalletError);
    expect((error as GoogleWalletError).configuration).toBe(true);
    expect((error as Error).message).not.toContain('AAAA');
  });
});

describe('Jeton d’accès', () => {
  it('POST au serveur de jetons, grant_type jwt-bearer, assertion signée', async () => {
    const server = tokenServer([okToken('ya29.jeton')]);
    const auth = new GoogleAuth(ACCOUNT, { fetch: server.fetch });
    expect(await auth.token()).toBe('ya29.jeton');
    const [call] = server.calls;
    expect(call!.url).toBe('https://oauth2.googleapis.com/token');
    expect(call!.init?.method).toBe('POST');
    const form = new URLSearchParams(String(call!.init?.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload } = await jwtVerify(form.get('assertion')!, publicKey, { audience: ACCOUNT.tokenUri });
    expect(payload.scope).toBe(WALLET_OBJECT_SCOPE);
  });

  it('mis en cache jusqu’à l’expiration moins 60 s', async () => {
    const clock = { t: 1_000_000 };
    const server = tokenServer([okToken('premier', 3600), okToken('second', 3600)]);
    const auth = new GoogleAuth(ACCOUNT, { fetch: server.fetch, now: () => clock.t });
    expect(await auth.token()).toBe('premier');
    clock.t += 3600_000 - TOKEN_EARLY_REFRESH_MS - 1;
    expect(await auth.token()).toBe('premier');
    expect(server.fetch).toHaveBeenCalledTimes(1);
    clock.t += 1;
    expect(await auth.token()).toBe('second');
    expect(server.fetch).toHaveBeenCalledTimes(2);
  });

  it('deux demandes simultanées : une seule requête', async () => {
    const server = tokenServer([okToken('partagé')]);
    const auth = new GoogleAuth(ACCOUNT, { fetch: server.fetch });
    const [a, b] = await Promise.all([auth.token(), auth.token()]);
    expect([a, b]).toEqual(['partagé', 'partagé']);
    expect(server.fetch).toHaveBeenCalledTimes(1);
  });

  it('invalidate() après un 401 : un jeton neuf', async () => {
    const server = tokenServer([okToken('ancien'), okToken('neuf')]);
    const auth = new GoogleAuth(ACCOUNT, { fetch: server.fetch });
    await auth.token();
    auth.invalidate();
    expect(await auth.token()).toBe('neuf');
  });

  it('invalid_grant (clé révoquée) : erreur de configuration non réessayable', async () => {
    const server = tokenServer([() => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }), { status: 400 })]);
    const auth = new GoogleAuth(ACCOUNT, { fetch: server.fetch });
    const error = (await auth.token().catch((e: unknown) => e)) as GoogleWalletError;
    expect(error).toBeInstanceOf(GoogleWalletError);
    expect(error.kind).toBe('unauthorized');
    expect(error.configuration).toBe(true);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('invalid_grant');
  });

  it('panne du serveur de jetons : réessayable, Retry-After respecté', async () => {
    const server = tokenServer([() => new Response('{}', { status: 503, headers: { 'Retry-After': '12' } })]);
    const error = (await new GoogleAuth(ACCOUNT, { fetch: server.fetch }).token().catch((e: unknown) => e)) as GoogleWalletError;
    expect(error.kind).toBe('server');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(12);
  });

  it('réseau coupé : réessayable ; le message ne contient ni jeton ni assertion', async () => {
    const fetch = vi.fn<FetchLike>(async () => { throw new TypeError('fetch failed'); });
    const error = (await new GoogleAuth(ACCOUNT, { fetch }).token().catch((e: unknown) => e)) as GoogleWalletError;
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.message).not.toMatch(/eyJ/);
  });

  it('un échec n’est pas mis en cache : la demande suivante réessaie', async () => {
    const server = tokenServer([() => new Response('{}', { status: 500 }), okToken('rétabli')]);
    const auth = new GoogleAuth(ACCOUNT, { fetch: server.fetch });
    await expect(auth.token()).rejects.toBeInstanceOf(GoogleWalletError);
    expect(await auth.token()).toBe('rétabli');
  });

  it('attente annulée par l’appelant : erreur « aborted »', async () => {
    let release: () => void = () => undefined;
    const fetch = vi.fn<FetchLike>(() => new Promise<Response>((resolve) => { release = () => resolve(okToken('tard')()); }));
    const auth = new GoogleAuth(ACCOUNT, { fetch });
    const controller = new AbortController();
    const pending = auth.token(controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    release();
    // La requête partagée aboutit quand même pour les suivants.
    expect(await auth.token()).toBe('tard');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
