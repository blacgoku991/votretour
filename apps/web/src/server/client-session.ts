import 'server-only';
import { cookies, headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateSessionToken, hashSessionToken, hashIp, hashUserAgent } from '@/lib/crypto';
import { env } from '@/lib/env';
import type { ClientPlatform } from '@/lib/types';

/**
 * Identité client sans compte.
 *
 * Le web conserve le jeton dans un cookie httpOnly ; l'App Clip et
 * l'application iOS l'envoient en en-tête Authorization. Dans les deux
 * cas la base ne voit qu'un SHA-256 poivré.
 *
 * La session est cloisonnée par organisation : un même téléphone chez
 * deux commerces donne deux sessions indépendantes. C'est à la fois plus
 * propre côté RGPD et strictement nécessaire à l'isolation multi-tenant.
 */

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

export function sessionCookieName(organizationId: string): string {
  return `vts_${organizationId.replace(/-/g, '').slice(0, 24)}`;
}

export interface ClientSessionContext {
  id: string;
  publicId: string;
  organizationId: string;
  displayName: string | null;
  /** Renseigné uniquement lorsqu'une nouvelle session vient d'être créée. */
  issuedToken?: string;
}

/** Récupère le jeton présenté par l'appareil (cookie web ou en-tête natif). */
export async function readClientToken(organizationId: string): Promise<string | null> {
  const headerList = await headers();
  const authorization = headerList.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7).trim();
    if (token.length >= 20) return token;
  }

  const cookieStore = await cookies();
  return cookieStore.get(sessionCookieName(organizationId))?.value ?? null;
}

function clientIp(headerList: Headers): string | null {
  const forwarded = headerList.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return headerList.get('x-real-ip');
}

/** Contexte de requête anonymisé, utilisé pour l'anti-spam. */
export async function requestFingerprint(): Promise<{ ipHash: string | null; uaHash: string | null; ip: string | null }> {
  const headerList = await headers();
  const ip = clientIp(headerList);
  return {
    ip,
    ipHash: hashIp(ip),
    uaHash: hashUserAgent(headerList.get('user-agent')),
  };
}

/** Devine la plateforme d'origine, pour choisir le bon canal de push. */
export async function detectPlatform(): Promise<ClientPlatform> {
  const headerList = await headers();
  const custom = headerList.get('x-votretour-platform');
  if (custom === 'ios_appclip' || custom === 'ios_app') return custom;

  const ua = headerList.get('user-agent') ?? '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'web';
  if (/Android/i.test(ua)) return 'android_web';
  return 'web';
}

/** Retrouve la session existante de cet appareil, sans en créer. */
export async function getClientSession(organizationId: string): Promise<ClientSessionContext | null> {
  const token = await readClientToken(organizationId);
  if (!token) return null;

  const { data } = await supabaseAdmin()
    .from('client_sessions')
    .select('id, public_id, organization_id, display_name, revoked_at, expires_at')
    .eq('token_hash', hashSessionToken(token))
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!data || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;

  return {
    id: data.id,
    publicId: data.public_id,
    organizationId: data.organization_id,
    displayName: data.display_name,
  };
}

/**
 * Récupère la session de l'appareil ou en crée une.
 * Le jeton n'est renvoyé que lorsqu'il vient d'être émis : l'appelant
 * doit alors le poser en cookie (web) ou le renvoyer au client natif.
 */
export async function getOrCreateClientSession(
  organizationId: string,
  options: { displayName?: string | null; platform?: ClientPlatform } = {},
): Promise<ClientSessionContext> {
  const existing = await getClientSession(organizationId);
  const fingerprint = await requestFingerprint();
  const platform = options.platform ?? (await detectPlatform());

  if (existing) {
    const token = await readClientToken(organizationId);
    if (token) {
      await supabaseAdmin().rpc('upsert_client_session', {
        p_organization_id: organizationId,
        p_token_hash: hashSessionToken(token),
        p_platform: platform,
        p_display_name: options.displayName ?? null,
        p_locale: 'fr',
        p_ip_hash: fingerprint.ipHash,
        p_user_agent_hash: fingerprint.uaHash,
      });
    }
    return {
      ...existing,
      displayName: options.displayName ?? existing.displayName,
    };
  }

  const token = generateSessionToken();
  const { data, error } = await supabaseAdmin().rpc('upsert_client_session', {
    p_organization_id: organizationId,
    p_token_hash: hashSessionToken(token),
    p_platform: platform,
    p_display_name: options.displayName ?? null,
    p_locale: 'fr',
    p_ip_hash: fingerprint.ipHash,
    p_user_agent_hash: fingerprint.uaHash,
  });

  if (error || !data) {
    throw new Error(`Impossible de créer la session client : ${error?.message ?? 'inconnu'}`);
  }

  const session = data as { id: string; publicId: string; organizationId: string; displayName: string | null };
  return { ...session, issuedToken: token };
}

/** Pose le cookie de session (web uniquement). */
export async function persistSessionCookie(organizationId: string, token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(organizationId), token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}
