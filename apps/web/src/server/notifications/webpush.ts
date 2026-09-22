import 'server-only';
import webpush, { type PushSubscription, type WebPushError } from 'web-push';
import { env } from '@/lib/env';

/**
 * Web Push (VAPID) — le canal Android et navigateur.
 *
 * Fonctionne sur Chrome/Firefox Android sans installer d'application, et
 * sur iOS 16.4+ lorsque le site a été ajouté à l'écran d'accueil. Sur
 * iPhone sans PWA installée, c'est l'App Clip qui prend le relais : les
 * deux canaux sont complémentaires, jamais redondants.
 */

let configured = false;

export function webPushConfigured(): boolean {
  return Boolean(env.webPush.publicKey && env.webPush.privateKey);
}

function ensureConfigured(): void {
  if (configured) return;
  if (!webPushConfigured()) {
    throw new Error(
      'Web Push non configuré (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY). ' +
        'Générez une paire avec : npm run keys:vapid',
    );
  }
  webpush.setVapidDetails(
    env.webPush.subject,
    env.webPush.publicKey as string,
    env.webPush.privateKey as string,
  );
  configured = true;
}

export interface WebPushPayload {
  title: string;
  body: string;
  /** URL ouverte au clic sur la notification. */
  url: string;
  tag?: string;
  kind?: string;
  entryId?: string;
  /** Actions affichées sous la notification (ex. « Laisser un avis Google »). */
  actions?: { action: string; title: string; url?: string }[];
  requireInteraction?: boolean;
  renotify?: boolean;
}

export type WebPushResult =
  | { ok: true; status: number }
  | { ok: false; status: number; reason: string; shouldDeactivate: boolean; retriable: boolean };

export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: WebPushPayload,
  options: { ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {},
): Promise<WebPushResult> {
  if (!webPushConfigured()) {
    return { ok: false, status: 0, reason: 'NotConfigured', shouldDeactivate: false, retriable: false };
  }
  ensureConfigured();

  const target: PushSubscription = {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  };

  try {
    const result = await webpush.sendNotification(target, JSON.stringify(payload), {
      TTL: options.ttlSeconds ?? 900,
      urgency: options.urgency ?? 'high',
      headers: { Topic: (payload.tag ?? 'votretour').slice(0, 32) },
    });
    return { ok: true, status: result.statusCode };
  } catch (error) {
    const pushError = error as WebPushError;
    const status = pushError.statusCode ?? 0;
    return {
      ok: false,
      status,
      reason: pushError.body?.slice(0, 300) ?? pushError.message ?? 'PushError',
      // 404/410 : l'abonnement du navigateur n'existe plus.
      shouldDeactivate: status === 404 || status === 410,
      retriable: status === 429 || status >= 500,
    };
  }
}

/** Clé publique VAPID exposée au navigateur pour s'abonner. */
export function vapidPublicKey(): string | null {
  return env.webPush.publicKey;
}
