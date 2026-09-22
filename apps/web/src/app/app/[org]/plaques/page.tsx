import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { PlatesManager } from './PlatesManager';

export const metadata: Metadata = { title: 'Plaques & QR', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function PlatesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await requireOrgAccess(org);
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();

  const [{ data: plates }, { data: locations }, { data: queues }, { data: staff }, { data: quota }] =
    await Promise.all([
      db.from('plates')
        .select('id, code, label, kind, is_active, queue_id, staff_id, location_id, scan_count, last_scanned_at, order_status, order_reference, created_at')
        .eq('organization_id', organizationId)
        .order('created_at'),
      db.from('locations').select('id, name, city').eq('organization_id', organizationId).order('created_at'),
      db.from('queues').select('id, name, location_id').eq('organization_id', organizationId).order('created_at'),
      db.from('staff').select('id, display_name, location_id').eq('organization_id', organizationId).eq('is_active', true).order('sort_order'),
      db.rpc('check_org_quota', { p_organization_id: organizationId, p_resource: 'plates' }),
    ]);

  return (
    <PlatesManager
      orgSlug={org}
      organizationId={organizationId}
      siteUrl={env.siteUrl}
      canManage={access.can('plates.manage')}
      plates={(plates ?? []) as never}
      locations={(locations ?? []) as never}
      queues={(queues ?? []) as never}
      staff={(staff ?? []) as never}
      quota={quota as { used: number; limit: number; allowed: boolean } | null}
    />
  );
}
