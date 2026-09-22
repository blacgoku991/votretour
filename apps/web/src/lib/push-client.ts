'use client';

/**
 * Abonnement aux notifications côté navigateur (Web Push / VAPID).
 *
 * Utilisé sur Android et sur iPhone lorsque le site a été ajouté à
 * l'écran d'accueil. Sur iPhone en navigation classique, ce chemin n'est
 * pas disponible : c'est l'App Clip qui prend le relais avec APNs.
 * L'interface le dit clairement plutôt que de promettre une notification
 * qui n'arrivera jamais.
 */

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: 'unsupported' | 'ios_needs_pwa' | 'insecure' };

export function detectPushSupport(): PushSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'unsupported' };
  if (!window.isSecureContext) return { supported: false, reason: 'insecure' };

  const hasApi =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  if (hasApi) return { supported: true };

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;

  if (isIos && !standalone) return { supported: false, reason: 'ios_needs_pwa' };
  return { supported: false, reason: 'unsupported' };
}

export type SubscribeOutcome =
  | { status: 'subscribed' }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string };

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function subscribeToPush(params: {
  organizationId: string;
  vapidPublicKey: string;
  entryId?: string | null;
}): Promise<SubscribeOutcome> {
  const support = detectPushSupport();
  if (!support.supported) return { status: 'unsupported', reason: support.reason };
  if (!params.vapidPublicKey) return { status: 'unsupported', reason: 'not_configured' };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { status: 'denied' };

    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(params.vapidPublicKey) as BufferSource,
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { status: 'error', message: "Abonnement incomplet renvoyé par le navigateur." };
    }

    const response = await fetch('/api/client/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: params.organizationId,
        entryId: params.entryId ?? null,
        subscription: {
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        },
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      return { status: 'error', message: payload.error ?? "L'abonnement n'a pas pu être enregistré." };
    }

    return { status: 'subscribed' };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Erreur inconnue.',
    };
  }
}

export function currentPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
