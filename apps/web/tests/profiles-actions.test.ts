import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RÉGLAGES DES PROFILS MÉTIER — `server/actions/profiles.ts` et la borne
 * du TTL de `server/actions/settings.ts`.
 *
 *  - chaque action exige `queue.configure` : un simple membre est refusé
 *    AVANT toute lecture ou écriture ;
 *  - un profil ni ouvert à tous (`OPEN_PROFILES`) ni activé pour
 *    l'organisation (`features.profiles`) est refusé ; revenir au passage
 *    au fauteuil ne l'est jamais ;
 *  - une file, une fiche ou un modèle d'un autre commerce répond
 *    « introuvable » ;
 *  - VT017 (« Terminez ou videz la file avant de changer de profil »)
 *    revient tel quel, et la réponse dit si les réglages d'avant sont
 *    rétablis ;
 *  - chaque écriture laisse une trace d'audit (le changement de profil,
 *    lui, l'écrit en SQL : l'acteur est transmis à la fonction).
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const LOC = '33333333-3333-4333-8333-333333333333';
const Q_WALKIN = '44444444-4444-4444-8444-444444444444';
const Q_VEHICLE = '55555555-5555-4555-8555-555555555555';
const Q_FOREIGN = '66666666-6666-4666-8666-666666666666';
const Q_DESK = '77777777-7777-4777-8777-777777777777';
const STAFF = '88888888-8888-4888-8888-888888888888';
const STAFF_FOREIGN = '99999999-9999-4999-8999-999999999999';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as { fn: string; params: Row }[],
  rpcResult: { data: null as unknown, error: null as unknown },
  writes: [] as { table: string; op: 'update' | 'insert' | 'delete'; values?: Row; filters: [string, unknown][] }[],
  reads: 0,
  features: null as Row | null,
  role: 'owner' as 'owner' | 'admin' | 'manager' | 'member',
  audits: [] as Row[],
}));

/** Constructeur de requêtes minimal : filtres eq/is, lecture, écriture. */
function builder(table: string) {
  const filters: [string, unknown][] = [];
  let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  let values: Row | undefined;
  const rows = () => (db.tables[table] ?? []).filter((r) => filters.every(([k, v]) => (r[k] ?? null) === v));
  const run = () => {
    if (op === 'select') {
      db.reads += 1;
      return { data: rows(), error: null };
    }
    db.writes.push({ table, op, values, filters: [...filters] });
    return { data: null, error: null };
  };
  const q = {
    select: () => q,
    order: () => q,
    limit: () => q,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
    is: (k: string, v: unknown) => { filters.push([k, v]); return q; },
    update: (v: Row) => { op = 'update'; values = v; return q; },
    insert: (v: Row) => { op = 'insert'; values = v; return q; },
    delete: () => { op = 'delete'; return q; },
    maybeSingle: async () => {
      db.reads += 1;
      return { data: rows()[0] ?? null, error: null };
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
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
  const can = (p: string) => db.role !== 'member' || p === 'queue.operate';
  return {
    requireOrgAccess: async (slug: string, permission?: string) => {
      if (slug !== 'garage-demo') throw new AppError('not_found', 'Organisation introuvable.', 404);
      if (permission && !can(permission)) throw new AppError('forbidden', 'Votre rôle ne permet pas cette action.', 403);
      return { user: { id: USER }, organization: { organization_id: ORG, slug }, role: db.role, can };
    },
    assertQueueAccess: async (queueId: string, permission: string) => {
      if (!can(permission)) throw new AppError('forbidden', 'Votre rôle ne permet pas cette action.', 403);
      const q = (db.tables.queues ?? []).find((r) => r.id === queueId);
      if (!q) throw new AppError('not_found', 'File introuvable.', 404);
      return { user: { id: USER }, role: db.role, organizationId: q.organization_id, locationId: q.location_id };
    },
    assertOrgMembership: async () => ({ user: { id: USER }, role: db.role }),
  };
});

vi.mock('@/server/audit', () => ({
  audit: async (entry: Row) => { db.audits.push(entry); },
}));

vi.mock('@/server/profiles/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/profiles/queue')>();
  return { frenchIssues: actual.frenchIssues, loadOrganizationFeatures: async () => db.features };
});

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { switchQueueProfile, updateProfileOptions, upsertMessageTemplate, deleteMessageTemplate, setDeskLabel } =
  await import('@/server/actions/profiles');
const { updateQueueSettings } = await import('@/server/actions/settings');

beforeEach(() => {
  db.tables = {
    queues: [
      { id: Q_WALKIN, organization_id: ORG, location_id: LOC, profile: 'walkin', profile_options: {}, ticket_prefix: 'A' },
      {
        id: Q_VEHICLE, organization_id: ORG, location_id: LOC, profile: 'vehicle',
        profile_options: { quotes: true, tvRegistration: 'masked' }, ticket_prefix: 'A',
      },
      { id: Q_DESK, organization_id: ORG, location_id: LOC, profile: 'desk', profile_options: { numbering: true }, ticket_prefix: 'A' },
      { id: Q_FOREIGN, organization_id: OTHER_ORG, location_id: LOC, profile: 'walkin', profile_options: {}, ticket_prefix: 'A' },
    ],
    staff: [
      { id: STAFF, organization_id: ORG, location_id: LOC },
      { id: STAFF_FOREIGN, organization_id: OTHER_ORG, location_id: LOC },
    ],
    locations: [{ id: LOC, organization_id: ORG }],
    message_templates: [],
  };
  db.rpcCalls = [];
  db.rpcResult = {
    data: {
      queueId: Q_WALKIN, profile: 'vehicle', previousProfile: 'walkin', changed: true,
      settingsRestored: false, servicesCreated: 7, servicesRetired: 0,
    },
    error: null,
  };
  db.writes = [];
  db.reads = 0;
  db.features = null;
  db.role = 'owner';
  db.audits = [];
});

/* ------------------------------------------------------------------ */
/* Permission                                                           */
/* ------------------------------------------------------------------ */

describe('permission queue.configure', () => {
  it('refuse chaque action à un simple membre, avant toute lecture ni écriture', async () => {
    db.role = 'member';
    db.features = { profiles: true };
    const results = await Promise.all([
      switchQueueProfile('garage-demo', { queueId: Q_WALKIN, profile: 'vehicle' }),
      updateProfileOptions('garage-demo', { queueId: Q_VEHICLE, options: { quotes: false } }),
      upsertMessageTemplate('garage-demo', { profile: 'vehicle', label: 'Clés', body: 'Vos clés sont à l’accueil.' }),
      deleteMessageTemplate('garage-demo', { profile: 'vehicle', key: 'cles' }),
      setDeskLabel('garage-demo', { staffId: STAFF, label: 'Guichet 3' }),
    ]);
    for (const r of results) {
      expect(r).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect(db.reads).toBe(0);
    expect(db.writes).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.audits).toHaveLength(0);
  });

  it('accepte un responsable (manager), qui règle la file sans gérer l’établissement', async () => {
    db.role = 'manager';
    db.features = { profiles: true };
    const r = await switchQueueProfile('garage-demo', { queueId: Q_WALKIN, profile: 'vehicle' });
    expect(r.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Profil non ouvert                                                    */
/* ------------------------------------------------------------------ */

describe('profil non ouvert', () => {
  it('refuse de passer une file dans un profil ni ouvert ni activé pour l’organisation', async () => {
    const r = await switchQueueProfile('garage-demo', { queueId: Q_WALKIN, profile: 'vehicle' });
    expect(r).toMatchObject({ ok: false, code: 'profile_unavailable' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('l’accepte dès que features.profiles est posé (banc local, organisation activée)', async () => {
    db.features = { profiles: true };
    const r = await switchQueueProfile('garage-demo', { queueId: Q_WALKIN, profile: 'vehicle' });
    expect(r.ok).toBe(true);
    expect(db.rpcCalls).toEqual([
      { fn: 'switch_queue_profile', params: { p_queue_id: Q_WALKIN, p_profile: 'vehicle', p_actor_user_id: USER } },
    ]);
  });

  it('ne bloque jamais le retour au passage au fauteuil', async () => {
    db.rpcResult = {
      data: { profile: 'walkin', previousProfile: 'vehicle', changed: true, settingsRestored: true, servicesCreated: 0, servicesRetired: 7 },
      error: null,
    };
    const r = await switchQueueProfile('garage-demo', { queueId: Q_VEHICLE, profile: 'walkin' });
    expect(r).toEqual({
      ok: true,
      data: { profile: 'walkin', previousProfile: 'vehicle', changed: true, settingsRestored: true, servicesCreated: 0, servicesRetired: 7 },
    });
  });

  it('refuse aussi les options, les messages et les guichets d’un profil non ouvert', async () => {
    const results = await Promise.all([
      updateProfileOptions('garage-demo', { queueId: Q_VEHICLE, options: { quotes: false } }),
      upsertMessageTemplate('garage-demo', { profile: 'vehicle', label: 'Clés', body: 'Vos clés sont à l’accueil.' }),
      deleteMessageTemplate('garage-demo', { profile: 'vehicle', key: 'cles' }),
      setDeskLabel('garage-demo', { staffId: STAFF, label: 'Guichet 3' }),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, code: 'profile_unavailable' });
    expect(db.writes).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Changement de profil                                                 */
/* ------------------------------------------------------------------ */

describe('switchQueueProfile', () => {
  beforeEach(() => { db.features = { profiles: true }; });

  it('rend VT017 lisible : « Terminez ou videz la file avant de changer de profil »', async () => {
    db.rpcResult = { data: null, error: { code: 'VT017', message: 'Terminez ou videz la file avant de changer de profil' } };
    const r = await switchQueueProfile('garage-demo', { queueId: Q_VEHICLE, profile: 'table' });
    expect(r).toEqual({
      ok: false,
      code: 'queue_not_empty',
      error: 'Terminez ou videz la file avant de changer de profil.',
    });
  });

  it('dit quand les réglages d’avant sont rétablis', async () => {
    db.rpcResult = {
      data: { profile: 'walkin', previousProfile: 'table', changed: true, settingsRestored: true, servicesCreated: 0, servicesRetired: 0 },
      error: null,
    };
    const r = await switchQueueProfile('garage-demo', { queueId: Q_WALKIN, profile: 'walkin' });
    expect(r.ok && r.data.settingsRestored).toBe(true);
  });

  it('répond « introuvable » pour la file d’un autre commerce, sans appeler la base', async () => {
    const r = await switchQueueProfile('garage-demo', { queueId: Q_FOREIGN, profile: 'vehicle' });
    expect(r).toMatchObject({ ok: false, code: 'not_found' });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('refuse un profil inconnu et une clé en trop', async () => {
    const a = await switchQueueProfile('garage-demo', { queueId: Q_WALKIN, profile: 'spa' as never });
    const b = await switchQueueProfile('garage-demo', { queueId: Q_WALKIN, profile: 'vehicle', force: true } as never);
    expect(a).toMatchObject({ ok: false, code: 'validation' });
    expect(b).toMatchObject({ ok: false, code: 'validation' });
    expect(db.rpcCalls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Options                                                              */
/* ------------------------------------------------------------------ */

describe('updateProfileOptions', () => {
  beforeEach(() => { db.features = { profiles: true }; });

  it('garde les options stockées, applique le changement et écrit l’audit', async () => {
    const r = await updateProfileOptions('garage-demo', { queueId: Q_VEHICLE, options: { tvRegistration: 'model_only' } });
    expect(r).toEqual({ ok: true, data: { options: { quotes: true, tvRegistration: 'model_only' }, ticketPrefix: 'A' } });
    expect(db.writes).toEqual([
      {
        table: 'queues', op: 'update',
        values: { profile_options: { quotes: true, tvRegistration: 'model_only' } },
        filters: [['id', Q_VEHICLE], ['organization_id', ORG]],
      },
    ]);
    expect(db.audits).toEqual([
      expect.objectContaining({
        organizationId: ORG, actorUserId: USER, action: 'queue.profile_options_updated',
        targetType: 'queue', targetId: Q_VEHICLE,
      }),
    ]);
  });

  it('refuse une option d’un autre métier (les couverts sur un garage)', async () => {
    const r = await updateProfileOptions('garage-demo', { queueId: Q_VEHICLE, options: { partyMax: 8 } });
    expect(r).toMatchObject({ ok: false, code: 'validation' });
    expect(db.writes).toHaveLength(0);
    expect(db.audits).toHaveLength(0);
  });

  it('refuse les options d’une file au passage : un barbier n’en a pas', async () => {
    const r = await updateProfileOptions('garage-demo', { queueId: Q_WALKIN, options: { review: false } });
    expect(r).toMatchObject({ ok: false, code: 'invalid_action' });
  });

  it('en santé (sensitive), coupe aussi la demande du prénom', async () => {
    const r = await updateProfileOptions('garage-demo', { queueId: Q_DESK, options: { sensitive: true } });
    expect(r.ok).toBe(true);
    expect(db.writes[0]?.values).toMatchObject({ ask_client_name: false, client_name_required: false });
  });

  it('règle le préfixe du numéro au guichet, jamais sur un atelier', async () => {
    const ok = await updateProfileOptions('garage-demo', { queueId: Q_DESK, ticketPrefix: 'b' });
    expect(ok).toMatchObject({ ok: true, data: { ticketPrefix: 'B' } });
    const bad = await updateProfileOptions('garage-demo', { queueId: Q_DESK, ticketPrefix: 'A1' });
    expect(bad).toMatchObject({ ok: false, code: 'validation' });
    const workshop = await updateProfileOptions('garage-demo', { queueId: Q_VEHICLE, ticketPrefix: 'B' });
    expect(workshop).toMatchObject({ ok: false, code: 'validation' });
  });
});

/* ------------------------------------------------------------------ */
/* Modèles de messages                                                  */
/* ------------------------------------------------------------------ */

describe('modèles de messages', () => {
  beforeEach(() => { db.features = { profiles: true }; });

  it('refuse une adresse web et un texte de plus de 180 caractères', async () => {
    const url = await upsertMessageTemplate('garage-demo', { profile: 'vehicle', label: 'Lien', body: 'Payez sur bit.ly/garage' });
    const long = await upsertMessageTemplate('garage-demo', { profile: 'vehicle', label: 'Long', body: 'a'.repeat(181) });
    expect(url).toMatchObject({ ok: false, code: 'validation' });
    expect(long).toMatchObject({ ok: false, code: 'validation' });
    expect(db.writes).toHaveLength(0);
  });

  it('refuse une variable hors liste blanche (jamais de prénom)', async () => {
    const r = await upsertMessageTemplate('garage-demo', { profile: 'vehicle', label: 'Salut', body: 'Bonjour {prenom} !' });
    expect(r).toMatchObject({ ok: false, code: 'validation' });
  });

  it('retouche un modèle du code : typographie rétablie, rang conservé, audit écrit', async () => {
    const r = await upsertMessageTemplate('garage-demo', {
      profile: 'vehicle', key: 'cles', label: 'Clés', body: "Vos clés vous attendent à l'accueil.",
    });
    expect(r).toEqual({ ok: true, data: { key: 'cles' } });
    const insert = db.writes.find((w) => w.op === 'insert');
    expect(insert?.values).toMatchObject({
      organization_id: ORG, location_id: null, profile: 'vehicle', key: 'cles',
      body: 'Vos clés vous attendent à l’accueil.', is_active: true, sort_order: 20,
    });
    expect(db.audits).toEqual([expect.objectContaining({ action: 'message_template.saved', targetId: 'cles' })]);
  });

  it('met à jour la surcharge existante au lieu d’en créer une seconde', async () => {
    db.tables.message_templates = [
      { id: 't1', organization_id: ORG, location_id: null, profile: 'vehicle', key: 'cles' },
    ];
    const r = await upsertMessageTemplate('garage-demo', { profile: 'vehicle', key: 'cles', label: 'Clés', body: 'Clés à l’accueil.' });
    expect(r.ok).toBe(true);
    expect(db.writes).toEqual([
      expect.objectContaining({ table: 'message_templates', op: 'update', values: { label: 'Clés', body: 'Clés à l’accueil.', is_active: true } }),
    ]);
  });

  it('ne masque pas un modèle : l’envoi ne sait pas encore le refuser (isActive refusé)', async () => {
    const r = await upsertMessageTemplate('garage-demo', {
      profile: 'vehicle', key: 'cles', label: 'Clés', body: 'Clés à l’accueil.', isActive: false,
    } as never);
    expect(r).toMatchObject({ ok: false, code: 'validation' });
    expect(db.writes).toHaveLength(0);
  });

  it('pose l’espace fine insécable avant « : ; ? ! » à l’enregistrement, sans toucher 19:00', async () => {
    const r = await upsertMessageTemplate('garage-demo', {
      profile: 'vehicle', key: 'rappel', label: 'Rappel',
      body: 'Pouvez-vous nous rappeler? Ouvert dès 19:00 ; merci !',
    });
    expect(r.ok).toBe(true);
    const insert = db.writes.find((w) => w.op === 'insert');
    expect(insert?.values?.body).toBe('Pouvez-vous nous rappeler\u202F? Ouvert dès 19:00\u202F; merci\u202F!');
  });

  it('refuse un métier sans messages (le passage au fauteuil)', async () => {
    const r = await upsertMessageTemplate('garage-demo', { profile: 'walkin', label: 'Salut', body: 'Bonjour.' });
    expect(r).toMatchObject({ ok: false, code: 'invalid_action' });
  });

  it('supprime la surcharge (le modèle du code revient) et écrit l’audit', async () => {
    const r = await deleteMessageTemplate('garage-demo', { profile: 'vehicle', key: 'cles' });
    expect(r).toEqual({ ok: true, data: { key: 'cles', restoredDefault: true } });
    expect(db.writes).toEqual([
      expect.objectContaining({
        table: 'message_templates', op: 'delete',
        filters: [['organization_id', ORG], ['profile', 'vehicle'], ['key', 'cles'], ['location_id', null]],
      }),
    ]);
    expect(db.audits).toEqual([expect.objectContaining({ action: 'message_template.deleted' })]);
  });
});

/* ------------------------------------------------------------------ */
/* Guichets                                                             */
/* ------------------------------------------------------------------ */

describe('setDeskLabel', () => {
  beforeEach(() => { db.features = { profiles: true }; });

  it('nomme un guichet de l’organisation et écrit l’audit', async () => {
    const r = await setDeskLabel('garage-demo', { staffId: STAFF, label: '  Guichet 3 ' });
    expect(r).toEqual({ ok: true, data: { staffId: STAFF, label: 'Guichet 3' } });
    expect(db.writes[0]).toMatchObject({ table: 'staff', op: 'update', values: { desk_label: 'Guichet 3' } });
    expect(db.audits).toEqual([expect.objectContaining({ action: 'staff.desk_label_updated', targetId: STAFF })]);
  });

  it('répond « introuvable » pour la fiche d’un autre commerce', async () => {
    const r = await setDeskLabel('garage-demo', { staffId: STAFF_FOREIGN, label: 'Guichet 1' });
    expect(r).toMatchObject({ ok: false, code: 'not_found' });
    expect(db.writes).toHaveLength(0);
  });

  it('un libellé vide revient au nom de la fiche', async () => {
    const r = await setDeskLabel('garage-demo', { staffId: STAFF, label: '' });
    expect(r).toEqual({ ok: true, data: { staffId: STAFF, label: null } });
  });
});

/* ------------------------------------------------------------------ */
/* Durée de vie d'un ticket (settings.ts)                               */
/* ------------------------------------------------------------------ */

describe('updateQueueSettings : borne de la durée de vie', () => {
  it('garde 24 h au plus pour une file au passage', async () => {
    const r = await updateQueueSettings({ queueId: Q_WALKIN, entryTtlMinutes: 2880 });
    expect(r.ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });

  it('va jusqu’à 30 jours pour un atelier, pas au-delà', async () => {
    const ok = await updateQueueSettings({ queueId: Q_VEHICLE, entryTtlMinutes: 43_200 });
    expect(ok.ok).toBe(true);
    expect(db.writes[0]).toMatchObject({ table: 'queues', op: 'update', values: { entry_ttl_minutes: 43_200 } });
    const tooLong = await updateQueueSettings({ queueId: Q_VEHICLE, entryTtlMinutes: 43_201 });
    expect(tooLong.ok).toBe(false);
  });

  it('ne change rien pour un barbier sous 24 h', async () => {
    const r = await updateQueueSettings({ queueId: Q_WALKIN, entryTtlMinutes: 240 });
    expect(r.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Ce que Réglages affiche des modèles                                  */
/* ------------------------------------------------------------------ */

const { mergeTemplates } = await import('@/app/app/[org]/reglages/templateRows');

describe('mergeTemplates (Réglages, section Messages)', () => {
  const row = (over: Row) => ({
    profile: 'vehicle', key: 'x', label: 'X', body: 'X.', is_active: true, location_id: null, sort_order: 0, ...over,
  }) as Parameters<typeof mergeTemplates>[1][number];

  it('garde l’ordre du code, marque les retouches et les ajouts ; une surcharge inactive est lue comme à l’envoi', () => {
    const list = mergeTemplates('vehicle', [
      row({ key: 'cles', label: 'Clés', body: 'Clés à l’accueil.' }),
      row({ key: 'retard', label: 'Retard', body: 'Petit retard : votre véhicule sera prêt demain matin.', is_active: false }),
      row({ key: 'perso_ab12', label: 'Lavage offert', body: 'Votre véhicule a été lavé.', sort_order: 1000 }),
      row({ key: 'cles', label: 'Autre', body: 'Ailleurs.', location_id: LOC }),
      row({ key: 'bientot', profile: 'table', label: 'Table', body: 'Table.' }),
    ]);
    expect(list.map((t) => [t.key, t.origin])).toEqual([
      ['retard', 'default'],
      ['rappel', 'default'],
      ['cles', 'edited'],
      ['fermeture', 'default'],
      ['devis_maj', 'default'],
      ['fausse_alerte', 'default'],
      ['perso_ab12', 'custom'],
    ]);
    expect(list[2]?.original?.body).toBe('Vos clés sont disponibles à l’accueil.');
    // `sendTemplateMessage` écarte une surcharge inactive : le texte du code part.
    expect(list[0]?.body).toBe('Petit retard : votre véhicule sera prêt demain matin.');
  });

  it('un modèle du code réenregistré tel quel (espace fine posée) n’est pas « Retouché »', () => {
    const list = mergeTemplates('vehicle', [
      row({ key: 'rappel', label: 'Nous rappeler', body: 'Pouvez-vous nous rappeler au {telephone_etablissement}\u202F?' }),
    ]);
    expect(list.find((t) => t.key === 'rappel')?.origin).toBe('default');
  });

  it('un barbier n’a aucun modèle', () => {
    expect(mergeTemplates('walkin', [])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Données de santé : ni prénom, ni avis par défaut                     */
/* ------------------------------------------------------------------ */

describe('file de santé (sensitive)', () => {
  const Q_HEALTH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  beforeEach(() => {
    db.features = { profiles: true };
    db.tables.queues!.push({
      id: Q_HEALTH, organization_id: ORG, location_id: LOC, profile: 'desk',
      profile_options: { numbering: true, sensitive: true, review: false, reviewDelayMinutes: null }, ticket_prefix: 'A',
    });
  });

  it('updateQueueSettings refuse de demander ou d’exiger le prénom : join_queue le refuserait à tout patient', async () => {
    const ask = await updateQueueSettings({ queueId: Q_HEALTH, askClientName: true });
    const required = await updateQueueSettings({ queueId: Q_HEALTH, clientNameRequired: true });
    expect(ask).toMatchObject({ ok: false, code: 'validation' });
    expect(required).toMatchObject({ ok: false, code: 'validation' });
    expect(db.writes).toHaveLength(0);
  });

  it('les couper reste toujours possible, et un guichet ordinaire peut demander le prénom', async () => {
    const off = await updateQueueSettings({ queueId: Q_HEALTH, askClientName: false, clientNameRequired: false });
    expect(off.ok).toBe(true);
    const desk = await updateQueueSettings({ queueId: Q_DESK, askClientName: true });
    expect(desk.ok).toBe(true);
  });

  it('passer une file en santé coupe aussi la demande d’avis (review false, délai « jamais »)', async () => {
    const r = await updateProfileOptions('garage-demo', { queueId: Q_DESK, options: { sensitive: true } });
    expect(r).toMatchObject({ ok: true, data: { options: { numbering: true, sensitive: true, review: false, reviewDelayMinutes: null } } });
    expect(db.writes[0]?.values).toMatchObject({
      profile_options: { numbering: true, sensitive: true, review: false, reviewDelayMinutes: null },
      ask_client_name: false,
      client_name_required: false,
    });
  });

  it('un choix explicite du même appel l’emporte ; rallumer l’avis ensuite reste possible', async () => {
    const same = await updateProfileOptions('garage-demo', { queueId: Q_DESK, options: { sensitive: true, review: true } });
    expect(same).toMatchObject({ ok: true, data: { options: { sensitive: true, review: true, reviewDelayMinutes: null } } });
    db.writes = [];
    const later = await updateProfileOptions('garage-demo', { queueId: Q_HEALTH, options: { review: true, reviewDelayMinutes: 0 } });
    expect(later).toMatchObject({ ok: true, data: { options: { sensitive: true, review: true, reviewDelayMinutes: 0 } } });
  });
});

/* ------------------------------------------------------------------ */
/* Choix du métier : jamais proposé à un barbier                       */
/* ------------------------------------------------------------------ */

const { offersMetierChoice, metierLabel } = await import('@/app/app/[org]/reglages/ProfileSection');

describe('offersMetierChoice (Réglages, « Voir les autres métiers »)', () => {
  const base = { current: 'walkin' as const, activity: 'barber', features: null, orgHasProfiledQueue: false, availableCount: 6 };

  it('un barbier au passage : jamais, même si six métiers étaient ouverts', () => {
    expect(offersMetierChoice(base)).toBe(false);
  });

  it('une activité à métier propre, une organisation activée ou une autre file à métier : oui', () => {
    expect(offersMetierChoice({ ...base, activity: 'garage' })).toBe(true);
    expect(offersMetierChoice({ ...base, features: { profiles: true } })).toBe(true);
    expect(offersMetierChoice({ ...base, orgHasProfiledQueue: true })).toBe(true);
  });

  it('une file déjà dans un métier peut toujours revenir en arrière ; un seul métier possible : rien', () => {
    expect(offersMetierChoice({ ...base, current: 'table' })).toBe(true);
    expect(offersMetierChoice({ ...base, activity: 'garage', availableCount: 1 })).toBe(false);
  });

  it('« Passage au fauteuil » chez un coiffeur, « Passage sans rendez-vous » dans un garage', () => {
    expect(metierLabel('walkin', 'barber')).toBe('Passage au fauteuil');
    expect(metierLabel('walkin', null)).toBe('Passage au fauteuil');
    expect(metierLabel('walkin', 'garage')).toBe('Passage sans rendez-vous');
    expect(metierLabel('table', 'garage')).toBe('Table');
  });
});

describe('ProfileSection (rendu) avec OPEN_PROFILES étendu à tous les métiers', () => {
  it('un barbier voit « Passage au fauteuil » sans « Voir les autres métiers » ; un garage le voit', async () => {
    vi.resetModules();
    vi.doMock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
    vi.doMock('@/lib/profiles/capabilities', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/profiles/capabilities')>();
      const all = new Set(['walkin', 'event', 'vehicle', 'device', 'table', 'desk', 'retail'] as const);
      return { ...actual, OPEN_PROFILES: all, profileAvailable: () => true };
    });
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ProfileSection } = await import('@/app/app/[org]/reglages/ProfileSection');
    const props = {
      orgSlug: 'barber-house',
      queue: { id: Q_WALKIN, name: 'Salon', profile: 'walkin' as const, profile_options: {}, ticket_prefix: 'A' },
      features: null,
      canConfigure: true,
      staff: [],
      run: () => undefined,
      pending: false,
    };
    const barber = renderToStaticMarkup(createElement(ProfileSection, { ...props, activity: 'barber' }));
    expect(barber).toContain('Passage au fauteuil');
    expect(barber).not.toContain('Voir les autres métiers');
    expect(barber).not.toContain('Changer de métier');

    const garage = renderToStaticMarkup(createElement(ProfileSection, {
      ...props, activity: 'garage', queue: { ...props.queue, name: 'Pneus minute' },
    }));
    expect(garage).toContain('Passage sans rendez-vous');
    expect(garage).not.toContain('Au fauteuil');
    // Le garage a son métier : le sélecteur s'ouvre de lui-même, suggestion comprise.
    expect(garage).toContain('Fait pour vous');
    vi.doUnmock('@/lib/profiles/capabilities');
    vi.doUnmock('next/navigation');
  });
});
