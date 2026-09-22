'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { assertOrgMembership } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/server/audit';
import { generateInviteToken } from '@/lib/crypto';
import { env } from '@/lib/env';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[team]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const ACCENTS = ['signal', 'jade', 'cobalt', 'copper', 'brique', 'ardoise'] as const;

const staffSchema = z.object({
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  displayName: z.string().trim().min(1, 'Indiquez un prénom.').max(60),
  roleTitle: z.string().trim().max(60).nullish(),
  accent: z.enum(ACCENTS).optional(),
});

/** Ajoute un professionnel. Il n'a pas besoin de compte pour exister. */
export async function addStaff(input: z.input<typeof staffSchema>): Promise<Result<{ id: string }>> {
  try {
    const parsed = staffSchema.parse(input);
    const { user } = await assertOrgMembership(parsed.organizationId, 'team.manage');
    const db = supabaseAdmin();

    const { data: quota } = await db.rpc('check_org_quota', {
      p_organization_id: parsed.organizationId, p_resource: 'staff',
    });
    const q = quota as { allowed: boolean; limit: number } | null;
    if (q && !q.allowed) {
      throw new AppError(
        'quota',
        `Votre offre est limitée à ${q.limit} professionnel${q.limit > 1 ? 's' : ''}.`,
        402,
      );
    }

    const { count } = await db
      .from('staff').select('id', { count: 'exact', head: true })
      .eq('location_id', parsed.locationId);

    const { data, error } = await db.from('staff').insert({
      organization_id: parsed.organizationId,
      location_id: parsed.locationId,
      display_name: parsed.displayName,
      role_title: parsed.roleTitle ?? null,
      accent: parsed.accent ?? ACCENTS[(count ?? 0) % ACCENTS.length],
      sort_order: count ?? 0,
    }).select('id').single();
    if (error) throw error;

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'staff.created', targetType: 'staff', targetId: data.id,
    });
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error);
  }
}

const updateStaffSchema = z.object({
  organizationId: z.string().uuid(),
  staffId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(60).optional(),
  roleTitle: z.string().trim().max(60).nullish(),
  accent: z.enum(ACCENTS).optional(),
  isActive: z.boolean().optional(),
  acceptsQueue: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export async function updateStaff(
  input: z.input<typeof updateStaffSchema>,
): Promise<Result<{ staffId: string }>> {
  try {
    const parsed = updateStaffSchema.parse(input);
    await assertOrgMembership(parsed.organizationId, 'team.manage');

    const patch: Record<string, unknown> = {};
    if (parsed.displayName !== undefined) patch.display_name = parsed.displayName;
    if (parsed.roleTitle !== undefined) patch.role_title = parsed.roleTitle;
    if (parsed.accent !== undefined) patch.accent = parsed.accent;
    if (parsed.isActive !== undefined) patch.is_active = parsed.isActive;
    if (parsed.acceptsQueue !== undefined) patch.accepts_queue = parsed.acceptsQueue;
    if (parsed.sortOrder !== undefined) patch.sort_order = parsed.sortOrder;

    const { error } = await supabaseAdmin()
      .from('staff').update(patch)
      .eq('id', parsed.staffId)
      .eq('organization_id', parsed.organizationId);
    if (error) throw error;

    return { ok: true, data: { staffId: parsed.staffId } };
  } catch (error) {
    return fail(error);
  }
}

const inviteSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().email('Adresse e-mail invalide.').max(160),
  role: z.enum(['admin', 'manager', 'member']),
});

/**
 * Invite un collègue à accéder au tableau de bord.
 *
 * Le produit n'envoie pas d'e-mail lui-même : il produit un lien
 * d'invitation à transmettre. On ne prétend pas avoir envoyé un message
 * qui ne part pas.
 */
export async function inviteMember(
  input: z.input<typeof inviteSchema>,
): Promise<Result<{ inviteUrl: string; expiresAt: string }>> {
  try {
    const parsed = inviteSchema.parse(input);
    const { user } = await assertOrgMembership(parsed.organizationId, 'team.manage');
    const db = supabaseAdmin();

    const { token, hash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    const { error } = await db.from('organization_members').upsert(
      {
        organization_id: parsed.organizationId,
        invited_email: parsed.email.toLowerCase(),
        role: parsed.role,
        status: 'invited',
        invite_token_hash: hash,
        invite_expires_at: expiresAt,
        invited_by: user.id,
      },
      { onConflict: 'organization_id,invited_email' },
    );
    if (error) throw error;

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'member.invited', targetType: 'member', targetId: parsed.email,
      metadata: { role: parsed.role },
    });

    return {
      ok: true,
      data: { inviteUrl: `${env.siteUrl}/invitation/${token}`, expiresAt },
    };
  } catch (error) {
    return fail(error);
  }
}

const memberSchema = z.object({
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'manager', 'member']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export async function updateMember(
  input: z.input<typeof memberSchema>,
): Promise<Result<{ memberId: string }>> {
  try {
    const parsed = memberSchema.parse(input);
    const { user, role } = await assertOrgMembership(parsed.organizationId, 'team.manage');
    const db = supabaseAdmin();

    const { data: target } = await db
      .from('organization_members')
      .select('role, user_id')
      .eq('id', parsed.memberId)
      .eq('organization_id', parsed.organizationId)
      .maybeSingle();
    if (!target) throw new AppError('not_found', 'Membre introuvable.', 404);

    // Un propriétaire ne peut être touché que par un propriétaire, et
    // jamais le dernier : une organisation sans propriétaire serait
    // définitivement inadministrable.
    if (target.role === 'owner' && role !== 'owner') {
      throw new AppError('forbidden', "Seul un propriétaire peut modifier un autre propriétaire.", 403);
    }
    if (target.role === 'owner' && (parsed.role !== 'owner' || parsed.status === 'disabled')) {
      const { count } = await db
        .from('organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', parsed.organizationId)
        .eq('role', 'owner')
        .eq('status', 'active');
      if ((count ?? 0) <= 1) {
        throw new AppError('forbidden', "Gardez au moins un propriétaire sur l'organisation.", 409);
      }
    }

    const patch: Record<string, unknown> = {};
    if (parsed.role) patch.role = parsed.role;
    if (parsed.status) patch.status = parsed.status;

    const { error } = await db
      .from('organization_members').update(patch)
      .eq('id', parsed.memberId).eq('organization_id', parsed.organizationId);
    if (error) throw error;

    await audit({
      organizationId: parsed.organizationId, actorUserId: user.id,
      action: 'member.updated', targetType: 'member', targetId: parsed.memberId, metadata: patch,
    });
    return { ok: true, data: { memberId: parsed.memberId } };
  } catch (error) {
    return fail(error);
  }
}

export async function revalidateTeam(orgSlug: string): Promise<void> {
  revalidatePath(`/app/${orgSlug}/equipe`);
}
