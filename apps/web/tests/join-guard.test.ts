import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GARDES DES ROUTES CLIENT — `POST /api/client/join`, puis les actions à
 * profil de `POST /api/client/action` (en fin de fichier).
 *
 *  - walkin et event : AUCUNE garde, aucune lecture en plus, et le même
 *    appel `joinQueue` qu'avant les profils, argument pour argument ;
 *  - un ancien App Clip (sans `X-Rangvia-Profiles: 1`) sur une file à
 *    profil : refus explicite `update_required`, qu'il sait afficher ;
 *  - les informations métier sont validées par le schéma STRICT du profil,
 *    avec les réglages COMPLETS de la file, avant de créer la session ;
 *  - garde défensive « profil disponible » : un profil ni ouvert à tous ni
 *    activé pour l'organisation sert la file comme aujourd'hui.
 */

const state = vi.hoisted(() => ({
  entryPoint: null as unknown,
  joinQueue: [] as Record<string, unknown>[],
  joinProfileQueue: [] as Record<string, unknown>[],
  features: null as Record<string, unknown> | null,
  featureReads: 0,
  infoReads: 0,
  sessions: [] as unknown[],
  queueOptions: {} as Record<string, unknown>,
}));

/**
 * Base simulée pour `client_queue_action` et `ticket_state`, avec LEURS
 * règles (0034, 0035) : une session qui ne détient plus la fiche est
 * refusée par VT009, jamais servie par null.
 */
const sql = vi.hoisted(() => ({
  entrySession: 'session-1' as string | null,
  quoteN: 2,
  clientSession: { id: 'session-1' } as { id: string } | null,
  calls: [] as { fn: string; params: Record<string, unknown> }[],
}));
const NOT_YOURS = { code: 'VT009', message: "Ce ticket n'appartient pas à cette session" };

function sqlRpc(fn: string, params: Record<string, unknown>): { data: unknown; error: unknown } {
  sql.calls.push({ fn, params });
  if (sql.entrySession !== params.p_client_session_id) return { data: null, error: NOT_YOURS };
  if (fn === 'ticket_state') {
    return { data: { ticket: { id: params.p_entry_public_id, profile: 'vehicle', stage: 'quote_pending' } }, error: null };
  }
  if (fn !== 'client_queue_action') return { data: null, error: null };
  const options = params.p_options as { quoteN?: number };
  if (params.p_action === 'unfollow') sql.entrySession = null;
  if (String(params.p_action).startsWith('quote_') && options.quoteN !== sql.quoteN) {
    return { data: null, error: { code: 'VT006', message: 'Le devis a changé : relisez-le avant de répondre' } };
  }
  return { data: { entry: { id: params.p_entry_public_id, status: 'serving' }, queueId: 'q' }, error: null };
}

vi.mock('@/server/queue', () => ({
  resolveEntryPoint: async () => state.entryPoint,
  joinQueue: async (input: Record<string, unknown>) => {
    state.joinQueue.push(input);
    return { entry: { id: 'Tk7pQ2xWm9Ra' }, rejoined: false, queueId: input.queueId };
  },
  propagate: async () => ({ state: null, notifications: { claimed: 0, sent: 0, failed: 0, skipped: 0, reasons: [] } }),
  clientAction: async () => { throw new Error('chemin historique inattendu'); },
  getTicketState: async () => null,
}));

vi.mock('@/server/profiles/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/profiles/queue')>();
  return {
    ...actual,
    joinProfileQueue: async (input: Record<string, unknown>) => {
      state.joinProfileQueue.push(input);
      return { entry: { id: 'Pr0f1lE0tIck' }, rejoined: false, queueId: input.queueId };
    },
    loadOrganizationFeatures: async () => {
      state.featureReads += 1;
      return state.features;
    },
    getQueueProfileInfo: async (queueId: string) => {
      state.infoReads += 1;
      const profile = (state.entryPoint as { queue: { profile: string } }).queue.profile;
      return { queueId, organizationId: 'org', locationId: 'loc', profile, options: state.queueOptions, clientNameRequired: false };
    },
  };
});

vi.mock('@/server/client-session', () => ({
  requestFingerprint: async () => ({ ip: null, ipHash: 'ip', uaHash: null }),
  detectPlatform: async () => 'web',
  getClientSession: async () => sql.clientSession,
  getOrCreateClientSession: async (organizationId: string, options: unknown) => {
    state.sessions.push({ organizationId, options });
    return { id: 'session-1', issuedToken: 'jeton' };
  },
  sessionCookieName: () => 'vts_org',
  sessionCookieOptions: () => ({ httpOnly: true, path: '/' }),
}));
vi.mock('@/server/ratelimit', () => ({
  LIMITS: { join: { max: 8, window: 300 }, clientAction: { max: 40, window: 300 } },
  enforceRateLimit: async () => undefined,
}));
vi.mock('@/server/realtime', () => ({ broadcastTicketEvent: async () => true }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: () => undefined }) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ insert: () => ({ then: () => undefined }) }),
    rpc: async (fn: string, params: Record<string, unknown>) => sqlRpc(fn, params),
  }),
}));

const { AppError } = await import('@/lib/errors');
const { PROFILES_HEADER, resolveJoinPath } = await import('@/server/profiles/queue');
const { POST } = await import('@/app/api/client/join/route');
const { POST: ACTION } = await import('@/app/api/client/action/route');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUEUE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function entryPoint(profile: string, publicOptions: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    slug: 'plaque',
    organization: { id: ORG, name: 'Commerce', activity: 'other', logoUrl: null },
    location: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Commerce', slug: 'commerce', timezone: 'Europe/Paris' },
    plate: null,
    queue: {
      id: QUEUE, name: 'File', mode: 'shared', status: 'open', askClientName: true, clientNameRequired: false,
      allowStaffChoice: false, allowServiceChoice: false, pauseReason: null, waitingCount: 0,
      profile, publicOptions,
    },
  };
}

function join(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return POST(new Request('https://rangvia.test/api/client/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ slug: 'plaque', ...body }),
  }));
}

beforeEach(() => {
  state.joinQueue.length = 0;
  state.joinProfileQueue.length = 0;
  state.sessions.length = 0;
  state.featureReads = 0;
  state.infoReads = 0;
  state.features = { profiles: true };
  state.queueOptions = { registrationRequired: true, stayChoice: true, quotes: true };
  state.entryPoint = entryPoint('walkin');
});

/* ------------------------------------------------------------------ */
/* resolveJoinPath                                                       */
/* ------------------------------------------------------------------ */

describe('resolveJoinPath', () => {
  const features = vi.fn(async () => ({ profiles: true }) as Record<string, unknown> | null);
  beforeEach(() => features.mockClear());

  it('walkin et event : aucune garde, aucune lecture, même depuis un ancien App Clip', async () => {
    for (const profile of ['walkin', 'event', null, undefined, 'inconnu']) {
      await expect(resolveJoinPath({
        profile, eventId: null, source: 'appclip', profilesHeader: null, loadFeatures: features,
      })).resolves.toEqual({ kind: 'legacy' });
    }
    expect(features).not.toHaveBeenCalled();
  });

  it('une campagne d’événement garde son parcours, quel que soit le profil', async () => {
    await expect(resolveJoinPath({
      profile: 'vehicle', eventId: 'evt', source: 'appclip', profilesHeader: null, loadFeatures: features,
    })).resolves.toEqual({ kind: 'legacy' });
    expect(features).not.toHaveBeenCalled();
  });

  it('ancien App Clip sur une file à profil : update_required', async () => {
    const attempt = resolveJoinPath({
      profile: 'vehicle', eventId: null, source: 'appclip', profilesHeader: null, loadFeatures: features,
    });
    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(resolveJoinPath({
      profile: 'table', eventId: null, source: 'appclip', profilesHeader: '0', loadFeatures: features,
    })).rejects.toMatchObject({
      code: 'update_required',
      status: 426,
      message: 'Mettez à jour l’App Clip ou ouvrez le suivi dans Safari.',
    });
  });

  it('nouvel App Clip (X-Rangvia-Profiles: 1) et navigateur : parcours du profil', async () => {
    expect(PROFILES_HEADER).toBe('x-rangvia-profiles');
    await expect(resolveJoinPath({
      profile: 'vehicle', eventId: null, source: 'appclip', profilesHeader: '1', loadFeatures: features,
    })).resolves.toEqual({ kind: 'profile', profile: 'vehicle' });
    await expect(resolveJoinPath({
      profile: 'desk', eventId: null, source: 'nfc', profilesHeader: null, loadFeatures: features,
    })).resolves.toEqual({ kind: 'profile', profile: 'desk' });
  });

  it('métiers ouverts à tous : une file à métier est servie dans son parcours, même sans la clé features', async () => {
    // Le métier d'une file n'est posé que par l'équipe (super-admin) : il
    // n'y a plus de profil « ni ouvert ni activé » à protéger.
    const none = vi.fn(async () => null);
    await expect(resolveJoinPath({
      profile: 'vehicle', eventId: null, source: 'qr', profilesHeader: null, loadFeatures: none,
    })).resolves.toEqual({ kind: 'profile', profile: 'vehicle' });
  });
});

/* ------------------------------------------------------------------ */
/* La route                                                              */
/* ------------------------------------------------------------------ */

describe('POST /api/client/join', () => {
  it('walkin : exactement l’appel d’aujourd’hui, sans lecture de plus', async () => {
    const response = await join({ name: 'Karim', source: 'qr', details: { registration: 'AB-123-CD' } });
    expect(response.status).toBe(200);
    expect(state.joinProfileQueue).toEqual([]);
    expect(state.joinQueue).toEqual([{
      queueId: QUEUE,
      clientSessionId: 'session-1',
      clientName: 'Karim',
      staffId: null,
      serviceId: null,
      source: 'qr',
      plateId: null,
    }]);
    expect(state.featureReads).toBe(0);
    expect(state.infoReads).toBe(0);
  });

  it('walkin depuis un ancien App Clip : aucune garde', async () => {
    const response = await join({ source: 'appclip' });
    expect(response.status).toBe(200);
    expect(state.joinQueue).toHaveLength(1);
  });

  it('ancien App Clip sur un atelier : 426 update_required, sans session créée', async () => {
    state.entryPoint = entryPoint('vehicle');
    const response = await join({ source: 'appclip', details: { registration: 'AB-123-CD' } });
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ ok: false, code: 'update_required' });
    expect(state.sessions).toEqual([]);
    expect(state.joinQueue).toEqual([]);
    expect(state.joinProfileQueue).toEqual([]);
  });

  it('atelier : détails validés et normalisés, puis joinProfileQueue', async () => {
    state.entryPoint = entryPoint('vehicle');
    const response = await join(
      { source: 'appclip', details: { registration: 'ab 123 cd', model: '  Peugeot 208 ', stay: 'away' } },
      { 'X-Rangvia-Profiles': '1' },
    );
    expect(response.status).toBe(200);
    expect(state.joinQueue).toEqual([]);
    expect(state.joinProfileQueue).toEqual([expect.objectContaining({
      queueId: QUEUE,
      details: { registration: 'AB-123-CD', country: 'FR', model: 'Peugeot 208', stay: 'away' },
    })]);
  });

  it('refuse une clé que le client n’a pas le droit de poser, avant toute session', async () => {
    state.entryPoint = entryPoint('vehicle');
    for (const details of [
      { registration: 'AB-123-CD', keys: true },
      { registration: 'AB-123-CD', quote: { amountCents: 1 } },
      { registration: 'AB-123-CD', code: '0000' },
    ]) {
      const response = await join({ details });
      expect(response.status, JSON.stringify(details)).toBe(422);
      expect((await response.json()).code).toBe('invalid_details');
    }
    expect(state.sessions).toEqual([]);
    // Un refus générique de zod arrive en français chez le client.
    const response = await join({ details: { registration: 'AB-123-CD', keys: true } });
    expect((await response.json()).error).toBe('Information non prévue ici : «\u00a0keys\u00a0».');
  });

  it('lit les réglages complets : sans immatriculation exigée, le dépôt passe', async () => {
    state.entryPoint = entryPoint('vehicle');
    expect((await join({ details: { model: 'Clio' } })).status).toBe(422);
    state.queueOptions = { registrationRequired: false };
    expect((await join({ details: { model: 'Clio' } })).status).toBe(200);
    expect(state.infoReads).toBe(2);
  });

  it('santé : ni prénom ni texte libre, pas même sur la session', async () => {
    state.entryPoint = entryPoint('desk', { sensitive: true });
    state.queueOptions = { sensitive: true, numbering: true };
    const response = await join({ name: 'Jeanne', details: {} });
    expect(response.status).toBe(200);
    expect(state.joinProfileQueue).toEqual([expect.objectContaining({ clientName: null, details: {} })]);
    expect(state.sessions).toEqual([{ organizationId: ORG, options: expect.objectContaining({ displayName: null }) }]);
  });

  it('file à métier attribuée, organisation sans clé features : parcours du métier', async () => {
    state.entryPoint = entryPoint('table');
    state.features = null;
    const response = await join({ name: 'Karim', details: { partySize: 4 } });
    expect(response.status).toBe(200);
    expect(state.joinQueue).toEqual([]);
    expect(state.joinProfileQueue).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Actions à profil : POST /api/client/action                            */
/* ------------------------------------------------------------------ */

describe('POST /api/client/action (profils)', () => {
  const ENTRY = 'Tk7pQ2xWm9Ra';

  function act(body: Record<string, unknown>) {
    return ACTION(new Request('https://rangvia.test/api/client/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: ORG, entryId: ENTRY, ...body }),
    }));
  }

  beforeEach(() => {
    sql.entrySession = 'session-1';
    sql.quoteN = 2;
    sql.clientSession = { id: 'session-1' };
    sql.calls.length = 0;
  });

  it('« Ne plus suivre » répond 200, ticket null, sans relire une fiche détachée', async () => {
    const response = await act({ action: 'unfollow' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { entry: { id: ENTRY, status: 'serving' }, ticket: null } });
    expect(sql.entrySession).toBeNull();
    // Relire la fiche aurait levé VT009 : la route ne le tente même pas.
    expect(sql.calls.map((c) => c.fn)).toEqual(['client_queue_action']);
  });

  it('accord du devis lu : 200, puis la fiche relue par l’appareil', async () => {
    const response = await act({ action: 'quote_accept', quoteN: 2 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { ticket: { ticket: { id: ENTRY } } } });
    expect(sql.calls.map((c) => [c.fn, c.params.p_options ?? null])).toEqual([
      ['client_queue_action', { quoteN: 2 }],
      ['ticket_state', null],
    ]);
  });

  it('décision sans numéro de devis : 422, sans appeler la base', async () => {
    for (const action of ['quote_accept', 'quote_decline']) {
      const response = await act({ action });
      expect(response.status, action).toBe(422);
      expect(await response.json()).toMatchObject({ ok: false, code: 'validation', error: 'Devis inconnu : rechargez la page.' });
    }
    expect(sql.calls).toEqual([]);
  });

  it('devis renvoyé entre-temps : 409 quote_changed, pour que l’écran le relise', async () => {
    const response = await act({ action: 'quote_decline', quoteN: 1 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'quote_changed', error: 'Le devis a changé : relisez-le avant de répondre.' });
  });

  it('sans session sur cet appareil : 403, rien n’est tenté', async () => {
    sql.clientSession = null;
    expect((await act({ action: 'unfollow' })).status).toBe(403);
    expect(sql.calls).toEqual([]);
  });
});
