'use server';

import { z } from 'zod';
import { toAppError } from '@/lib/errors';
import { requireUser } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';
import { audit } from '@/server/audit';
import { env } from '@/lib/env';
import { ACTIVITY_PROFILE } from '@/lib/profiles';
import type { ActivityType, QueueProfile } from '@/lib/profiles/types';
import { onboardingProfile, reviewOffByDefault } from '@/app/bienvenue/metiers';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string };

function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[onboarding]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const ACTIVITIES = Object.keys(ACTIVITY_PROFILE) as [ActivityType, ...ActivityType[]];

const schema = z.object({
  organizationName: z.string().trim().min(2, "Indiquez le nom de votre commerce.").max(120),
  // Tous les métiers de la grille, `event` compris (il était proposé par
  // l'ancien menu mais refusé ici).
  activity: z.enum(ACTIVITIES),
  locationName: z.string().trim().min(1).max(120),
  addressLine1: z.string().trim().max(160).nullish(),
  postalCode: z.string().trim().max(12).nullish(),
  city: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(30).nullish(),
  timezone: z.string().trim().max(60).default('Europe/Paris'),
  queueMode: z.enum(['shared', 'per_staff']),
  googleReviewUrl: z
    .string().trim().url("Le lien d'avis doit être une URL complète.")
    .startsWith('https://', 'Le lien doit commencer par https://')
    .max(500).nullish()
    .or(z.literal('').transform(() => null)),
  /**
   * Demander un avis Google en fin de visite ? Absent : oui, sauf pour les
   * métiers où la demande est coupée par défaut (santé, service
   * administratif). Le parcours d'un barbier n'envoie jamais ce champ.
   */
  requestReviews: z.boolean().optional(),
  staffNames: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  openingHours: z
    .array(z.object({
      weekday: z.number().int().min(0).max(6),
      isClosed: z.boolean(),
      opensAt: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
      closesAt: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
    }))
    .max(7)
    .default([]),
});

export interface OnboardingResult {
  organizationSlug: string;
  organizationName: string;
  locationName: string;
  queueId: string;
  plateCode: string;
  plateUrl: string;
  /** Activité choisie. */
  activity: ActivityType;
  /**
   * Profil de la file créée : toujours le passage. Le métier est activé
   * ensuite par l'équipe Rangvia (espace super-admin).
   */
  profile: QueueProfile;
}

/**
 * Onboarding complet, en une transaction côté base :
 * organisation → propriétaire → établissement → file → plaque NFC/QR →
 * horaires → période d'essai. À la fin, le professionnel a une URL
 * qu'il peut coller sur un tag NFC et un QR à imprimer.
 *
 * Métier : décision du propriétaire, le commerçant DÉCLARE son activité,
 * enregistrée telle quelle sur l'organisation, mais il ne choisit pas son
 * métier. La file naît TOUJOURS au passage (walkin) ; l'équipe Rangvia
 * active l'interface du métier (atelier, table, guichet…) lors de
 * l'installation, depuis l'espace super-admin. La base le garantit aussi
 * (`create_location`, 0042) : rien ici ne dépend du navigateur.
 */
export async function completeOnboarding(
  input: z.input<typeof schema>,
): Promise<Result<OnboardingResult>> {
  try {
    const parsed = schema.parse(input);
    const user = await requireUser();
    await enforceRateLimit(
      `signup:${user.id}`, LIMITS.signup.max, LIMITS.signup.window,
      'Trop de créations en peu de temps. Réessayez dans un moment.',
    );

    const db = supabaseAdmin();
    const choice = onboardingProfile(parsed.activity);
    const requestReviews = parsed.requestReviews ?? !reviewOffByDefault(parsed.activity);

    const { data: provisioned, error } = await db.rpc('provision_organization', {
      p_user_id: user.id,
      p_org_name: parsed.organizationName,
      p_activity: choice.provisionActivity,
      p_location_name: parsed.locationName,
      p_queue_mode: parsed.queueMode,
      p_plan_code: 'pro',
    });
    if (error) throw error;

    const result = provisioned as {
      organization: { id: string; slug: string; name: string };
      location: { id: string; name: string };
      queue: { id: string; profile?: QueueProfile };
      plate: { code: string };
    };

    const organizationId = result.organization.id;
    const locationId = result.location.id;
    // Le profil que la base a réellement posé fait foi : le passage, sauf
    // base d'avant 0042 (qui déduisait encore le métier de l'activité).
    const profile: QueueProfile = result.queue.profile ?? 'walkin';

    // Coordonnées et lien d'avis.
    await db.from('locations').update({
      address_line1: parsed.addressLine1 ?? null,
      postal_code: parsed.postalCode ?? null,
      city: parsed.city ?? null,
      phone: parsed.phone ?? null,
      timezone: parsed.timezone,
      google_review_url: requestReviews ? (parsed.googleReviewUrl ?? null) : null,
    }).eq('id', locationId);

    // Santé, service administratif : la file naît sans demande d'avis
    // (`{"review": false}`, posé par create_location en 0042). Le
    // professionnel qui l'a DEMANDÉE ici, explicitement, l'obtient : son
    // choix est écrit sur la file (`review: true`, forme admise au
    // passage), sinon le lien collé plus haut ne servirait jamais. Le
    // super-admin le lit ensuite avant d'attribuer le métier.
    if (requestReviews && reviewOffByDefault(parsed.activity)) {
      const { error: reviewError } = await db.from('queues')
        .update({ profile_options: { review: true } })
        .eq('id', result.queue.id);
      if (reviewError) throw reviewError;
    }

    // Équipe.
    if (parsed.staffNames.length > 0) {
      const accents = ['signal', 'jade', 'cobalt', 'copper', 'brique', 'ardoise'] as const;
      await db.from('staff').insert(
        parsed.staffNames.map((name, index) => ({
          organization_id: organizationId,
          location_id: locationId,
          display_name: name,
          accent: accents[index % accents.length],
          sort_order: index,
        })),
      );
    }

    // Horaires, s'ils ont été personnalisés.
    if (parsed.openingHours.length > 0) {
      await db.from('opening_hours').delete().eq('location_id', locationId);
      await db.from('opening_hours').insert(
        parsed.openingHours.map((day) => ({
          organization_id: organizationId,
          location_id: locationId,
          weekday: day.weekday,
          is_closed: day.isClosed,
          opens_at: day.isClosed ? null : (day.opensAt ?? '09:00'),
          closes_at: day.isClosed ? null : (day.closesAt ?? '19:00'),
        })),
      );
    }

    await db.from('organizations').update({
      onboarding_step: 'done',
      onboarding_done_at: new Date().toISOString(),
    }).eq('id', organizationId);

    await audit({
      organizationId, actorUserId: user.id, action: 'onboarding.completed',
      targetType: 'organization', targetId: organizationId,
      // `activity` : l'activité déclarée ; `targetProfile` : le métier que
      // l'équipe Rangvia activera à l'installation.
      metadata: {
        activity: parsed.activity, queueMode: parsed.queueMode, profile, targetProfile: choice.target,
        // Seulement là où la demande d'avis est coupée par défaut : le choix du pro.
        ...(reviewOffByDefault(parsed.activity) ? { requestReviews } : {}),
      },
    });

    return {
      ok: true,
      data: {
        organizationSlug: result.organization.slug,
        organizationName: result.organization.name,
        locationName: result.location.name,
        queueId: result.queue.id,
        plateCode: result.plate.code,
        plateUrl: `${env.siteUrl}/e/${result.plate.code}`,
        activity: parsed.activity,
        profile,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** Ouvre la file tout de suite depuis l'écran final de l'onboarding. */
export async function openQueueNow(queueId: string): Promise<Result<{ status: string }>> {
  try {
    const user = await requireUser();
    const db = supabaseAdmin();

    const { data: queue } = await db
      .from('queues').select('organization_id').eq('id', queueId).maybeSingle();
    if (!queue) throw new Error('File introuvable.');

    const { data: member } = await db
      .from('organization_members')
      .select('role')
      .eq('organization_id', queue.organization_id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!member) throw new Error("Vous n'avez pas accès à cette file.");

    const { error } = await db.rpc('set_queue_status', {
      p_queue_id: queueId, p_status: 'open', p_actor_user_id: user.id, p_reason: null,
    });
    if (error) throw error;

    return { ok: true, data: { status: 'open' } };
  } catch (error) {
    return fail(error);
  }
}
