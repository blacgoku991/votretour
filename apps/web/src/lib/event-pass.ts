import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/** Hash SHA-256 du bearer token. Le jeton brut n'est jamais stocké en base. */
export function hashEventPassToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Signature courte d'un QR Event.
 *
 * Le QR tourne par tranche de 30 s. Une capture d'écran ancienne ne reste
 * donc pas utile indéfiniment, et le serveur revérifie toujours le statut
 * du pass en base avant validation.
 */
export function signEventPassSlot(tokenHash: string, slot: number): string {
  if (!env.sessionSecret) {
    throw new Error('SESSION_HASH_SECRET est requis pour signer les laisser-passer Event.');
  }
  return createHmac('sha256', env.sessionSecret)
    .update(`event-pass:${tokenHash}:${slot}`, 'utf8')
    .digest('base64url')
    .slice(0, 32);
}

export function currentEventPassSlot(now = Date.now()): number {
  return Math.floor(now / 30_000);
}

export function verifyEventPassSignature(
  tokenHash: string,
  slot: number,
  signature: string,
  now = Date.now(),
): boolean {
  const current = currentEventPassSlot(now);
  // Tolérance réseau : tranche courante + précédente uniquement.
  if (slot < current - 1 || slot > current) return false;
  const expected = signEventPassSlot(tokenHash, slot);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
