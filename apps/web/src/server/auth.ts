import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors';
import type { MemberRole, OrganizationSummary } from '@/lib/types';

/**
 * Authentification professionnelle et garde-fous multi-tenant.
 *
 * Toute page ou action du tableau de bord passe par requireOrgAccess :
 * l'appartenance à l'organisation est revérifiée côté serveur à chaque
 * requête, jamais déduite de l'URL ni d'un état client.
 */

export interface SessionUser {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  isPlatformAdmin: boolean;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, is_platform_admin')
    .eq('id', data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: profile?.email ?? data.user.email ?? null,
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    isPlatformAdmin: profile?.is_platform_admin === true,
  };
});

export async function requireUser(redirectTo = '/connexion'): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(redirectTo);
  return user;
}

export const getMyOrganizations = cache(async (): Promise<OrganizationSummary[]> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('my_organizations');
  if (error) {
    console.error('[auth] organisations illisibles', error);
    return [];
  }
  return (data ?? []) as OrganizationSummary[];
});

export interface OrgAccess {
  user: SessionUser;
  organization: OrganizationSummary;
  role: MemberRole;
  can: (action: Permission) => boolean;
}

export type Permission =
  | 'queue.operate'      // faire avancer la file
  | 'queue.configure'    // régler la file
  | 'team.manage'
  | 'plates.manage'
  | 'settings.manage'
  | 'billing.manage'
  | 'stats.view'
  | 'organization.delete';

const ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  owner: [
    'queue.operate', 'queue.configure', 'team.manage',
    'settings.manage', 'billing.manage', 'stats.view', 'organization.delete',
  ],
  admin: [
    'queue.operate', 'queue.configure', 'team.manage',
    'settings.manage', 'billing.manage', 'stats.view',
  ],
  manager: ['queue.operate', 'queue.configure', 'stats.view'],
  member: ['queue.operate'],
};

export function roleCan(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Vérifie que l'utilisateur connecté appartient bien à l'organisation
 * désignée par le slug d'URL. Un slug inconnu ou non autorisé est
 * traité exactement comme un slug inexistant : on ne révèle pas
 * l'existence d'une organisation à quelqu'un qui n'y a pas accès.
 */
export async function requireOrgAccess(
  orgSlug: string,
  permission?: Permission,
): Promise<OrgAccess> {
  const user = await requireUser();
  const organizations = await getMyOrganizations();
  const organization = organizations.find((o) => o.slug === orgSlug);

  if (!organization) {
    if (organizations.length > 0) redirect(`/app/${organizations[0]!.slug}/file`);
    redirect('/bienvenue');
  }

  if (organization.status === 'suspended') {
    redirect(`/app/${organization.slug}/suspendu`);
  }

  const can = (action: Permission) => roleCan(organization.role, action);

  if (permission && !can(permission)) {
    throw new AppError('forbidden', "Votre rôle ne permet pas cette action.", 403);
  }

  return { user, organization, role: organization.role, can };
}

/** Variante non redirigeante, pour les routes API et les server actions. */
export async function assertOrgMembership(
  organizationId: string,
  permission?: Permission,
): Promise<{ user: SessionUser; role: MemberRole }> {
  const user = await getSessionUser();
  if (!user) throw new AppError('unauthorized', 'Connectez-vous pour continuer.', 401);

  const { data, error } = await supabaseAdmin()
    .from('organization_members')
    .select('role, status')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) {
    throw new AppError('forbidden', "Vous n'avez pas accès à cet établissement.", 403);
  }

  const role = data.role as MemberRole;
  if (permission && !roleCan(role, permission)) {
    throw new AppError('forbidden', "Votre rôle ne permet pas cette action.", 403);
  }
  return { user, role };
}

/**
 * Vérifie qu'une file appartient bien à une organisation dont
 * l'utilisateur est membre. C'est le contrôle qui empêche d'agir sur la
 * file d'un autre commerce en devinant un identifiant.
 */
export async function assertQueueAccess(
  queueId: string,
  permission: Permission = 'queue.operate',
): Promise<{ user: SessionUser; role: MemberRole; organizationId: string; locationId: string }> {
  const { data, error } = await supabaseAdmin()
    .from('queues')
    .select('organization_id, location_id')
    .eq('id', queueId)
    .maybeSingle();

  if (error || !data) throw new AppError('not_found', 'File introuvable.', 404);

  const { user, role } = await assertOrgMembership(data.organization_id, permission);
  return { user, role, organizationId: data.organization_id, locationId: data.location_id };
}

/** Même contrôle, à partir d'un ticket. */
export async function assertEntryAccess(
  entryPublicId: string,
  permission: Permission = 'queue.operate',
): Promise<{ user: SessionUser; role: MemberRole; organizationId: string; queueId: string }> {
  const { data, error } = await supabaseAdmin()
    .from('queue_entries')
    .select('organization_id, queue_id')
    .eq('public_id', entryPublicId)
    .maybeSingle();

  if (error || !data) throw new AppError('not_found', 'Ticket introuvable.', 404);

  const { user, role } = await assertOrgMembership(data.organization_id, permission);
  return { user, role, organizationId: data.organization_id, queueId: data.queue_id };
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser('/connexion?next=/admin');
  if (!user.isPlatformAdmin) redirect('/app');
  return user;
}

export async function assertPlatformAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user?.isPlatformAdmin) {
    throw new AppError('forbidden', 'Réservé à l\'administration de la plateforme.', 403);
  }
  return user;
}

/** Fiche employé rattachée au compte connecté, si elle existe. */
export async function getStaffRecord(
  userId: string,
  locationId: string,
): Promise<{ id: string; display_name: string } | null> {
  const { data } = await supabaseAdmin()
    .from('staff')
    .select('id, display_name')
    .eq('user_id', userId)
    .eq('location_id', locationId)
    .eq('is_active', true)
    .maybeSingle();
  return data ?? null;
}
