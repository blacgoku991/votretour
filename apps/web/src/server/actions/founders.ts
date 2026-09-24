'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireOrgAccess } from '@/server/auth';
import { audit } from '@/server/audit';
import { FOUNDERS_TAG, getFoundersPlace } from '@/server/founders';

/**
 * L'ACCORD « APPARAÎTRE PARMI LES PREMIERS COMMERCES SUR RANGVIA ».
 *
 * Le nom et la ville d'un commerce partent sur toutes les pages publiques :
 * c'est une décision de l'ORGANISATION, pas d'un employé. D'où, à chaque
 * appel, sans rien croire du navigateur :
 *   1. l'accès à l'organisation de l'URL avec `settings.manage` (propriétaire
 *      ou administrateur) ; un membre ou un responsable de file est refusé
 *      AVANT toute écriture ;
 *   2. une entrée validée en zod STRICT (un booléen, rien d'autre) ;
 *   3. une trace dans `audit_logs` (founders.opt_in / founders.opt_out) :
 *      l'accord en cours est horodaté par la base (0041), l'historique des
 *      accords et des retraits est ici ;
 *   4. l'invalidation du cache « founders » : le pied de page du site
 *      montre (ou retire) le commerce tout de suite, pas dans une heure.
 */

export type FoundersResult =
  | { ok: true; data: { optIn: boolean; place: number | null } }
  | { ok: false; error: string; code: string };

const inputSchema = z
  .object({
    orgSlug: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
    optIn: z.boolean(),
  })
  .strict();

export async function setFoundersShowcase(input: unknown): Promise<FoundersResult> {
  try {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new AppError('validation', 'Données invalides.', 422, parsed.error.issues);
    const { orgSlug, optIn } = parsed.data;

    const access = await requireOrgAccess(orgSlug, 'settings.manage');
    const organizationId = access.organization.organization_id;

    // L'heure de l'accord est posée par la base (déclencheur de 0041).
    const { error } = await supabaseAdmin()
      .from('organization_settings')
      .update({ founders_opt_in: optIn })
      .eq('organization_id', organizationId);
    if (error) throw toAppError(error);

    await audit({
      organizationId,
      actorUserId: access.user.id,
      action: optIn ? 'founders.opt_in' : 'founders.opt_out',
      targetType: 'organization',
      targetId: organizationId,
      // Ce que le commerce a accepté de montrer, pour relire l'accord plus tard.
      metadata: { shown: ['name', 'city'] },
    });

    revalidateTag(FOUNDERS_TAG);
    revalidatePath(`/app/${orgSlug}/reglages`);

    return { ok: true, data: { optIn, place: optIn ? await getFoundersPlace(organizationId) : null } };
  } catch (error) {
    // Redirection (session expirée, organisation inaccessible) : Next.js doit
    // la voir passer, on ne la transforme pas en message d'erreur.
    unstable_rethrow(error);
    const appError = toAppError(error);
    if (appError.status >= 500) console.error('[premiers commerces]', appError);
    return { ok: false, error: appError.message, code: appError.code };
  }
}
