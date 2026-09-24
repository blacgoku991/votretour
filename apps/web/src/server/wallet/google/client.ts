import type { AccessTokenSource, FetchLike } from './auth';
import { GoogleWalletError, kindForStatus, parseRetryAfter } from './errors';

/**
 * Client REST Google Wallet (walletobjects v1), écrit sur fetch.
 *
 * Chemins vérifiés dans le document de découverte walletobjects v1
 * (révision 20260923) : insert, get, patch, addMessage sur
 * genericObject / eventTicketObject, et insert, get, patch sur les
 * classes. Il n'existe PAS de suppression d'objet : l'effacement RGPD est
 * un PATCH (sync.ts).
 *
 * Tout ce qui sort d'ici est soit une réponse JSON, soit une
 * GoogleWalletError classée (errors.ts). Garanties :
 *  - `fetch` injectable : les tests ne touchent jamais le réseau ;
 *  - seau de 10 requêtes par seconde glissante, par processus (la limite
 *    annoncée par Google est 20/s, à confirmer dans la console Cloud) ;
 *  - 8 s au plus par requête, et le signal d'annulation de l'appelant
 *    (délai du vidage, process()) est relayé à fetch ;
 *  - 401 : jeton invalidé, UN seul nouvel essai avec un jeton neuf ;
 *  - 409 sur insert → « existe déjà » ; 409 sur addMessage → « déjà
 *    ajouté » : ce ne sont pas des échecs.
 */

export const WALLET_API_BASE = 'https://walletobjects.googleapis.com/walletobjects/v1';
export const REQUEST_TIMEOUT_MS = 8_000;
export const DEFAULT_RATE_PER_SECOND = 10;

export type GoogleObjectType = 'genericObject' | 'eventTicketObject';
export type GoogleClassType = 'genericClass' | 'eventTicketClass';

/** Ressource Google telle que renvoyée : on ne lit que quelques champs, sans présumer du reste. */
export type GoogleResource = Record<string, unknown>;

export interface GoogleMessage {
  id: string;
  header: string;
  body: string;
  messageType: 'TEXT' | 'TEXT_AND_NOTIFY';
  displayInterval?: { start?: { date: string }; end?: { date: string } };
}

/* ====================================================================
   Seau de débit : au plus N requêtes par seconde glissante
   ==================================================================== */

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GoogleWalletError('aborted', 'Requête Google annulée'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GoogleWalletError('aborted', 'Requête Google annulée'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const systemClock: Clock = { now: () => Date.now(), sleep: abortableSleep };

/**
 * Seau de débit : jamais plus de N départs de requête sur une seconde
 * GLISSANTE (et non « N par seconde civile », qui laisserait passer 2N
 * requêtes à cheval sur deux secondes). Chaque appel RÉSERVE son créneau
 * avant d'attendre : dix appels simultanés sur un seau plein s'étalent
 * proprement au lieu de tous se réveiller au même instant.
 *
 * Les créneaux réservés restent triés : un nouveau créneau vaut
 * max(maintenant, créneau N rangs plus tôt + 1 s), qui n'est jamais
 * antérieur au dernier réservé.
 */
export class TokenBucket {
  private readonly starts: number[] = [];

  constructor(
    readonly ratePerSecond = DEFAULT_RATE_PER_SECOND,
    private readonly clock: Clock = systemClock,
  ) {}

  async take(signal?: AbortSignal): Promise<void> {
    const now = this.clock.now();
    while (this.starts.length > 0 && this.starts[0]! <= now - 1000) this.starts.shift();
    const n = this.ratePerSecond;
    const slot = this.starts.length >= n ? Math.max(now, this.starts[this.starts.length - n]! + 1000) : now;
    this.starts.push(slot);
    if (slot <= now) return;
    // Une requête annulée pendant son attente garde son créneau : le
    // rendre casserait l'ordre des réservations suivantes, calculées à
    // partir de lui. Le cas est rare (délai du vidage) et ne coûte qu'un
    // dixième de seconde de débit.
    await this.clock.sleep(slot - now, signal);
  }
}

/** Un seau par processus : tous les clients partagent le même débit. */
let sharedBucket: TokenBucket | null = null;
export function sharedTokenBucket(): TokenBucket {
  sharedBucket ??= new TokenBucket();
  return sharedBucket;
}

/* ====================================================================
   Client
   ==================================================================== */

export interface GoogleWalletClientOptions {
  auth: AccessTokenSource;
  fetch?: FetchLike;
  bucket?: TokenBucket;
  baseUrl?: string;
  timeoutMs?: number;
}

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
}

function encodeId(id: string): string {
  // Identifiants Google : [0-9]+.[A-Za-z0-9._-]+ ; encodés par principe.
  return encodeURIComponent(id);
}

/** Motif et message d'une erreur Google (`{ error: { code, message, status, errors: [{ reason }] } }`). */
function describeError(payload: unknown): { message: string; reason: string | null } {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error: unknown }).error;
    if (error && typeof error === 'object') {
      const e = error as { message?: unknown; status?: unknown; errors?: unknown };
      const first = Array.isArray(e.errors) ? (e.errors[0] as { reason?: unknown } | undefined) : undefined;
      const reason = typeof first?.reason === 'string' ? first.reason : typeof e.status === 'string' ? e.status : null;
      return { message: typeof e.message === 'string' ? e.message.slice(0, 300) : '', reason };
    }
    if (typeof error === 'string') return { message: error.slice(0, 300), reason: error };
  }
  return { message: '', reason: null };
}

export class GoogleWalletClient {
  private readonly auth: AccessTokenSource;
  private readonly fetchImpl: FetchLike;
  private readonly bucket: TokenBucket;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GoogleWalletClientOptions) {
    this.auth = options.auth;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.bucket = options.bucket ?? sharedTokenBucket();
    this.baseUrl = (options.baseUrl ?? WALLET_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /* ---------- Objets ---------- */

  /** Création. 409 (déjà créé, double clic) → `exists` : l'appelant fait un PATCH. */
  async insertObject(type: GoogleObjectType, body: GoogleResource, signal?: AbortSignal): Promise<{ status: 'created' | 'exists' }> {
    try {
      await this.request('POST', `/${type}`, { body, signal });
      return { status: 'created' };
    } catch (error) {
      if (error instanceof GoogleWalletError && error.kind === 'conflict') return { status: 'exists' };
      throw error;
    }
  }

  /** Lecture ; null si l'objet n'existe pas. */
  async getObject(type: GoogleObjectType, id: string, signal?: AbortSignal): Promise<GoogleResource | null> {
    try {
      return await this.request('GET', `/${type}/${encodeId(id)}`, { signal });
    } catch (error) {
      if (error instanceof GoogleWalletError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  /** PATCH : les tableaux envoyés remplacent ceux de Google en entier. */
  patchObject(type: GoogleObjectType, id: string, body: GoogleResource, signal?: AbortSignal): Promise<GoogleResource> {
    return this.request('PATCH', `/${type}/${encodeId(id)}`, { body, signal });
  }

  /**
   * Ajoute un message au dos du pass ; TEXT_AND_NOTIFY fait sonner le
   * téléphone. 409 → `duplicate` : un envoi rejoué (délai dépassé puis
   * repris) ne doit pas passer pour un échec. Renvoie la ressource à jour
   * quand Google la donne (pour élaguer les vieux messages).
   */
  async addMessage(
    type: GoogleObjectType,
    id: string,
    message: GoogleMessage,
    signal?: AbortSignal,
  ): Promise<{ status: 'added' | 'duplicate'; resource: GoogleResource | null }> {
    try {
      const response = await this.request('POST', `/${type}/${encodeId(id)}/addMessage`, { body: { message }, signal });
      const resource = response.resource;
      return { status: 'added', resource: resource && typeof resource === 'object' ? (resource as GoogleResource) : null };
    } catch (error) {
      if (error instanceof GoogleWalletError && error.kind === 'conflict') return { status: 'duplicate', resource: null };
      throw error;
    }
  }

  /* ---------- Classes ---------- */

  async insertClass(type: GoogleClassType, body: GoogleResource, signal?: AbortSignal): Promise<{ status: 'created' | 'exists'; resource: GoogleResource | null }> {
    try {
      const resource = await this.request('POST', `/${type}`, { body, signal });
      return { status: 'created', resource };
    } catch (error) {
      if (error instanceof GoogleWalletError && error.kind === 'conflict') return { status: 'exists', resource: null };
      throw error;
    }
  }

  async getClass(type: GoogleClassType, id: string, signal?: AbortSignal): Promise<GoogleResource | null> {
    try {
      return await this.request('GET', `/${type}/${encodeId(id)}`, { signal });
    } catch (error) {
      if (error instanceof GoogleWalletError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  patchClass(type: GoogleClassType, id: string, body: GoogleResource, signal?: AbortSignal): Promise<GoogleResource> {
    return this.request('PATCH', `/${type}/${encodeId(id)}`, { body, signal });
  }

  /* ---------- Transport ---------- */

  private async request(method: string, path: string, options: RequestOptions, retried = false): Promise<GoogleResource> {
    const { signal } = options;
    if (signal?.aborted) throw new GoogleWalletError('aborted', 'Requête Google annulée');
    await this.bucket.take(signal);
    const token = await this.auth.token(signal);

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: combined,
        cache: 'no-store',
      });
    } catch {
      // Qui a coupé ? L'appelant (délai du vidage) ou notre propre délai.
      if (signal?.aborted) throw new GoogleWalletError('aborted', `${method} ${path} annulé`);
      if (timeout.aborted) throw new GoogleWalletError('timeout', `${method} ${path} : délai de ${this.timeoutMs} ms dépassé`);
      throw new GoogleWalletError('network', `${method} ${path} : Google Wallet injoignable`);
    }

    if (response.status === 401 && !retried) {
      // Jeton expiré plus tôt que prévu, ou révoqué : un jeton neuf, un seul essai.
      await response.body?.cancel().catch(() => undefined);
      this.auth.invalidate();
      return this.request(method, path, options, true);
    }

    let payload: unknown = null;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const { message, reason } = describeError(payload);
      throw new GoogleWalletError(
        kindForStatus(response.status),
        `${method} ${path} : ${response.status}${message ? ` ${message}` : ''}`,
        response.status,
        parseRetryAfter(response.headers.get('retry-after')),
        reason,
      );
    }
    return payload && typeof payload === 'object' ? (payload as GoogleResource) : {};
  }
}
