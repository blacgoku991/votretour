import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GARDES D'INSCRIPTION — `POST /api/client/join`.
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

vi.mock('@/server/queue', () => ({
  resolveEntryPoint: async () => state.entryPoint,
  joinQueue: async (input: Record<string, unknown>) => {
    state.joinQueue.push(input);
    return { entry: { id: 'Tk7pQ2xWm9Ra' }, rejoined: false, queueId: input.queueId };
  },
  propagate: async () => ({ state: null, notifications: { claimed: 0, sent: 0, failed: 0, skipped: 0, reasons: [] } }),
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
  getOrCreateClientSession: async (organizationId: string, options: unknown) => {
    state.sessions.push({ organizationId, options });
    return { id: 'session-1', issuedToken: 'jeton' };
  },
  sessionCookieName: () => 'vts_org',
  sessionCookieOptions: () => ({ httpOnly: true, path: '/' }),
}));
vi.mock('@/server/ratelimit', () => ({
  LIMITS: { join: { max: 8, window: 300 } },
  enforceRateLimit: async () => undefined,
}));
vi.mock('@/server/realtime', () => ({ broadcastTicketEvent: async () => true }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: () => undefined }) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert: () => ({ then: () => undefined }) }) }),
}));

const { AppError } = await import('@/lib/errors');
const { PROFILES_HEADER, resolveJoinPath } = await import('@/server/profiles/queue');
const { POST } = await import('@/app/api/client/join/route');

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

  it('garde défensive : profil ni ouvert ni activé → servi comme aujourd’hui', async () => {
    const none = vi.fn(async () => null);
    await expect(resolveJoinPath({
      profile: 'vehicle', eventId: null, source: 'qr', profilesHeader: null, loadFeatures: none,
    })).resolves.toEqual({ kind: 'legacy' });
    // Et un ancien App Clip n'est alors pas refusé : la file lui est lisible.
    await expect(resolveJoinPath({
      profile: 'vehicle', eventId: null, source: 'appclip', profilesHeader: null, loadFeatures: none,
    })).resolves.toEqual({ kind: 'legacy' });
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

  it('garde défensive : organisation sans profils, profil non ouvert → parcours d’aujourd’hui', async () => {
    state.entryPoint = entryPoint('table');
    state.features = null;
    const response = await join({ name: 'Karim', details: { partySize: 4 } });
    expect(response.status).toBe(200);
    expect(state.joinProfileQueue).toEqual([]);
    expect(state.joinQueue).toHaveLength(1);
  });
});
