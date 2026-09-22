import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SettingsManager } from './SettingsManager';

export const metadata: Metadata = { title: 'Réglages', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  params, searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ lieu?: string }>;
}) {
  const { org } = await params;
  const { lieu } = await searchParams;
  const access = await requireOrgAccess(org);
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();

  const { data: locations } = await db
    .from('locations')
    .select('id, name, address_line1, postal_code, city, phone, timezone, maps_url, google_review_url, latitude, longitude, is_active')
    .eq('organization_id', organizationId).order('created_at');

  const list = locations ?? [];
  const current = list.find((l) => l.id === lieu) ?? list[0] ?? null;

  const [{ data: settings }, { data: queues }, { data: hours }, { data: services }] =
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
    ]);

  return (
    <SettingsManager
      orgSlug={org}
      organizationId={organizationId}
      canManage={access.can('settings.manage')}
      locations={list as never}
      currentLocation={current as never}
      settings={settings as never}
      queues={(queues ?? []) as never}
      hours={(hours ?? []) as never}
      services={(services ?? []) as never}
    />
  );
}
