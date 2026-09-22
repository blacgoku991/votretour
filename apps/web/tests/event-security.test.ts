import { describe, expect, it } from 'vitest';
import {
  currentEventPassSlot,
  hashEventPassToken,
  signEventPassSlot,
  verifyEventPassSignature,
  makeEventPassCookie,
  verifyEventPassCookie,
} from '@/lib/event-pass';

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
