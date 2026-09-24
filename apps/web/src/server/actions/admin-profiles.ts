'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isLegacyProfile, isQueueProfile, QUEUE_PROFILES } from '@/lib/profiles';
import type { QueueProfile } from '@/lib/profiles/types';
import { assertPlatformAdmin } from '@/server/auth';
import { audit } from '@/server/audit';
import { frenchIssues } from '@/server/profiles/queue';

/**
 * ATTRIBUTION DU MÉTIER D'UNE FILE — réservée à l'équipe Rangvia.
 *
 * Décision du propriétaire : le commerçant déclare son activité à
 * l'inscription, mais il ne choisit ni ne change son métier (passage,
 * atelier véhicule, atelier appareils, table, guichet, boutique,
 * événement). C'est le super-admin qui l'attribue, à l'installation,
 * depuis /admin/etablissements/[id]. Le commerçant règle ensuite les
 * OPTIONS du métier attribué (devis en ligne, couverts, préfixe…) dans ses
 * Réglages (`server/actions/profiles.ts`).
 *
 * Contrôles, à chaque appel, sans rien croire du navigateur :
 *   1. le compte est super-admin (`assertPlatformAdmin`), AVANT toute
 *      lecture ;
 *   2. entrées en zod STRICT ; la file appartient bien à l'organisation
 *      annoncée (sinon « introuvable ») ;
 *   3. aucune garde d'ouverture (`OPEN_PROFILES`, `features.profiles`) :
 *      l'équipe peut attribuer n'importe lequel des sept métiers ;
 *   4. le changement lui-même se fait en SQL (`switch_queue_profile`, 0034),
 *      sous verrou de la file : refusé tant qu'un ticket est actif (VT017),
 *      réglages par défaut du métier ou réglages d'avant rétablis, motifs.
 *
 * Métier hors passage : l'organisation reçoit aussi `features.profiles`.
 * Tant que les métiers ne sont pas ouverts à tous (`OPEN_PROFILES`, rempli
 * à l'ouverture), c'est cette clé qui fait servir la file dans son métier
 * à l'inscription des clients, sur l'écran client et dans les Réglages.
 * Elle n'est jamais retirée : une file revenue au passage n'en a pas
 * besoin, et une autre file de l'organisation peut encore être métier.
 *
 * Trace : `queue.profile_assigned` (acteur `platform_admin`), en plus de la
 * ligne `queue.profile_changed` que la fonction SQL écrit elle-même (et
 * d'où se relisent les réglages d'avant en cas de retour). Cette seconde
 * ligne garde l'acteur « staff » de la fonction commune (0034) avec
 * l'identifiant du super-admin : c'est la première qui dit qui a décidé.
 *
 * Choix d'avis de l'inscription : un cabinet de santé ou un service
 * administratif qui a DEMANDÉ les avis Google a `review: true` sur sa
 * file au passage. Un guichet les coupe par défaut ; la confirmation du
 * super-admin le dit avant (`assignSummary`, MetierPanel), rien n'est
 * reporté en silence.
 */

export type AdminProfileResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

const QUEUE_NOT_EMPTY = 'La file doit être vide avant de changer de métier.';

function fail(error: unknown): AdminProfileResult<never> {
  const appError = toAppError(error);
  if (appError.code === 'queue_not_empty') {
    return { ok: false, error: QUEUE_NOT_EMPTY, code: 'queue_not_empty' };
  }
  if (appError.status >= 500) console.error('[admin métier]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const uuid = z.string().uuid('Identifiant invalide.');
const profileSchema = z.enum(QUEUE_PROFILES as unknown as [QueueProfile, ...QueueProfile[]]);

const assignSchema = z
  .object({
    organizationId: uuid,
    queueId: uuid,
    profile: profileSchema,
  })
  .strict();

export interface AssignProfileResult {
  profile: QueueProfile;
  previousProfile: QueueProfile;
  changed: boolean;
  /** La file retrouve les réglages qu'elle avait en quittant ce métier. */
  settingsRestored: boolean;
  /** Motifs du métier créés (l'établissement n'en avait aucun d'actif). */
  servicesCreated: number;
  /** Motifs créés par le métier quitté, jamais retouchés, désactivés. */
  servicesRetired: number;
}

/**
 * Attribue un métier à une file. Refusé tant qu'un ticket est actif :
 * « La file doit être vide avant de changer de métier. »
 */
export async function assignQueueProfile(
  input: z.input<typeof assignSchema>,
): Promise<AdminProfileResult<AssignProfileResult>> {
  try {
    const admin = await assertPlatformAdmin();
    const parsed = assignSchema.safeParse(input, { error: frenchIssues });
    if (!parsed.success) {
      throw new AppError('validation', parsed.error.issues[0]?.message ?? 'Données invalides.', 422);
    }
    const { organizationId, queueId, profile } = parsed.data;
    const db = supabaseAdmin();

    const { data: queue, error: readError } = await db
      .from('queues')
      .select('id, organization_id, profile')
      .eq('id', queueId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (readError) throw readError;
    if (!queue) throw new AppError('not_found', 'File introuvable.', 404);

    const { data, error } = await db.rpc('switch_queue_profile', {
      p_queue_id: queueId,
      p_profile: profile,
      p_actor_user_id: admin.id,
    });
    if (error) throw error;

    const row = (data ?? {}) as Partial<Record<string, unknown>>;
    const before: QueueProfile = isQueueProfile(queue.profile) ? queue.profile : 'walkin';
    const result: AssignProfileResult = {
      profile: isQueueProfile(row.profile) ? row.profile : profile,
      previousProfile: isQueueProfile(row.previousProfile) ? row.previousProfile : before,
      changed: row.changed === true,
      settingsRestored: row.settingsRestored === true,
      servicesCreated: typeof row.servicesCreated === 'number' ? row.servicesCreated : 0,
      servicesRetired: typeof row.servicesRetired === 'number' ? row.servicesRetired : 0,
    };

    // Après le changement, jamais avant : un refus (VT017) ne laisse rien
    // derrière lui. Si cette écriture échoue, l'erreur remonte et un nouvel
    // essai la refait (le métier, déjà posé, répond « rien ne change »).
    if (!isLegacyProfile(result.profile)) await enableProfiles(organizationId);

    await audit({
      organizationId,
      actor: 'platform_admin',
      actorUserId: admin.id,
      action: 'queue.profile_assigned',
      targetType: 'queue',
      targetId: queueId,
      metadata: {
        from: result.previousProfile,
        to: result.profile,
        changed: result.changed,
        settingsRestored: result.settingsRestored,
        servicesCreated: result.servicesCreated,
        servicesRetired: result.servicesRetired,
      },
    });

    revalidatePath(`/admin/etablissements/${organizationId}`);
    const { data: org } = await db.from('organizations').select('slug').eq('id', organizationId).maybeSingle();
    if (typeof org?.slug === 'string') {
      for (const page of ['file', 'reglages', 'ecran', 'statistiques', 'historique', 'notifications']) {
        revalidatePath(`/app/${org.slug}/${page}`);
      }
    }
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/** Pose `features.profiles = true` sans toucher aux autres clés. */
async function enableProfiles(organizationId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('organization_settings')
    .select('features')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  const current = data?.features && typeof data.features === 'object' && !Array.isArray(data.features)
    ? (data.features as Record<string, unknown>)
    : {};
  if (current.profiles === true) return;
  const { error: writeError } = await db
    .from('organization_settings')
    .update({ features: { ...current, profiles: true } })
    .eq('organization_id', organizationId);
  if (writeError) throw writeError;
}
