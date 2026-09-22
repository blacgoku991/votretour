/* =====================================================================
   VotreTour — service worker
   ---------------------------------------------------------------------
   Deux rôles, et rien de plus :

     1. RECEVOIR LES NOTIFICATIONS WEB PUSH (Android, et iOS lorsque le
        site est installé sur l'écran d'accueil). Le chiffrement est
        géré par le navigateur ; ici on se contente d'afficher, et de
        router le clic au bon endroit.

     2. ROUVRIR LA BONNE PAGE au clic, en réutilisant l'onglet déjà
        ouvert s'il existe — un client qui revient ne doit pas se
        retrouver avec trois onglets de sa file.

   Volontairement AUCUN cache hors ligne de l'application : une file
   d'attente périmée affichée depuis un cache serait pire que pas de
   page du tout. Le suivi de position vient du réseau, ou pas du tout.
   ===================================================================== */

self.addEventListener('install', (event) => {
  // Le nouveau service worker prend la main immédiatement : une
  // correction de notification ne doit pas attendre la fermeture de
  // tous les onglets.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'VotreTour', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'VotreTour';
  const url = payload.url || '/';

  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Un seul fil par ticket : les mises à jour se remplacent au lieu
    // de s'empiler.
    tag: payload.tag || 'votretour',
    renotify: payload.renotify !== false,
    requireInteraction: payload.requireInteraction === true,
    vibrate: payload.kind === 'your_turn' ? [18, 60, 28] : [12],
    timestamp: Date.now(),
    data: {
      url,
      kind: payload.kind || null,
      entryId: payload.entryId || null,
      actions: payload.actions || [],
    },
    actions: (payload.actions || []).slice(0, 2).map((action) => ({
      action: action.action,
      title: action.title,
    })),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  // Un clic sur « Laisser un avis Google » ouvre directement le lien de
  // CET établissement, transporté dans la charge utile.
  const matched = (data.actions || []).find((a) => a.action === event.action);
  const target = (matched && matched.url) || data.url || '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      const sameOrigin = new URL(target, self.location.origin).origin === self.location.origin;

      if (sameOrigin) {
        for (const client of windows) {
          if (client.url.includes('/e/') && 'focus' in client) {
            await client.focus();
            if ('navigate' in client) {
              try {
                await client.navigate(target);
              } catch {
                /* certains navigateurs refusent navigate() : le focus suffit */
              }
            }
            return;
          }
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(target);
      }
    })(),
  );
});

/* Le navigateur peut révoquer un abonnement (rotation de clés, purge).
   On prévient le serveur pour qu'il cesse d'essayer d'y pousser. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint;
      if (!oldEndpoint) return;
      try {
        await fetch('/api/client/push/rotate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldEndpoint,
            newSubscription: event.newSubscription ? event.newSubscription.toJSON() : null,
          }),
        });
      } catch {
        /* hors ligne : le serveur détectera l'endpoint mort au prochain envoi */
      }
    })(),
  );
});
