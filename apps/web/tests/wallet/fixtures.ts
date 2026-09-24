import type { WalletSnapshot } from '../../src/server/wallet/types';

/**
 * Instantané de référence, à la forme exacte de wallet_pass_snapshot()
 * (migration 0021). Un « prénom piège » est glissé dans des champs que la
 * vue n'a pas le droit de lire : il ne doit jamais ressortir.
 */

export const TRAP_NAME = 'Zébulon';
export const SITE = 'https://rangvia.test';

type Section<K extends keyof WalletSnapshot> = WalletSnapshot[K] extends object | null
  ? Partial<NonNullable<WalletSnapshot[K]>> | (null extends WalletSnapshot[K] ? null : never)
  : WalletSnapshot[K];
export type Overrides = { [K in keyof WalletSnapshot]?: Section<K> };

export function snapshot(overrides: Overrides = {}): WalletSnapshot {
  const base: WalletSnapshot = {
    pass: {
      id: '7b0f3c1e-2a44-4c1b-9d0e-5f6a7b8c9d01',
      provider: 'apple',
      kind: 'queue',
      externalId: 'q7Kx2mP9vLr4Tz8Wn3Hb5c',
      classRef: 'pass.fr.rangvia.ticket',
      state: 'active',
      live: true,
      holderState: 'saved',
      versionSeq: 12,
      versionAt: '2026-09-24T12:05:00Z',
      contentHash: null,
      syncedHash: null,
      lastSyncedAt: null,
      alerts: {},
      notifyLog: [],
      downloadCount: 1,
      finalAt: null,
      revokedAt: null,
      scrubbedAt: null,
      createdAt: '2026-09-24T12:05:00Z',
    },
    entry: {
      publicId: 'Tk42abcdEFGH',
      status: 'waiting',
      peopleAhead: 6,
      joinedAt: '2026-09-24T12:05:00Z',
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      cancelledAt: null,
      expiredAt: null,
      absentAt: null,
      eventTicketNumber: null,
      staffName: 'Karim',
      statusActor: 'client',
      statusEvent: 'join',
      statusChangedAt: '2026-09-24T12:05:00Z',
    },
    queue: {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'open',
      mode: 'shared',
      notifyAheadThreshold: 2,
      entryTtlMinutes: 240,
    },
    location: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Barber House Bastille',
      slug: 'barber-house-bastille',
      addressLine1: '12 rue de la Roquette',
      addressLine2: null,
      postalCode: '75011',
      city: 'Paris',
      countryCode: 'FR',
      latitude: 48.853,
      longitude: 2.369,
      timezone: 'Europe/Paris',
      logoUrl: `${SITE}/media/org/logo.png`,
      coverUrl: null,
      hasReviewUrl: true,
    },
    organization: {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Barber House',
      logoUrl: null,
      brandAccent: 'signal',
      walletEnabled: true,
      sendCompletionReview: true,
    },
    event: null,
    access: null,
    deliveredKinds: {},
    at: '2026-09-24T12:30:00Z',
  };

  const merged = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) merged[key] = null;
    else if (typeof value === 'object' && !Array.isArray(value) && merged[key] && typeof merged[key] === 'object') {
      merged[key] = { ...(merged[key] as object), ...(value as object) };
    } else merged[key] = value;
  }

  // Le piège : des champs qui n'existent pas dans le contrat.
  (merged.entry as Record<string, unknown>).clientName = TRAP_NAME;
  (merged.entry as Record<string, unknown>).client_name = TRAP_NAME;
  return merged as unknown as WalletSnapshot;
}

export function eventSnapshot(overrides: Overrides = {}): WalletSnapshot {
  return snapshot({
    ...overrides,
    pass: { kind: 'event', ...(overrides.pass ?? {}) },
    entry: { eventTicketNumber: 42, staffName: null, ...(overrides.entry ?? {}) },
    event: overrides.event === null ? null : {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Drop Aurore',
      heroTitle: null,
      logoUrl: null,
      coverUrl: 'https://cdn.example.com/aurore.jpg',
      accentHex: '#18143C',
      rulesText: 'Une paire par personne.',
      status: 'live',
      startedAt: '2026-09-24T10:00:00Z',
      endedAt: null,
      walletQrEnabled: true,
      ...(overrides.event ?? {}),
    },
  });
}
