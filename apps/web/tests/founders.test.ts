import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * LES DIX PREMIERS COMMERCES — la vitrine du pied de page.
 *
 *  - dix places, du 1er au 10e ; on dessine les tickets pris, puis UNE
 *    seule place à prendre (la prochaine libre, vers /inscription), et les
 *    autres places libres en une latte neutre (« 05 à 10 : libres ») ;
 *    sans volontaire, la place n° 1 et l'invitation, sans grille ; aucun
 *    nom n'est inventé ; une ligne douteuse est écartée ;
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

const { FOUNDERS_PLACES, LONG_NAME, foundersLayout, openPlaceLabel, parseFounderRows, placeNumber, restPlacesLabel } =
  await import('@/components/founders/places');
const { FoundersQueue } = await import('@/components/founders/FoundersQueue');
const { FOUNDERS_TAG, getFoundersShowcase, getFoundersPlace } = await import('@/server/founders');
const { setFoundersShowcase } = await import('@/server/actions/founders');

const NBSP = ' ';
const TEN = Array.from({ length: 10 }, (_, i) => ({ place: i + 1, name: `Commerce ${i + 1}`, city: 'Lyon' }));
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
  it('sans volontaire : compact, la place n° 1 à prendre, rien d’autre', () => {
    const layout = foundersLayout([]);
    expect(FOUNDERS_PLACES).toBe(10);
    expect(layout).toEqual({
      places: [{ place: 1, kind: 'open' }],
      rest: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      taken: 0,
      free: 10,
      compact: true,
    });
  });

  it('trois volontaires : leurs tickets, la place n° 4 à prendre, 5 à 10 regroupées', () => {
    const layout = foundersLayout(THREE);
    expect(layout.places).toEqual([
      { place: 1, kind: 'taken', name: 'Barber House', city: 'Paris' },
      { place: 2, kind: 'taken', name: 'Garage 92', city: 'Nanterre' },
      { place: 3, kind: 'taken', name: 'Atelier Sans Ville', city: null },
      { place: 4, kind: 'open' },
    ]);
    expect(layout.rest).toEqual([5, 6, 7, 8, 9, 10]);
    expect(layout).toMatchObject({ taken: 3, free: 7, compact: false });
  });

  it('neuf volontaires : la place n° 10 à prendre, plus de latte', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ place: i + 1, name: `C${i + 1}`, city: null }));
    const layout = foundersLayout(nine);
    expect(layout.places.at(-1)).toEqual({ place: 10, kind: 'open' });
    expect(layout.rest).toEqual([]);
  });

  it('dix volontaires : dix tickets, aucune place à prendre', () => {
    const layout = foundersLayout(TEN);
    expect(layout.places.every((p) => p.kind === 'taken')).toBe(true);
    expect(layout).toMatchObject({ rest: [], taken: 10, free: 0, compact: false });
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
    // Un trou (place 2 à 4) : la place à prendre est la 2, la latte dit le reste exactement.
    const layout = foundersLayout(rows);
    expect(layout.places.map((p) => `${p.place}:${p.kind}`)).toEqual(['1:taken', '2:open', '5:taken']);
    expect(layout.rest).toEqual([3, 4, 6, 7, 8, 9, 10]);
    expect(restPlacesLabel(layout.rest)).toBe(`03, 04 et 06 à 10${NBSP}: libres`);
  });

  it('libellés : « 01 » à « 10 », « Place n° 4 : à prendre », « 05 à 10 : libres »', () => {
    expect(placeNumber(1)).toBe('01');
    expect(placeNumber(10)).toBe('10');
    expect(openPlaceLabel(4)).toBe(`Place n°${NBSP}4${NBSP}: à prendre`);
    expect(restPlacesLabel([5, 6, 7, 8, 9, 10])).toBe(`05 à 10${NBSP}: libres`);
    expect(restPlacesLabel([9, 10])).toBe(`09 et 10${NBSP}: libres`);
    expect(restPlacesLabel([10])).toBe(`Place n°${NBSP}10${NBSP}: libre`);
    expect(restPlacesLabel([])).toBe('');
  });
});

describe('la file du pied de page (rendu)', () => {
  const render = (founders: Parameters<typeof FoundersQueue>[0]['founders']) =>
    renderToStaticMarkup(createElement(FoundersQueue, { founders }));
  const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0;

  it('0 volontaire : version compacte, la place n° 1 et l’invitation, sans grille ni latte', () => {
    const html = render([]);
    expect(html).toContain('data-compact="true"');
    expect(count(html, /data-kind="open"/g)).toBe(1);
    expect(html).not.toContain('data-kind="taken"');
    expect(html).not.toContain('data-kind="rest"');
    expect(html).toContain(openPlaceLabel(1));
    expect(html).toContain('Votre commerce ici');
    // La place à prendre mène à l'inscription.
    expect(html).toMatch(/<a [^>]*href="\/inscription"[^>]*>(?:(?!<\/a>).)*Place n°/);
    // Rien qui annonce « aucun commerce » : on ne dessine pas dix cases vides.
    expect(html).not.toContain('libre');
  });

  it('3 volontaires : trois tickets, UNE place fantôme (n° 4), puis la latte « 05 à 10 : libres »', () => {
    const html = render(THREE);
    expect(count(html, /data-kind="taken"/g)).toBe(3);
    expect(count(html, /data-kind="open"/g)).toBe(1);
    expect(count(html, /data-kind="rest"/g)).toBe(1);
    expect(html).not.toContain('data-compact');
    expect(html).toContain('Barber House');
    expect(html).toContain('Nanterre');
    expect(html).toContain(`Encore 7${NBSP}places libres.`);
    expect(html).toContain(openPlaceLabel(4));
    expect(html).toContain(`05 à 10${NBSP}: libres`);
    // La latte finit la rangée de cinq : 3 tickets + 1 place à prendre → 1 colonne.
    expect(html).toMatch(/data-kind="rest" style="--i:4;--span:1"/);
    // Rien d'autre qu'un nom et une ville : ni image, ni lien vers le commerce.
    expect(html).not.toMatch(/<img|<a [^>]*href="\/e\//);
  });

  it('au téléphone, la pile s’arrête aux tickets pris + la place à prendre (latte masquée en CSS)', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../src/components/founders/FoundersQueue.module.css', import.meta.url)),
      'utf8',
    );
    // Hors media query : la latte est masquée ; elle n'apparaît qu'à partir de 760 px.
    const [base, desktop] = css.split('@media (min-width: 760px)');
    expect(base).toMatch(/\.rest \{ display: none; \}/);
    expect(desktop).toMatch(/\.rest \{\s*display: grid;/);
    // Le vermillon ne sert qu'à la place à prendre, jamais à la latte des places libres.
    expect(css).toMatch(/--rest-line: var\(--line-strong\)/);
  });

  it('10 volontaires : dix tickets, plus de place à prendre ni d’invitation', () => {
    const html = render(TEN);
    expect(count(html, /data-kind="taken"/g)).toBe(10);
    expect(html).not.toContain('data-kind="open"');
    expect(html).not.toContain('data-kind="rest"');
    expect(html).not.toContain('libre');
    expect(html).not.toContain('Votre commerce ici');
  });

  it('les numéros 01 à 10 sont décoratifs, la place est dite aux lecteurs d’écran', () => {
    const html = render(THREE);
    expect(html).toContain(`Place n°${NBSP}1${NBSP}: `);
    expect(html).toMatch(/<ol[^>]*>/);
  });

  it('nom long : corps réduit et infobulle avec le nom entier', () => {
    const long = 'Le Salon de Coiffure Mixte des Quatre Chemins';
    expect(long.length).toBeGreaterThan(LONG_NAME);
    const html = render([{ place: 1, name: long, city: 'Lyon' }]);
    expect(html).toContain(`data-long="true" title="${long}"`);
    expect(render(THREE)).not.toContain('data-long');
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
