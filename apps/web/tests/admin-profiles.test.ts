import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ATTRIBUTION DU MÉTIER PAR LE SUPER-ADMIN — `server/actions/admin-profiles.ts`.
 *
 * Décision du propriétaire : seul le super-admin attribue le métier d'une
 * file ; le commerçant ne le choisit ni ne le change.
 *  - un compte qui n'est pas super-admin est refusé AVANT toute lecture,
 *    tout appel SQL et toute écriture (propriétaire de l'organisation
 *    compris) ;
 *  - le super-admin attribue n'importe lequel des sept métiers, sans garde
 *    d'ouverture (`OPEN_PROFILES`) ni `features.profiles` préalable ;
 *  - le refus VT017 se lit en clair : « La file doit être vide avant de
 *    changer de métier. », et ne laisse aucune trace d'attribution ;
 *  - l'attribution écrit `queue.profile_assigned`, acteur `platform_admin`,
 *    et pose `features.profiles` (sans toucher aux autres clés) pour qu'un
 *    métier hors passage soit servi tant qu'il n'est pas ouvert à tous.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const LOC = '33333333-3333-4333-8333-333333333333';
const Q_GARAGE = '44444444-4444-4444-8444-444444444444';
const Q_FOREIGN = '55555555-5555-4555-8555-555555555555';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as { fn: string; params: Row }[],
  rpcResult: { data: null as unknown, error: null as unknown },
  writes: [] as { table: string; values?: Row; filters: [string, unknown][] }[],
  reads: 0,
  audits: [] as Row[],
  revalidated: [] as string[],
  isPlatformAdmin: true,
}));

function builder(table: string) {
  const filters: [string, unknown][] = [];
  let values: Row | undefined;
  let op: 'select' | 'update' = 'select';
  const rows = () => (db.tables[table] ?? []).filter((r) => filters.every(([k, v]) => (r[k] ?? null) === v));
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
    update: (v: Row) => { op = 'update'; values = v; return q; },
    maybeSingle: async () => { db.reads += 1; return { data: rows()[0] ?? null, error: null }; },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      if (op === 'update') db.writes.push({ table, values, filters: [...filters] });
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    },
  };
  return q;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => builder(table),
    rpc: async (fn: string, params: Row) => {
      db.rpcCalls.push({ fn, params });
      return db.rpcResult;
    },
  }),
}));

vi.mock('@/server/auth', async () => {
  const { AppError } = await import('@/lib/errors');
  return {
    assertPlatformAdmin: async () => {
      if (!db.isPlatformAdmin) throw new AppError('forbidden', 'Réservé à l\'administration de la plateforme.', 403);
      return { id: ADMIN, email: 'equipe@rangvia.test', fullName: 'Équipe', avatarUrl: null, isPlatformAdmin: true };
    },
  };
});

vi.mock('@/server/audit', () => ({
  audit: async (entry: Row) => { db.audits.push(entry); },
}));

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => { db.revalidated.push(path); } }));

const { assignQueueProfile } = await import('@/server/actions/admin-profiles');

beforeEach(() => {
  db.tables = {
    queues: [
      { id: Q_GARAGE, organization_id: ORG, location_id: LOC, profile: 'walkin' },
      { id: Q_FOREIGN, organization_id: OTHER_ORG, location_id: LOC, profile: 'walkin' },
    ],
    organization_settings: [{ organization_id: ORG, features: { wallet: true } }],
    organizations: [{ id: ORG, slug: 'garage-martin' }],
  };
  db.rpcCalls = [];
  db.rpcResult = {
    data: {
      queueId: Q_GARAGE, profile: 'vehicle', previousProfile: 'walkin', changed: true,
      settingsRestored: false, servicesCreated: 7, servicesRetired: 0,
    },
    error: null,
  };
  db.writes = [];
  db.reads = 0;
  db.audits = [];
  db.revalidated = [];
  db.isPlatformAdmin = true;
});

describe('super-admin seulement', () => {
  it('refuse tout compte qui n’est pas super-admin, avant toute lecture, tout appel et toute écriture', async () => {
    db.isPlatformAdmin = false;
    const r = await assignQueueProfile({ organizationId: ORG, queueId: Q_GARAGE, profile: 'vehicle' });
    expect(r).toMatchObject({ ok: false, code: 'forbidden' });
    expect(db.reads).toBe(0);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.writes).toHaveLength(0);
    expect(db.audits).toHaveLength(0);
  });
});

describe('attribution', () => {
  it('attribue l’atelier véhicule : switch_queue_profile avec l’auteur, features.profiles posé, audit platform_admin', async () => {
    const r = await assignQueueProfile({ organizationId: ORG, queueId: Q_GARAGE, profile: 'vehicle' });
    expect(r).toEqual({
      ok: true,
      data: {
        profile: 'vehicle', previousProfile: 'walkin', changed: true,
        settingsRestored: false, servicesCreated: 7, servicesRetired: 0,
      },
    });
    expect(db.rpcCalls).toEqual([
      { fn: 'switch_queue_profile', params: { p_queue_id: Q_GARAGE, p_profile: 'vehicle', p_actor_user_id: ADMIN } },
    ]);
    // Les autres clés de features sont gardées.
    expect(db.writes).toEqual([
      {
        table: 'organization_settings',
        values: { features: { wallet: true, profiles: true } },
        filters: [['organization_id', ORG]],
      },
    ]);
    expect(db.audits).toEqual([
      {
        organizationId: ORG,
        actor: 'platform_admin',
        actorUserId: ADMIN,
        action: 'queue.profile_assigned',
        targetType: 'queue',
        targetId: Q_GARAGE,
        metadata: {
          from: 'walkin', to: 'vehicle', changed: true,
          settingsRestored: false, servicesCreated: 7, servicesRetired: 0,
        },
      },
    ]);
    expect(db.revalidated).toContain(`/admin/etablissements/${ORG}`);
    expect(db.revalidated).toContain('/app/garage-martin/reglages');
    expect(db.revalidated).toContain('/app/garage-martin/file');
  });

  it('attribue n’importe lequel des sept métiers, sans garde d’ouverture ni features préalable', async () => {
    db.tables.organization_settings = [{ organization_id: ORG, features: {} }];
    for (const profile of ['walkin', 'vehicle', 'device', 'table', 'desk', 'retail', 'event'] as const) {
      db.rpcResult = {
        data: { profile, previousProfile: 'walkin', changed: true, settingsRestored: false, servicesCreated: 0, servicesRetired: 0 },
        error: null,
      };
      const r = await assignQueueProfile({ organizationId: ORG, queueId: Q_GARAGE, profile });
      expect(r.ok).toBe(true);
    }
    expect(db.rpcCalls.map((c) => c.params.p_profile)).toEqual(['walkin', 'vehicle', 'device', 'table', 'desk', 'retail', 'event']);
  });

  it('un retour au passage ne pose pas features.profiles', async () => {
    db.rpcResult = {
      data: { profile: 'walkin', previousProfile: 'vehicle', changed: true, settingsRestored: true, servicesCreated: 0, servicesRetired: 6 },
      error: null,
    };
    const r = await assignQueueProfile({ organizationId: ORG, queueId: Q_GARAGE, profile: 'walkin' });
    expect(r).toMatchObject({ ok: true, data: { profile: 'walkin', settingsRestored: true, servicesRetired: 6 } });
    expect(db.writes).toHaveLength(0);
    expect(db.audits[0]).toMatchObject({ action: 'queue.profile_assigned', metadata: { from: 'vehicle', to: 'walkin' } });
  });

  it('features.profiles déjà posé : rien n’est réécrit', async () => {
    db.tables.organization_settings = [{ organization_id: ORG, features: { profiles: true } }];
    await assignQueueProfile({ organizationId: ORG, queueId: Q_GARAGE, profile: 'vehicle' });
    expect(db.writes).toHaveLength(0);
  });
});

describe('refus', () => {
  it('VT017 : « La file doit être vide avant de changer de métier. », sans trace ni features', async () => {
    db.rpcResult = { data: null, error: { code: 'VT017', message: 'Terminez ou videz la file avant de changer de profil' } };
    const r = await assignQueueProfile({ organizationId: ORG, queueId: Q_GARAGE, profile: 'table' });
    expect(r).toEqual({
      ok: false,
      code: 'queue_not_empty',
      error: 'La file doit être vide avant de changer de métier.',
    });
    expect(db.writes).toHaveLength(0);
    expect(db.audits).toHaveLength(0);
  });

  it('répond « introuvable » pour une file d’une autre organisation, sans appeler la base', async () => {
    const r = await assignQueueProfile({ organizationId: ORG, queueId: Q_FOREIGN, profile: 'vehicle' });
    expect(r).toMatchObject({ ok: false, code: 'not_found' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('refuse un métier inconnu, un identifiant invalide et une clé en trop', async () => {
    const results = await Promise.all([
      assignQueueProfile({ organizationId: ORG, queueId: Q_GARAGE, profile: 'spa' as never }),
      assignQueueProfile({ organizationId: 'org', queueId: Q_GARAGE, profile: 'vehicle' }),
      assignQueueProfile({ organizationId: ORG, queueId: Q_GARAGE, profile: 'vehicle', force: true } as never),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, code: 'validation' });
    expect(db.rpcCalls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* « Métier à activer » : la règle partagée (liste, vue d'ensemble,     */
/* fiche d'un établissement)                                            */
/* ------------------------------------------------------------------ */

const { ACTIVITIES_WITH_METIER, metierToActivate, metiersToActivate } = await import('@/app/admin/etablissements/metier-pending');

describe('métier à activer', () => {
  it('une activité à métier propre sans aucune file dans ce métier : à activer', () => {
    expect(metierToActivate('garage', ['walkin'])).toBe('vehicle');
    expect(metierToActivate('auto_center', [])).toBe('vehicle');
    expect(metierToActivate('phone_repair', ['walkin', 'walkin'])).toBe('device');
    expect(metierToActivate('restaurant', ['walkin'])).toBe('table');
    expect(metierToActivate('health', ['walkin'])).toBe('desk');
    expect(metierToActivate('admin_service', ['walkin'])).toBe('desk');
    expect(metierToActivate('shop', ['walkin'])).toBe('retail');
    // Un autre métier que celui de l'activité n'éteint pas le signal.
    expect(metierToActivate('garage', ['table'])).toBe('vehicle');
  });

  it('dès qu’une file est dans le métier : plus rien, même si d’autres restent au passage', () => {
    expect(metierToActivate('garage', ['walkin', 'vehicle'])).toBeNull();
    expect(metierToActivate('health', ['desk'])).toBeNull();
  });

  it('jamais pour un barbier, un salon, « Autre », un événement ou une activité inconnue', () => {
    for (const activity of ['barber', 'hair_salon', 'nail_bar', 'beauty', 'other', 'event', 'spa', null, undefined, '__proto__']) {
      expect(metierToActivate(activity, ['walkin'])).toBeNull();
    }
    expect([...ACTIVITIES_WITH_METIER].sort()).toEqual(
      ['admin_service', 'aftersales', 'auto_center', 'counter', 'garage', 'health', 'phone_repair', 'restaurant', 'shop'],
    );
  });

  it('pour une liste d’organisations, les files des autres organisations sont ignorées', () => {
    const pending = metiersToActivate(
      [
        { id: 'g1', activity: 'garage' },
        { id: 'g2', activity: 'garage' },
        { id: 'b1', activity: 'barber' },
        { id: 'r1', activity: 'restaurant' },
      ],
      [
        { organization_id: 'g1', profile: 'walkin' },
        { organization_id: 'g2', profile: 'vehicle' },
        { organization_id: 'x9', profile: 'table' },
      ],
    );
    expect([...pending.entries()]).toEqual([['g1', 'vehicle'], ['r1', 'table']]);
  });

  it('la tuile de la vue d’ensemble : compteur, noms, lien vers la liste filtrée', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { MetiersToActivateCard } = await import('@/app/admin/etablissements/MetiersToActivate');
    const html = renderToStaticMarkup(createElement(MetiersToActivateCard, {
      data: { count: 4, names: ['Garage 92', 'Chez Paul', 'Labo Voltaire'] },
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(html).toContain('href="/admin/etablissements?metier=a-activer"');
    expect(html).toContain('data-waiting="1"');
    expect(text).toContain('Métiers à activer');
    expect(text).toContain('Garage 92 · Chez Paul · Labo Voltaire et 1 autre attendent l’interface de leur métier.');
    const one = renderToStaticMarkup(createElement(MetiersToActivateCard, { data: { count: 1, names: ['Garage 92'] } }));
    expect(one.replace(/<[^>]+>/g, ' ')).toContain('Garage 92 attend l’interface de son métier.');
    const none = renderToStaticMarkup(createElement(MetiersToActivateCard, { data: { count: 0, names: [] } }));
    expect(none).not.toContain('data-waiting');
  });
});

/* ------------------------------------------------------------------ */
/* La confirmation du super-admin : ce qu'elle dit avant               */
/* ------------------------------------------------------------------ */

const { assignSummary } = await import('@/app/admin/etablissements/[id]/MetierPanel');

describe('confirmation d’attribution', () => {
  const labelOf = (p: string) => p;

  it('santé → guichet : dit « ni prénom… ni avis », sans alerte de sensibilité', () => {
    const r = assignSummary({ from: 'walkin', to: 'desk', activity: 'health', fromOptions: { review: false }, labelOf });
    expect(r.lines.join(' ')).toContain('Santé : ni prénom demandé, ni nom à l’écran, ni demande d’avis Google par défaut.');
    expect(r.healthMismatch).toBe(false);
    expect(r.reviewDropped).toBe(false);
  });

  it('avis demandés à l’inscription puis coupés par le guichet : l’équipe le lit avant', () => {
    for (const activity of ['health', 'admin_service']) {
      expect(assignSummary({ from: 'walkin', to: 'desk', activity, fromOptions: { review: true }, labelOf }).reviewDropped).toBe(true);
    }
    // Un métier qui garde l'avis ne dit rien.
    expect(assignSummary({ from: 'walkin', to: 'retail', activity: 'health', fromOptions: { review: true }, labelOf }).reviewDropped).toBe(false);
    // Sans choix explicite, rien à dire.
    expect(assignSummary({ from: 'walkin', to: 'desk', activity: 'health', fromOptions: {}, labelOf }).reviewDropped).toBe(false);
  });

  it('un guichet pour une organisation qui n’a pas déclaré un guichet : données de santé NON, dit avant', () => {
    expect(assignSummary({ from: 'walkin', to: 'desk', activity: 'other', fromOptions: {}, labelOf }).healthMismatch).toBe(true);
    expect(assignSummary({ from: 'walkin', to: 'desk', activity: 'barber', fromOptions: {}, labelOf }).healthMismatch).toBe(true);
    for (const activity of ['health', 'admin_service', 'counter']) {
      expect(assignSummary({ from: 'walkin', to: 'desk', activity, fromOptions: {}, labelOf }).healthMismatch).toBe(false);
    }
    expect(assignSummary({ from: 'walkin', to: 'vehicle', activity: 'other', fromOptions: {}, labelOf }).healthMismatch).toBe(false);
  });
});
