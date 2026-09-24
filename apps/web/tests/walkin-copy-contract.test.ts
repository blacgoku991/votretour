import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  CLIENT_STATUS_LABEL,
  QUEUE_STATUS_LABEL,
  STAFF_STATUS_LABEL,
  notificationCopy,
  peopleAheadLabel,
  peopleAheadUnit,
  waitingCountLabel,
} from '@/lib/copy';
import type { EntryStatus, NotificationKind, QueueStatus } from '@/lib/types';
import { env } from '@/lib/env';
import { sendApns, type ApnsPayload } from '@/server/notifications/apns';
import { sendWebPush, type WebPushPayload } from '@/server/notifications/webpush';
import {
  dispatchEntryNotification,
  dispatchQueueNotifications,
} from '@/server/notifications/dispatch';

/**
 * Contrat de non-régression des textes vus par les barbiers et leurs
 * clients (lot R0 du chantier « profils métier »).
 *
 * Ce fichier est écrit AVANT le chantier, sur le code tel qu'il tourne
 * aujourd'hui. Chaque chaîne est recopiée littéralement, apostrophes
 * typographiques comprises : aucune expression régulière, aucun
 * `toContain`. Les profils métier ajoutent leurs propres textes dans de
 * nouveaux modules (`lib/profiles/copy.ts`) ; ceux-ci ne doivent JAMAIS
 * bouger. Si ce test casse, c'est qu'un texte déjà envoyé à des clients
 * a changé : la correction se fait dans le code, pas dans ce fichier
 * (sauf décision explicite de reformuler, à consigner dans la PR).
 */

type Context = Parameters<typeof notificationCopy>[1];
type Copy = { title: string; body: string };

/** Établissement ordinaire, sans apostrophe. */
const BARBER: Context = { locationName: 'Barber House' };
/** Nom avec apostrophes typographiques : il doit passer tel quel. */
const ANNA: Context = { locationName: 'L’Atelier d’Anna' };

/**
 * Une entrée par `NotificationKind`. Le type `Record` rend l'oubli d'un
 * genre impossible : ajouter une valeur à `NotificationKind` dans
 * `lib/types.ts` fait échouer `tsc` tant que son texte n'est pas figé ici.
 */
const EXPECTED: Record<NotificationKind, Array<{ ctx: Context; copy: Copy }>> = {
  ahead_two: [
    {
      ctx: { ...BARBER, peopleAhead: 2 },
      copy: { title: 'Barber House', body: 'Plus que 2 personnes devant vous.' },
    },
    {
      // Le seuil est réglable (notify_ahead_threshold) : le chiffre suit.
      ctx: { ...ANNA, peopleAhead: 3, clientName: 'Sarah' },
      copy: { title: 'L’Atelier d’Anna', body: 'Plus que 3 personnes devant vous.' },
    },
    {
      // Sans position connue, le texte retombe sur 2.
      ctx: BARBER,
      copy: { title: 'Barber House', body: 'Plus que 2 personnes devant vous.' },
    },
  ],
  ahead_one: [
    {
      ctx: { ...BARBER, peopleAhead: 1 },
      copy: { title: 'Barber House', body: 'Plus qu’une personne devant vous. Commencez à revenir.' },
    },
    {
      ctx: { ...ANNA, clientName: null },
      copy: { title: 'L’Atelier d’Anna', body: 'Plus qu’une personne devant vous. Commencez à revenir.' },
    },
  ],
  your_turn: [
    {
      ctx: { ...BARBER, peopleAhead: 0 },
      copy: { title: 'C’est votre tour', body: 'Présentez-vous maintenant chez Barber House.' },
    },
    {
      // Le prénom n'apparaît jamais sur l'écran verrouillé.
      ctx: { ...ANNA, clientName: 'Sarah' },
      copy: { title: 'C’est votre tour', body: 'Présentez-vous maintenant chez L’Atelier d’Anna.' },
    },
  ],
  visit_completed: [
    {
      ctx: BARBER,
      copy: { title: 'Merci pour votre visite', body: 'Merci d’être passé chez Barber House.' },
    },
    {
      ctx: { ...ANNA, clientName: 'Sarah' },
      copy: { title: 'Merci pour votre visite', body: 'Merci d’être passé chez L’Atelier d’Anna.' },
    },
  ],
  removed: [
    {
      ctx: BARBER,
      copy: { title: 'Barber House', body: 'Vous avez été retiré de la file.' },
    },
  ],
  queue_closed: [
    {
      ctx: ANNA,
      copy: { title: 'L’Atelier d’Anna', body: 'La file vient de fermer.' },
    },
  ],
  event_access: [
    {
      ctx: BARBER,
      copy: {
        title: 'Votre accès est prêt 🎟️',
        body: 'Présentez votre laisser-passer chez Barber House dans le délai indiqué.',
      },
    },
  ],
  event_sold_out: [
    {
      ctx: BARBER,
      copy: {
        title: 'Stock épuisé',
        body: 'Désolé, le stock disponible chez Barber House est désormais épuisé.',
      },
    },
  ],
  event_ended: [
    {
      ctx: ANNA,
      copy: {
        title: 'Événement terminé',
        body: 'L’événement chez L’Atelier d’Anna est maintenant terminé. Merci d’avoir participé.',
      },
    },
  ],
  custom: [
    {
      // Les messages libres du pro sont rédigés côté serveur ; le texte
      // de repli, lui, est fixe.
      ctx: BARBER,
      copy: { title: 'Barber House', body: 'Mise à jour de votre place.' },
    },
  ],
};

describe('contrat walkin : textes de notification', () => {
  const cases = (Object.keys(EXPECTED) as NotificationKind[]).flatMap((kind) =>
    EXPECTED[kind].map((c, i) => ({ kind, i, ...c })),
  );

  it.each(cases)('$kind (cas $i) : titre et corps exacts', ({ kind, ctx, copy }) => {
    expect(notificationCopy(kind, ctx)).toStrictEqual(copy);
  });

  it('aucun texte ne contient d’apostrophe droite', () => {
    for (const { kind, ctx } of cases) {
      const { title, body } = notificationCopy(kind, ctx);
      expect(`${title} ${body}`).not.toMatch(/'/);
    }
  });
});

describe('contrat walkin : libellés des écrans', () => {
  it('statuts vus par le client', () => {
    expect(CLIENT_STATUS_LABEL).toStrictEqual({
      waiting: 'Dans la file',
      notified: 'Votre tour approche',
      returning: 'Vous revenez',
      present: 'Vous êtes sur place',
      next: 'Vous êtes le prochain',
      serving: 'C’est votre tour',
      completed: 'Visite terminée',
      absent: 'Vous avez été noté absent',
      skipped: 'Vous avez été retiré de la file',
      cancelled: 'Vous avez quitté la file',
      expired: 'Votre place a expiré',
    } satisfies Record<EntryStatus, string>);
  });

  it('statuts vus par le pro', () => {
    expect(STAFF_STATUS_LABEL).toStrictEqual({
      waiting: 'En attente',
      notified: 'Prévenu',
      returning: 'Revient',
      present: 'Présent',
      next: 'Appelé',
      serving: 'En cours',
      completed: 'Terminé',
      absent: 'Absent',
      skipped: 'Retiré',
      cancelled: 'Parti',
      expired: 'Expiré',
    } satisfies Record<EntryStatus, string>);
  });

  it('état de la file', () => {
    expect(QUEUE_STATUS_LABEL).toStrictEqual({
      open: 'File ouverte',
      paused: 'File en pause',
      closed: 'File fermée',
    } satisfies Record<QueueStatus, string>);
  });

  it('position du client : jamais de numéro, seulement des personnes', () => {
    expect([-1, 0, 1, 2, 12].map(peopleAheadLabel)).toStrictEqual([
      'C’est votre tour',
      'C’est votre tour',
      '1 personne devant vous',
      '2 personnes devant vous',
      '12 personnes devant vous',
    ]);
    expect([0, 1, 5].map(peopleAheadUnit)).toStrictEqual([
      'à vous de jouer',
      'personne devant vous',
      'personnes devant vous',
    ]);
    expect([0, 1, 7].map(waitingCountLabel)).toStrictEqual([
      'Personne dans la file',
      '1 personne dans la file',
      '7 personnes dans la file',
    ]);
  });
});

/* =====================================================================
   Ce que la notification porte en plus de son texte
   ---------------------------------------------------------------------
   Le titre de l'action « Laisser un avis Google », la catégorie iOS qui
   l'affiche, le lien mesuré et l'URL d'ouverture ne vivent pas dans
   `lib/copy.ts` mais dans la chaîne d'envoi (`server/notifications/
   dispatch.ts`). On les fige en faisant tourner la vraie chaîne : la base
   et les deux fournisseurs (APNs, Web Push) sont remplacés par des
   doublures qui enregistrent ce qu'on leur confie, rien ne sort.
   ===================================================================== */

vi.mock('@/server/notifications/webpush', () => ({
  webPushConfigured: () => true,
  sendWebPush: vi.fn(async () => ({ ok: true, status: 201 })),
}));
vi.mock('@/server/notifications/apns', () => ({
  apnsConfigured: () => true,
  sendApns: vi.fn(async () => ({ ok: true, apnsId: 'apns-e2e', status: 200 })),
}));

/** Un ticket de barbier, client suivi sur l'App Clip ET sur le web. */
const ENTRY = {
  id: '0a000000-0000-4000-8000-00000000e001',
  public_id: 'r0ticketbarbier0001',
  organization_id: '0a000000-0000-4000-8000-00000000e002',
  location_id: '0a000000-0000-4000-8000-00000000e003',
  client_session_id: '0a000000-0000-4000-8000-00000000e004',
  client_name: 'Sarah',
  people_ahead: 0,
  status: 'serving',
};
const LOCATION = {
  id: ENTRY.location_id,
  name: 'Barber House',
  slug: 'barber-house',
  google_review_url: 'https://search.google.com/local/writereview?placeid=R0' as string | null,
};
const SUBSCRIPTIONS = [
  {
    id: 'sub-web', channel: 'web_push', endpoint: 'https://push.example/abc', p256dh: 'p256dh',
    auth_secret: 'auth', device_token: null, bundle_id: null, apns_environment: null,
    invocation_url: null, expires_at: null, client_session_id: ENTRY.client_session_id,
  },
  {
    id: 'sub-clip', channel: 'apns_appclip', endpoint: null, p256dh: null, auth_secret: null,
    device_token: 'jeton', bundle_id: 'app.rangvia.Clip', apns_environment: 'production',
    invocation_url: 'https://votretour.test/e/barber-house-comptoir', expires_at: null,
    client_session_id: ENTRY.client_session_id,
  },
];

type Result = { data: unknown; error: null };

/**
 * Doublure du client Supabase : chaque table rend une réponse fixe,
 * quelle que soit la chaîne de filtres. Suffisant ici, car on ne teste
 * pas les requêtes mais ce qui part vers les fournisseurs.
 */
function fakeDb(location: typeof LOCATION) {
  const rows: Record<string, { one: unknown; many: unknown }> = {
    event_campaigns: { one: null, many: [] },
    queue_entries: { one: ENTRY, many: [ENTRY] },
    notification_subscriptions: { one: { failure_count: 0 }, many: SUBSCRIPTIONS },
    locations: { one: location, many: [location] },
    notification_deliveries: { one: null, many: [] },
  };
  const table = (name: string) => {
    const answer = rows[name];
    if (!answer) throw new Error(`table inattendue : ${name}`);
    const many: Result = { data: answer.many, error: null };
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      limit: () => query,
      update: () => query,
      insert: async (): Promise<Result> => ({ data: null, error: null }),
      maybeSingle: async (): Promise<Result> => ({ data: answer.one, error: null }),
      then: <T>(resolve: (value: Result) => T) => Promise.resolve(many).then(resolve),
    };
    return query;
  };
  return {
    from: table,
    rpc: async (fn: string): Promise<Result> => {
      if (fn === 'claim_entry_notification') return { data: true, error: null };
      if (fn === 'claim_pending_notifications') {
        return {
          data: [{
            entry_id: ENTRY.id, entry_public_id: ENTRY.public_id, kind: 'your_turn',
            client_session_id: ENTRY.client_session_id, organization_id: ENTRY.organization_id,
            location_id: ENTRY.location_id, client_name: ENTRY.client_name,
            people_ahead: 0, status: 'serving',
          }],
          error: null,
        };
      }
      throw new Error(`fonction inattendue : ${fn}`);
    },
  };
}

let currentDb = fakeDb(LOCATION);
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => currentDb }));

/** Ce que Web Push et APNs ont reçu lors du dernier envoi. */
function sent(): { web: WebPushPayload; apns: ApnsPayload } {
  const web = vi.mocked(sendWebPush).mock.calls.at(-1)?.[1];
  const apns = vi.mocked(sendApns).mock.calls.at(-1)?.[2];
  if (!web || !apns) throw new Error('aucun envoi vers les deux canaux');
  return { web, apns };
}

describe('contrat walkin : ce que porte la notification', () => {
  const ticketUrl = (kind: NotificationKind) => `${env.siteUrl}/e/barber-house?src=push&k=${kind}`;
  const reviewUrl =
    `${env.siteUrl}/api/client/review/click?entry=${ENTRY.public_id}&source=notification`;

  afterEach(() => {
    vi.mocked(sendWebPush).mockClear();
    vi.mocked(sendApns).mockClear();
    currentDb = fakeDb(LOCATION);
  });

  it('fin de visite : action « Laisser un avis Google » et catégorie iOS dédiée', async () => {
    const summary = await dispatchEntryNotification(ENTRY.id, 'visit_completed');
    expect(summary.sent).toBe(2);
    const { web, apns } = sent();
    expect({
      title: web.title, body: web.body, url: web.url,
      actions: web.actions, requireInteraction: web.requireInteraction,
    }).toStrictEqual({
      title: 'Merci pour votre visite',
      body: 'Merci d’être passé chez Barber House.',
      url: ticketUrl('visit_completed'),
      actions: [{ action: 'review', title: 'Laisser un avis Google', url: reviewUrl }],
      requireInteraction: false,
    });
    expect({
      title: apns.title, subtitle: apns.subtitle, body: apns.body, category: apns.category,
      targetContentId: apns.targetContentId, interruptionLevel: apns.interruptionLevel,
      reviewUrl: apns.data?.reviewUrl,
    }).toStrictEqual({
      title: 'Merci pour votre visite',
      subtitle: 'Barber House',
      body: 'Merci d’être passé chez Barber House.',
      category: 'VISIT_COMPLETED',
      targetContentId: 'https://votretour.test/e/barber-house-comptoir',
      interruptionLevel: 'active',
      reviewUrl,
    });
  });

  it('sans lien d’avis renseigné, aucune action n’est proposée', async () => {
    currentDb = fakeDb({ ...LOCATION, google_review_url: null });
    await dispatchEntryNotification(ENTRY.id, 'visit_completed');
    const { web, apns } = sent();
    expect(web.actions).toBeUndefined();
    expect(apns.category).toBe('VISIT_COMPLETED');
    expect(apns.data?.reviewUrl).toBeNull();
  });

  it('c’est votre tour : insistant, sensible au temps, sans action', async () => {
    const summary = await dispatchQueueNotifications('file-barbier');
    expect(summary.sent).toBe(2);
    const { web, apns } = sent();
    expect({
      title: web.title, body: web.body, url: web.url,
      actions: web.actions, requireInteraction: web.requireInteraction,
    }).toStrictEqual({
      title: 'C’est votre tour',
      body: 'Présentez-vous maintenant chez Barber House.',
      url: ticketUrl('your_turn'),
      actions: undefined,
      requireInteraction: true,
    });
    expect({
      subtitle: apns.subtitle, category: apns.category,
      interruptionLevel: apns.interruptionLevel, reviewUrl: apns.data?.reviewUrl,
    }).toStrictEqual({
      subtitle: 'Barber House',
      category: 'QUEUE_UPDATE',
      interruptionLevel: 'time-sensitive',
      reviewUrl: null,
    });
  });
});
