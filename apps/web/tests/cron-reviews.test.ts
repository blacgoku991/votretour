import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `GET/POST /api/cron/reviews` — avis Google différés.
 *
 * Même secret que les autres crons, comparé à temps constant ; une
 * réclamation par appel ; une panne répond 500 SUR CETTE ROUTE SEULEMENT
 * (les notifications des barbiers passent par `cron/notifications`, qui
 * n'en dépend pas).
 */

vi.hoisted(() => {
  process.env.CRON_SECRET = 'secret-du-cron-de-test';
});

const state = vi.hoisted(() => ({
  calls: 0,
  fail: null as Error | null,
  reported: [] as unknown[],
  compared: [] as [string, string][],
}));

vi.mock('@/server/notifications/dispatch', () => ({
  dispatchDueReviews: async () => {
    state.calls += 1;
    if (state.fail) throw state.fail;
    return { claimed: 3, sent: 2, failed: 0, skipped: 1, reasons: ['aucun abonnement push actif'] };
  },
}));

vi.mock('@/server/audit', () => ({
  reportError: async (params: unknown) => {
    state.reported.push(params);
  },
}));

vi.mock('@/lib/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crypto')>();
  return {
    ...actual,
    constantTimeEquals: (a: string, b: string) => {
      state.compared.push([a, b]);
      return actual.constantTimeEquals(a, b);
    },
  };
});

const { GET, POST } = await import('@/app/api/cron/reviews/route');

const request = (authorization?: string) =>
  new Request('https://rangvia.test/api/cron/reviews', {
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => {
  state.calls = 0;
  state.fail = null;
  state.reported.length = 0;
  state.compared.length = 0;
});

describe('cron des avis différés', () => {
  it('refuse sans secret : 401, et rien n’est réclamé', async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(state.calls).toBe(0);
  });

  it('refuse un mauvais secret, comparé à temps constant', async () => {
    for (const header of ['Bearer mauvais', 'Bearer secret-du-cron-de-tes', 'secret-du-cron-de-test', 'Basic secret-du-cron-de-test']) {
      const response = await GET(request(header));
      expect(response.status, header).toBe(401);
    }
    expect(state.calls).toBe(0);
    expect(state.compared).toContainEqual(['mauvais', 'secret-du-cron-de-test']);
  });

  it('appelle dispatchDueReviews une fois et rend le bilan, sans détail', async () => {
    const response = await GET(request('Bearer secret-du-cron-de-test'));
    expect(response.status).toBe(200);
    expect(state.calls).toBe(1);
    expect(await response.json()).toEqual({ ok: true, claimed: 3, sent: 2, failed: 0, skipped: 1 });
  });

  it('accepte aussi POST, avec le même contrôle', async () => {
    expect(POST).toBe(GET);
    expect((await POST(request())).status).toBe(401);
  });

  it('répond 500 et signale la panne, sans la cacher derrière « rien à envoyer »', async () => {
    state.fail = new Error('réclamation des avis différés impossible : connexion perdue');
    const response = await GET(request('Bearer secret-du-cron-de-test'));
    expect(response.status).toBe(500);
    expect(state.calls).toBe(1);
    expect(state.reported).toEqual([{ source: 'cron.reviews', message: state.fail.message }]);
  });
});

describe('isolation', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('le cron des notifications ne dépend pas des avis différés', () => {
    const notifications = read('../src/app/api/cron/notifications/route.ts');
    expect(notifications).not.toMatch(/dispatchDueReviews|claim_due_review_notifications|cron\/reviews/);
  });

  it('le service cron de production appelle la route chaque minute, avec le même secret', () => {
    // Sans cette ligne, rien n'appelle jamais la route : les avis différés
    // (restaurant, 75 min après « Installer ») ne partiraient pas.
    const compose = read('../../../deploy/docker-compose.yml');
    const cron = compose.slice(compose.indexOf('\n  cron:'), compose.indexOf('\nvolumes:'));
    expect(cron).toContain('while true; do');
    const loop = cron.slice(cron.indexOf('while true; do'), cron.indexOf('done'));
    // Appel HORS du bloc horaire (`if … date +%M`) : chaque tour de boucle.
    const hourly = loop.indexOf('if [');
    const call = loop.indexOf('http://app:3000/api/cron/reviews || true');
    expect(call).toBeGreaterThan(-1);
    expect(hourly === -1 || call < hourly).toBe(true);
    // Même forme que l'appel des notifications : secret du cron, échec toléré.
    const block = loop.slice(loop.lastIndexOf('curl', call), call);
    expect(block).toContain('-H "Authorization: Bearer $$CRON_SECRET"');
    expect(block).toMatch(/-m \d+/);
  });

  it('la route lit le même secret que les autres crons', () => {
    const route = read('../src/app/api/cron/reviews/route.ts');
    expect(route).toContain('env.cronSecret');
    expect(route).toContain('constantTimeEquals(token, env.cronSecret)');
  });
});
