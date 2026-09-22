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


const EVENT_COOKIE_PREFIX = 'event-session';

export function signEventPassCookie(publicId: string, expiresAt: number): string {
  if (!env.sessionSecret) {
    throw new Error('SESSION_HASH_SECRET est requis pour les sessions Event.');
  }
  return createHmac('sha256', env.sessionSecret)
    .update(`${EVENT_COOKIE_PREFIX}:${publicId}:${expiresAt}`, 'utf8')
    .digest('base64url');
}

export function makeEventPassCookie(publicId: string, expiresAt: number): string {
  const signature = signEventPassCookie(publicId, expiresAt);
  return `${publicId}.${expiresAt}.${signature}`;
}

export function verifyEventPassCookie(
  value: string | null | undefined,
  now = Date.now(),
): { publicId: string; expiresAt: number } | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;

  const [publicId, expiresRaw, signature] = parts;
  if (!publicId || !/^[0-9A-Za-z]{12,32}$/.test(publicId)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return null;

  const expected = signEventPassCookie(publicId, expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? '');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { publicId, expiresAt };
}


/**
 * Lien d'ouverture d'un laisser-passer.
 *
 * Contrairement à un bearer aléatoire stocké/transporté, ce lien est
 * dérivé à la demande d'un identifiant public + échéance et signé HMAC.
 * Il peut donc être régénéré en cas de retry push sans stocker de secret
 * récupérable en base.
 */
export function signEventAccessLink(publicId: string, expiresAt: number): string {
  if (!env.sessionSecret) {
    throw new Error('SESSION_HASH_SECRET est requis pour signer les accès Event.');
  }
  return createHmac('sha256', env.sessionSecret)
    .update(`event-access:${publicId}:${expiresAt}`, 'utf8')
    .digest('base64url')
    .slice(0, 43);
}

export function verifyEventAccessLink(
  publicId: string,
  expiresAt: number,
  signature: string,
  now = Date.now(),
): boolean {
  if (!/^[0-9A-Za-z]{12,32}$/.test(publicId)) return false;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;

  const expected = signEventAccessLink(publicId, expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function eventAccessPath(publicId: string, graceUntilIso: string): string {
  const expiresAt = Math.floor(new Date(graceUntilIso).getTime() / 1000);
  const signature = signEventAccessLink(publicId, expiresAt);
  return `/api/pass/access/${encodeURIComponent(publicId)}?exp=${expiresAt}&sig=${encodeURIComponent(signature)}`;
}
