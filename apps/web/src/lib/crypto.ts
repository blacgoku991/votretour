import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Identité client sans compte.
 *
 * L'appareil détient un jeton secret (cookie httpOnly côté web,
 * trousseau côté App Clip). La base ne stocke QUE son SHA-256 poivré :
 * une copie de la base ne permet pas de rejouer une session.
 */

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256')
    .update(`${env.sessionSecret ?? 'votretour-dev-pepper'}:session:${token}`)
    .digest('hex');
}

/**
 * Les adresses IP ne sont jamais stockées en clair (RGPD). On n'en
 * conserve qu'un condensat, utilisé pour l'anti-spam et la limitation
 * de débit, non réversible sans le secret serveur.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256')
    .update(`${env.sessionSecret ?? 'votretour-dev-pepper'}:ip:${ip}`)
    .digest('hex')
    .slice(0, 32);
}

export function hashUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return createHash('sha256').update(ua).digest('hex').slice(0, 32);
}

/** Empreinte stable d'un destinataire push (endpoint Web Push ou device token APNs). */
export function endpointFingerprint(channel: string, endpoint: string): string {
  return createHash('sha256').update(`${channel}:${endpoint}`).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Jeton d'invitation d'équipe : la valeur en clair n'est montrée qu'une fois. */
export function generateInviteToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  const hash = createHash('sha256')
    .update(`${env.sessionSecret ?? 'votretour-dev-pepper'}:invite:${token}`)
    .digest('hex');
  return { token, hash };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256')
    .update(`${env.sessionSecret ?? 'votretour-dev-pepper'}:invite:${token}`)
    .digest('hex');
}
