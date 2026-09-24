'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isLegacyProfile, isQueueProfile, QUEUE_PROFILES } from '@/lib/profiles';
import { profileOptionsSchema, resolveProfileOptions } from '@/lib/profiles/options';
import {
  defaultTemplates,
  TEMPLATE_KEY_RE,
  TEMPLATE_LABEL_MAX,
  typographie,
  validateTemplateBody,
} from '@/lib/profiles/templates';
import { TICKET_PREFIX_RE } from '@/lib/profiles/ticket';
import type { ProfileOptions, QueueProfile } from '@/lib/profiles/types';
import { requireOrgAccess } from '@/server/auth';
import { audit } from '@/server/audit';
import { frenchIssues } from '@/server/profiles/queue';

/**
 * RÉGLAGES DES PROFILS MÉTIER — ce que le professionnel règle dans
 * Réglages, sections « Métier de la file » et « Messages ».
 *
 * Le MÉTIER lui-même ne se règle pas ici. Décision du propriétaire : il
 * est attribué par l'équipe Rangvia, à l'installation, depuis l'espace
 * super-admin (`server/actions/admin-profiles.ts`). Aucune action de ce
 * fichier ne change le profil d'une file. Le professionnel règle les
 * OPTIONS du métier qui lui a été attribué : devis en ligne,
 * immatriculation obligatoire, couverts, préfixe du numéro, libellés des
 * guichets, modèles de messages.
 *
 * Chaque action revérifie, à chaque appel, sans rien croire du navigateur :
 *   1. l'accès à l'organisation de l'URL avec la permission
 *      `queue.configure` (`requireOrgAccess`) : un simple membre
 *      (`queue.operate`) fait avancer la file, il ne la reconfigure pas ;
 *   2. que la file, la fiche ou le guichet visé appartient BIEN à cette
 *      organisation : un identifiant deviné d'un autre commerce répond
 *      « introuvable », comme un identifiant inexistant ;
 *   3. que le métier visé est bien ATTRIBUÉ, ce que seul le super-admin
 *      peut faire : la file est dans ce métier (options), l'organisation a
 *      une file dans ce métier (messages), l'établissement de la fiche a
 *      une file au guichet (libellés) ;
 *   4. des entrées validées en zod STRICT.
 * Chaque écriture laisse une trace dans `audit_logs`.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

function fail(error: unknown): ActionResult<never> {
  // Redirection (session expirée, organisation inaccessible) : Next.js doit
  // la voir passer, on ne la transforme pas en message d'erreur.
  unstable_rethrow(error);
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[réglages profils]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const orgSlugSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'Organisation invalide.');
const uuid = z.string().uuid('Identifiant invalide.');
const profileSchema = z.enum(QUEUE_PROFILES as unknown as [QueueProfile, ...QueueProfile[]]);

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value, { error: frenchIssues });
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError('validation', first?.message ?? 'Données invalides.', 422, result.error.issues);
  }
  return result.data;
}

/* --------------------------------------------------------------------
   Contrôles
   -------------------------------------------------------------------- */

async function configureAccess(orgSlug: unknown) {
  const access = await requireOrgAccess(parse(orgSlugSchema, orgSlug), 'queue.configure');
  return { organizationId: access.organization.organization_id, userId: access.user.id };
}

const NOT_ASSIGNED_MESSAGE = 'Ce métier n’est pas celui de votre établissement : l’équipe Rangvia l’active à l’installation.';

/**
 * Une file de l'organisation (de cet établissement, si précisé) est-elle
 * dans ce métier ? C'est la seule preuve qui compte : seul le super-admin
 * pose un métier sur une file.
 */
async function assertProfileAssigned(
  organizationId: string,
  profile: QueueProfile,
  locationId?: string,
): Promise<void> {
  let query = supabaseAdmin()
    .from('queues')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('profile', profile);
  if (locationId) query = query.eq('location_id', locationId);
  const { data, error } = await query.limit(1);
  if (error) throw toAppError(error);
  if (!data || data.length === 0) {
    throw new AppError('profile_unavailable', NOT_ASSIGNED_MESSAGE, 403);
  }
}

interface QueueRow {
  id: string;
  organization_id: string;
  location_id: string;
  profile: QueueProfile;
  profile_options: unknown;
  ticket_prefix: string;
}

/** La file appartient-elle à l'organisation de l'URL ? */
async function queueInOrg(queueId: string, organizationId: string): Promise<QueueRow> {
  const { data, error } = await supabaseAdmin()
    .from('queues')
    .select('id, organization_id, location_id, profile, profile_options, ticket_prefix')
    .eq('id', queueId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data || data.organization_id !== organizationId) {
    throw new AppError('not_found', 'File introuvable.', 404);
  }
  return {
    ...(data as Omit<QueueRow, 'profile'>),
    profile: isQueueProfile(data.profile) ? data.profile : 'walkin',
  };
}

function revalidate(orgSlug: string): void {
  for (const page of ['reglages', 'file', 'ecran', 'statistiques', 'notifications']) {
    revalidatePath(`/app/${orgSlug}/${page}`);
  }
}

/* --------------------------------------------------------------------
   Options du profil
   -------------------------------------------------------------------- */

const optionsInputSchema = z
  .object({
    queueId: uuid,
    /** Clés à changer ; les autres gardent leur valeur. `null` n'efface pas : c'est une valeur (« jamais »). */
    options: z.record(z.string(), z.unknown()).default({}),
    /** Préfixe du numéro de ticket (« A » → « A-042 ») : guichet et boutique. */
    ticketPrefix: z.string().trim().toUpperCase().optional(),
  })
  .strict();

/** Profils dont le numéro porte un préfixe (le dossier d'atelier est « 0042 »). */
const PREFIXED_PROFILES: ReadonlySet<QueueProfile> = new Set(['desk', 'retail']);

/**
 * Règle les options du profil de la file (`profile_options`), et le
 * préfixe du numéro. Les options STOCKÉES valides sont reprises, le
 * changement est appliqué par-dessus, puis le tout est revalidé par le
 * schéma strict du profil : une clé d'un autre métier est refusée.
 *
 * Données de santé : passer une file en `sensitive` coupe aussi la
 * demande du prénom (colonnes `ask_client_name` et `client_name_required`).
 * Réglages masque alors ces deux interrupteurs et `updateQueueSettings`
 * refuse de les rallumer : `join_queue` efface le prénom en santé, un
 * « prénom obligatoire » resté allumé fermerait la file à tout patient.
 *
 * Au passage en santé, la demande d'avis Google est aussi coupée
 * (`review: false`, et « jamais » pour le délai), comme le fait
 * `apply_profile_defaults` en SQL : décision du propriétaire, aucune
 * sollicitation d'avis par défaut en santé. Le pro peut la rallumer,
 * explicitement, ensuite ; une clé envoyée dans le même appel l'emporte.
 */
export async function updateProfileOptions(
  orgSlug: string,
  input: z.input<typeof optionsInputSchema>,
): Promise<ActionResult<{ options: ProfileOptions; ticketPrefix: string }>> {
  try {
    const { organizationId, userId } = await configureAccess(orgSlug);
    const parsed = parse(optionsInputSchema, input);
    const queue = await queueInOrg(parsed.queueId, organizationId);
    if (isLegacyProfile(queue.profile)) {
      throw new AppError('invalid_action', 'Cette file n’a pas d’options de métier.', 400);
    }
    // Pas d'autre garde : le métier de la file est, par construction,
    // celui que l'équipe Rangvia lui a attribué ; ses options sont au pro.

    // Seules les clés réellement stockées sont reprises : un défaut que le
    // pro n'a jamais touché reste un défaut (il suivra le code).
    const stored = resolveStoredOnly(queue.profile, queue.profile_options);
    const wasSensitive = resolveProfileOptions(queue.profile, queue.profile_options).sensitive === true;
    const next = parse(profileOptionsSchema(queue.profile), { ...stored, ...parsed.options }) as ProfileOptions;
    if (next.sensitive === true && !wasSensitive) {
      if (!('review' in parsed.options)) next.review = false;
      if (!('reviewDelayMinutes' in parsed.options)) next.reviewDelayMinutes = null;
    }

    const patch: Record<string, unknown> = { profile_options: next };
    if (parsed.ticketPrefix !== undefined) {
      if (!PREFIXED_PROFILES.has(queue.profile)) {
        throw new AppError('validation', 'Ce métier ne numérote pas avec un préfixe.', 422);
      }
      if (!TICKET_PREFIX_RE.test(parsed.ticketPrefix)) {
        throw new AppError('validation', 'Le préfixe tient en une ou deux lettres, de A à Z.', 422);
      }
      patch.ticket_prefix = parsed.ticketPrefix;
    }
    if (next.sensitive === true) {
      patch.ask_client_name = false;
      patch.client_name_required = false;
    }

    const { error } = await supabaseAdmin()
      .from('queues')
      .update(patch)
      .eq('id', queue.id)
      .eq('organization_id', organizationId);
    if (error) throw error;

    await audit({
      organizationId,
      actorUserId: userId,
      action: 'queue.profile_options_updated',
      targetType: 'queue',
      targetId: queue.id,
      metadata: {
        profile: queue.profile,
        keys: Object.keys(parsed.options),
        ...(parsed.ticketPrefix !== undefined ? { ticketPrefix: parsed.ticketPrefix } : {}),
      },
    });
    revalidate(orgSlug);
    return { ok: true, data: { options: next, ticketPrefix: (patch.ticket_prefix as string | undefined) ?? queue.ticket_prefix } };
  } catch (error) {
    return fail(error);
  }
}

/** Les clés stockées valides, sans les défauts du profil. */
function resolveStoredOnly(profile: QueueProfile, stored: unknown): ProfileOptions {
  const resolved = resolveProfileOptions(profile, stored);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const keys = new Set(Object.keys(stored as Record<string, unknown>));
  return Object.fromEntries(Object.entries(resolved).filter(([k]) => keys.has(k))) as ProfileOptions;
}

/* --------------------------------------------------------------------
   Modèles de messages
   -------------------------------------------------------------------- */

const templateSchema = z
  .object({
    profile: profileSchema,
    /** Absente : un nouveau modèle, dont la clé est tirée du libellé. */
    key: z.string().regex(TEMPLATE_KEY_RE, 'Modèle invalide.').optional(),
    label: z.string().trim().min(1, 'Donnez un nom au modèle.').max(TEMPLATE_LABEL_MAX, `${TEMPLATE_LABEL_MAX} caractères au plus pour le nom.`),
    body: z.string().max(400),
    /** Absent ou null : pour tous les établissements de l'organisation. */
    locationId: uuid.nullish(),
  })
  .strict();

async function assertTemplateProfile(organizationId: string, profile: QueueProfile): Promise<void> {
  if (isLegacyProfile(profile)) {
    throw new AppError('invalid_action', 'Ce métier n’envoie pas de message en un geste.', 400);
  }
  await assertProfileAssigned(organizationId, profile);
}

async function assertLocationInOrg(locationId: string, organizationId: string): Promise<void> {
  const { data } = await supabaseAdmin()
    .from('locations')
    .select('id')
    .eq('id', locationId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!data) throw new AppError('not_found', 'Établissement introuvable.', 404);
}

/** « Retard du jour » → « retard_du_jour » ; la clé ne sert qu'au code. */
function keyFromLabel(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base.length >= 2 ? base : 'message'}_${suffix}`;
}

/**
 * Typographie française À L'ENREGISTREMENT : l'apostrophe ’ (via
 * `typographie`), puis l'espace fine insécable (U+202F) avant « : ; ? ! ».
 * Le texte stocké est déjà juste : le poste, la notification et l'écran
 * verrouillé l'affichent tel quel, sans correction de dernière minute, et
 * « ? » ne part jamais seul en début de ligne. Une ponctuation collée à
 * une autre (« ?! ») ou suivie d'un caractère (« 19:00 », « :) ») n'est
 * pas touchée.
 */
const THIN_NBSP = '\u202F';
function typographieFr(text: string): string {
  return typographie(text).replace(/([^\s;:!?])[ \u00A0\u202F]?([;:!?])(?=\s|$)/gu, `$1${THIN_NBSP}$2`);
}

/**
 * Enregistre un modèle (surcharge d'un modèle du code, ou modèle ajouté).
 * Le texte est contrôlé comme à l'envoi : 180 caractères, variables sur
 * liste blanche, AUCUNE adresse web (un compte pro volé ne doit pas faire
 * de Rangvia un outil d'hameçonnage sous le nom du commerce).
 */
export async function upsertMessageTemplate(
  orgSlug: string,
  input: z.input<typeof templateSchema>,
): Promise<ActionResult<{ key: string }>> {
  try {
    const { organizationId, userId } = await configureAccess(orgSlug);
    const parsed = parse(templateSchema, input);
    await assertTemplateProfile(organizationId, parsed.profile);
    const locationId = parsed.locationId ?? null;
    if (locationId) await assertLocationInOrg(locationId, organizationId);

    const body = typographieFr(parsed.body);
    const label = typographieFr(parsed.label);
    const check = validateTemplateBody(body, parsed.profile);
    if (!check.ok) throw new AppError('validation', check.errors[0] ?? 'Message invalide.', 422);

    const db = supabaseAdmin();
    const key = parsed.key ?? keyFromLabel(label);

    // L'index unique porte sur une EXPRESSION (coalesce de location_id) :
    // PostgREST ne sait pas s'en servir pour un upsert. Lecture puis
    // écriture ; un double envoi simultané bute sur l'index (conflit 409).
    let existing = db
      .from('message_templates')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('profile', parsed.profile)
      .eq('key', key);
    existing = locationId ? existing.eq('location_id', locationId) : existing.is('location_id', null);
    const { data: found, error: readError } = await existing.maybeSingle();
    if (readError) throw readError;

    if (found) {
      const { error } = await db
        .from('message_templates')
        .update({ label, body, is_active: true })
        .eq('id', found.id)
        .eq('organization_id', organizationId);
      if (error) throw error;
    } else {
      const defaults = defaultTemplates(parsed.profile);
      const order = defaults.findIndex((t) => t.key === key);
      const { error } = await db.from('message_templates').insert({
        organization_id: organizationId,
        location_id: locationId,
        profile: parsed.profile,
        key,
        label,
        body,
        is_active: true,
        // Les modèles du code gardent leur rang ; les ajouts viennent après.
        sort_order: order >= 0 ? order * 10 : 1000,
      });
      if (error) throw error;
    }

    await audit({
      organizationId,
      actorUserId: userId,
      action: 'message_template.saved',
      targetType: 'message_template',
      targetId: key,
      metadata: { profile: parsed.profile, locationId, length: Array.from(body).length },
    });
    revalidate(orgSlug);
    return { ok: true, data: { key } };
  } catch (error) {
    return fail(error);
  }
}

const deleteTemplateSchema = z
  .object({
    profile: profileSchema,
    key: z.string().regex(TEMPLATE_KEY_RE, 'Modèle invalide.'),
    locationId: uuid.nullish(),
  })
  .strict();

/**
 * Supprime la surcharge : un modèle ajouté disparaît, un modèle du code
 * retrouve son texte d'origine.
 */
export async function deleteMessageTemplate(
  orgSlug: string,
  input: z.input<typeof deleteTemplateSchema>,
): Promise<ActionResult<{ key: string; restoredDefault: boolean }>> {
  try {
    const { organizationId, userId } = await configureAccess(orgSlug);
    const parsed = parse(deleteTemplateSchema, input);
    await assertTemplateProfile(organizationId, parsed.profile);
    const locationId = parsed.locationId ?? null;

    let query = supabaseAdmin()
      .from('message_templates')
      .delete()
      .eq('organization_id', organizationId)
      .eq('profile', parsed.profile)
      .eq('key', parsed.key);
    query = locationId ? query.eq('location_id', locationId) : query.is('location_id', null);
    const { error } = await query;
    if (error) throw error;

    const restoredDefault = defaultTemplates(parsed.profile).some((t) => t.key === parsed.key);
    await audit({
      organizationId,
      actorUserId: userId,
      action: 'message_template.deleted',
      targetType: 'message_template',
      targetId: parsed.key,
      metadata: { profile: parsed.profile, locationId, restoredDefault },
    });
    revalidate(orgSlug);
    return { ok: true, data: { key: parsed.key, restoredDefault } };
  } catch (error) {
    return fail(error);
  }
}

/* --------------------------------------------------------------------
   Guichets
   -------------------------------------------------------------------- */

const deskLabelSchema = z
  .object({
    staffId: uuid,
    /** Vide ou null : on revient au nom de la fiche (repli de `display_desk_label`). */
    label: z.string().trim().max(24, '24 caractères au plus.').nullable(),
  })
  .strict();

/**
 * « Guichet 3 », « Box 2 », « Salle 1 » : le libellé qu'appellent la TV
 * et la notification. Une fiche `staff` = un guichet. Le libellé est
 * public (il s'affiche en salle) : jamais de nom de personne imposé.
 */
export async function setDeskLabel(
  orgSlug: string,
  input: z.input<typeof deskLabelSchema>,
): Promise<ActionResult<{ staffId: string; label: string | null }>> {
  try {
    const { organizationId, userId } = await configureAccess(orgSlug);
    const parsed = parse(deskLabelSchema, input);
    const label = parsed.label ? typographie(parsed.label) : null;

    const db = supabaseAdmin();
    const { data: staff } = await db
      .from('staff')
      .select('id, organization_id, location_id')
      .eq('id', parsed.staffId)
      .maybeSingle();
    if (!staff || staff.organization_id !== organizationId) {
      throw new AppError('not_found', 'Fiche introuvable.', 404);
    }
    // Une fiche = un guichet, là seulement où un guichet a été installé.
    await assertProfileAssigned(organizationId, 'desk', staff.location_id as string);

    const { error } = await db
      .from('staff')
      .update({ desk_label: label })
      .eq('id', parsed.staffId)
      .eq('organization_id', organizationId);
    if (error) throw error;

    await audit({
      organizationId,
      actorUserId: userId,
      action: 'staff.desk_label_updated',
      targetType: 'staff',
      targetId: parsed.staffId,
      metadata: { label },
    });
    revalidate(orgSlug);
    return { ok: true, data: { staffId: parsed.staffId, label } };
  } catch (error) {
    return fail(error);
  }
}
