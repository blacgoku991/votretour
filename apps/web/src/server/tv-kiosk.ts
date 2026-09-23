import 'server-only';

import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

export const TV_COOKIE = 'rv_tv_device';

function secret(): string {
  if (!env.sessionSecret) {
    throw new Error('SESSION_HASH_SECRET est requis pour les écrans TV.');
  }
  return env.sessionSecret;
}

function hash(scope: string, value: string): string {
  return createHmac('sha256', secret())
    .update(scope)
    .update(':')
    .update(value)
    .digest('hex');
}

export function hashTvPairCode(code: string): string {
  return hash('tv-pair-code', code);
}

export function hashTvDeviceToken(token: string): string {
  return hash('tv-device-token', token);
}

export function generateTvPairCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function generateTvDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface TvDeviceContext {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  organizationSlug: string;
  locationId: string;
  locationName: string;
  locationSlug: string;
  city: string | null;
  queueId: string;
  queueName: string;
  eventId: string | null;
  event: {
    id: string;
    name: string;
    status: string;
    heroTitle: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
    accentHex: string;
    rulesText: string | null;
    qrLabel: string | null;
  } | null;
  lastSeenAt: string | null;
}

export async function getTvDeviceByToken(rawToken: string | null | undefined): Promise<TvDeviceContext | null> {
  if (!rawToken) return null;

  const tokenHash = hashTvDeviceToken(rawToken);
  const db = supabaseAdmin();

  const { data: row } = await db
    .from('display_devices')
    .select(`
      id, name, organization_id, location_id, queue_id, event_id, last_seen_at,
      organizations(name, logo_url, slug),
      locations(name, slug, city),
      queues(name),
      event_campaigns(
        id, name, status, hero_title, logo_url, cover_url,
        accent_hex, rules_text, qr_label
      )
    `)
    .eq('token_hash', tokenHash)
    .eq('status', 'active')
    .maybeSingle();

  if (!row) return null;

  const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  const location = Array.isArray(row.locations) ? row.locations[0] : row.locations;
  const queue = Array.isArray(row.queues) ? row.queues[0] : row.queues;
  const event = Array.isArray(row.event_campaigns) ? row.event_campaigns[0] : row.event_campaigns;

  if (!organization || !location || !queue) return null;

  const lastSeenAt = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  if (!lastSeenAt || Date.now() - lastSeenAt > 60_000) {
    void db.from('display_devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', row.id)
      .then(({ error }) => {
        if (error) console.error('[tv] impossible de mettre à jour last_seen', error);
      });
  }

  return {
    id: row.id,
    name: row.name,
    organizationId: row.organization_id,
    organizationName: organization.name,
    organizationLogoUrl: organization.logo_url ?? null,
    organizationSlug: organization.slug,
    locationId: row.location_id,
    locationName: location.name,
    locationSlug: location.slug,
    city: location.city ?? null,
    queueId: row.queue_id,
    queueName: queue.name,
    eventId: row.event_id ?? null,
    event: event ? {
      id: event.id,
      name: event.name,
      status: event.status,
      heroTitle: event.hero_title ?? null,
      logoUrl: event.logo_url ?? null,
      coverUrl: event.cover_url ?? null,
      accentHex: event.accent_hex ?? '#FF4B1F',
      rulesText: event.rules_text ?? null,
      qrLabel: event.qr_label ?? null,
    } : null,
    lastSeenAt: row.last_seen_at ?? null,
  };
}
