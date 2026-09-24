import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * LES DIX PREMIERS COMMERCES — la vitrine du pied de page.
 *
 *  - dix places, du 1er au 10e ; celles sans volontaire sont LIBRES
 *    (« Place n° X : libre »), aucun nom n'est inventé ; sans volontaire,
 *    dix places libres ; une ligne douteuse est écartée ;
 *  - l'ordre est celui que renvoie la base (0041 : date de création) ;
 *  - lecture serveur : service_role, cache étiqueté « founders » ; rien
 *    (null) si la clé manque ou si la base répond en erreur ;
 *  - l'accord : `settings.manage` exigé AVANT toute écriture, entrée
 *    stricte, audit, puis revalidation de l'étiquette « founders ».
 *
 * Le SQL (accord horodaté, commerces actifs, dix au plus, droits) est
 * tenu par supabase/tests/41_founders_showcase.test.sql.
 */

const db = vi.hoisted(() => ({
  key: 'service-de-test' as string | undefined,
  rpc: [] as { fn: string; params: unknown }[],
  rpcResult: { data: null as unknown, error: null as unknown },
  placeResult: { data: null as unknown, error: null as unknown },
  updates: [] as { table: string; values: unknown; filters: [string, unknown][] }[],
  updateError: null as unknown,
  role: 'owner' as 'owner' | 'admin' | 'manager' | 'member',
  audits: [] as Record<string, unknown>[],
  revalidatedTags: [] as string[],
  revalidatedPaths: [] as string[],
  cacheOptions: [] as unknown[],
}));

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    env: {
      ...actual.env,
      supabase: {
        ...actual.env.supabase,
        get serviceRoleKey() {
          return db.key;
        },
      },
    },
  };
});

vi.mock('next/cache', () => ({
  // Le cache est transparent ici : on vérifie son étiquette, pas Next.
  unstable_cache: (fn: () => unknown, _keys: unknown, options: unknown) => {
    db.cacheOptions.push(options);
    return fn;
  },
  revalidateTag: (tag: string) => { db.revalidatedTags.push(tag); },
  revalidatePath: (path: string) => { db.revalidatedPaths.push(path); },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: async (fn: string, params: unknown) => {
      db.rpc.push({ fn, params });
      return fn === 'founders_showcase_place' ? db.placeResult : db.rpcResult;
    },
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let values: unknown;
      const q = {
        update: (v: unknown) => { values = v; return q; },
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          db.updates.push({ table, values, filters: [...filters] });
          return Promise.resolve({ data: null, error: db.updateError }).then(resolve, reject);
        },
      };
      return q;
    },
  }),
}));

vi.mock('@/server/auth', async () => {
  const { AppError } = await import('@/lib/errors');
  const can = (p: string) => (p === 'settings.manage' ? db.role === 'owner' || db.role === 'admin' : true);
  return {
    requireOrgAccess: async (slug: string, permission?: string) => {
      if (slug !== 'barber-house') throw new AppError('not_found', 'Organisation introuvable.', 404);
      if (permission && !can(permission)) throw new AppError('forbidden', 'Votre rôle ne permet pas cette action.', 403);
      return { user: { id: 'user-1' }, organization: { organization_id: 'org-1', slug }, role: db.role, can };
    },
  };
});

vi.mock('@/server/audit', () => ({
  audit: async (entry: Record<string, unknown>) => { db.audits.push(entry); },
}));

const { FOUNDERS_PLACES, foundersPlaces, freePlaceLabel, parseFounderRows, placeNumber } =
  await import('@/components/founders/places');
const { FoundersQueue } = await import('@/components/founders/FoundersQueue');
const { FOUNDERS_TAG, getFoundersShowcase, getFoundersPlace } = await import('@/server/founders');
const { setFoundersShowcase } = await import('@/server/actions/founders');

const NBSP = ' ';
const THREE = [
  { place: 1, name: 'Barber House', city: 'Paris' },
  { place: 2, name: 'Garage 92', city: 'Nanterre' },
  { place: 3, name: 'Atelier Sans Ville', city: null },
];

function reset(): void {
  db.key = 'service-de-test';
  db.rpc = [];
  db.rpcResult = { data: null, error: null };
  db.placeResult = { data: null, error: null };
  db.updates = [];
  db.updateError = null;
  db.role = 'owner';
  db.audits = [];
  db.revalidatedTags = [];
  db.revalidatedPaths = [];
}

describe('les dix places', () => {
  it('sans volontaire : dix places libres, de 1 à 10', () => {
    const places = foundersPlaces([]);
    expect(FOUNDERS_PLACES).toBe(10);
    expect(places).toHaveLength(10);
    expect(places.every((p) => p.kind === 'free')).toBe(true);
    expect(places.map((p) => p.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('trois volontaires : leurs places, puis sept places libres', () => {
    const places = foundersPlaces(THREE);
    expect(places.slice(0, 3)).toEqual([
      { place: 1, kind: 'taken', name: 'Barber House', city: 'Paris' },
      { place: 2, kind: 'taken', name: 'Garage 92', city: 'Nanterre' },
      { place: 3, kind: 'taken', name: 'Atelier Sans Ville', city: null },
    ]);
    expect(places.slice(3).every((p) => p.kind === 'free')).toBe(true);
  });

  it('l’ordre est celui de la base, quel que soit l’ordre des lignes reçues', () => {
    const rows = parseFounderRows([THREE[2], THREE[0], THREE[1]]);
    expect(rows.map((r) => r.name)).toEqual(['Barber House', 'Garage 92', 'Atelier Sans Ville']);
  });

  it('écarte une ligne douteuse plutôt que de l’afficher (sa place reste libre)', () => {
    const rows = parseFounderRows([
      { place: 1, name: 'Barber House', city: 'Paris' },
      { place: 1, name: 'Doublon', city: 'Paris' },
      { place: 11, name: 'Onzième', city: 'Lyon' },
      { place: 0, name: 'Zéro', city: 'Lyon' },
      { place: 2.5, name: 'Demi', city: 'Lyon' },
      { place: 4, name: '   ', city: 'Lyon' },
      { place: 5, name: 'Nom\nsur deux lignes', city: '  ' },
      null,
      'texte',
    ]);
    expect(rows).toEqual([
      { place: 1, name: 'Barber House', city: 'Paris' },
      { place: 5, name: 'Nom sur deux lignes', city: null },
    ]);
    expect(parseFounderRows(null)).toEqual([]);
    expect(foundersPlaces(rows).filter((p) => p.kind === 'free')).toHaveLength(8);
  });

  it('libellés : « 01 » à « 10 » et « Place n° X : libre »', () => {
    expect(placeNumber(1)).toBe('01');
    expect(placeNumber(10)).toBe('10');
    expect(freePlaceLabel(7)).toBe(`Place n°${NBSP}7${NBSP}: libre`);
  });
});

describe('la file du pied de page (rendu)', () => {
  const render = (founders: Parameters<typeof FoundersQueue>[0]['founders']) =>
    renderToStaticMarkup(createElement(FoundersQueue, { founders }));

  it('aucun volontaire : dix places libres, aucun nom', () => {
    const html = render([]);
    for (let i = 1; i <= 10; i += 1) expect(html).toContain(freePlaceLabel(i));
    expect(html.match(/data-kind="free"/g)).toHaveLength(10);
    expect(html).not.toContain('data-kind="taken"');
    expect(html).toContain('Les dix premières places attendent leurs commerces');
  });

  it('trois volontaires : nom et ville, puis sept places libres annoncées', () => {
    const html = render(THREE);
    expect(html.match(/data-kind="taken"/g)).toHaveLength(3);
    expect(html.match(/data-kind="free"/g)).toHaveLength(7);
    expect(html).toContain('Barber House');
    expect(html).toContain('Nanterre');
    expect(html).toContain(`Encore 7${NBSP}places libres.`);
    expect(html).toContain(freePlaceLabel(4));
    expect(html).not.toContain(freePlaceLabel(3));
    // Rien d'autre qu'un nom et une ville : ni image, ni lien vers le commerce.
    expect(html).not.toMatch(/<img|<a [^>]*href="\/e\//);
  });

  it('dix volontaires : dix tickets, plus d’appel à prendre une place', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ place: i + 1, name: `Commerce ${i + 1}`, city: 'Lyon' }));
    const html = render(ten);
    expect(html.match(/data-kind="taken"/g)).toHaveLength(10);
    expect(html).not.toContain('libre');
    expect(html).not.toContain('Votre commerce ici');
  });

  it('les numéros 01 à 10 sont décoratifs, la place est dite aux lecteurs d’écran', () => {
    const html = render(THREE);
    expect(html).toContain(`Place n°${NBSP}1${NBSP}: `);
    expect(html).toMatch(/<ol[^>]*>/);
  });
});

describe('lecture serveur (server/founders.ts)', () => {
  beforeEach(reset);

  it('lit founders_showcase avec le cache étiqueté « founders » (une heure)', async () => {
    db.rpcResult = { data: THREE, error: null };
    expect(await getFoundersShowcase()).toEqual(THREE);
    expect(db.rpc).toEqual([{ fn: 'founders_showcase', params: undefined }]);
    expect(FOUNDERS_TAG).toBe('founders');
    expect(db.cacheOptions).toContainEqual({ tags: ['founders'], revalidate: 3600 });
  });

  it('sans clé service_role (build) : null, sans appel', async () => {
    db.key = undefined;
    expect(await getFoundersShowcase()).toBeNull();
    expect(db.rpc).toEqual([]);
  });

  it('base en erreur : null (la vitrine n’est pas affichée), pas dix places « libres »', async () => {
    db.rpcResult = { data: null, error: { message: 'panne' } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getFoundersShowcase()).toBeNull();
    spy.mockRestore();
  });

  it('place d’un commerce : un entier positif, sinon null', async () => {
    db.placeResult = { data: 12, error: null };
    expect(await getFoundersPlace('org-1')).toBe(12);
    expect(db.rpc.at(-1)).toEqual({ fn: 'founders_showcase_place', params: { p_organization_id: 'org-1' } });
    db.placeResult = { data: null, error: null };
    expect(await getFoundersPlace('org-1')).toBeNull();
  });
});

describe('l’accord (server/actions/founders.ts)', () => {
  beforeEach(reset);

  it('refuse sans la permission de gérer l’organisation, avant toute écriture', async () => {
    for (const role of ['member', 'manager'] as const) {
      db.role = role;
      const result = await setFoundersShowcase({ orgSlug: 'barber-house', optIn: true });
      expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    }
    expect(db.updates).toEqual([]);
    expect(db.audits).toEqual([]);
    expect(db.revalidatedTags).toEqual([]);
  });

  it('refuse une entrée qui n’est pas exactement { orgSlug, optIn: booléen }', async () => {
    for (const input of [
      { orgSlug: 'barber-house', optIn: 'oui' },
      { orgSlug: 'barber-house', optIn: true, name: 'Autre nom' },
      { orgSlug: '../x', optIn: true },
      null,
    ]) {
      expect(await setFoundersShowcase(input)).toMatchObject({ ok: false, code: 'validation' });
    }
    expect(db.updates).toEqual([]);
  });

  it('accord : écrit l’accord seul (l’heure vient de la base), audite, revalide « founders »', async () => {
    db.placeResult = { data: 3, error: null };
    const result = await setFoundersShowcase({ orgSlug: 'barber-house', optIn: true });
    expect(result).toEqual({ ok: true, data: { optIn: true, place: 3 } });
    expect(db.updates).toEqual([
      { table: 'organization_settings', values: { founders_opt_in: true }, filters: [['organization_id', 'org-1']] },
    ]);
    expect(db.audits).toEqual([
      expect.objectContaining({ organizationId: 'org-1', actorUserId: 'user-1', action: 'founders.opt_in' }),
    ]);
    expect(db.revalidatedTags).toEqual(['founders']);
    expect(db.revalidatedPaths).toEqual(['/app/barber-house/reglages']);
  });

  it('retrait : même chemin, trace « founders.opt_out », revalidation immédiate', async () => {
    const result = await setFoundersShowcase({ orgSlug: 'barber-house', optIn: false });
    expect(result).toEqual({ ok: true, data: { optIn: false, place: null } });
    expect(db.updates[0]?.values).toEqual({ founders_opt_in: false });
    expect(db.audits[0]?.action).toBe('founders.opt_out');
    expect(db.revalidatedTags).toEqual(['founders']);
  });

  it('écriture en échec : ni audit ni revalidation', async () => {
    db.updateError = { message: 'panne', code: 'XX000' };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await setFoundersShowcase({ orgSlug: 'barber-house', optIn: true });
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(db.audits).toEqual([]);
    expect(db.revalidatedTags).toEqual([]);
  });
});
