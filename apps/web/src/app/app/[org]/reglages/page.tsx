import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isLegacyProfile } from '@/lib/profiles';
import { SettingsManager } from './SettingsManager';

export const metadata: Metadata = { title: 'Réglages', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  params, searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ lieu?: string; file?: string }>;
}) {
  const { org } = await params;
  const { lieu, file } = await searchParams;
  const access = await requireOrgAccess(org);
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();

  const { data: locations } = await db
    .from('locations')
    .select('id, name, address_line1, postal_code, city, phone, timezone, maps_url, google_review_url, latitude, longitude, is_active')
    .eq('organization_id', organizationId).order('created_at');

  const list = locations ?? [];
  const current = list.find((l) => l.id === lieu) ?? list[0] ?? null;

  const [
    { data: settings }, { data: queues }, { data: hours }, { data: services },
    { data: organization }, { data: staff }, { data: templateRows }, { data: orgQueues },
  ] =
    await Promise.all([
      db.from('organization_settings').select('*').eq('organization_id', organizationId).maybeSingle(),
      current
        ? db.from('queues').select('*').eq('location_id', current.id).order('created_at')
        : Promise.resolve({ data: [] }),
      current
        ? db.from('opening_hours').select('weekday, opens_at, closes_at, is_closed')
            .eq('location_id', current.id).order('weekday')
        : Promise.resolve({ data: [] }),
      current
        ? db.from('services').select('id, name, duration_minutes, price_cents, is_active')
            .eq('location_id', current.id).eq('is_active', true).order('sort_order')
        : Promise.resolve({ data: [] }),
      // Profils métier : l'activité (suggestion d'un métier), les fiches
      // (une fiche = un guichet) et les modèles de messages retouchés.
      db.from('organizations').select('activity').eq('id', organizationId).maybeSingle(),
      current
        ? db.from('staff').select('id, display_name, desk_label, is_active')
            .eq('location_id', current.id).order('sort_order').order('created_at')
        : Promise.resolve({ data: [] }),
      db.from('message_templates')
        .select('profile, key, label, body, is_active, location_id, sort_order')
        .eq('organization_id', organizationId).is('location_id', null),
      // Une file déjà dans un métier, ailleurs dans l'organisation : elle
      // seule, avec l'activité et `features.profiles`, ouvre le choix du
      // métier d'une file au passage (jamais pour un simple barbier).
      db.from('queues').select('id, profile').eq('organization_id', organizationId),
    ]);

  const orgHasProfiledQueue = ((orgQueues ?? []) as { id: string; profile: string | null }[])
    .some((q) => !isLegacyProfile(q.profile));

  return (
    <SettingsManager
      orgSlug={org}
      organizationId={organizationId}
      canManage={access.can('settings.manage')}
      canConfigure={access.can('queue.configure')}
      activity={(organization?.activity as string | undefined) ?? null}
      orgHasProfiledQueue={orgHasProfiledQueue}
      staff={(staff ?? []) as never}
      templateRows={(templateRows ?? []) as never}
      locations={list as never}
      currentLocation={current as never}
      settings={settings as never}
      queues={(queues ?? []) as never}
      selectedQueueId={file ?? null}
      hours={(hours ?? []) as never}
      services={(services ?? []) as never}
    />
  );
}
