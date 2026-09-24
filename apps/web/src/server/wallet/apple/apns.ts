import 'server-only';
import http2 from 'node:http2';
import { createHash } from 'node:crypto';
import { DEAD_TOKEN_REASONS, RETRIABLE_REASONS } from '@/server/notifications/apns';

/**
 * Pushes de mise à jour Apple Wallet.
 *
 * Ce qu'Apple documente (« Adding a web service to update passes ») : la
 * notification utilise LE MÊME certificat et la même clé que la
 * signature du pass, le jeton push inscrit par l'appareil, un
 * dictionnaire JSON VIDE pour charge utile, et ne fonctionne qu'en
 * PRODUCTION. D'où :
 *  - TLS client par certificat (pas le jeton .p8 de l'App Clip, qui
 *    n'est pas documenté pour Wallet), session HTTP/2 distincte de
 *    celle de server/notifications/apns.ts ;
 *  - apns-topic = passTypeIdentifier, corps {} ;
 *  - toujours api.push.apple.com, jamais le bac à sable ;
 *  - apns-expiration à une heure : une mise à jour plus vieille est de
 *    toute façon remplacée par la suivante ;
 *  - pas d'apns-push-type ni de priorité explicite [à vérifier en recette :
 *    si APNs l'exige, `background` et priorité 5].
 *
 * Le push ne transporte rien : il dit seulement à l'iPhone « demande la
 * nouvelle version » (GET /v1/passes/…). Aucune donnée ne transite par
 * Apple à cette étape.
 *
 * Classement des réponses : mêmes listes que les pushes de l'App Clip
 * (exportées par notifications/apns.ts) pour les jetons morts et les
 * échecs passagers ; un certificat refusé arrête le tour, qu'APNs le dise
 * en HTTP (403 BadCertificate…) ou dès la poignée de main TLS (certificat
 * révoqué ou expiré : alerte TLS, aucune réponse HTTP).
 */

export const APNS_WALLET_HOST = 'https://api.push.apple.com';
/** Une mise à jour ne sert plus à rien au-delà : la suivante la remplace. */
export const PUSH_TTL_SECONDS = 3600;
/** Flux HTTP/2 simultanés par envoi (le vidage en lance au plus 20 à la fois). */
const PUSH_CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 10_000;

/** Certificat refusé ou mal configuré : insister ne changerait rien. */
export const HALT_REASONS: ReadonlySet<string> = new Set([
  'BadCertificate',
  'BadCertificateEnvironment',
  'Forbidden',
  'TopicDisallowed',
  'BadTopic',
  'MissingTopic',
]);

/**
 * Échec TLS qui tient au CERTIFICAT, pas au réseau : alerte reçue d'APNs
 * (OpenSSL : ERR_SSL_SSLV3_ALERT_CERTIFICATE_REVOKED, …_BAD_CERTIFICATE,
 * …_CERTIFICATE_EXPIRED, ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED…) ou
 * certificat du serveur refusé (CERT_HAS_EXPIRED, UNABLE_TO_VERIFY_…,
 * SELF_SIGNED_…, ERR_TLS_CERT_ALTNAME_INVALID). Réessayer toutes les 30 s
 * n'y changerait rien. Une coupure pendant la poignée de main (ECONNRESET,
 * « socket disconnected before secure TLS connection ») reste passagère.
 * [à vérifier en recette : le code exact renvoyé pour un certificat révoqué.]
 */
const TLS_CERTIFICATE_FAILURE = new RegExp(
  [
    '^ERR_SSL_\\w*ALERT_\\w*(CERTIFICATE|UNKNOWN_CA|ACCESS_DENIED|HANDSHAKE_FAILURE)',
    '^ERR_TLS_CERT',
    '^CERT_',
    '^(UNABLE_TO_(GET|VERIFY|DECRYPT)|SELF_SIGNED|DEPTH_ZERO_SELF_SIGNED)',
    'alert (bad certificate|certificate (revoked|expired|unknown|required)|unknown ca)',
  ].join('|'),
  'i',
);

export function isTlsCertificateFailure(reason: string | null): boolean {
  return reason !== null && TLS_CERTIFICATE_FAILURE.test(reason);
}

export type PushOutcome = 'ok' | 'dead' | 'retry' | 'halt' | 'fail' | 'aborted';

export interface PushRequest {
  headers: Record<string, string | number>;
  body: string;
}

export interface PushResponse {
  status: number;
  reason: string | null;
}

export interface PushResult extends PushResponse {
  token: string;
  outcome: PushOutcome;
}

export type PushTransport = (request: PushRequest, signal: AbortSignal) => Promise<PushResponse>;

const PUSH_TOKEN = /^[0-9a-fA-F]{32,200}$/;

export function buildWalletPushRequest(token: string, topic: string, now: Date): PushRequest {
  if (!PUSH_TOKEN.test(token)) throw new Error('Jeton push Apple invalide');
  const body = '{}';
  return {
    headers: {
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      'apns-topic': topic,
      'apns-expiration': Math.floor(now.getTime() / 1000) + PUSH_TTL_SECONDS,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    body,
  };
}

export function classifyPush(response: PushResponse): PushOutcome {
  const { status, reason } = response;
  if (status === 200) return 'ok';
  if (reason === 'Aborted') return 'aborted';
  if (status === 410 || (reason !== null && DEAD_TOKEN_REASONS.has(reason))) return 'dead';
  if (status === 403 || (reason !== null && HALT_REASONS.has(reason))) return 'halt';
  if (status === 0 && isTlsCertificateFailure(reason)) return 'halt';
  if (status === 0 || status === 429 || status >= 500 || (reason !== null && RETRIABLE_REASONS.has(reason))) return 'retry';
  // 400 (BadPath, PayloadEmpty…) : défaut de notre côté, un nouvel essai
  // enverrait la même requête.
  return 'fail';
}

/* ====================================================================
   Transport HTTP/2 réel : une session par certificat, réutilisée
   ==================================================================== */

const sessions = new Map<string, http2.ClientHttp2Session>();

/**
 * Destination : APNs de production. Surchargeable UNIQUEMENT pour les
 * tests (serveur HTTP/2 local et son autorité de test).
 */
export interface TransportTarget {
  host: string;
  ca?: string;
}

function sessionFor(tls: { cert: string; key: string }, target: TransportTarget): http2.ClientHttp2Session {
  const id = createHash('sha256').update(`${target.host}\n${tls.cert}`).digest('hex').slice(0, 16);
  const existing = sessions.get(id);
  if (existing && !existing.closed && !existing.destroyed) return existing;

  const session = http2.connect(target.host, { cert: tls.cert, key: tls.key, ...(target.ca ? { ca: target.ca } : {}) });
  // Au repos 30 s : on ferme (le cron repasse chaque minute).
  session.setTimeout(30_000, () => session.close());
  session.on('error', (error) => {
    console.error('[wallet/apns] session HTTP/2 en erreur', error.message);
    sessions.delete(id);
  });
  session.on('close', () => sessions.delete(id));
  sessions.set(id, session);
  return session;
}

export function closeWalletApnsSessions(): void {
  for (const session of sessions.values()) if (!session.closed) session.close();
  sessions.clear();
}

export function http2Transport(
  tls: { cert: string; key: string },
  target: TransportTarget = { host: APNS_WALLET_HOST },
): PushTransport {
  return (request, signal) => new Promise<PushResponse>((resolve) => {
    let settled = false;
    const finish = (response: PushResponse) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(response);
    };
    let stream: http2.ClientHttp2Stream | null = null;
    // Signal d'annulation du vidage (délai dépassé) : on coupe le flux.
    const onAbort = () => {
      stream?.close(http2.constants.NGHTTP2_CANCEL);
      finish({ status: 0, reason: 'Aborted' });
    };
    if (signal.aborted) {
      finish({ status: 0, reason: 'Aborted' });
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      stream = sessionFor(tls, target).request(request.headers);
    } catch (error) {
      finish({ status: 0, reason: error instanceof Error ? error.message : 'ConnectError' });
      return;
    }
    let status = 0;
    const chunks: Buffer[] = [];
    stream.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
    });
    stream.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    // Une poignée de main refusée détruit la session : le flux reçoit
    // ERR_HTTP2_STREAM_CANCEL, la vraie raison (alerte TLS) en `cause`.
    stream.on('error', (error) => finish({ status: 0, reason: streamFailure(error) }));
    stream.on('end', () => {
      let reason: string | null = null;
      if (status !== 200) {
        try {
          reason = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { reason?: string }).reason ?? null;
        } catch {
          reason = `HTTP ${status}`;
        }
      }
      finish({ status, reason });
    });
    // Flux fermé sans réponse ni erreur (TLS 1.3 : le serveur rejette le
    // certificat client APRÈS la poignée de main, la session se ferme) :
    // sans ce filet, la promesse attendrait le signal du vidage.
    stream.on('close', () => {
      if (status === 0) finish({ status: 0, reason: 'StreamClosed' });
      else finish({ status, reason: status === 200 ? null : `HTTP ${status}` });
    });
    stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
      stream?.close(http2.constants.NGHTTP2_CANCEL);
      finish({ status: 0, reason: 'Timeout' });
    });
    stream.end(request.body);
  });
}

/** Raison lisible d'une erreur de flux : le code de la cause (TLS) d'abord. */
export function streamFailure(error: Error & { code?: unknown; cause?: unknown }): string {
  const cause = error.cause as (Error & { code?: unknown }) | undefined;
  if (cause && typeof cause.code === 'string') return cause.code;
  if (typeof error.code === 'string' && error.code !== 'ERR_HTTP2_STREAM_CANCEL' && error.code !== 'ERR_HTTP2_STREAM_ERROR') {
    return error.code;
  }
  return cause?.message ?? error.message;
}

/**
 * Pousse `{}` à chaque jeton (dédoublonnés). Ne lève jamais : chaque
 * jeton a son issue, classée.
 */
export async function pushPassUpdate(
  tokens: readonly string[],
  options: { topic: string; transport: PushTransport; signal: AbortSignal; now: Date },
): Promise<PushResult[]> {
  const unique = [...new Set(tokens)].filter((token) => PUSH_TOKEN.test(token));
  const results: PushResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const token = unique[next++]!;
      let response: PushResponse;
      if (options.signal.aborted) response = { status: 0, reason: 'Aborted' };
      else {
        try {
          response = await options.transport(buildWalletPushRequest(token, options.topic, options.now), options.signal);
        } catch (error) {
          response = { status: 0, reason: error instanceof Error ? error.message : 'erreur inconnue' };
        }
      }
      results.push({ token, ...response, outcome: classifyPush(response) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, unique.length) }, worker));
  return results;
}

/** Jeton raccourci pour les journaux : jamais le jeton complet. */
export function tokenHint(token: string): string {
  return `${token.slice(0, 6)}…`;
}
