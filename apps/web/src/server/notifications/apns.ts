import 'server-only';
import http2 from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';
import { env } from '@/lib/env';

/**
 * Client APNs (HTTP/2), écrit directement sur le protocole d'Apple.
 *
 * Points spécifiques aux App Clips, tirés de la documentation Apple
 * « Enabling notifications in App Clips » :
 *
 *  1. Le topic (apns-topic) est le bundle ID de l'APP CLIP, pas celui de
 *     l'application complète.
 *  2. Un App Clip qui déclare NSAppClipRequestEphemeralUserNotification
 *     ne peut recevoir des notifications que pendant 8 h après chaque
 *     lancement. Au-delà, le jeton est mort : on le désactive.
 *  3. Pour un App Clip qui sert PLUSIEURS commerces — exactement notre
 *     cas — Apple impose que la charge utile porte un `target-content-id`
 *     égal à l'URL d'invocation correspondant à une expérience App Clip
 *     avancée déclarée. C'est ce champ qui garantit qu'une notification
 *     du Barber House ne peut pas atterrir dans l'instance App Clip du
 *     Garage 92 : le système route sur cette URL.
 */

const APNS_HOST_PROD = 'https://api.push.apple.com';
const APNS_HOST_SANDBOX = 'https://api.sandbox.push.apple.com';

export type ApnsResult =
  | { ok: true; apnsId: string | null; status: number }
  | { ok: false; status: number; reason: string; retriable: boolean; shouldDeactivate: boolean };

export interface ApnsPayload {
  title: string;
  subtitle?: string;
  body: string;
  /** URL d'invocation : OBLIGATOIRE pour un App Clip multi-commerces. */
  targetContentId?: string | null;
  category?: string;
  threadId?: string;
  /** Regroupe les mises à jour d'un même ticket : une seule notif visible. */
  collapseId?: string;
  interruptionLevel?: 'passive' | 'active' | 'time-sensitive';
  relevanceScore?: number;
  sound?: string | null;
  data?: Record<string, unknown>;
  /** Date d'expiration : inutile de livrer « c'est votre tour » 2 h après. */
  expiration?: number;
}

export function apnsConfigured(): boolean {
  return Boolean(env.apns.keyId && env.apns.teamId && env.apns.privateKey);
}

/* --------------------------------------------------------------------
   Jeton d'authentification : valable 1 h côté Apple, régénéré à 50 min.
   Apple rejette (TooManyProviderTokenUpdates) un fournisseur qui en
   fabrique un à chaque envoi : la mise en cache est obligatoire.
   -------------------------------------------------------------------- */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function providerToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.value;

  const { keyId, teamId, privateKey } = env.apns;
  if (!keyId || !teamId || !privateKey) {
    throw new Error('APNs non configuré (APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY).');
  }

  const key = await importPKCS8(privateKey, 'ES256');
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(key);

  cachedToken = { value, expiresAt: now + 50 * 60 * 1000 };
  return value;
}

/* --------------------------------------------------------------------
   Session HTTP/2 réutilisée entre les envois d'une même exécution.
   -------------------------------------------------------------------- */
const sessions = new Map<string, http2.ClientHttp2Session>();

function getSession(host: string): http2.ClientHttp2Session {
  const existing = sessions.get(host);
  if (existing && !existing.closed && !existing.destroyed) return existing;

  const session = http2.connect(host);
  session.setTimeout(30_000, () => session.close());
  session.on('error', (error) => {
    console.error('[apns] session HTTP/2 en erreur', error.message);
    sessions.delete(host);
  });
  session.on('close', () => sessions.delete(host));
  sessions.set(host, session);
  return session;
}

/** Ferme les sessions ouvertes (utile en fin de tâche planifiée). */
export function closeApnsSessions(): void {
  for (const session of sessions.values()) {
    if (!session.closed) session.close();
  }
  sessions.clear();
}

/**
 * Codes APNs pour lesquels le destinataire n'existe plus. Exportés (en
 * lecture seule) pour les mises à jour Apple Wallet (server/wallet/apple/
 * apns.ts), qui classent les réponses d'APNs de la même façon : une seule
 * liste à tenir à jour.
 */
export const DEAD_TOKEN_REASONS: ReadonlySet<string> = new Set([
  'BadDeviceToken',
  'Unregistered',
  'DeviceTokenNotForTopic',
  'ExpiredToken',
]);

/** Codes APNs d'un échec passager : on réessaie plus tard. */
export const RETRIABLE_REASONS: ReadonlySet<string> = new Set([
  'TooManyRequests',
  'InternalServerError',
  'ServiceUnavailable',
  'ExpiredProviderToken',
]);

/**
 * Construit la charge utile APNs.
 *
 * Extraite pour être testable : `target-content-id` est la clé qui, dans
 * un App Clip multi-commerces, empêche une notification d'atterrir dans
 * la mauvaise instance. Une régression silencieuse à cet endroit ferait
 * passer un client d'un commerce à un autre — c'est exactement le genre
 * de chose qu'une suite de tests doit verrouiller.
 */
export function buildApnsBody(payload: ApnsPayload): {
  aps: Record<string, unknown>;
  vt: Record<string, unknown>;
} {
  const aps: Record<string, unknown> = {
    alert: {
      title: payload.title,
      ...(payload.subtitle ? { subtitle: payload.subtitle } : {}),
      body: payload.body,
    },
    'interruption-level': payload.interruptionLevel ?? 'time-sensitive',
    'relevance-score': payload.relevanceScore ?? 1,
  };

  if (payload.sound !== null) aps.sound = payload.sound ?? 'default';
  if (payload.category) aps.category = payload.category;
  if (payload.threadId) aps['thread-id'] = payload.threadId;
  // Sans ce champ, iOS ne sait pas à quelle instance d'App Clip remettre
  // la notification lorsque le client a ouvert plusieurs commerces.
  if (payload.targetContentId) aps['target-content-id'] = payload.targetContentId;

  return { aps, vt: payload.data ?? {} };
}

export async function sendApns(
  deviceToken: string,
  topic: string,
  payload: ApnsPayload,
  environment: 'sandbox' | 'production' = env.apns.environment,
): Promise<ApnsResult> {
  if (!apnsConfigured()) {
    return {
      ok: false, status: 0, reason: 'NotConfigured',
      retriable: false, shouldDeactivate: false,
    };
  }

  const host = environment === 'production' ? APNS_HOST_PROD : APNS_HOST_SANDBOX;

  let token: string;
  try {
    token = await providerToken();
  } catch (error) {
    return {
      ok: false, status: 0,
      reason: error instanceof Error ? error.message : 'TokenError',
      retriable: false, shouldDeactivate: false,
    };
  }

  const body = JSON.stringify(buildApnsBody(payload));

  const headers: Record<string, string | number> = {
    ':method': 'POST',
    ':path': `/3/device/${deviceToken}`,
    authorization: `bearer ${token}`,
    'apns-topic': topic,
    'apns-push-type': 'alert',
    'apns-priority': 10,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  };
  if (payload.collapseId) headers['apns-collapse-id'] = payload.collapseId.slice(0, 64);
  if (payload.expiration != null) headers['apns-expiration'] = payload.expiration;

  return new Promise<ApnsResult>((resolve) => {
    let settled = false;
    const finish = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let request: http2.ClientHttp2Stream;
    try {
      request = getSession(host).request(headers);
    } catch (error) {
      finish({
        ok: false, status: 0,
        reason: error instanceof Error ? error.message : 'ConnectError',
        retriable: true, shouldDeactivate: false,
      });
      return;
    }

    let status = 0;
    let apnsId: string | null = null;
    const chunks: Buffer[] = [];

    request.setEncoding('utf8');
    request.on('response', (responseHeaders) => {
      status = Number(responseHeaders[':status'] ?? 0);
      const id = responseHeaders['apns-id'];
      apnsId = typeof id === 'string' ? id : null;
    });
    request.on('data', (chunk: string) => chunks.push(Buffer.from(chunk)));
    request.on('error', (error) => {
      finish({
        ok: false, status: 0, reason: error.message,
        retriable: true, shouldDeactivate: false,
      });
    });
    request.on('end', () => {
      if (status === 200) {
        finish({ ok: true, apnsId, status });
        return;
      }
      let reason = `HTTP ${status}`;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { reason?: string };
        if (parsed.reason) reason = parsed.reason;
      } catch {
        /* corps non JSON : on garde le statut */
      }
      // Un jeton rejeté après la fenêtre de 8 h de l'App Clip tombe ici.
      finish({
        ok: false,
        status,
        reason,
        retriable: RETRIABLE_REASONS.has(reason) || status >= 500,
        shouldDeactivate: DEAD_TOKEN_REASONS.has(reason) || status === 410,
      });
    });

    request.setTimeout(10_000, () => {
      request.close(http2.constants.NGHTTP2_CANCEL);
      finish({
        ok: false, status: 0, reason: 'Timeout',
        retriable: true, shouldDeactivate: false,
      });
    });

    request.end(body);
  });
}
