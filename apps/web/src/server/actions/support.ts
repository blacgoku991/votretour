'use server';

import { z } from 'zod';
import { toAppError } from '@/lib/errors';
import { assertOrgMembership } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[support]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const ticketSchema = z.object({
  organizationId: z.string().uuid(),
  subject: z.string().trim().min(3, 'Décrivez votre demande en quelques mots.').max(140),
  category: z.enum(['question', 'bug', 'billing', 'plates', 'feature', 'other']),
  message: z.string().trim().min(10, 'Détaillez un peu votre demande.').max(8000),
});

export async function createSupportTicket(
  input: z.input<typeof ticketSchema>,
): Promise<Result<{ ticketId: string }>> {
  try {
    const parsed = ticketSchema.parse(input);
    const { user } = await assertOrgMembership(parsed.organizationId);
    await enforceRateLimit(`support:${user.id}`, LIMITS.support.max, LIMITS.support.window);

    const db = supabaseAdmin();
    const { data: ticket, error } = await db.from('support_tickets').insert({
      organization_id: parsed.organizationId,
      created_by: user.id,
      subject: parsed.subject,
      category: parsed.category,
    }).select('id').single();
    if (error) throw error;

    const { error: messageError } = await db.from('support_messages').insert({
      ticket_id: ticket.id,
      organization_id: parsed.organizationId,
      author_id: user.id,
      body: parsed.message,
    });
    if (messageError) throw messageError;

    return { ok: true, data: { ticketId: ticket.id } };
  } catch (error) {
    return fail(error);
  }
}

const replySchema = z.object({
  organizationId: z.string().uuid(),
  ticketId: z.string().uuid(),
  message: z.string().trim().min(1).max(8000),
});

export async function replyToTicket(
  input: z.input<typeof replySchema>,
): Promise<Result<{ ticketId: string }>> {
  try {
    const parsed = replySchema.parse(input);
    const { user } = await assertOrgMembership(parsed.organizationId);
    const db = supabaseAdmin();

    const { error } = await db.from('support_messages').insert({
      ticket_id: parsed.ticketId,
      organization_id: parsed.organizationId,
      author_id: user.id,
      body: parsed.message,
    });
    if (error) throw error;

    await db.from('support_tickets').update({ status: 'open' }).eq('id', parsed.ticketId);
    return { ok: true, data: { ticketId: parsed.ticketId } };
  } catch (error) {
    return fail(error);
  }
}
