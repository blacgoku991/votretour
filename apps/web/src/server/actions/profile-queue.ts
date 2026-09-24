'use server';

import QRCode from 'qrcode';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { env } from '@/lib/env';
import { AppError, toAppError } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isLegacyProfile } from '@/lib/profiles';
import { formatClock } from '@/lib/profiles/copy';
import { detailsSchemaFor } from '@/lib/profiles/details';
import { defaultTemplates, renderTemplate, validateTemplateBody } from '@/lib/profiles/templates';
import { formatTicketNo } from '@/lib/profiles/ticket';
import type { EntryDetails, ProfileQueueSnapshot, ProfileStaffEntry } from '@/lib/profiles/types';
import { requireOrgAccess, getStaffRecord } from '@/server/auth';
import { getDisplaySnapshot, type DisplaySnapshot } from '@/server/display';
import { broadcastTicketEvent } from '@/server/realtime';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';
import { STAFF_ACTIONS, staffAction, type StaffAction } from '@/server/queue';
import {
  templateHoursAt,
  type HoursOverrideRow,
  type NotificationReach,
  type WeeklyHoursRow,
} from '@/server/notifications/dispatch';
import { PROFILE_LIMITS } from '@/server/profiles/limits';
import {
  addProfileEntry,
  deskCallNext,
  frenchIssues,
  getProfileQueueSnapshot,
  getQueueProfileInfo,
  isProfileStaffAction,
  profileStaffAction,
  LEGACY_OPTION_SCHEMAS,
  PROFILE_STAFF_ACTIONS,
  turnNotice,
  type ProfileStaffAction,
  type QueueProfileInfo,
} from '@/server/profiles/queue';
import {
  generateTrackingToken,
  TRACKING_TTL_MINUTES,
  trackingUrl,
} from '@/server/profiles/tracking-link';

/**
 * ACTIONS SERVEUR DES POSTES À PROFIL (atelier, table, guichet, boutique).
 *
 * `server/actions/queue.ts` n'est pas modifié : le poste des barbiers
 * garde son fichier et ses actions. Celles-ci servent les postes des
 * profils (lots P3), et chacune revérifie, à chaque appel :
 *   1. l'accès à l'organisation désignée par l'URL, avec la permission
 *      `queue.operate` (`requireOrgAccess`) ;
 *   2. que la file ou le ticket visé appartient BIEN à cette
 *      organisation : un identifiant deviné d'un autre commerce répond
 *      « introuvable », exactement comme un identifiant inexistant ;
 *   3. des options validées en zod STRICT, action par action.
 * Rien n'est déduit d'un état du navigateur.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

/** Ce que le poste affiche après un envoi (« Prévenu 14:32 » / « Non joignable »). */
export interface SentNotice {
  kind: string;
  reach: NotificationReach;
}

function fail(error: unknown): ActionResult<never> {
  // Redirection (session expirée, organisation inaccessible) : Next.js
  // doit la voir passer, on ne la transforme pas en message d'erreur.
  unstable_rethrow(error);
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[action profils]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const orgSlugSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'Organisation invalide.');
const entryIdSchema = z.string().regex(/^[0-9a-zA-Z]{8,32}$/, 'Ticket invalide.');
const uuid = z.string().uuid('Identifiant invalide.');

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value, { error: frenchIssues });
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError('validation', first?.message ?? 'Données invalides.', 422, result.error.issues);
  }
  return result.data;
}

/* --------------------------------------------------------------------
   Contrôles d'appartenance
   -------------------------------------------------------------------- */

async function orgAccess(orgSlug: unknown) {
  const access = await requireOrgAccess(parse(orgSlugSchema, orgSlug), 'queue.operate');
  return { access, organizationId: access.organization.organization_id, userId: access.user.id };
}

/** La file appartient-elle à l'organisation de l'URL ? */
async function queueInOrg(queueId: string, organizationId: string): Promise<QueueProfileInfo> {
  const info = await getQueueProfileInfo(queueId);
  if (!info || info.organizationId !== organizationId) {
    throw new AppError('not_found', 'File introuvable.', 404);
  }
  return info;
}

interface EntryRow {
  id: string;
  public_id: string;
  queue_id: string;
  organization_id: string;
  location_id: string;
  status: string;
  stage: string | null;
  details: EntryDetails | null;
  ticket_no: number | null;
  staff_id: string | null;
}

/** Le ticket appartient-il à l'organisation de l'URL ? */
async function entryInOrg(entryId: string, organizationId: string): Promise<{ entry: EntryRow; queue: QueueProfileInfo }> {
  const { data, error } = await supabaseAdmin()
    .from('queue_entries')
    .select('id, public_id, queue_id, organization_id, location_id, status, stage, details, ticket_no, staff_id')
    .eq('public_id', entryId)
    .maybeSingle();
  if (error) throw toAppError(error);
  const entry = data as EntryRow | null;
  if (!entry || entry.organization_id !== organizationId) {
    throw new AppError('not_found', 'Ticket introuvable.', 404);
  }
  return { entry, queue: await queueInOrg(entry.queue_id, organizationId) };
}

/** Réservé aux files à profil : le poste des barbiers a ses propres actions. */
function assertProfiled(queue: QueueProfileInfo): void {
  if (isLegacyProfile(queue.profile)) {
    throw new AppError('invalid_action', 'Cette action ne concerne pas cette file.', 400);
  }
}

async function staffLimit(userId: string): Promise<void> {
  await enforceRateLimit(`staff:${userId}`, LIMITS.staffAction.max, LIMITS.staffAction.window);
}

/* --------------------------------------------------------------------
   Faire avancer un ticket
   -------------------------------------------------------------------- */

/** Les actions historiques qui annoncent déjà leur propre événement de ticket. */
const SELF_ANNOUNCING: ReadonlySet<StaffAction> = new Set<StaffAction>(['complete', 'remove', 'cancel', 'call']);

const advanceSchema = z.object({
  entryId: entryIdSchema,
  action: z.enum([...PROFILE_STAFF_ACTIONS, ...STAFF_ACTIONS] as [string, ...string[]]),
  options: z.record(z.string(), z.unknown()).optional(),
}).strict();

/**
 * Le geste principal d'un poste à profil : changer d'étape, envoyer un
 * devis, rappeler, corriger une fiche… ou l'une des actions historiques
 * (prendre en charge, appeler, rendre au client). Le message du pro et le
 * lien de suivi ont leurs actions dédiées, qui contrôlent ce qu'ils
 * envoient.
 */
export async function advanceProfileEntry(
  orgSlug: string,
  input: { entryId: string; action: ProfileStaffAction | StaffAction; options?: Record<string, unknown> },
): Promise<ActionResult<{ snapshot: ProfileQueueSnapshot | null; notice: SentNotice | null }>> {
  try {
    const { organizationId, userId } = await orgAccess(orgSlug);
    const parsed = parse(advanceSchema, input);
    const { queue } = await entryInOrg(parsed.entryId, organizationId);
    assertProfiled(queue);
    await staffLimit(userId);
    const staff = await getStaffRecord(userId, queue.locationId);

    let notice: SentNotice | null = null;
    if (isProfileStaffAction(parsed.action)) {
      if (parsed.action === 'message' || parsed.action === 'set_claim') {
        throw new AppError('invalid_action', 'Action indisponible ici.', 400);
      }
      const result = await profileStaffAction({
        entryPublicId: parsed.entryId,
        action: parsed.action,
        options: parsed.options ?? {},
        actorUserId: userId,
        actorStaffId: staff?.id ?? null,
        queue,
      });
      notice = result.notification ? { kind: result.notification.kind, reach: result.notification.reach } : null;
    } else {
      const action = parsed.action as StaffAction;
      const options = parse(LEGACY_OPTION_SCHEMAS[action], parsed.options ?? {}) as Record<string, unknown>;
      const startedAt = new Date();
      const result = await staffAction({
        entryPublicId: parsed.entryId,
        action,
        actorUserId: userId,
        actorStaffId: staff?.id ?? null,
        options,
      });
      // « Prendre en charge » fait passer l'étape de « Reçu » à
      // « Diagnostic » : l'appareil du client doit relire son ticket.
      if (!SELF_ANNOUNCING.has(action)) {
        await broadcastTicketEvent(result.queueId, parsed.entryId, 'updated');
      }
      // « Prêt · prévenir », « Table prête · appeler », « Appeler au
      // guichet » : dire au pro si le client a vraiment été prévenu.
      if (action === 'call') {
        const turn = await turnNotice(parsed.entryId, startedAt);
        notice = turn ? { kind: turn.kind, reach: turn.reach } : null;
      }
    }

    return { ok: true, data: { snapshot: await getProfileQueueSnapshot(queue.queueId), notice } };
  } catch (error) {
    return fail(error);
  }
}

/* --------------------------------------------------------------------
   Ajouter un ticket au comptoir
   -------------------------------------------------------------------- */

const addSchema = z.object({
  queueId: uuid,
  name: z.string().trim().max(40, 'Prénom trop long.').regex(/^[^<>{}\\]*$/, 'Caractères non autorisés.').nullish(),
  staffId: uuid.nullish(),
  serviceId: uuid.nullish(),
  details: z.record(z.string(), z.unknown()).optional(),
  /** Émettre tout de suite le QR de suivi (atelier). */
  issueTrackingLink: z.boolean().optional(),
}).strict();

export interface TrackingLink {
  /** URL à usage unique ; affichée une seule fois. */
  url: string;
  expiresAt: string;
  /** Le même lien en QR (SVG), prêt à afficher ou à imprimer. */
  qrSvg: string;
}

/**
 * « Ajouter un véhicule », un groupe, un ticket : fiche créée par le pro,
 * sans téléphone. En atelier, le QR de suivi peut être émis dans la
 * foulée : le client le scanne et suit sa fiche sans rien saisir.
 */
export async function addProfileEntryAction(
  orgSlug: string,
  input: z.input<typeof addSchema>,
): Promise<ActionResult<{
  snapshot: ProfileQueueSnapshot | null;
  entry: ProfileStaffEntry;
  trackingLink: TrackingLink | null;
}>> {
  try {
    const { organizationId, userId } = await orgAccess(orgSlug);
    const parsed = parse(addSchema, input);
    const queue = await queueInOrg(parsed.queueId, organizationId);
    assertProfiled(queue);
    await staffLimit(userId);

    const name = parsed.name?.trim() || null;
    if (!name && (queue.profile === 'table' || queue.clientNameRequired) && queue.options.sensitive !== true) {
      throw new AppError('validation', 'Indiquez un prénom : l’accueil appelle les noms.', 422);
    }
    const details = parse(
      detailsSchemaFor(queue.profile, { actor: 'staff', options: queue.options }),
      parsed.details ?? {},
    ) as EntryDetails;

    const staff = await getStaffRecord(userId, queue.locationId);
    const { entry } = await addProfileEntry({
      queueId: queue.queueId,
      clientName: name,
      staffId: parsed.staffId ?? null,
      serviceId: parsed.serviceId ?? null,
      actorUserId: userId,
      actorStaffId: staff?.id ?? null,
      details,
    });

    const trackingLink = parsed.issueTrackingLink
      ? await issueLink(entry.id, queue, userId, staff?.id ?? null, TRACKING_TTL_MINUTES)
      : null;

    return {
      ok: true,
      data: { snapshot: await getProfileQueueSnapshot(queue.queueId), entry, trackingLink },
    };
  } catch (error) {
    return fail(error);
  }
}

/* --------------------------------------------------------------------
   Guichet : appeler le suivant
   -------------------------------------------------------------------- */

const callNextSchema = z.object({
  queueId: uuid,
  /** Le guichet choisi en tête du poste ; à défaut, la fiche du compte. */
  deskStaffId: uuid.nullish(),
}).strict();

export async function callNextAtDesk(
  orgSlug: string,
  input: z.input<typeof callNextSchema>,
): Promise<ActionResult<{ snapshot: ProfileQueueSnapshot | null; calledId: string | null }>> {
  try {
    const { organizationId, userId } = await orgAccess(orgSlug);
    const parsed = parse(callNextSchema, input);
    const queue = await queueInOrg(parsed.queueId, organizationId);
    if (queue.profile !== 'desk' && queue.profile !== 'retail') {
      throw new AppError('invalid_action', 'Cette action ne concerne pas cette file.', 400);
    }
    await staffLimit(userId);

    const deskStaffId = parsed.deskStaffId ?? (await getStaffRecord(userId, queue.locationId))?.id ?? null;
    if (!deskStaffId) throw new AppError('validation', 'Choisissez d’abord votre guichet.', 422);

    const result = await deskCallNext({ queueId: queue.queueId, deskStaffId, actorUserId: userId });
    return {
      ok: true,
      data: { snapshot: await getProfileQueueSnapshot(queue.queueId), calledId: result.entry?.id ?? null },
    };
  } catch (error) {
    return fail(error);
  }
}

/* --------------------------------------------------------------------
   Message du pro (modèle rendu côté serveur)
   -------------------------------------------------------------------- */

const messageSchema = z.object({
  entryId: entryIdSchema,
  /** Un modèle (défaut du code ou surcharge des Réglages)… */
  templateKey: z.string().regex(/^[a-z0-9_]{2,40}$/).optional(),
  /** …ou un texte libre, soumis aux mêmes règles qu'un modèle. */
  body: z.string().max(400).optional(),
}).strict().refine((v) => (v.templateKey ? !v.body : !!v.body), 'Choisissez un modèle ou écrivez un message.');

async function loadHours(locationId: string): Promise<{ weekly: WeeklyHoursRow[]; overrides: HoursOverrideRow[] }> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [w, o] = await Promise.all([
    db.from('opening_hours').select('location_id, weekday, opens_at, closes_at, is_closed').eq('location_id', locationId),
    db.from('opening_hours_overrides').select('location_id, on_date, opens_at, closes_at, is_closed')
      .eq('location_id', locationId).gte('on_date', since),
  ]);
  return { weekly: (w.data ?? []) as WeeklyHoursRow[], overrides: (o.data ?? []) as HoursOverrideRow[] };
}

/**
 * « Vos clés sont disponibles à l'accueil » en un geste. Le texte est
 * contrôlé DEUX fois (modèle, puis texte rendu) : 180 caractères,
 * variables sur liste blanche, jamais d'adresse web ni de prénom. La base
 * borne ensuite l'envoi (10 par ticket, 30 s d'écart : VT016), et l'envoi
 * à clé `custom:<n>` le rend idempotent.
 */
export async function sendTemplateMessage(
  orgSlug: string,
  input: z.input<typeof messageSchema>,
): Promise<ActionResult<{ snapshot: ProfileQueueSnapshot | null; text: string; notice: SentNotice | null }>> {
  try {
    const { organizationId, userId } = await orgAccess(orgSlug);
    const parsed = parse(messageSchema, input);
    const { entry, queue } = await entryInOrg(parsed.entryId, organizationId);
    assertProfiled(queue);
    await enforceRateLimit(`profile-message:${userId}`, PROFILE_LIMITS.message.max, PROFILE_LIMITS.message.window);

    const db = supabaseAdmin();
    let body = parsed.body ?? null;
    if (parsed.templateKey) {
      const { data: rows } = await db
        .from('message_templates')
        .select('location_id, body')
        .eq('organization_id', organizationId)
        .eq('profile', queue.profile)
        .eq('key', parsed.templateKey)
        .eq('is_active', true);
      const stored = (rows ?? []) as { location_id: string | null; body: string }[];
      // La surcharge de l'établissement l'emporte sur celle de l'organisation,
      // qui l'emporte sur le modèle du code.
      body = stored.find((r) => r.location_id === entry.location_id)?.body
        ?? stored.find((r) => r.location_id === null)?.body
        ?? defaultTemplates(queue.profile).find((t) => t.key === parsed.templateKey)?.body
        ?? null;
      if (!body) throw new AppError('not_found', 'Modèle introuvable.', 404);
    }

    const check = validateTemplateBody(body ?? '', queue.profile);
    if (!check.ok) throw new AppError('invalid_details', check.errors[0] ?? 'Message invalide.', 422);

    const [{ data: location }, hours, desk] = await Promise.all([
      db.from('locations').select('name, phone, timezone').eq('id', entry.location_id).maybeSingle(),
      check.variables.some((v) => v.startsWith('heure_')) ? loadHours(entry.location_id) : Promise.resolve(null),
      check.variables.includes('guichet') && entry.staff_id
        ? db.from('staff').select('desk_label, display_name').eq('id', entry.staff_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const times = hours
      ? templateHoursAt(new Date(), location?.timezone ?? 'Europe/Paris', hours.weekly, hours.overrides)
      : { closesAt: null, opensAt: null };
    const { data: prefixRow } = check.variables.includes('numero')
      ? await db.from('queues').select('ticket_prefix').eq('id', queue.queueId).maybeSingle()
      : { data: null };
    const details = entry.details ?? {};
    const deskRow = desk.data as { desk_label: string | null; display_name: string } | null;

    const rendered = renderTemplate(body ?? '', {
      etablissement: location?.name ?? null,
      telephone_etablissement: location?.phone ?? null,
      heure_fermeture: times.closesAt ? formatClock(times.closesAt) : null,
      heure_ouverture: times.opensAt ? formatClock(times.opensAt) : null,
      modele: details.model ?? null,
      numero: formatTicketNo(queue.profile, entry.ticket_no, (prefixRow as { ticket_prefix?: string } | null)?.ticket_prefix ?? 'A'),
      guichet: deskRow ? deskRow.desk_label?.trim() || deskRow.display_name : null,
      couverts: details.partySize != null ? String(details.partySize) : null,
    });
    if (!rendered.ok) throw new AppError('validation', rendered.errors[0] ?? 'Message invalide.', 422);

    const staff = await getStaffRecord(userId, queue.locationId);
    const result = await profileStaffAction({
      entryPublicId: parsed.entryId,
      action: 'message',
      actorUserId: userId,
      actorStaffId: staff?.id ?? null,
      messageBody: rendered.text,
      queue,
    });

    return {
      ok: true,
      data: {
        snapshot: await getProfileQueueSnapshot(queue.queueId),
        text: rendered.text,
        notice: result.notification ? { kind: result.notification.kind, reach: result.notification.reach } : null,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/* --------------------------------------------------------------------
   Lien de suivi (QR de l'étiquette de clé)
   -------------------------------------------------------------------- */

async function issueLink(
  entryPublicId: string,
  queue: QueueProfileInfo,
  userId: string,
  staffId: string | null,
  ttlMinutes: number,
): Promise<TrackingLink> {
  const { token, hash } = generateTrackingToken();
  await profileStaffAction({
    entryPublicId,
    action: 'set_claim',
    options: { tokenHash: hash, ttlMinutes },
    actorUserId: userId,
    actorStaffId: staffId,
    queue,
  });
  const url = trackingUrl(token, env.siteUrl);
  const qrSvg = await QRCode.toString(url, {
    errorCorrectionLevel: 'M',
    type: 'svg',
    margin: 0,
    color: { dark: '#0B0E13', light: '#FFFFFF' },
  });
  return { url, expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(), qrSvg };
}

const linkSchema = z.object({
  entryId: entryIdSchema,
  ttlMinutes: z.number().int().min(5).max(1440).optional(),
}).strict();

/**
 * QR de suivi d'une fiche sans téléphone. Le jeton n'est rendu qu'ICI,
 * une seule fois : la base n'en garde que le SHA-256, et en émettre un
 * nouveau invalide le précédent.
 */
export async function issueTrackingLink(
  orgSlug: string,
  input: z.input<typeof linkSchema>,
): Promise<ActionResult<TrackingLink>> {
  try {
    const { organizationId, userId } = await orgAccess(orgSlug);
    const parsed = parse(linkSchema, input);
    const { queue } = await entryInOrg(parsed.entryId, organizationId);
    assertProfiled(queue);
    await enforceRateLimit(
      `tracking-link:${userId}`, PROFILE_LIMITS.trackingLink.max, PROFILE_LIMITS.trackingLink.window,
    );
    const staff = await getStaffRecord(userId, queue.locationId);
    const link = await issueLink(parsed.entryId, queue, userId, staff?.id ?? null, parsed.ttlMinutes ?? TRACKING_TTL_MINUTES);
    return { ok: true, data: link };
  } catch (error) {
    return fail(error);
  }
}

/* --------------------------------------------------------------------
   Lectures
   -------------------------------------------------------------------- */

/** Rafraîchissement du poste à profil (temps réel, retour de veille). */
export async function fetchProfileQueueSnapshot(
  orgSlug: string,
  queueId: string,
): Promise<ActionResult<{ snapshot: ProfileQueueSnapshot | null }>> {
  try {
    const { organizationId } = await orgAccess(orgSlug);
    const queue = await queueInOrg(parse(uuid, queueId), organizationId);
    return { ok: true, data: { snapshot: await getProfileQueueSnapshot(queue.queueId) } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Aperçu de l'écran de salle depuis le poste. Lit `display_snapshot`
 * (`server/display.ts`), exactement ce que reçoit le téléviseur : jamais
 * `queue_snapshot`, pour que l'aperçu ne montre rien que la TV ne
 * montrerait pas (immatriculation masquée en SQL, aucun prénom au guichet).
 */
export async function fetchDisplaySnapshot(
  orgSlug: string,
  queueId: string,
): Promise<ActionResult<{ snapshot: DisplaySnapshot | null }>> {
  try {
    const { organizationId } = await orgAccess(orgSlug);
    const queue = await queueInOrg(parse(uuid, queueId), organizationId);
    return { ok: true, data: { snapshot: await getDisplaySnapshot(queue.queueId) } };
  } catch (error) {
    return fail(error);
  }
}
