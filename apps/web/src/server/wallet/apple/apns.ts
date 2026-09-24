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
 * échecs passagers ; un certificat refusé arrête le tour.
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
    stream.on('error', (error) => finish({ status: 0, reason: error.message }));
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
    stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
      stream?.close(http2.constants.NGHTTP2_CANCEL);
      finish({ status: 0, reason: 'Timeout' });
    });
    stream.end(request.body);
  });
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
