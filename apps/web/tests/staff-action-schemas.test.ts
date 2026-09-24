import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * ACTIONS DES POSTES À PROFIL — schémas d'options, garde d'accès, et
 * contrat avec les fonctions SQL.
 *
 *  - chaque action a un schéma zod STRICT : une clé inattendue n'atteint
 *    jamais la base ;
 *  - chaque action serveur de `server/actions/profile-queue.ts` vérifie
 *    `requireOrgAccess(orgSlug, 'queue.operate')` avant toute lecture ;
 *  - la décision du client sur un devis transmet `{ quoteN }` (le devis
 *    qu'il a lu), et « Le devis a changé » lui revient tel quel ;
 *  - l'aperçu TV du poste lit `display_snapshot`, jamais `queue_snapshot`.
 */

const rpcCalls = vi.hoisted(() => [] as { fn: string; params: Record<string, unknown> }[]);
const rpcResult = vi.hoisted(() => ({ value: { data: null as unknown, error: null as unknown } }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return rpcResult.value;
    },
  }),
}));
vi.mock('@/server/queue', () => ({
  propagate: async () => ({ state: null, notifications: { claimed: 0, sent: 0, failed: 0, skipped: 0, reasons: [] } }),
}));
vi.mock('@/server/realtime', () => ({ broadcastTicketEvent: async () => true }));

const {
  LEGACY_OPTION_SCHEMAS, PROFILE_STAFF_ACTIONS, STAFF_OPTION_SCHEMAS, READY_ETA_MAX_DAYS,
  getProfileQueueSnapshot, parseDetailsPatch, parseStaffOptions, profileClientAction, profileError,
} = await import('@/server/profiles/queue');

beforeEach(() => {
  rpcCalls.length = 0;
  rpcResult.value = { data: { entry: { id: 'Tk7pQ2xWm9Ra' }, queueId: 'q' }, error: null };
});

const HASH = 'a'.repeat(64);

/* ------------------------------------------------------------------ */
/* Schémas des options                                                   */
/* ------------------------------------------------------------------ */

describe('schémas d’options des actions à profil', () => {
  it('couvrent exactement les sept actions de staff_queue_action', () => {
    expect([...PROFILE_STAFF_ACTIONS].sort()).toEqual(
      ['message', 'recall', 'send_quote', 'set_claim', 'set_eta', 'set_stage', 'update_details'],
    );
    expect(Object.keys(STAFF_OPTION_SCHEMAS).sort()).toEqual([...PROFILE_STAFF_ACTIONS].sort());
  });

  it('refusent toute clé inattendue', () => {
    const extra = { pirate: true };
    const valid: Record<(typeof PROFILE_STAFF_ACTIONS)[number], Record<string, unknown>> = {
      set_stage: { stage: 'diagnosis' },
      send_quote: { amountCents: 100, label: 'Vidange' },
      update_details: { details: {} },
      set_eta: { readyEta: null },
      set_claim: { tokenHash: HASH, ttlMinutes: 60 },
      recall: {},
      message: {},
    };
    for (const action of PROFILE_STAFF_ACTIONS) {
      expect(STAFF_OPTION_SCHEMAS[action].safeParse(valid[action]).success, action).toBe(true);
      expect(STAFF_OPTION_SCHEMAS[action].safeParse({ ...valid[action], ...extra }).success, action).toBe(false);
    }
  });

  it('set_stage : un code d’étape, rien d’autre', () => {
    expect(parseStaffOptions('set_stage', { stage: 'waiting_parts', notify: true })).toEqual({ stage: 'waiting_parts', notify: true });
    expect(() => parseStaffOptions('set_stage', { stage: 'Prêt' })).toThrow(/Étape inconnue/);
    expect(() => parseStaffOptions('set_stage', { stage: "ready'; drop table" })).toThrow();
    expect(() => parseStaffOptions('set_stage', { stage: 'ready', notify: 'oui' })).toThrow();
  });

  it('send_quote : montant entier en centimes, libellé nettoyé, jamais d’adresse web', () => {
    expect(parseStaffOptions('send_quote', { amountCents: 18_400, label: '  Plaquettes\n+ disques AV  ' }))
      .toEqual({ amountCents: 18_400, label: 'Plaquettes + disques AV' });
    expect(() => parseStaffOptions('send_quote', { amountCents: 184.5, label: 'x' })).toThrow(/centimes/);
    expect(() => parseStaffOptions('send_quote', { amountCents: -1, label: 'x' })).toThrow();
    expect(() => parseStaffOptions('send_quote', { amountCents: 100_000_01, label: 'x' })).toThrow(/trop élevé/);
    expect(() => parseStaffOptions('send_quote', { amountCents: 100, label: '   ' })).toThrow(/Décrivez/);
    expect(() => parseStaffOptions('send_quote', { amountCents: 100, label: 'Payez sur bit.ly/devis' })).toThrow(/adresse web/);
    expect(() => parseStaffOptions('send_quote', { amountCents: '100', label: 'x' })).toThrow();
    // 80 caractères au plus, coupés proprement.
    const long = parseStaffOptions('send_quote', { amountCents: 100, label: 'a'.repeat(200) });
    expect(Array.from(long.label)).toHaveLength(80);
  });

  it('set_eta : une date à venir, dans les 60 jours, ou rien', () => {
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    expect(READY_ETA_MAX_DAYS).toBe(60);
    const eta = inDays(2);
    expect(parseStaffOptions('set_eta', { readyEta: eta })).toEqual({ readyEta: eta });
    expect(parseStaffOptions('set_eta', { readyEta: null })).toEqual({ readyEta: null });
    expect(() => parseStaffOptions('set_eta', { readyEta: inDays(-1) })).toThrow(/à venir/);
    expect(() => parseStaffOptions('set_eta', { readyEta: inDays(61) })).toThrow(/60 jours/);
    expect(() => parseStaffOptions('set_eta', { readyEta: 'jeudi 17 h' })).toThrow();
  });

  it('set_claim : seulement un SHA-256 hexadécimal, 24 h au plus', () => {
    expect(parseStaffOptions('set_claim', { tokenHash: HASH, ttlMinutes: 1440 })).toEqual({ tokenHash: HASH, ttlMinutes: 1440 });
    expect(() => parseStaffOptions('set_claim', { tokenHash: 'A'.repeat(43), ttlMinutes: 60 })).toThrow();
    expect(() => parseStaffOptions('set_claim', { tokenHash: HASH.toUpperCase(), ttlMinutes: 60 })).toThrow();
    expect(() => parseStaffOptions('set_claim', { tokenHash: HASH, ttlMinutes: 1441 })).toThrow();
  });

  it('options des actions historiques, employées par les postes à profil, en strict aussi', () => {
    expect(LEGACY_OPTION_SCHEMAS.call.safeParse({ notify: false }).success).toBe(true);
    expect(LEGACY_OPTION_SCHEMAS.call.safeParse({ staffId: 'pas-un-uuid' }).success).toBe(false);
    expect(LEGACY_OPTION_SCHEMAS.complete.safeParse({ skipReview: true }).success).toBe(false);
    expect(LEGACY_OPTION_SCHEMAS.mark_absent.safeParse({ policy: 'remove' }).success).toBe(true);
    expect(LEGACY_OPTION_SCHEMAS.mark_absent.safeParse({ policy: 'effacer' }).success).toBe(false);
    expect(LEGACY_OPTION_SCHEMAS.note.safeParse({ note: 'x'.repeat(281) }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Correctif de fiche (update_details)                                   */
/* ------------------------------------------------------------------ */

describe('parseDetailsPatch', () => {
  it('passe par le schéma du profil, côté pro', () => {
    expect(parseDetailsPatch('vehicle', {}, { registration: 'ab123cd', keys: true }))
      .toEqual({ registration: 'AB-123-CD', country: 'FR', keys: true });
    expect(parseDetailsPatch('device', {}, { accessories: ['charger', 'charger', 'case'] }))
      .toEqual({ accessories: ['charger', 'case'] });
  });

  it('retire une clé connue avec null, refuse une clé inconnue même à null', () => {
    expect(parseDetailsPatch('vehicle', {}, { model: null })).toEqual({ model: null });
    expect(() => parseDetailsPatch('vehicle', {}, { code: '1234' })).toThrow();
    expect(() => parseDetailsPatch('vehicle', {}, { code: null })).toThrow();
  });

  it('ne pose jamais de devis par ce chemin', () => {
    expect(() => parseDetailsPatch('vehicle', { quotes: true }, { quote: { amountCents: 1 } })).toThrow();
    expect(() => parseDetailsPatch('vehicle', { quotes: true }, { quote: null })).toThrow();
  });

  it('lit une plaque corrigée dans le pays DÉJÀ enregistré sur la fiche', () => {
    // Plaque allemande : refusée au format français, juste en « autre pays ».
    expect(() => parseDetailsPatch('vehicle', {}, { registration: 'M-AB 1234' })).toThrow();
    const patched = parseDetailsPatch('vehicle', {}, { registration: 'M-AB 1234' }, 'other');
    expect(patched.country).toBe('other');
    expect(patched.registration).toBeTruthy();
    // Le pays transmis explicitement l'emporte sur celui de la fiche.
    expect(parseDetailsPatch('vehicle', {}, { registration: 'ab123cd', country: 'FR' }, 'other'))
      .toEqual({ registration: 'AB-123-CD', country: 'FR' });
    // Sans pays enregistré : format français, comme avant.
    expect(parseDetailsPatch('vehicle', {}, { registration: 'ab123cd' }, null))
      .toEqual({ registration: 'AB-123-CD', country: 'FR' });
  });

  it('respecte une file de santé : aucun texte libre', () => {
    expect(() => parseDetailsPatch('device', { sensitive: true }, { model: 'iPhone' })).toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* Décision sur un devis                                                 */
/* ------------------------------------------------------------------ */

describe('profileClientAction', () => {
  it('transmet le numéro du devis lu par le client', async () => {
    await profileClientAction({ entryPublicId: 'Tk7pQ2xWm9Ra', clientSessionId: 's', action: 'quote_accept', quoteN: 2 });
    await profileClientAction({ entryPublicId: 'Tk7pQ2xWm9Ra', clientSessionId: 's', action: 'quote_decline', quoteN: 3 });
    await profileClientAction({ entryPublicId: 'Tk7pQ2xWm9Ra', clientSessionId: 's', action: 'unfollow' });
    expect(rpcCalls.map((c) => [c.fn, c.params.p_action, c.params.p_options])).toEqual([
      ['client_queue_action', 'quote_accept', { quoteN: 2 }],
      ['client_queue_action', 'quote_decline', { quoteN: 3 }],
      ['client_queue_action', 'unfollow', {}],
    ]);
  });

  it('refuse une décision sans numéro de devis, sans appeler la base', async () => {
    await expect(profileClientAction({ entryPublicId: 'x', clientSessionId: 's', action: 'quote_accept' }))
      .rejects.toMatchObject({ code: 'validation' });
    await expect(profileClientAction({ entryPublicId: 'x', clientSessionId: 's', action: 'quote_accept', quoteN: 0 }))
      .rejects.toMatchObject({ code: 'validation' });
    expect(rpcCalls).toEqual([]);
  });

  it('dit « Le devis a changé » quand le garage l’a renvoyé entre-temps', async () => {
    rpcResult.value = { data: null, error: { code: 'VT006', message: 'Le devis a changé : relisez-le avant de répondre' } };
    await expect(profileClientAction({ entryPublicId: 'x', clientSessionId: 's', action: 'quote_accept', quoteN: 1 }))
      .rejects.toMatchObject({ code: 'quote_changed', status: 409, message: 'Le devis a changé : relisez-le avant de répondre.' });
  });
});

describe('profileError', () => {
  it('reprend les refus écrits pour être lus, typographie française comprise', () => {
    expect(profileError({ code: 'VT006', message: 'Trois rappels au maximum' }))
      .toMatchObject({ code: 'invalid_transition', message: 'Trois rappels au maximum.' });
    expect(profileError({ code: 'VT016', message: 'Trop de messages : attendez 30 secondes entre deux envois' }))
      .toMatchObject({ code: 'too_many_messages', status: 429 });
    expect(profileError({ code: 'VT006', message: "Ce ticket n'est plus en cours" }).message).toBe('Ce ticket n’est plus en cours.');
  });

  it('ne montre jamais au pro un message destiné au client', () => {
    // VT009 veut dire « ticket d'un autre appareil » ; un guichet disparu
    // a son propre code et son propre texte, pour le poste.
    expect(profileError({ code: 'VT009', message: 'Guichet inconnu pour cet établissement' }))
      .toMatchObject({ code: 'invalid_desk', status: 422, message: 'Ce guichet n’existe plus pour cet établissement : rechargez la page.' });
    expect(profileError({ code: 'VT015', message: 'Informations invalides : montant du devis' }))
      .toMatchObject({ code: 'invalid_details', status: 422, message: 'Montant du devis invalide.' });
    expect(profileError({ code: 'VT015', message: 'Informations invalides : devis' }).message)
      .toBe('Devis invalide : un libellé de 80 caractères au plus, et un montant.');
    expect(profileError({ code: 'VT015', message: 'Informations invalides : trop de couverts pour une inscription en ligne' }).message)
      .toBe('Pour un groupe de cette taille, appelez directement l’établissement.');
    expect(profileError({ code: 'VT006', message: 'Action client inconnue: unfollow' }).message)
      .toBe('Cette action n’existe pas pour ce métier.');
  });

  it('écrit chaque texte repris avec l’apostrophe typographique', () => {
    // Un texte entre guillemets doubles pourrait cacher une apostrophe
    // droite : tous doivent être entre apostrophes simples, donc sans.
    const source = readFileSync(fileURLToPath(new URL('../src/server/profiles/queue.ts', import.meta.url)), 'utf8');
    const table = source.slice(source.indexOf('const PRECISE_SQL_MESSAGES'), source.indexOf('export function profileError'));
    const messages = [...table.matchAll(/message: (['"`])/g)].map((m) => m[1]);
    expect(messages.length).toBeGreaterThan(15);
    expect(new Set(messages)).toEqual(new Set(["'"]));
  });

  it('garde le message générique pour tout texte SQL inconnu', () => {
    expect(profileError({ code: 'VT006', message: 'Action inconnue: pirate' }))
      .toMatchObject({ code: 'invalid_transition', message: 'Cette action n’est pas possible dans l’état actuel.' });
    expect(profileError({ code: 'VT015', message: 'Informations invalides : keys' }).message)
      .toBe('Certaines informations ne sont pas valides. Vérifiez-les et réessayez.');
  });
});

/* ------------------------------------------------------------------ */
/* Instantanés                                                           */
/* ------------------------------------------------------------------ */

describe('instantanés', () => {
  it('le poste du pro demande les informations métier explicitement', async () => {
    rpcResult.value = { data: { queue: { id: 'q' } }, error: null };
    await getProfileQueueSnapshot('q');
    expect(rpcCalls).toEqual([{ fn: 'queue_snapshot', params: { p_queue_id: 'q', p_include_details: true } }]);
  });

  it('l’aperçu TV du poste lit display_snapshot, jamais queue_snapshot', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/server/actions/profile-queue.ts', import.meta.url)), 'utf8');
    const fn = source.slice(source.indexOf('export async function fetchDisplaySnapshot'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain('getDisplaySnapshot(');
    expect(body).not.toMatch(/queue_snapshot|getProfileQueueSnapshot|getQueueSnapshot/);
  });
});

/* ------------------------------------------------------------------ */
/* Garde d'accès des actions serveur                                     */
/* ------------------------------------------------------------------ */

describe('server/actions/profile-queue.ts', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/server/actions/profile-queue.ts', import.meta.url)), 'utf8');
  const actions = [...source.matchAll(/export async function (\w+)\(([\s\S]*?)\n}\n/g)].map((m) => ({ name: m[1]!, body: m[0] }));

  it('est un fichier d’actions serveur', () => {
    expect(source.startsWith("'use server';")).toBe(true);
    expect(actions.map((a) => a.name).sort()).toEqual([
      'addProfileEntryAction', 'advanceProfileEntry', 'callNextAtDesk', 'fetchDisplaySnapshot',
      'fetchProfileQueueSnapshot', 'issueTrackingLink', 'sendTemplateMessage',
    ]);
  });

  it('exige queue.operate', () => {
    expect(source).toContain("requireOrgAccess(parse(orgSlugSchema, orgSlug), 'queue.operate')");
    expect(source).not.toMatch(/requireOrgAccess\([^)]*'queue\.configure'/);
  });

  it.each(['addProfileEntryAction', 'advanceProfileEntry', 'callNextAtDesk', 'fetchDisplaySnapshot',
    'fetchProfileQueueSnapshot', 'issueTrackingLink', 'sendTemplateMessage'])(
    '%s vérifie l’accès avant toute lecture ou écriture',
    (name) => {
      const body = actions.find((a) => a.name === name)!.body;
      const guard = body.indexOf('await orgAccess(orgSlug)');
      expect(guard, 'orgAccess absent').toBeGreaterThan(-1);
      for (const read of ['supabaseAdmin(', 'queueInOrg(', 'entryInOrg(', 'profileStaffAction(', 'staffAction(', 'getProfileQueueSnapshot(', 'getDisplaySnapshot(']) {
        const at = body.indexOf(read);
        if (at > -1) expect(guard, `${read} avant la garde`).toBeLessThan(at);
      }
      // Toute file ou fiche visée est rattachée à l'organisation de l'URL.
      expect(body).toMatch(/queueInOrg\(|entryInOrg\(/);
    },
  );

  it('valide chaque entrée par un schéma strict', () => {
    const schemas = [...source.matchAll(/const (\w+Schema) = z\.object\(/g)].map((m) => m[1]);
    expect(schemas.length).toBeGreaterThanOrEqual(5);
    for (const name of schemas) {
      const decl = source.slice(source.indexOf(`const ${name} = z.object(`));
      expect(decl.slice(0, decl.indexOf('\n\n')), name).toContain('.strict()');
    }
  });
});
