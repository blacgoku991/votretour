import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { TeamManager } from './TeamManager';

export const metadata: Metadata = { title: 'Équipe', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Début de la journée à Paris, en ISO UTC (même définition que le
 * compteur « aujourd'hui » de la File : minuit heure locale). Calcul de
 * requête côté serveur, jamais rendu tel quel dans la page.
 */
function startOfTodayParis(now: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  // Heure affichée à Paris quand il est minuit UTC = décalage (1 ou 2 h).
  const offsetHours = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23',
  }).format(utcMidnight));
  return new Date(utcMidnight.getTime() - offsetHours * 3_600_000).toISOString();
}

export default async function TeamPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await requireOrgAccess(org);
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();
  const since = startOfTodayParis(new Date());

  const [{ data: staff }, { data: locations }, { data: members }, { data: quota }, { data: today }, { data: serving }] =
    await Promise.all([
      db.from('staff')
        .select('id, display_name, role_title, accent, is_active, accepts_queue, is_on_break, sort_order, location_id, user_id')
        .eq('organization_id', organizationId).order('sort_order'),
      db.from('locations').select('id, name').eq('organization_id', organizationId).order('created_at'),
      db.from('organization_members')
        .select('id, role, status, invited_email, user_id, created_at, profiles(full_name, email)')
        .eq('organization_id', organizationId).order('created_at'),
      db.rpc('check_org_quota', { p_organization_id: organizationId, p_resource: 'staff' }),
      // Passages du jour, par professionnel (lecture seule).
      db.from('queue_entries').select('staff_id')
        .eq('organization_id', organizationId).eq('status', 'completed')
        .gte('completed_at', since),
      // Qui est en prestation en ce moment.
      db.from('queue_entries').select('staff_id')
        .eq('organization_id', organizationId).eq('status', 'serving'),
    ]);

  const passages: Record<string, number> = {};
  for (const row of (today ?? []) as { staff_id: string | null }[]) {
    if (row.staff_id) passages[row.staff_id] = (passages[row.staff_id] ?? 0) + 1;
  }
  const servingIds = Array.from(new Set(
    ((serving ?? []) as { staff_id: string | null }[]).map((r) => r.staff_id).filter((id): id is string => Boolean(id)),
  ));

  return (
    <TeamManager
      organizationId={organizationId}
      canManage={access.can('team.manage')}
      currentUserId={access.user.id}
      staff={(staff ?? []) as never}
      locations={(locations ?? []) as never}
      members={(members ?? []) as never}
      quota={quota as { used: number; limit: number; allowed: boolean } | null}
      passagesToday={passages}
      servingStaffIds={servingIds}
    />
  );
}
