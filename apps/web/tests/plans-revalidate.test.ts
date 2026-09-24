import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lot S5 : enregistrer une offre invalide le cache étiqueté `plans`, que
 * lisent les pages métier statiques (lib/public-plans.ts). Sans cela, un
 * prix modifié par le super-admin resterait jusqu'à une heure en ligne.
 */

const spies = vi.hoisted(() => ({
  update: vi.fn(),
  revalidateTag: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: spies.revalidateTag }));
vi.mock('@/server/auth', () => ({ assertPlatformAdmin: async () => ({ id: 'admin-1' }) }));
vi.mock('@/server/audit', () => ({ audit: (...args: unknown[]) => spies.audit(...args) }));
vi.mock('@/server/queue', () => ({ propagate: vi.fn(), setQueueStatus: vi.fn() }));
vi.mock('@/server/notifications/dispatch', () => ({ dispatchEventEntryNotification: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (patch: unknown) => ({ eq: async () => spies.update(patch) }),
    }),
  }),
}));

const { updatePlan } = await import('@/server/actions/admin');
const { PLANS_TAG } = await import('@/lib/public-plans');

const PLAN_ID = '5d0c6f0e-0000-4000-8000-000000000001';

describe('updatePlan : revalidation des offres publiques', () => {
  beforeEach(() => {
    for (const spy of Object.values(spies)) spy.mockReset();
  });

  it('invalide le cache « plans » après un enregistrement réussi', async () => {
    spies.update.mockResolvedValue({ error: null });
    const result = await updatePlan({ planId: PLAN_ID, priceMonthCents: 2900 });
    expect(result.ok).toBe(true);
    expect(PLANS_TAG).toBe('plans');
    expect(spies.revalidateTag).toHaveBeenCalledWith(PLANS_TAG);
  });

  it("n'invalide rien si l'écriture échoue", async () => {
    spies.update.mockResolvedValue({ error: { message: 'panne', code: 'XX000' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await updatePlan({ planId: PLAN_ID, priceMonthCents: 2900 });
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(spies.revalidateTag).not.toHaveBeenCalled();
  });
});
