import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { TeamManager } from './TeamManager';

export const metadata: Metadata = { title: 'Équipe', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await requireOrgAccess(org);
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();

  const [{ data: staff }, { data: locations }, { data: members }, { data: quota }] =
    await Promise.all([
      db.from('staff')
        .select('id, display_name, role_title, accent, is_active, accepts_queue, is_on_break, sort_order, location_id, user_id')
        .eq('organization_id', organizationId).order('sort_order'),
      db.from('locations').select('id, name').eq('organization_id', organizationId).order('created_at'),
      db.from('organization_members')
        .select('id, role, status, invited_email, user_id, created_at, profiles(full_name, email)')
        .eq('organization_id', organizationId).order('created_at'),
      db.rpc('check_org_quota', { p_organization_id: organizationId, p_resource: 'staff' }),
    ]);

  return (
    <TeamManager
      organizationId={organizationId}
      canManage={access.can('team.manage')}
      currentUserId={access.user.id}
      staff={(staff ?? []) as never}
      locations={(locations ?? []) as never}
      members={(members ?? []) as never}
      quota={quota as { used: number; limit: number; allowed: boolean } | null}
    />
  );
}
