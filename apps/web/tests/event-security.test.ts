import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentEventPassSlot,
  hashEventPassToken,
  parseScanProof,
  signEventPassSlot,
  verifyEventPassSignature,
  verifyScanProof,
  makeEventPassCookie,
  verifyEventPassCookie,
  type ScanWalletPass,
} from '@/lib/event-pass';
import { signWalletQrCode, totp, walletTotpKey } from '@/lib/wallet/scan-proof';
import { AppError } from '@/lib/errors';

describe('sécurité des laisser-passer Event', () => {
  it('ne stocke qu’un SHA-256 du bearer token', () => {
    const token = 'a'.repeat(64);
    const hash = hashEventPassToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token.slice(0, 16));
  });

  it('signe un QR sur une tranche temporelle', () => {
    const now = Date.UTC(2026, 8, 23, 10, 0, 0);
    const slot = currentEventPassSlot(now);
    const hash = hashEventPassToken('b'.repeat(64));
    const signature = signEventPassSlot(hash, slot);

    expect(signature.length).toBeGreaterThanOrEqual(24);
    expect(verifyEventPassSignature(hash, slot, signature, now)).toBe(true);
  });

  it('refuse une signature modifiée', () => {
    const now = Date.UTC(2026, 8, 23, 10, 0, 0);
    const slot = currentEventPassSlot(now);
    const hash = hashEventPassToken('c'.repeat(64));
    const signature = signEventPassSlot(hash, slot);

    expect(verifyEventPassSignature(hash, slot, signature.slice(0, -1) + 'x', now)).toBe(false);
  });

  it('refuse un QR trop ancien', () => {
    const now = Date.UTC(2026, 8, 23, 10, 0, 0);
    const current = currentEventPassSlot(now);
    const oldSlot = current - 2;
    const hash = hashEventPassToken('d'.repeat(64));
    const signature = signEventPassSlot(hash, oldSlot);

    expect(verifyEventPassSignature(hash, oldSlot, signature, now)).toBe(false);
  });

  it('tolère uniquement la tranche précédente pour les délais réseau', () => {
    const now = Date.UTC(2026, 8, 23, 10, 0, 0);
    const current = currentEventPassSlot(now);
    const previous = current - 1;
    const hash = hashEventPassToken('e'.repeat(64));
    const signature = signEventPassSlot(hash, previous);

    expect(verifyEventPassSignature(hash, previous, signature, now)).toBe(true);
  });

  it('signe une session de pass courte sans réexposer le bearer', () => {
    const now = Date.UTC(2026, 8, 23, 10, 0, 0);
    const publicId = 'AbCdEfGh23456789';
    const expiresAt = Math.floor(now / 1000) + 600;
    const cookie = makeEventPassCookie(publicId, expiresAt);

    expect(cookie).not.toContain('a'.repeat(32));
    expect(verifyEventPassCookie(cookie, now)).toEqual({ publicId, expiresAt });
  });

  it('refuse un cookie de pass altéré ou expiré', () => {
    const now = Date.UTC(2026, 8, 23, 10, 0, 0);
    const publicId = 'AbCdEfGh23456789';
    const expiresAt = Math.floor(now / 1000) + 60;
    const cookie = makeEventPassCookie(publicId, expiresAt);

    expect(verifyEventPassCookie(cookie + 'x', now)).toBeNull();
    expect(verifyEventPassCookie(cookie, now + 61_000)).toBeNull();
  });
});

/* =====================================================================
   Contrôle à l'entrée : QR web, billet Wallet statique, TOTP Google
   ===================================================================== */

const TOKEN = hashEventPassToken('w'.repeat(64));
const APPLE: ScanWalletPass = { id: '7b0f3c1e-2a44-4c1b-9d0e-5f6a7b8c9d01', provider: 'apple' };
const GOOGLE: ScanWalletPass = { id: '8c1f4d2f-3b55-4d2c-8e1f-6a7b8c9d0e12', provider: 'google' };
const otpFor = (pass: ScanWalletPass, t: number, token = TOKEN) =>
  totp(walletTotpKey(token, pass.id), Math.floor(t / 30));

describe('lecture de la preuve dans l’URL scannée', () => {
  it('reconnaît les trois formes', () => {
    const sig = 'a'.repeat(32);
    expect(parseScanProof({ slot: '58921', sig })).toEqual({ kind: 'slot', slot: 58921, sig });
    expect(parseScanProof({ w: 'Qm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFi' }))
      .toEqual({ kind: 'wallet', w: 'Qm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFi' });
    expect(parseScanProof({ t: '1790000000', otp: '01234567' }))
      .toEqual({ kind: 'totp', t: 1790000000, otp: '01234567' });
  });

  it('refuse une forme incomplète, répétée ou hors bornes', () => {
    expect(parseScanProof({})).toBeNull();
    expect(parseScanProof({ slot: '1' })).toBeNull();
    expect(parseScanProof({ slot: 'abc', sig: 'a'.repeat(32) })).toBeNull();
    expect(parseScanProof({ slot: '0', sig: 'a'.repeat(32) })).toBeNull();
    expect(parseScanProof({ slot: '12', sig: 'court' })).toBeNull();
    // Un paramètre répété arrive en tableau : ni l'un ni l'autre n'est pris.
    expect(parseScanProof({ w: ['a', 'b'] })).toBeNull();
    expect(parseScanProof({ w: 'x'.repeat(65) })).toBeNull();
    expect(parseScanProof({ w: 'pas de blancs' })).toBeNull();
    expect(parseScanProof({ t: '1790000000' })).toBeNull();
    expect(parseScanProof({ t: '-5', otp: '01234567' })).toBeNull();
    expect(parseScanProof({ t: '1790000000', otp: '12ab' })).toBeNull();
  });
});

describe('validateur unique verifyScanProof', () => {
  const now = new Date('2026-09-24T18:30:00Z');
  const nowS = Math.floor(now.getTime() / 1000);
  const base = { tokenHash: TOKEN, walletQrEnabled: true, walletPasses: [APPLE, GOOGLE], now };

  it('QR tournant de /pass : inchangé, et indépendant de l’interrupteur Wallet', () => {
    const slot = currentEventPassSlot(now.getTime());
    const sig = signEventPassSlot(TOKEN, slot);
    for (const walletQrEnabled of [true, false]) {
      expect(verifyScanProof({ ...base, walletQrEnabled, proof: { kind: 'slot', slot, sig } }))
        .toEqual({ ok: true, source: 'web' });
    }
    expect(verifyScanProof({ ...base, proof: { kind: 'slot', slot, sig: `${sig.slice(0, -1)}x` } }))
      .toEqual({ ok: false, reason: 'invalid' });
  });

  it('billet Wallet statique : reconnu et attribué à son fournisseur', () => {
    const apple = signWalletQrCode(TOKEN, APPLE.id);
    const google = signWalletQrCode(TOKEN, GOOGLE.id);
    expect(verifyScanProof({ ...base, proof: { kind: 'wallet', w: apple } })).toEqual({ ok: true, source: 'apple' });
    expect(verifyScanProof({ ...base, proof: { kind: 'wallet', w: google } })).toEqual({ ok: true, source: 'google' });
  });

  it('billet Wallet falsifié ou d’un autre accès : refusé', () => {
    const code = signWalletQrCode(TOKEN, APPLE.id);
    const forged = `${code.slice(0, 31)}${code.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyScanProof({ ...base, proof: { kind: 'wallet', w: forged } })).toEqual({ ok: false, reason: 'invalid' });
    // Code d'un autre client pour le même drop : lié à un autre accès.
    const other = signWalletQrCode(hashEventPassToken('z'.repeat(64)), APPLE.id);
    expect(verifyScanProof({ ...base, proof: { kind: 'wallet', w: other } })).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyScanProof({ ...base, proof: { kind: 'wallet', w: 'court' } })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('nouvelle vague (nouveau token_hash) : l’ancien code ne vaut plus rien', () => {
    const before = signWalletQrCode(TOKEN, APPLE.id);
    const nextWave = hashEventPassToken('n'.repeat(64));
    expect(verifyScanProof({ ...base, tokenHash: nextWave, proof: { kind: 'wallet', w: before } }))
      .toEqual({ ok: false, reason: 'invalid' });
  });

  it('pass Wallet révoqué ou effacé : absent de la liste, donc refusé', () => {
    const code = signWalletQrCode(TOKEN, APPLE.id);
    expect(verifyScanProof({ ...base, walletPasses: [GOOGLE], proof: { kind: 'wallet', w: code } }))
      .toEqual({ ok: false, reason: 'invalid' });
    expect(verifyScanProof({ ...base, walletPasses: [], proof: { kind: 'wallet', w: code } }))
      .toEqual({ ok: false, reason: 'invalid' });
  });

  it('interrupteur coupé : preuves Wallet refusées, même valides', () => {
    const w = signWalletQrCode(TOKEN, APPLE.id);
    expect(verifyScanProof({ ...base, walletQrEnabled: false, proof: { kind: 'wallet', w } }))
      .toEqual({ ok: false, reason: 'wallet_disabled' });
    expect(verifyScanProof({ ...base, walletQrEnabled: false, proof: { kind: 'totp', t: nowS, otp: otpFor(GOOGLE, nowS) } }))
      .toEqual({ ok: false, reason: 'wallet_disabled' });
  });

  it('TOTP Google : fenêtre −90 s / +30 s, rejeu hors fenêtre refusé', () => {
    const at = (t: number) => verifyScanProof({ ...base, proof: { kind: 'totp', t, otp: otpFor(GOOGLE, t) } });
    expect(at(nowS)).toEqual({ ok: true, source: 'google' });
    expect(at(nowS - 90)).toEqual({ ok: true, source: 'google' });
    expect(at(nowS + 30)).toEqual({ ok: true, source: 'google' });
    // Capture d'écran rejouée deux minutes plus tard.
    expect(at(nowS - 120)).toEqual({ ok: false, reason: 'invalid' });
    expect(at(nowS + 31)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('TOTP : code retouché, horodatage déplacé, ou clé d’un pass Apple refusés', () => {
    const t = nowS - 12;
    const good = otpFor(GOOGLE, t);
    const bad = good.replace(/.$/, (d) => String((Number(d) + 1) % 10));
    expect(verifyScanProof({ ...base, proof: { kind: 'totp', t, otp: bad } })).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyScanProof({ ...base, proof: { kind: 'totp', t: t - 60, otp: good } })).toEqual({ ok: false, reason: 'invalid' });
    // Seul Google reçoit une clé TOTP : un code calculé pour le pass Apple
    // ne peut provenir que d'une fuite, il est refusé.
    expect(verifyScanProof({ ...base, proof: { kind: 'totp', t, otp: otpFor(APPLE, t) } })).toEqual({ ok: false, reason: 'invalid' });
  });
});

/* ---------------------------------------------------------------------
   Action serveur redeemEventPass : la preuve est revérifiée au rachat,
   après le contrôle d'appartenance, et la base fait foi (usage unique).
   --------------------------------------------------------------------- */

interface DbCall { table: string; ops: [string, ...unknown[]][] }
const db = {
  calls: [] as DbCall[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  /** Ligne rendue par maybeSingle/single ; une fonction choisit selon la requête. */
  single: {} as Record<string, unknown>,
  /** Réponse d'une fonction SQL nommée ; à défaut, rpcResult. */
  rpcData: {} as Record<string, unknown>,
  lists: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  rpcResult: { status: 'redeemed', queueId: 'q-1', clientName: 'Zoé', redeemedAt: '2026-09-24T18:30:05Z', passPublicId: 'AccesPublic0001' } as Record<string, unknown>,
};

function builder(table: string) {
  const call: DbCall = { table, ops: [] };
  db.calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'in', 'limit', 'order', 'update', 'insert']) {
    chain[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args]);
      return chain;
    };
  }
  const row = () => {
    const value = db.single[table];
    return (typeof value === 'function' ? (value as (c: DbCall) => unknown)(call) : value) ?? null;
  };
  chain.maybeSingle = async () => ({ data: row(), error: null });
  chain.single = async () => ({ data: row(), error: null });
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(db.lists[table] ?? { data: [], error: null }).then(resolve, reject);
  return chain;
}

const spies = {
  assertQueueAccess: vi.fn(),
  assertOrgMembership: vi.fn(),
  sessionUser: vi.fn(),
  notFound: vi.fn(),
  audit: vi.fn(),
  rateLimit: vi.fn(),
  propagate: vi.fn(),
  statuses: vi.fn(),
};

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.rpcs.push({ fn, args });
      return { data: fn in db.rpcData ? db.rpcData[fn] : db.rpcResult, error: null };
    },
  }),
}));
vi.mock('@/server/auth', () => ({
  assertQueueAccess: (...args: unknown[]) => spies.assertQueueAccess(...args),
  assertOrgMembership: (...args: unknown[]) => spies.assertOrgMembership(...args),
  getSessionUser: async () => spies.sessionUser(),
}));
vi.mock('@/server/audit', () => ({ audit: (...args: unknown[]) => spies.audit(...args) }));
vi.mock('@/server/ratelimit', () => ({
  enforceRateLimit: (...args: unknown[]) => spies.rateLimit(...args),
  LIMITS: { staffAction: { max: 300, window: 60 } },
}));
vi.mock('@/server/queue', () => ({
  propagate: (...args: unknown[]) => spies.propagate(...args),
  setQueueStatus: vi.fn(),
}));
vi.mock('@/server/notifications/dispatch', () => ({ dispatchEventEntryNotification: vi.fn() }));
vi.mock('@/server/wallet/providers', () => ({ walletStatuses: async () => spies.statuses() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// notFound() de Next interrompt le rendu en levant une erreur : même geste ici.
vi.mock('next/navigation', () => ({
  notFound: () => {
    spies.notFound();
    throw new Error('NEXT_NOT_FOUND');
  },
}));
// La carte est un composant client : la page est jugée sur ce qu'elle lui passe.
vi.mock('@/app/scan/[token]/ScanPassCard', () => ({ ScanPassCard: () => null }));

const { redeemEventPass, setEventWalletQr, readEventWalletSettings } = await import('@/server/actions/events');

const PASS_ID = 'AccesPublic0001';
const ENTRY_ID = '11111111-2222-4333-8444-555555555555';
const EVENT_ID = '99999999-8888-4777-8666-555555555555';
const EXPIRED_MESSAGE = 'Ce QR a expiré. Demandez au client de rouvrir son laisser-passer.';

function accessRow(walletQrEnabled = true) {
  return {
    token_hash: TOKEN,
    queue_entry_id: ENTRY_ID,
    event_campaigns: { queue_id: 'q-1', wallet_qr_enabled: walletQrEnabled },
  };
}

beforeEach(() => {
  db.calls.length = 0;
  db.rpcs.length = 0;
  db.single = { event_access_passes: accessRow() };
  db.lists = { wallet_passes: { data: [APPLE, GOOGLE], error: null } };
  db.rpcResult = { status: 'redeemed', queueId: 'q-1', clientName: 'Zoé', redeemedAt: '2026-09-24T18:30:05Z', passPublicId: PASS_ID };
  db.rpcData = {};
  for (const spy of Object.values(spies)) spy.mockReset();
  spies.sessionUser.mockResolvedValue({ id: 'user-1' });
  spies.assertOrgMembership.mockResolvedValue({ user: { id: 'user-1' }, role: 'member' });
  spies.assertQueueAccess.mockResolvedValue({ user: { id: 'user-1' }, role: 'member', organizationId: 'org-1', locationId: 'loc-1' });
  spies.statuses.mockResolvedValue({ apple: { ready: false, reason: 'non construit' }, google: { ready: false, reason: 'non construit' } });
});

const walletQuery = () => db.calls.find((call) => call.table === 'wallet_passes');

describe('redeemEventPass : billet Wallet', () => {
  it('code Apple valide : rachat en base, audit avec la provenance', async () => {
    const res = await redeemEventPass({ kind: 'wallet', passId: PASS_ID, w: signWalletQrCode(TOKEN, APPLE.id) });
    expect(res).toEqual({ ok: true, data: { status: 'redeemed', clientName: 'Zoé', redeemedAt: '2026-09-24T18:30:05Z' } });
    expect(db.rpcs).toEqual([{ fn: 'redeem_event_pass', args: { p_token_hash: TOKEN, p_actor_user_id: 'user-1' } }]);
    expect(spies.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'event.pass_checked',
      metadata: { result: 'redeemed', via: 'apple' },
    }));
    // Seuls les passes du MÊME ticket, billets de drop, ni révoqués ni effacés.
    expect(walletQuery()?.ops).toEqual(expect.arrayContaining([
      ['select', 'id, provider'],
      ['eq', 'queue_entry_id', ENTRY_ID],
      ['eq', 'kind', 'event'],
      ['in', 'state', ['active', 'final']],
    ]));
  });

  it('code rejoué après l’entrée : la base répond already_redeemed, rien n’est validé deux fois', async () => {
    db.rpcResult = { status: 'already_redeemed', redeemedAt: '2026-09-24T18:30:05Z', queueId: 'q-1' };
    const res = await redeemEventPass({ kind: 'wallet', passId: PASS_ID, w: signWalletQrCode(TOKEN, APPLE.id) });
    expect(res).toEqual({ ok: true, data: { status: 'already_redeemed', clientName: null, redeemedAt: '2026-09-24T18:30:05Z' } });
  });

  it('code falsifié : refus avec le message habituel, aucun rachat', async () => {
    const code = signWalletQrCode(TOKEN, APPLE.id);
    const res = await redeemEventPass({ kind: 'wallet', passId: PASS_ID, w: `${code.slice(0, 31)}${code.endsWith('A') ? 'B' : 'A'}` });
    expect(res).toEqual({ ok: false, code: 'invalid_pass', error: EXPIRED_MESSAGE });
    expect(db.rpcs).toEqual([]);
  });

  it('pass Wallet révoqué ou effacé : la lecture ne le rend plus, refus', async () => {
    db.lists.wallet_passes = { data: [], error: null };
    const res = await redeemEventPass({ kind: 'wallet', passId: PASS_ID, w: signWalletQrCode(TOKEN, APPLE.id) });
    expect(res).toEqual({ ok: false, code: 'invalid_pass', error: EXPIRED_MESSAGE });
    expect(db.rpcs).toEqual([]);
  });

  it('lecture des passes en échec : refus prudent, jamais d’acceptation par défaut', async () => {
    db.lists.wallet_passes = { data: null, error: { message: 'relation absente' } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await redeemEventPass({ kind: 'wallet', passId: PASS_ID, w: signWalletQrCode(TOKEN, APPLE.id) });
    spy.mockRestore();
    expect(res).toMatchObject({ ok: false, code: 'invalid_pass' });
    expect(db.rpcs).toEqual([]);
  });

  it('interrupteur coupé : refus explicite, sans même lire les passes', async () => {
    db.single.event_access_passes = accessRow(false);
    const res = await redeemEventPass({ kind: 'wallet', passId: PASS_ID, w: signWalletQrCode(TOKEN, APPLE.id) });
    expect(res).toMatchObject({ ok: false, code: 'wallet_not_accepted' });
    expect(walletQuery()).toBeUndefined();
    expect(db.rpcs).toEqual([]);
  });

  it('TOTP Google dans la fenêtre : accepté ; hors fenêtre : refusé', async () => {
    const t = Math.floor(Date.now() / 1000);
    const ok = await redeemEventPass({ kind: 'totp', passId: PASS_ID, t, otp: otpFor(GOOGLE, t) });
    expect(ok).toMatchObject({ ok: true, data: { status: 'redeemed' } });
    expect(spies.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { result: 'redeemed', via: 'google' } }));

    db.rpcs.length = 0;
    const old = t - 180;
    const late = await redeemEventPass({ kind: 'totp', passId: PASS_ID, t: old, otp: otpFor(GOOGLE, old) });
    expect(late).toEqual({ ok: false, code: 'invalid_pass', error: EXPIRED_MESSAGE });
    expect(db.rpcs).toEqual([]);
  });

  it('QR tournant web : toujours accepté, interrupteur coupé compris, sans lecture Wallet', async () => {
    db.single.event_access_passes = accessRow(false);
    const slot = currentEventPassSlot();
    const res = await redeemEventPass({ kind: 'slot', passId: PASS_ID, slot, sig: signEventPassSlot(TOKEN, slot) });
    expect(res).toMatchObject({ ok: true, data: { status: 'redeemed' } });
    expect(walletQuery()).toBeUndefined();
    expect(spies.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { result: 'redeemed', via: 'web' } }));
  });

  it('appartenance vérifiée AVANT la preuve : un compte étranger ne peut pas tester de codes', async () => {
    spies.assertQueueAccess.mockRejectedValue(new AppError('forbidden', "Vous n'avez pas accès à cet établissement.", 403));
    const res = await redeemEventPass({ kind: 'wallet', passId: PASS_ID, w: signWalletQrCode(TOKEN, APPLE.id) });
    expect(res).toMatchObject({ ok: false, code: 'forbidden' });
    expect(walletQuery()).toBeUndefined();
    expect(spies.rateLimit).not.toHaveBeenCalled();
    expect(db.rpcs).toEqual([]);
  });

  it('forme inconnue ou incomplète : rejetée par le schéma', async () => {
    const res = await redeemEventPass({ kind: 'nfc', passId: PASS_ID } as never);
    expect(res.ok).toBe(false);
    // `w` manquant : la forme wallet est incomplète.
    const partial = await redeemEventPass({ kind: 'wallet', passId: PASS_ID, slot: 1 } as never);
    expect(partial.ok).toBe(false);
    expect(db.calls).toEqual([]);
  });

  it('forme mêlée, chaque moitié valide : rejetée, jamais nettoyée en silence', async () => {
    const slot = currentEventPassSlot();
    const w = signWalletQrCode(TOKEN, APPLE.id);
    const t = Math.floor(Date.now() / 1000);
    const mixed = [
      { kind: 'wallet', passId: PASS_ID, w, slot, sig: signEventPassSlot(TOKEN, slot) },
      { kind: 'slot', passId: PASS_ID, slot, sig: signEventPassSlot(TOKEN, slot), w },
      { kind: 'totp', passId: PASS_ID, t, otp: otpFor(GOOGLE, t), w },
    ];
    for (const input of mixed) {
      expect(await redeemEventPass(input as never)).toMatchObject({ ok: false });
    }
    expect(db.calls).toEqual([]);
    expect(db.rpcs).toEqual([]);
  });
});

describe('réglage « Accepter le billet Wallet au contrôle »', () => {
  const liveEvent = { id: EVENT_ID, queue_id: 'q-1', organization_id: 'org-1', location_id: 'loc-1', name: 'Drop', status: 'live', locations: { slug: 'x' } };

  it('enregistré avec la permission de configuration, et audité', async () => {
    db.single.event_campaigns = liveEvent;
    db.lists.event_campaigns = { data: [{ id: EVENT_ID }], error: null };
    const res = await setEventWalletQr({ eventId: EVENT_ID, enabled: false });
    expect(res).toEqual({ ok: true, data: { enabled: false } });
    expect(spies.assertQueueAccess).toHaveBeenCalledWith('q-1', 'queue.configure');
    const update = db.calls.find((call) => call.ops.some(([op]) => op === 'update'));
    expect(update?.ops).toEqual(expect.arrayContaining([
      ['update', { wallet_qr_enabled: false }],
      ['eq', 'id', EVENT_ID],
      ['eq', 'organization_id', 'org-1'],
      ['select', 'id'],
    ]));
    expect(spies.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'event.wallet_qr_changed', targetId: EVENT_ID, metadata: { enabled: false },
    }));
  });

  it('refusé sans la permission, ou sur un événement terminé', async () => {
    db.single.event_campaigns = liveEvent;
    spies.assertQueueAccess.mockRejectedValue(new AppError('forbidden', 'Votre rôle ne permet pas cette action.', 403));
    expect(await setEventWalletQr({ eventId: EVENT_ID, enabled: true })).toMatchObject({ ok: false, code: 'forbidden' });

    spies.assertQueueAccess.mockResolvedValue({ user: { id: 'user-1' }, role: 'owner', organizationId: 'org-1', locationId: 'loc-1' });
    db.single.event_campaigns = { ...liveEvent, status: 'ended' };
    expect(await setEventWalletQr({ eventId: EVENT_ID, enabled: true })).toMatchObject({ ok: false, code: 'event_closed' });
    expect(db.calls.some((call) => call.ops.some(([op]) => op === 'update'))).toBe(false);
    expect(spies.audit).not.toHaveBeenCalled();
  });

  it('événement effacé entre la lecture et l’écriture : aucune ligne, refus sans audit', async () => {
    db.single.event_campaigns = liveEvent;
    db.lists.event_campaigns = { data: [], error: null };
    expect(await setEventWalletQr({ eventId: EVENT_ID, enabled: false }))
      .toMatchObject({ ok: false, code: 'not_found' });
    expect(spies.audit).not.toHaveBeenCalled();
  });

  const eventsRead = () => db.calls.find((call) => call.table === 'event_campaigns');

  it('lecture : masqué tant qu’aucun fournisseur n’est prêt, filtré par organisation et par statut', async () => {
    db.single.organizations = { id: 'org-1' };
    db.lists.event_campaigns = { data: [{ id: EVENT_ID, wallet_qr_enabled: false }], error: null };
    const hidden = await readEventWalletSettings({ orgSlug: 'barber-house' });
    expect(hidden).toEqual({ ok: true, data: { available: false, enabled: { [EVENT_ID]: false } } });
    expect(spies.assertOrgMembership).toHaveBeenCalledWith('org-1');
    expect(db.calls.find((call) => call.table === 'organizations')?.ops)
      .toEqual(expect.arrayContaining([['eq', 'slug', 'barber-house']]));
    // Le serveur choisit les événements : ceux de l'organisation, encore
    // ouverts. Aucun identifiant ne vient du navigateur.
    expect(eventsRead()?.ops).toEqual([
      ['select', 'id, wallet_qr_enabled'],
      ['eq', 'organization_id', 'org-1'],
      ['in', 'status', ['draft', 'live', 'paused']],
    ]);

    spies.statuses.mockResolvedValue({ apple: { ready: true, reason: null }, google: { ready: false, reason: 'x' } });
    db.lists.event_campaigns = { data: [], error: null };
    expect(await readEventWalletSettings({ orgSlug: 'barber-house' }))
      .toEqual({ ok: true, data: { available: true, enabled: {} } });

    // Wallet coupé pour l'organisation : rien à régler.
    db.single.organization_settings = { features: { wallet: false } };
    expect(await readEventWalletSettings({ orgSlug: 'barber-house' }))
      .toMatchObject({ ok: true, data: { available: false } });
  });

  it('long historique (plus de 200 événements) : le réglage reste disponible', async () => {
    // Régression : la liste d'identifiants envoyée par la fiche était bornée
    // à 200 ; au-delà, la lecture échouait et l'interrupteur disparaissait
    // sans un mot, même avec un fournisseur prêt.
    db.single.organizations = { id: 'org-1' };
    spies.statuses.mockResolvedValue({ apple: { ready: true, reason: null }, google: { ready: true, reason: null } });
    const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const rows = Array.from({ length: 260 }, (_, i) => ({ id: uuid(i), wallet_qr_enabled: i % 2 === 0 }));
    db.lists.event_campaigns = { data: rows, error: null };

    const res = await readEventWalletSettings({ orgSlug: 'barber-house' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.available).toBe(true);
    expect(Object.keys(res.data.enabled)).toHaveLength(260);
    expect(res.data.enabled[uuid(1)]).toBe(false);
    expect(res.data.enabled[uuid(258)]).toBe(true);
    // Aucune liste d'identifiants dans la requête : pas d'URL démesurée.
    expect(eventsRead()?.ops.some(([op, column]) => op === 'in' && column === 'id')).toBe(false);

    // L'ancien appel, avec une liste, ne casse rien : la clé est ignorée.
    const legacy = await readEventWalletSettings({
      orgSlug: 'barber-house',
      eventIds: rows.map((row) => row.id),
    } as never);
    expect(legacy).toMatchObject({ ok: true, data: { available: true } });
  });

  it('lecture refusée : anonyme, slug inconnu ou organisation étrangère, sans lire les événements', async () => {
    spies.sessionUser.mockResolvedValue(null);
    expect(await readEventWalletSettings({ orgSlug: 'barber-house' }))
      .toMatchObject({ ok: false, code: 'unauthorized' });
    expect(db.calls).toEqual([]);

    spies.sessionUser.mockResolvedValue({ id: 'user-1' });
    expect(await readEventWalletSettings({ orgSlug: 'inconnu' }))
      .toMatchObject({ ok: false, code: 'forbidden' });
    expect(spies.assertOrgMembership).not.toHaveBeenCalled();

    db.single.organizations = { id: 'org-2' };
    spies.assertOrgMembership.mockRejectedValue(new AppError('forbidden', "Vous n'avez pas accès à cet établissement.", 403));
    expect(await readEventWalletSettings({ orgSlug: 'autre-commerce' }))
      .toMatchObject({ ok: false, code: 'forbidden' });
    expect(eventsRead()).toBeUndefined();
    expect(db.calls.some((call) => call.table === 'organization_settings')).toBe(false);
  });
});

/* ---------------------------------------------------------------------
   Page /scan/[token] : ce que voit le personnel, avant toute validation.
   --------------------------------------------------------------------- */

const { default: ScanPage } = await import('@/app/scan/[token]/page');

describe('page de contrôle /scan/[token]', () => {
  const FULL_PASS = {
    public_id: PASS_ID,
    status: 'issued',
    valid_until: '2099-01-01T00:10:00Z',
    grace_until: '2099-01-01T00:15:00Z',
    redeemed_at: null,
    queue_entries: { client_name: 'Zoé', ticket_number: '42' },
    event_campaigns: { name: 'Drop Air Max' },
    locations: { name: 'Comptoir Paris 11' },
  };

  function passRows(walletQrEnabled = true) {
    // Première lecture : les seules colonnes du contrôle d'accès ; seconde
    // lecture, après autorisation : ce que la carte affiche.
    db.single.event_access_passes = (call: DbCall) => {
      const select = String(call.ops.find(([op]) => op === 'select')?.[1] ?? '');
      return select.includes('token_hash')
        ? {
          public_id: PASS_ID, token_hash: TOKEN, queue_entry_id: ENTRY_ID,
          event_id: EVENT_ID, issued_at: '2026-09-24T18:20:00Z',
          event_campaigns: { queue_id: 'q-1', wallet_qr_enabled: walletQrEnabled },
        }
        : FULL_PASS;
    };
  }

  const render = async (query: Record<string, string>, passId = PASS_ID) => {
    const element = await ScanPage({
      params: Promise.resolve({ token: passId }),
      searchParams: Promise.resolve(query),
    });
    return (element as { props: Record<string, unknown> }).props;
  };

  const selects = (table: string) => db.calls
    .filter((call) => call.table === table)
    .map((call) => String(call.ops.find(([op]) => op === 'select')?.[1] ?? '').replace(/\s+/g, ' ').trim());

  beforeEach(() => {
    passRows();
    db.rpcData = { event_pass_wave: 3 };
  });

  it('preuve mal formée ou identifiant invalide : 404 avant toute lecture', async () => {
    for (const [query, passId] of [
      [{}, PASS_ID],
      [{ w: 'x'.repeat(65) }, PASS_ID],
      [{ w: 'pas un code' }, PASS_ID],
      [{ slot: '12' }, PASS_ID],
      [{ t: '1727200000' }, PASS_ID],
      [{ w: signWalletQrCode(TOKEN, APPLE.id) }, 'x!'],
    ] as const) {
      await expect(render(query, passId)).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(db.calls).toEqual([]);
    expect(db.rpcs).toEqual([]);
    expect(spies.assertQueueAccess).not.toHaveBeenCalled();
  });

  it('compte d’une autre organisation : arrêt après la lecture minimale, avant la preuve', async () => {
    spies.assertQueueAccess.mockRejectedValue(new AppError('forbidden', "Vous n'avez pas accès à cet établissement.", 403));
    await expect(render({ w: signWalletQrCode(TOKEN, APPLE.id) })).rejects.toMatchObject({ code: 'forbidden' });
    expect(spies.assertQueueAccess).toHaveBeenCalledWith('q-1', 'queue.operate');
    // Une seule lecture, sans prénom ni billet ; aucune preuve examinée.
    expect(selects('event_access_passes')).toHaveLength(1);
    expect(selects('event_access_passes')[0]).not.toMatch(/client_name|queue_entries/);
    expect(walletQuery()).toBeUndefined();
    expect(db.rpcs).toEqual([]);
  });

  it('billet Apple valide : fournisseur nommé, numéro et vague, sans lire tout `metadata`', async () => {
    const props = await render({ w: signWalletQrCode(TOKEN, APPLE.id) });
    expect(props).toMatchObject({
      passId: PASS_ID,
      check: { state: 'valid', source: 'apple' },
      passStatus: 'issued',
      clientName: 'Zoé',
      ticketNumber: 'A-042',
      wave: 3,
      eventName: 'Drop Air Max',
      locationName: 'Comptoir Paris 11',
    });
    expect(db.rpcs).toEqual([{ fn: 'event_pass_wave', args: { p_event_id: EVENT_ID, p_issued_at: '2026-09-24T18:20:00Z' } }]);
    const full = selects('event_access_passes')[1] ?? '';
    // Syntaxe PostgREST : un seul champ JSON extrait en texte, dans la
    // ressource embarquée du ticket ; jamais l'objet `metadata` entier.
    expect(full).toContain('queue_entries(client_name, ticket_number:metadata->>eventTicketNumber)');
    expect(full.replace('metadata->>eventTicketNumber', '')).not.toContain('metadata');
  });

  it('interrupteur coupé : verdict « Wallet non accepté », sans lire les passes', async () => {
    passRows(false);
    const props = await render({ w: signWalletQrCode(TOKEN, APPLE.id) });
    expect(props.check).toEqual({ state: 'wallet_disabled', source: 'wallet' });
    expect(walletQuery()).toBeUndefined();
  });

  it('preuve Wallet refusée : « Billet Wallet », jamais le nom d’un fournisseur non prouvé', async () => {
    const t = Math.floor(Date.now() / 1000);
    const good = otpFor(GOOGLE, t);
    const forged = good.replace(/.$/, (d) => String((Number(d) + 1) % 10));
    expect((await render({ t: String(t), otp: forged })).check).toEqual({ state: 'invalid', source: 'wallet' });
    // Rejoué hors fenêtre.
    const old = t - 600;
    expect((await render({ t: String(old), otp: otpFor(GOOGLE, old) })).check)
      .toEqual({ state: 'invalid', source: 'wallet' });
    // Et le vrai TOTP, lui, nomme Google.
    expect((await render({ t: String(t), otp: good })).check).toEqual({ state: 'valid', source: 'google' });
  });

  it('QR web valide : source « Page web », sans lecture Wallet', async () => {
    const slot = currentEventPassSlot();
    const props = await render({ slot: String(slot), sig: signEventPassSlot(TOKEN, slot) });
    expect(props.check).toEqual({ state: 'valid', source: 'web' });
    expect(walletQuery()).toBeUndefined();
  });
});
