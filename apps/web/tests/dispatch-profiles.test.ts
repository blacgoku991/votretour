import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationCopy } from '@/lib/copy';

/**
 * ENVOIS DES PROFILS MÉTIER — `server/notifications/dispatch.ts` et
 * `server/profiles/queue.ts`, avec une base SIMULÉE (aucun réseau).
 *
 * Ce que l'on verrouille :
 *  - un changement d'étape « Prévenir » réclame la clé `stage:<étape>` et
 *    n'envoie qu'une fois (réclamation refusée = rien ne part) ;
 *  - une fiche sans abonnement actif remonte « Non joignable »
 *    (`unreachable`), pour que le pro sache qu'il doit appeler ;
 *  - le devis part sous `quote:<n>`, ouvre la page sur `#devis` et ne
 *    propose jamais d'accepter depuis la notification ;
 *  - l'immatriculation complète n'apparaît dans AUCUN texte envoyé ;
 *  - les durées de vie par profil, et celles des barbiers inchangées ;
 *  - en walkin, le texte envoyé est EXACTEMENT celui de `notificationCopy`.
 */

/* ------------------------------------------------------------------ */
/* Base simulée                                                          */
/* ------------------------------------------------------------------ */

type Filter = [op: string, column: string, value: unknown];
interface TableCall {
  table: string;
  op: 'select' | 'insert' | 'update';
  columns?: string;
  filters: Filter[];
  values?: unknown;
}
type Result = { data: unknown; error: unknown };

const db = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string; params: Record<string, unknown> }[],
  tableCalls: [] as TableCall[],
  rpc: (_fn: string, _params: Record<string, unknown>): Result => ({ data: null, error: null }),
  table: (_call: TableCall): Result => ({ data: [], error: null }),
}));

function builder(table: string) {
  const call: TableCall = { table, op: 'select', filters: [] };
  const run = (): Result => {
    db.tableCalls.push(call);
    return db.table(call);
  };
  const chain = {
    select(columns?: string) { if (call.op === 'select') call.columns = columns; return chain; },
    insert(values: unknown) { call.op = 'insert'; call.values = values; return chain; },
    update(values: unknown) { call.op = 'update'; call.values = values; return chain; },
    eq(column: string, value: unknown) { call.filters.push(['eq', column, value]); return chain; },
    in(column: string, value: unknown) { call.filters.push(['in', column, value]); return chain; },
    gte(column: string, value: unknown) { call.filters.push(['gte', column, value]); return chain; },
    order() { return chain; },
    limit() { return chain; },
    async maybeSingle(): Promise<Result> {
      const result = run();
      const rows = Array.isArray(result.data) ? result.data : result.data == null ? [] : [result.data];
      return { data: rows[0] ?? null, error: result.error };
    },
    then<T>(resolve: (value: Result) => T, reject?: (reason: unknown) => T) {
      try {
        return Promise.resolve(resolve(run()));
      } catch (error) {
        return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
      }
    },
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string, params: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, params });
      return db.rpc(fn, params);
    },
    from: (table: string) => builder(table),
  }),
}));

const push = vi.hoisted(() => ({ sent: [] as { payload: Record<string, unknown>; options: Record<string, unknown> }[] }));

vi.mock('@/server/notifications/webpush', () => ({
  webPushConfigured: () => true,
  sendWebPush: async (_sub: unknown, payload: Record<string, unknown>, options: Record<string, unknown>) => {
    push.sent.push({ payload, options });
    return { ok: true, status: 201 };
  },
}));

vi.mock('@/server/notifications/apns', () => ({
  apnsConfigured: () => false,
  sendApns: async () => ({ ok: false, status: 0, reason: 'non configuré', shouldDeactivate: false }),
}));

// La diffusion d'état et le balayage de file ont leurs propres tests ; ici
// on isole l'envoi à clé qui suit l'action.
const side = vi.hoisted(() => ({ propagated: [] as string[], broadcasts: [] as unknown[][] }));
vi.mock('@/server/queue', () => ({
  propagate: async (queueId: string) => {
    side.propagated.push(queueId);
    return { state: null, notifications: { claimed: 0, sent: 0, failed: 0, skipped: 0, reasons: [] } };
  },
}));
vi.mock('@/server/realtime', () => ({
  broadcastTicketEvent: async (...args: unknown[]) => {
    side.broadcasts.push(args);
    return true;
  },
}));

const {
  dispatchDueReviews, dispatchEntryNotification, dispatchKeyedNotification, openingStateAt, reachOf, ttlSecondsFor,
} = await import('@/server/notifications/dispatch');
const { keyedSendFor, profileStaffAction } = await import('@/server/profiles/queue');

/* ------------------------------------------------------------------ */
/* Jeu d'essai                                                           */
/* ------------------------------------------------------------------ */

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const QUEUE_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const ORG_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';
const PUBLIC_ID = 'Tk7pQ2xWm9Ra';

interface Scenario {
  profile: string;
  details: Record<string, unknown>;
  stage: string | null;
  sessionId: string | null;
  subscriptions: Record<string, unknown>[];
  claimKey: boolean;
  notified: Record<string, unknown>;
  status: string;
}

let scenario: Scenario;

const WEB_PUSH_SUB = {
  id: '66666666-6666-4666-8666-666666666666',
  channel: 'web_push',
  endpoint: 'https://push.example.test/abc',
  p256dh: 'cle',
  auth_secret: 'secret',
  device_token: null,
  bundle_id: null,
  apns_environment: null,
  invocation_url: null,
  expires_at: null,
  client_session_id: SESSION_ID,
};

function staffEntry() {
  return {
    id: PUBLIC_ID,
    name: null,
    status: scenario.status,
    stage: scenario.stage,
    details: scenario.details,
    notified: scenario.notified,
  };
}

function install() {
  db.rpc = (fn, params) => {
    switch (fn) {
      case 'staff_queue_action': {
        const options = params.p_options as Record<string, unknown>;
        if (params.p_action === 'set_stage') scenario.stage = String(options.stage);
        if (params.p_action === 'send_quote') {
          const n = Number(scenario.notified.quote_count ?? 0) + 1;
          scenario.notified = { ...scenario.notified, quote_count: n };
          scenario.details = {
            ...scenario.details,
            quote: { n, amountCents: options.amountCents, label: options.label, sentAt: new Date().toISOString(), decision: null, decidedAt: null },
          };
          scenario.stage = 'quote_pending';
        }
        return {
          data: { entry: staffEntry(), promoted: null, queueId: QUEUE_ID, organizationId: ORG_ID, locationId: LOCATION_ID },
          error: null,
        };
      }
      case 'claim_entry_notification_key':
      case 'claim_entry_notification':
        return { data: scenario.claimKey, error: null };
      default:
        return { data: null, error: null };
    }
  };
  db.table = (call) => {
    const has = (column: string) => call.filters.some(([, c]) => c === column);
    switch (call.table) {
      case 'queue_entries':
        if (call.columns === 'id') return { data: [{ id: ENTRY_ID }], error: null };
        return {
          data: [{
            id: ENTRY_ID,
            public_id: PUBLIC_ID,
            queue_id: QUEUE_ID,
            organization_id: ORG_ID,
            location_id: LOCATION_ID,
            client_session_id: scenario.sessionId,
            client_name: 'Karim',
            people_ahead: 0,
            status: scenario.status,
            details: scenario.details,
            stage: scenario.stage,
            ticket_no: null,
            staff_id: null,
            called_at: null,
          }],
          error: null,
        };
      case 'queues':
        return {
          data: [{
            id: QUEUE_ID,
            organization_id: ORG_ID,
            location_id: LOCATION_ID,
            profile: scenario.profile,
            profile_options: {},
            client_name_required: false,
            absent_grace_minutes: 5,
            ticket_prefix: 'A',
          }],
          error: null,
        };
      case 'notification_subscriptions':
        return { data: call.op === 'select' && has('client_session_id') ? scenario.subscriptions : [], error: null };
      case 'locations':
        return {
          data: [{ id: LOCATION_ID, name: 'Garage des Tilleuls', slug: 'garage-des-tilleuls', google_review_url: 'https://g.page/r/avis', timezone: 'Europe/Paris' }],
          error: null,
        };
      default:
        return { data: [], error: null };
    }
  };
}

function deliveries(): Record<string, unknown>[] {
  return db.tableCalls
    .filter((c) => c.table === 'notification_deliveries' && c.op === 'insert')
    .flatMap((c) => c.values as Record<string, unknown>[]);
}

function keyedClaims(): string[] {
  return db.rpcCalls.filter((c) => c.fn === 'claim_entry_notification_key').map((c) => String(c.params.p_key));
}

beforeEach(() => {
  db.rpcCalls.length = 0;
  db.tableCalls.length = 0;
  push.sent.length = 0;
  side.propagated.length = 0;
  side.broadcasts.length = 0;
  scenario = {
    profile: 'vehicle',
    details: { registration: 'AB-123-CD', country: 'FR', model: 'Peugeot 208' },
    stage: 'in_repair',
    sessionId: SESSION_ID,
    subscriptions: [WEB_PUSH_SUB],
    claimKey: true,
    notified: {},
    status: 'serving',
  };
  install();
});

const vehicleQueue = { profile: 'vehicle' as const, options: { quotes: true } };

/* ------------------------------------------------------------------ */
/* Durées de vie                                                         */
/* ------------------------------------------------------------------ */

describe('ttlSecondsFor', () => {
  it('garde les durées des barbiers', () => {
    expect(ttlSecondsFor('your_turn')).toBe(600);
    expect(ttlSecondsFor('your_turn', 'walkin')).toBe(600);
    expect(ttlSecondsFor('ahead_one', 'walkin')).toBe(900);
    expect(ttlSecondsFor('ahead_two', 'walkin')).toBe(900);
    expect(ttlSecondsFor('visit_completed', 'walkin')).toBe(86_400);
  });

  it('allonge « prêt » en atelier seulement, et fixe les genres nouveaux', () => {
    expect(ttlSecondsFor('your_turn', 'vehicle')).toBe(43_200);
    expect(ttlSecondsFor('your_turn', 'device')).toBe(43_200);
    expect(ttlSecondsFor('your_turn', 'table')).toBe(600);
    expect(ttlSecondsFor('your_turn', 'desk')).toBe(600);
    expect(ttlSecondsFor('quote_ready', 'vehicle')).toBe(86_400);
    expect(ttlSecondsFor('stage_update', 'device')).toBe(43_200);
    expect(ttlSecondsFor('recall', 'table')).toBe(600);
  });
});

describe('reachOf', () => {
  it('ne dit « prévenu » que si un fournisseur a accepté', () => {
    expect(reachOf({ claimed: 1, sent: 1, failed: 0, skipped: 0 })).toBe('sent');
    expect(reachOf({ claimed: 1, sent: 0, failed: 2, skipped: 0 })).toBe('failed');
    expect(reachOf({ claimed: 1, sent: 0, failed: 0, skipped: 1 })).toBe('unreachable');
    expect(reachOf({ claimed: 0, sent: 0, failed: 0, skipped: 0 })).toBe('none');
  });
});

/* ------------------------------------------------------------------ */
/* Envois à clé                                                          */
/* ------------------------------------------------------------------ */

describe('changement d’étape avec « Prévenir »', () => {
  it('réclame stage:<étape>, envoie le texte du métier et prévient l’appareil', async () => {
    const result = await profileStaffAction({
      entryPublicId: PUBLIC_ID,
      action: 'set_stage',
      options: { stage: 'waiting_parts', notify: true },
      queue: vehicleQueue,
    });

    const call = db.rpcCalls.find((c) => c.fn === 'staff_queue_action');
    expect(call?.params.p_options).toEqual({ stage: 'waiting_parts', notify: true });
    expect(keyedClaims()).toEqual(['stage:waiting_parts']);
    expect(side.propagated).toEqual([QUEUE_ID]);
    expect(side.broadcasts).toContainEqual([QUEUE_ID, PUBLIC_ID, 'updated']);

    expect(push.sent).toHaveLength(1);
    const { payload, options } = push.sent[0]!;
    expect(payload.title).toBe('Garage des Tilleuls');
    expect(payload.body).toBe('Une pièce est commandée pour votre Peugeot 208. Nous vous prévenons dès sa réception.');
    expect(payload.kind).toBe('stage_update');
    expect(options.ttlSeconds).toBe(43_200);

    expect(deliveries()).toEqual([expect.objectContaining({ kind: 'stage_update', status: 'sent' })]);
    expect(result.notification).toMatchObject({ kind: 'stage_update', key: 'stage:waiting_parts', reach: 'sent' });
  });

  it('remonte « Non joignable » quand aucun abonnement n’est actif', async () => {
    scenario.subscriptions = [];
    const result = await profileStaffAction({
      entryPublicId: PUBLIC_ID,
      action: 'set_stage',
      options: { stage: 'waiting_parts' },
      queue: vehicleQueue,
    });
    expect(keyedClaims()).toEqual(['stage:waiting_parts']);
    expect(push.sent).toHaveLength(0);
    expect(deliveries()).toEqual([
      expect.objectContaining({ kind: 'stage_update', status: 'skipped', error: 'aucun abonnement push actif' }),
    ]);
    expect(result.notification?.reach).toBe('unreachable');
  });

  it('remonte « Non joignable » pour une fiche créée au comptoir, sans appareil', async () => {
    scenario.sessionId = null;
    const result = await profileStaffAction({
      entryPublicId: PUBLIC_ID,
      action: 'set_stage',
      options: { stage: 'waiting_parts', notify: true },
      queue: vehicleQueue,
    });
    expect(result.notification?.reach).toBe('unreachable');
    expect(push.sent).toHaveLength(0);
  });

  it('suit le défaut de l’étape quand la case n’est pas transmise', async () => {
    // « En réparation » : proposé, non coché.
    const result = await profileStaffAction({
      entryPublicId: PUBLIC_ID,
      action: 'set_stage',
      options: { stage: 'in_repair' },
      queue: vehicleQueue,
    });
    const call = db.rpcCalls.find((c) => c.fn === 'staff_queue_action');
    expect(call?.params.p_options).toEqual({ stage: 'in_repair', notify: false });
    expect(keyedClaims()).toEqual([]);
    expect(push.sent).toHaveLength(0);
    expect(result.notification).toBeNull();
  });

  it('n’envoie rien de plus quand la clé est déjà réclamée (double clic, deux postes)', async () => {
    scenario.claimKey = false;
    const result = await profileStaffAction({
      entryPublicId: PUBLIC_ID,
      action: 'set_stage',
      options: { stage: 'waiting_parts', notify: true },
      queue: vehicleQueue,
    });
    expect(keyedClaims()).toEqual(['stage:waiting_parts']);
    expect(push.sent).toHaveLength(0);
    expect(deliveries()).toEqual([]);
    expect(result.notification?.reach).toBe('none');
  });

  it('refuse une étape étrangère au métier avant tout appel à la base', async () => {
    await expect(profileStaffAction({
      entryPublicId: PUBLIC_ID,
      action: 'set_stage',
      options: { stage: 'preparing', notify: true },
      queue: vehicleQueue,
    })).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(db.rpcCalls).toEqual([]);
  });
});

describe('devis', () => {
  it('part sous quote:<n>, ouvre la carte du devis, sans accord depuis la notification', async () => {
    const result = await profileStaffAction({
      entryPublicId: PUBLIC_ID,
      action: 'send_quote',
      options: { amountCents: 18_400, label: 'Plaquettes + disques AV.' },
      queue: vehicleQueue,
    });
    expect(keyedClaims()).toEqual(['quote:1']);
    const { payload, options } = push.sent[0]!;
    expect(payload.title).toBe('Devis à valider · 184,00 €');
    expect(payload.body).toBe('Plaquettes + disques AV. Touchez pour accepter ou refuser.');
    expect(String(payload.url)).toMatch(/\/e\/garage-des-tilleuls\?src=push&k=quote_ready#devis$/);
    expect(payload.requireInteraction).toBe(true);
    // Une seule action : OUVRIR la page. Jamais « Accepter ».
    expect(payload.actions).toEqual([{ action: 'quote', title: 'Voir le devis', url: payload.url }]);
    expect(options.ttlSeconds).toBe(86_400);
    expect(result.notification).toMatchObject({ kind: 'quote_ready', key: 'quote:1' });
  });

  it('numérote le devis suivant : un devis renvoyé prévient de nouveau', async () => {
    scenario.notified = { quote_count: 1 };
    await profileStaffAction({
      entryPublicId: PUBLIC_ID,
      action: 'send_quote',
      options: { amountCents: 9_900, label: 'Batterie' },
      queue: vehicleQueue,
    });
    expect(keyedClaims()).toEqual(['quote:2']);
  });
});

describe('clés d’envoi', () => {
  const entry = (notified: Record<string, unknown>) =>
    ({ id: PUBLIC_ID, notified } as unknown as Parameters<typeof keyedSendFor>[3]);
  // Même motif que claim_entry_notification_key (0034).
  const SQL_KEY = /^[a-z_]+(:[a-z0-9_]+)?$/;

  it('respectent le motif SQL et le compteur tenu par la base', () => {
    const keys = [
      keyedSendFor('set_stage', 'vehicle', { stage: 'waiting_parts', notify: true }, entry({})),
      keyedSendFor('send_quote', 'vehicle', { notify: true }, entry({ quote_count: 3 })),
      keyedSendFor('recall', 'table', {}, entry({ recall_count: 2 })),
      keyedSendFor('message', 'desk', {}, entry({ custom_count: 7 })),
    ].map((k) => k?.key);
    expect(keys).toEqual(['stage:waiting_parts', 'quote:3', 'recall:2', 'custom:7']);
    for (const key of keys) expect(key).toMatch(SQL_KEY);
  });

  it('laisse « prêt » au balayage de la file (your_turn), et rien sans compteur', () => {
    expect(keyedSendFor('set_stage', 'vehicle', { stage: 'ready', notify: true }, entry({}))).toBeNull();
    expect(keyedSendFor('set_stage', 'vehicle', { stage: 'diagnosis', notify: false }, entry({}))).toBeNull();
    expect(keyedSendFor('recall', 'table', {}, entry({}))).toBeNull();
    expect(keyedSendFor('update_details', 'vehicle', {}, entry({ custom_count: 1 }))).toBeNull();
  });
});

describe('message du pro', () => {
  it('envoie le texte rendu sous custom:<n>, immatriculation masquée même si le pro l’a tapée', async () => {
    const summary = await dispatchKeyedNotification(ENTRY_ID, 'custom', 'custom:4', 'Votre AB 123 CD est prête à l’accueil.');
    expect(keyedClaims()).toEqual(['custom:4']);
    expect(summary.sent).toBe(1);
    expect(push.sent[0]!.payload.body).toBe('Votre ••-••3-CD est prête à l’accueil.');
  });
});

/* ------------------------------------------------------------------ */
/* Confidentialité de l'écran verrouillé                                 */
/* ------------------------------------------------------------------ */

describe('écran verrouillé', () => {
  it('ne montre jamais l’immatriculation complète ni le prénom', async () => {
    for (const [kind, key] of [
      ['stage_update', 'stage:in_repair'],
      ['your_turn', 'stage:ready'],
      ['recall', 'recall:1'],
      ['quote_ready', 'quote:1'],
    ] as const) {
      await dispatchKeyedNotification(ENTRY_ID, kind, key);
    }
    expect(push.sent.length).toBe(4);
    for (const { payload } of push.sent) {
      const text = `${String(payload.title)} ${String(payload.body)}`;
      expect(text).not.toMatch(/AB-?123-?CD/i);
      expect(text).not.toContain('Karim');
    }
    expect(push.sent[1]!.payload.body).toContain('••-••3-CD');
    for (const row of deliveries()) {
      expect(String(row.body)).not.toMatch(/AB-?123-?CD/i);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Barbiers : rien ne change                                             */
/* ------------------------------------------------------------------ */

describe('walkin', () => {
  it('envoie exactement le texte et la durée de vie d’aujourd’hui', async () => {
    scenario.profile = 'walkin';
    scenario.details = {};
    scenario.stage = null;
    await dispatchEntryNotification(ENTRY_ID, 'visit_completed');
    const expected = notificationCopy('visit_completed', { locationName: 'Garage des Tilleuls', peopleAhead: 0, clientName: 'Karim' });
    const { payload, options } = push.sent[0]!;
    expect({ title: payload.title, body: payload.body }).toEqual(expected);
    expect(options).toEqual({ ttlSeconds: 86_400, urgency: 'normal' });
    expect(payload.requireInteraction).toBe(false);
    expect(payload.actions).toEqual([
      { action: 'review', title: 'Laisser un avis Google', url: expect.stringContaining('/api/client/review/click?entry=') },
    ]);
    expect(String(payload.url)).toMatch(/k=visit_completed$/);
  });
});

/* ------------------------------------------------------------------ */
/* Avis différés                                                         */
/* ------------------------------------------------------------------ */

describe('dispatchDueReviews', () => {
  it('livre ce que la base a réclamé, avec le bouton d’avis', async () => {
    scenario.profile = 'table';
    scenario.details = { partySize: 4 };
    scenario.stage = null;
    scenario.status = 'completed';
    const rpc = db.rpc;
    db.rpc = (fn, params) => fn === 'claim_due_review_notifications'
      ? {
          data: [{
            entry_id: ENTRY_ID, entry_public_id: PUBLIC_ID, kind: 'visit_completed', client_session_id: SESSION_ID,
            organization_id: ORG_ID, location_id: LOCATION_ID, client_name: 'Karim', people_ahead: 0, status: 'completed',
          }],
          error: null,
        }
      : rpc(fn, params);
    const summary = await dispatchDueReviews();
    expect(db.rpcCalls.find((c) => c.fn === 'claim_due_review_notifications')?.params).toEqual({ p_limit: 200 });
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
    expect(push.sent[0]!.payload.title).toBe('Merci pour votre visite');
    expect(push.sent[0]!.payload.actions).toEqual([expect.objectContaining({ action: 'review' })]);
  });

  it('ne fait rien quand rien n’est dû', async () => {
    db.rpc = () => ({ data: [], error: null });
    expect(await dispatchDueReviews()).toMatchObject({ claimed: 0, sent: 0 });
    expect(push.sent).toHaveLength(0);
  });

  it('lève l’erreur de la base : le cron doit répondre 500, pas « rien à envoyer »', async () => {
    db.rpc = () => ({ data: null, error: { message: 'connexion perdue' } });
    await expect(dispatchDueReviews()).rejects.toThrow(/connexion perdue/);
  });
});

/* ------------------------------------------------------------------ */
/* Horaires cités par les textes                                         */
/* ------------------------------------------------------------------ */

describe('openingStateAt', () => {
  // Semaine type : 08:30-12:00 puis 14:00-19:00 du lundi au vendredi,
  // samedi matin seulement, dimanche fermé.
  const weekly = [0, 1, 2, 3, 4].flatMap((weekday) => [
    { location_id: LOCATION_ID, weekday, opens_at: '08:30:00', closes_at: '12:00:00', is_closed: false },
    { location_id: LOCATION_ID, weekday, opens_at: '14:00:00', closes_at: '19:00:00', is_closed: false },
  ]).concat([
    { location_id: LOCATION_ID, weekday: 5, opens_at: '09:00:00', closes_at: '12:00:00', is_closed: false },
    { location_id: LOCATION_ID, weekday: 6, opens_at: null, closes_at: null, is_closed: true } as never,
  ]);
  // Jeudi 24 septembre 2026, heure de Paris (UTC+2).
  const at = (hhmm: string, day = '2026-09-24') => new Date(`${day}T${hhmm}:00+02:00`);

  it('dit jusqu’à quand c’est ouvert', () => {
    expect(openingStateAt(at('15:10'), 'Europe/Paris', weekly)).toEqual({ status: 'open', closesAt: '19:00' });
    expect(openingStateAt(at('09:00'), 'Europe/Paris', weekly)).toEqual({ status: 'open', closesAt: '12:00' });
  });

  it('annonce la réouverture du jour, du lendemain, ou du jour ouvert suivant', () => {
    expect(openingStateAt(at('12:30'), 'Europe/Paris', weekly))
      .toEqual({ status: 'closed', reopensAt: '14:00', reopensDay: 'today' });
    expect(openingStateAt(at('19:30'), 'Europe/Paris', weekly))
      .toEqual({ status: 'closed', reopensAt: '08:30', reopensDay: 'tomorrow' });
    // Samedi 13 h : dimanche fermé, réouverture lundi.
    expect(openingStateAt(at('13:00', '2026-09-26'), 'Europe/Paris', weekly))
      .toEqual({ status: 'closed', reopensAt: '08:30', reopensDay: 'lundi' });
  });

  it('respecte une fermeture exceptionnelle, et se tait sans horaires', () => {
    const overrides = [{ location_id: LOCATION_ID, on_date: '2026-09-24', opens_at: null, closes_at: null, is_closed: true }];
    expect(openingStateAt(at('10:00'), 'Europe/Paris', weekly, overrides))
      .toEqual({ status: 'closed', reopensAt: '08:30', reopensDay: 'tomorrow' });
    expect(openingStateAt(at('10:00'), 'Europe/Paris', [])).toBeNull();
  });
});
