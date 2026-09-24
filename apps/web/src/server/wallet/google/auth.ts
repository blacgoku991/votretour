import { SignJWT, importPKCS8 } from 'jose';
import { WALLET_OBJECT_SCOPE, type GoogleServiceAccount } from './config';
import { GoogleWalletError, kindForStatus, parseRetryAfter } from './errors';

/**
 * Jeton d'accès OAuth 2.0 du compte de service (flux JWT-bearer, RFC 7523).
 *
 * Pourquoi `jose` plutôt que google-auth-library : `jose` est déjà là et
 * signe déjà les jetons APNs. Le flux tient en quelques lignes testables
 * sans réseau (fetch injecté), sans ajouter gaxios, gcp-metadata…
 *
 *   assertion = RS256 { iss: client_email, scope: wallet_object.issuer,
 *                       aud: token_uri, iat, exp: iat + 1 h } (kid = private_key_id)
 *   POST token_uri  grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
 *   → { access_token, expires_in }
 *
 * Le jeton est gardé en mémoire jusqu'à son expiration moins 60 s : un
 * vidage de 400 passes ne demande qu'un jeton. Deux demandes simultanées
 * partagent la même requête. La clé privée n'est importée qu'une fois par
 * processus, et sert aussi à signer le JWT d'enregistrement (jwt.ts).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Marge avant l'expiration annoncée par Google. */
export const TOKEN_EARLY_REFRESH_MS = 60_000;
const ASSERTION_LIFETIME_S = 3600;
const TOKEN_TIMEOUT_MS = 8_000;

/** Ce dont le client REST a besoin : un jeton, et le moyen de l'invalider après un 401. */
export interface AccessTokenSource {
  token(signal?: AbortSignal): Promise<string>;
  invalidate(): void;
}

type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;

export interface GoogleAuthOptions {
  fetch?: FetchLike;
  now?: () => number;
}

export class GoogleAuth implements AccessTokenSource {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private keyPromise: Promise<SigningKey> | null = null;
  private cached: { value: string; refreshAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    readonly account: GoogleServiceAccount,
    options: GoogleAuthOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  /** Clé privée RS256, importée une seule fois. Une clé illisible est une erreur de configuration. */
  signingKey(): Promise<SigningKey> {
    if (!this.keyPromise) {
      this.keyPromise = importPKCS8(this.account.privateKey, 'RS256').catch(() => {
        this.keyPromise = null;
        throw new GoogleWalletError('unauthorized', 'Clé privée du compte de service illisible (PKCS#8 RSA attendu)');
      });
    }
    return this.keyPromise;
  }

  /** Assertion signée : exportée pour les tests (scope, aud = token_uri). */
  async assertion(): Promise<string> {
    const key = await this.signingKey();
    const iat = Math.floor(this.now() / 1000);
    return new SignJWT({ scope: WALLET_OBJECT_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: this.account.privateKeyId })
      .setIssuer(this.account.clientEmail)
      .setAudience(this.account.tokenUri)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ASSERTION_LIFETIME_S)
      .sign(key);
  }

  async token(signal?: AbortSignal): Promise<string> {
    const now = this.now();
    if (this.cached && this.cached.refreshAt > now) return this.cached.value;
    if (!this.inflight) {
      this.inflight = this.fetchToken().finally(() => {
        this.inflight = null;
      });
    }
    // L'appelant peut abandonner son attente ; la requête partagée, elle,
    // continue pour les autres (elle a son propre délai).
    if (!signal) return this.inflight;
    signal.throwIfAborted();
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => reject(new GoogleWalletError('aborted', 'Demande de jeton annulée'));
      signal.addEventListener('abort', onAbort, { once: true });
      this.inflight!.then(
        (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
        (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
      );
    });
  }

  invalidate(): void {
    this.cached = null;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await this.assertion(),
    });

    let response: Response;
    try {
      response = await this.fetchImpl(this.account.tokenUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new GoogleWalletError(timeout ? 'timeout' : 'network', timeout
        ? 'Serveur de jetons Google : délai dépassé'
        : 'Serveur de jetons Google injoignable');
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      /* corps illisible : traité ci-dessous */
    }

    if (!response.ok) {
      // invalid_grant, invalid_client, unauthorized_client : la clé est
      // révoquée ou le compte supprimé. Configuration à corriger, pas une
      // panne passagère. Le message de Google ne contient pas de secret.
      const code = typeof payload.error === 'string' ? payload.error : '';
      const detail = typeof payload.error_description === 'string' ? payload.error_description : '';
      const kind = response.status >= 500 || response.status === 429
        ? kindForStatus(response.status)
        : 'unauthorized';
      throw new GoogleWalletError(
        kind,
        `Jeton OAuth refusé (${response.status}${code ? ` ${code}` : ''})${detail ? ` : ${detail.slice(0, 200)}` : ''}`,
        response.status,
        parseRetryAfter(response.headers.get('retry-after'), this.now()),
        code || null,
      );
    }

    const accessToken = payload.access_token;
    const expiresIn = Number(payload.expires_in);
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new GoogleWalletError('network', 'Réponse du serveur de jetons Google illisible', response.status);
    }
    const lifetimeMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : ASSERTION_LIFETIME_S * 1000;
    this.cached = {
      value: accessToken,
      // Jamais négatif : un jeton de moins de 60 s sert une fois, puis on en redemande un.
      refreshAt: this.now() + Math.max(0, lifetimeMs - TOKEN_EARLY_REFRESH_MS),
    };
    return accessToken;
  }
}
