import { beforeAll, describe, expect, it } from 'vitest';
import { checkAppleConfig, type AppleWalletConfig } from '../../src/server/wallet/apple/config';
import { readZip } from '../../src/server/wallet/apple/pkpass';
import { distributeApplePass } from '../../src/server/wallet/apple/provider';
import { renderLatestPass } from '../../src/server/wallet/apple/routes';
import type { AppleStore } from '../../src/server/wallet/apple/store';
import { PkpassCache } from '../../src/server/wallet/apple/webservice';
import type { DistributeContext, IssuedWalletPass, WalletNaming, WalletSnapshot } from '../../src/server/wallet/types';
import { configInput, makePki } from './apple-fixtures';
import { snapshot } from './fixtures';

/**
 * Les deux chemins qui servent un .pkpass réel : le clic sur le badge
 * (distribute, § 8.1 du plan : en-têtes du téléchargement) et le service
 * web (GET /v1/passes : version enregistrée, puis cache par version).
 */

const NOW = new Date('2026-09-24T12:30:00Z');
let config: AppleWalletConfig;

beforeAll(() => {
  const check = checkAppleConfig(configInput(makePki()), new Date());
  if (!check.ok) throw new Error(check.reason);
  config = check.config;
});

function recordingStore(versions: { versionSeq: number; versionAt: string }[]) {
  const recorded: string[] = [];
  const store: Pick<AppleStore, 'recordRender'> = {
    recordRender: async (id, hash) => {
      recorded.push(`${id} ${hash}`);
      return versions[Math.min(recorded.length - 1, versions.length - 1)]!;
    },
  };
  return { store, recorded };
}

describe('distribution (clic sur « Ajouter à Apple Wallet »)', () => {
  it('pass émis, version enregistrée, .pkpass signé et en-têtes du téléchargement', async () => {
    const snap = snapshot();
    const namings: WalletNaming[] = [];
    const ctx = {
      request: new Request('https://rangvia.test/api/client/wallet/apple'),
      provider: 'apple',
      entryPublicId: 'Tk42abcdEFGH',
      organizationId: 'org',
      clientSessionId: 'session',
      eventPassPublicId: null,
      from: 'entry',
      returnTo: '/e/barber-house',
      now: NOW,
      issue: async (naming: WalletNaming) => {
        namings.push(naming);
        return { id: snap.pass.id, provider: 'apple', externalId: snap.pass.externalId, classRef: config.passTypeId, kind: 'queue', state: 'active', created: true, live: false } satisfies IssuedWalletPass;
      },
      snapshot: async () => snap,
    } satisfies DistributeContext;
    const { store, recorded } = recordingStore([{ versionSeq: 13, versionAt: '2026-09-24T12:29:41.512Z' }]);
    const full: AppleStore = {
      ...store, pushTargets: async () => [], dropTokens: async () => 0, register: async () => 'created',
      unregister: async () => true, serials: async () => [], lookup: async () => null,
    };

    const res = await distributeApplePass(ctx, config, full);
    expect(res.status).toBe(200);
    expect(namings).toEqual([{ provider: 'apple', passTypeId: config.passTypeId }]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatch(new RegExp(`^${snap.pass.id} [0-9a-f]{64}$`));
    const headers = Object.fromEntries(res.headers.entries());
    expect(headers).toMatchObject({
      'content-type': 'application/vnd.apple.pkpass',
      'content-disposition': 'attachment; filename="rangvia.pkpass"',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
      // À la seconde : c'est ce que l'iPhone renverra en If-Modified-Since.
      'last-modified': 'Thu, 24 Sep 2026 12:29:41 GMT',
    });
    const body = Buffer.from(await res.arrayBuffer());
    expect(headers['content-length']).toBe(String(body.length));
    const names = readZip(body).map((e) => e.info.name);
    expect(names[0]).toBe('pass.json');
    expect(names).toEqual(expect.arrayContaining(['manifest.json', 'signature', 'icon.png', 'logo@3x.png']));
  });

  it('instantané introuvable : lève (la coquille ramène le client à sa page)', async () => {
    const ctx = {
      request: new Request('https://rangvia.test/api/client/wallet/apple'),
      provider: 'apple', entryPublicId: 'x', organizationId: 'o', clientSessionId: null, eventPassPublicId: null,
      from: 'entry', returnTo: '/', now: NOW,
      issue: async () => ({ id: 'p', provider: 'apple', externalId: 'e', classRef: 'c', kind: 'queue', state: 'active', created: true, live: false } satisfies IssuedWalletPass),
      snapshot: async () => null,
    } satisfies DistributeContext;
    const store = { recordRender: async () => ({ versionSeq: 1, versionAt: NOW.toISOString() }) } as unknown as AppleStore;
    await expect(distributeApplePass(ctx, config, store)).rejects.toThrow(/introuvable/);
  });
});

describe('service web : rendu de la dernière version', () => {
  const opts = { sources: { logo: null, cover: null } };

  it('version enregistrée à chaque appel, une seule signature par (série, version)', async () => {
    const snap = snapshot();
    const { store, recorded } = recordingStore([
      { versionSeq: 5, versionAt: '2026-09-24T12:05:00Z' },
      { versionSeq: 5, versionAt: '2026-09-24T12:05:00Z' },
      { versionSeq: 6, versionAt: '2026-09-24T12:31:00Z' },
    ]);
    const cache = new PkpassCache();
    let clock = NOW;
    const render = renderLatestPass({ load: async () => snap, store, cache, clock: () => clock, ...opts });

    const first = await render(snap.pass.id, config);
    clock = new Date(NOW.getTime() + 5_000);
    const watch = await render(snap.pass.id, config);
    expect(recorded).toHaveLength(2);
    expect(first?.versionSeq).toBe(5);
    // La montre, 5 s après l'iPhone : les mêmes octets (signature comprise).
    expect(watch?.pkpass).toBe(first?.pkpass);
    expect(cache.size).toBe(1);

    const next = await render(snap.pass.id, config);
    expect(next?.versionSeq).toBe(6);
    expect(next?.pkpass).not.toBe(first?.pkpass);
    expect(cache.size).toBe(2);
  });

  it('pass révoqué, effacé ou introuvable : rien (401 côté route), aucune version enregistrée', async () => {
    const { store, recorded } = recordingStore([{ versionSeq: 1, versionAt: NOW.toISOString() }]);
    for (const snap of [null, snapshot({ pass: { state: 'revoked' } }), snapshot({ pass: { state: 'scrubbed' } })] as (WalletSnapshot | null)[]) {
      const render = renderLatestPass({ load: async () => snap, store, cache: new PkpassCache(), clock: () => NOW, ...opts });
      expect(await render('p', config)).toBeNull();
    }
    expect(recorded).toEqual([]);
  });

  it('pass final (Merci) : toujours servi', async () => {
    const snap = snapshot({ pass: { state: 'final' }, entry: { status: 'completed', completedAt: '2026-09-24T12:20:00Z' } });
    const { store } = recordingStore([{ versionSeq: 9, versionAt: NOW.toISOString() }]);
    const render = renderLatestPass({ load: async () => snap, store, cache: new PkpassCache(), clock: () => NOW, ...opts });
    expect((await render(snap.pass.id, config))?.versionSeq).toBe(9);
  });
});
