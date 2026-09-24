import 'server-only';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError, toAppError } from '@/lib/errors';
import type { EntrySource, StaffEntry } from '@/lib/types';
import { isLegacyProfile, isQueueProfile, stageDef } from '@/lib/profiles';
import { profileAvailable } from '@/lib/profiles/capabilities';
import { containsUrl } from '@/lib/profiles/templates';
import { cleanText, detailsSchemaFor } from '@/lib/profiles/details';
import { resolveProfileOptions } from '@/lib/profiles/options';
import type {
  DeviceKind,
  EntryDetails,
  ProfileClientEntry,
  ProfileNotificationKind,
  ProfileOptions,
  ProfileQueueSnapshot,
  ProfileStaffEntry,
  ProfileStage,
  ProfileTicketState,
  QueueProfile,
} from '@/lib/profiles/types';
import { propagate, type StaffAction } from '@/server/queue';
import { broadcastTicketEvent } from '@/server/realtime';
import {
  dispatchKeyedNotification,
  reachOf,
  turnReachSince,
  type DispatchSummary,
  type NotificationReach,
} from '@/server/notifications/dispatch';

/**
 * SERVICE DES PROFILS MÉTIER — le pendant de `server/queue.ts` pour les
 * files qui ne sont pas des passages au fauteuil.
 *
 * `server/queue.ts` n'est pas modifié : le chemin des barbiers garde son
 * fichier, ses fonctions et ses appels RPC, octet pour octet. Ce module
 * réutilise seulement `propagate()` (diffusion de l'état public, puis
 * balayage des notifications de la file), exporté pour cela.
 *
 * Chaque mutation suit la même séquence que le moteur historique, plus
 * deux temps propres aux profils :
 *   1. la fonction SQL (transaction, verrou de file) ;
 *   2. `propagate` : l'état public ET les notifications de position
 *      (dont « Votre véhicule est prêt », réclamé par le balayage dès que
 *      le ticket passe à `next`) ;
 *   3. l'envoi À CLÉ de ce que le balayage ne voit pas (changement
 *      d'étape, devis, rappel, message du pro) : idempotent en base ;
 *   4. un événement `updated` au seul appareil du ticket, qui relit son
 *      `ticket_state` : aucune donnée métier ne part dans la diffusion
 *      publique.
 */

async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin().rpc(fn, params);
  if (error) throw profileError(error);
  return data as T;
}

/**
 * Refus PRÉCIS des fonctions SQL des profils.
 *
 * `toAppError` (lib/errors.ts, partagé avec les barbiers) traduit un code
 * VT0xx en un message générique : « Cette action n'est pas possible dans
 * l'état actuel. » C'est juste pour un fauteuil, trop vague pour un
 * atelier : le client qui accepte un devis renvoyé entre-temps doit lire
 * « Le devis a changé », et le pro qui rappelle une quatrième fois,
 * « Trois rappels au maximum ». On reprend donc le texte de la base, mais
 * SEULEMENT pour les messages de cette liste, écrits pour être lus : un
 * message SQL inconnu (« Action inconnue: x ») garde le texte générique.
 * Le code applicatif reste celui de `toAppError`, sauf le devis changé,
 * qui a le sien (`quote_changed`) : l'écran du client relit alors le
 * devis au lieu d'afficher une simple erreur.
 */
const PRECISE_SQL_MESSAGES: Readonly<Record<string, { message: string; code?: string; status?: number }>> = {
  'Le devis a changé : relisez-le avant de répondre': {
    message: 'Le devis a changé : relisez-le avant de répondre.',
    code: 'quote_changed',
  },
  "Aucun devis n'attend votre décision": { message: 'Aucun devis n’attend votre décision.' },
  "Un dépôt en atelier ne s'annule pas depuis le téléphone": {
    message: 'Un dépôt en atelier ne s’annule pas depuis le téléphone : appelez l’accueil.',
  },
  'Les devis ne sont pas activés pour cette file': { message: 'Les devis ne sont pas activés pour cette file.' },
  "Ce ticket n'est plus en cours": { message: 'Ce ticket n’est plus en cours.' },
  "Cette fiche est déjà suivie ou n'est plus en cours": {
    message: 'Cette fiche est déjà suivie par un téléphone, ou n’est plus en cours.',
  },
  'Seul un client appelé peut être rappelé': { message: 'Seul un client appelé peut être rappelé.' },
  'Trois rappels au maximum': { message: 'Trois rappels au maximum.' },
  'Action indisponible pour ce profil': { message: 'Cette action n’existe pas pour ce métier.' },
  "Ce guichet a déjà appelé quelqu'un": { message: 'Ce guichet a déjà appelé quelqu’un : terminez d’abord.' },
  // VT009 est le code des tickets d'un AUTRE appareil : son texte générique
  // (« Ce ticket n'appartient pas à cet appareil ») serait faux au poste
  // du pro, qui a seulement choisi un guichet disparu entre-temps.
  'Guichet inconnu pour cet établissement': {
    message: 'Ce guichet n’existe plus pour cet établissement : rechargez la page.',
    code: 'invalid_desk',
    status: 422,
  },
  // `unfollow` n'existe qu'en atelier : ailleurs la base répond par son
  // refus générique d'action inconnue, qui ne dirait rien au client.
  'Action client inconnue: unfollow': { message: 'Cette action n’existe pas pour ce métier.' },
  'Trop de messages : attendez 30 secondes entre deux envois': {
    message: 'Trop de messages : attendez 30 secondes entre deux envois.',
  },
  'Trop de messages pour ce ticket (10 au plus)': { message: 'Trop de messages pour ce ticket (10 au plus).' },
  'Informations invalides : immatriculation requise': { message: 'Saisissez l’immatriculation.' },
  'Informations invalides : immatriculation': { message: 'Immatriculation invalide.' },
  'Informations invalides : nombre de couverts (1 à 20)': { message: 'Nombre de couverts invalide (1 à 20).' },
  'Informations invalides : trop de couverts pour une inscription en ligne': {
    message: 'Pour un groupe de cette taille, appelez directement l’établissement.',
  },
  'Informations invalides : devis': { message: 'Devis invalide : un libellé de 80 caractères au plus, et un montant.' },
  'Informations invalides : montant du devis': { message: 'Montant du devis invalide.' },
  "Informations invalides : pas d'adresse web dans le libellé du devis": {
    message: 'Le libellé du devis ne peut pas contenir d’adresse web.',
  },
  "Informations invalides : pays de l'immatriculation": { message: 'Pays de l’immatriculation invalide.' },
  // 60 jours : la borne de `set_eta` en SQL, et READY_ETA_MAX_DAYS ici.
  'Informations invalides : promesse de délai': { message: 'Choisissez une date à venir, dans les 60 jours.' },
};

export function profileError(error: unknown): AppError {
  const base = toAppError(error);
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? (error as { message?: unknown }).message
    : null;
  const precise = typeof raw === 'string' ? PRECISE_SQL_MESSAGES[raw.trim()] : undefined;
  if (!precise || base.code === 'internal') return base;
  return new AppError(precise.code ?? base.code, precise.message, precise.status ?? base.status);
}

/**
 * Messages de validation en français. Les messages écrits dans les
 * schémas (« Saisissez l'immatriculation. ») l'emportent toujours : cette
 * carte ne sert qu'aux refus génériques de zod, qui sortiraient sinon en
 * anglais (« Unrecognized key ») jusque sous les yeux du client.
 */
const zodFr = z.locales.fr().localeError;
export const frenchIssues: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys.map((k) => `«\u00a0${k}\u00a0»`).join(', ');
    return issue.keys.length > 1 ? `Informations non prévues ici : ${keys}.` : `Information non prévue ici : ${keys}.`;
  }
  return zodFr(issue);
};

/* ====================================================================
   Lecture
   ==================================================================== */

/**
 * Instantané du POSTE du professionnel, informations métier comprises
 * (immatriculation en clair, modèle, devis). `queue_snapshot` ne les
 * donne que sur demande explicite (`p_include_details`), pour qu'aucun
 * autre appelant ne les reçoive par défaut. Réservé aux actions protégées
 * par `queue.operate` ; l'écran TV lit `display_snapshot`
 * (`server/display.ts`), JAMAIS cette fonction.
 */
export async function getProfileQueueSnapshot(queueId: string): Promise<ProfileQueueSnapshot | null> {
  return (
    (await rpc<ProfileQueueSnapshot | null>('queue_snapshot', {
      p_queue_id: queueId,
      p_include_details: true,
    })) ?? null
  );
}

/** `ticket_state` avec les clés des profils (étapes, numéro, devis). */
export async function getProfileTicketState(
  entryPublicId: string,
  clientSessionId: string,
): Promise<ProfileTicketState | null> {
  return (
    (await rpc<ProfileTicketState | null>('ticket_state', {
      p_entry_public_id: entryPublicId,
      p_client_session_id: clientSessionId,
    })) ?? null
  );
}

async function internalIdFor(entryPublicId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from('queue_entries')
    .select('id')
    .eq('public_id', entryPublicId)
    .maybeSingle();
  return data?.id ?? null;
}

/** Pays de l'immatriculation déjà enregistré sur une fiche (ou null). */
async function storedRegistrationCountry(entryPublicId: string): Promise<'FR' | 'other' | null> {
  const { data } = await supabaseAdmin()
    .from('queue_entries')
    .select('details')
    .eq('public_id', entryPublicId)
    .maybeSingle();
  const country = (data?.details as Record<string, unknown> | null | undefined)?.country;
  return country === 'FR' || country === 'other' ? country : null;
}

/** Ce qu'il faut savoir d'une file pour valider des informations métier. */
export interface QueueProfileInfo {
  queueId: string;
  organizationId: string;
  locationId: string;
  profile: QueueProfile;
  options: ProfileOptions;
  clientNameRequired: boolean;
}

export async function getQueueProfileInfo(queueId: string): Promise<QueueProfileInfo | null> {
  const { data, error } = await supabaseAdmin()
    .from('queues')
    .select('id, organization_id, location_id, profile, profile_options, client_name_required')
    .eq('id', queueId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;
  const profile: QueueProfile = isQueueProfile(data.profile) ? data.profile : 'walkin';
  return {
    queueId: data.id,
    organizationId: data.organization_id,
    locationId: data.location_id,
    profile,
    options: resolveProfileOptions(profile, data.profile_options),
    clientNameRequired: data.client_name_required === true,
  };
}

/* ====================================================================
   Inscriptions
   ==================================================================== */

export interface JoinProfileQueueInput {
  queueId: string;
  clientSessionId: string;
  clientName?: string | null;
  staffId?: string | null;
  serviceId?: string | null;
  source?: EntrySource;
  plateId?: string | null;
  /** Déjà validées par `detailsSchemaFor(profil, { actor: 'client' })`. */
  details: EntryDetails;
}

/**
 * Inscription du client dans une file à profil : `join_queue` avec
 * `p_details` (revalidé en SQL par `internal.clean_details`), puis
 * propagation. Même contrat que `joinQueue` : une inscription reprise
 * (`rejoined`) ne propage rien.
 */
export async function joinProfileQueue(input: JoinProfileQueueInput): Promise<{
  entry: ProfileClientEntry;
  rejoined: boolean;
  queueId: string;
}> {
  const result = await rpc<{ entry: ProfileClientEntry; rejoined: boolean; queueId: string }>('join_queue', {
    p_queue_id: input.queueId,
    p_client_session_id: input.clientSessionId,
    p_client_name: input.clientName ?? null,
    p_staff_id: input.staffId ?? null,
    p_service_id: input.serviceId ?? null,
    p_source: input.source ?? 'qr',
    p_plate_id: input.plateId ?? null,
    p_details: input.details,
  });
  if (!result.rejoined) await propagate(input.queueId);
  return result;
}

/**
 * Ajout par le professionnel (« Ajouter un véhicule », un groupe, un
 * ticket) : `add_walkin` avec `p_details`. Le pro peut poser les champs
 * qui lui sont réservés (clés reçues, accessoires, promesse de délai).
 */
export async function addProfileEntry(params: {
  queueId: string;
  clientName?: string | null;
  staffId?: string | null;
  serviceId?: string | null;
  actorUserId?: string | null;
  actorStaffId?: string | null;
  details: EntryDetails;
}): Promise<{ entry: ProfileStaffEntry; queueId: string }> {
  const result = await rpc<{ entry: ProfileStaffEntry; queueId: string }>('add_walkin', {
    p_queue_id: params.queueId,
    p_client_name: params.clientName ?? null,
    p_staff_id: params.staffId ?? null,
    p_service_id: params.serviceId ?? null,
    p_actor_user_id: params.actorUserId ?? null,
    p_actor_staff_id: params.actorStaffId ?? null,
    p_details: params.details,
  });
  await propagate(params.queueId);
  return result;
}

/* ====================================================================
   Garde d'inscription (api/client/join)
   ==================================================================== */

/** En-tête envoyé par l'App Clip qui sait afficher un suivi à profil. */
export const PROFILES_HEADER = 'x-rangvia-profiles';

type JoinPath = { kind: 'legacy' } | { kind: 'profile'; profile: QueueProfile };

/**
 * Quel parcours sert cette inscription ?
 *
 *  - walkin, event, ou une campagne d'événement (`eventId`) : le parcours
 *    d'aujourd'hui, INCHANGÉ (même appel `joinQueue`, mêmes arguments) ;
 *  - un ancien App Clip sur une file à profil : refus explicite
 *    `update_required`. Il ne sait afficher ni étape ni devis ; mieux vaut
 *    un message clair (qu'il affiche déjà, `JoinScreen.swift`) qu'un suivi
 *    muet. Le nouvel App Clip envoie `X-Rangvia-Profiles: 1` ;
 *  - un profil ni ouvert à tous ni activé pour l'organisation
 *    (`features.profiles`) : garde défensive, impossible en pratique (on
 *    ne peut pas choisir un tel profil) ; la file est alors servie comme
 *    un passage au fauteuil, sans informations métier.
 */
export async function resolveJoinPath(params: {
  profile: string | null | undefined;
  eventId: string | null | undefined;
  source: string;
  profilesHeader: string | null;
  loadFeatures: () => Promise<Record<string, unknown> | null>;
}): Promise<JoinPath> {
  const profile: QueueProfile = isQueueProfile(params.profile) ? params.profile : 'walkin';
  // Barbiers et événements : on sort AVANT toute lecture, sans rien
  // demander à la base ni regarder l'en-tête. Leur chemin ne change pas.
  if (params.eventId || isLegacyProfile(profile)) return { kind: 'legacy' };
  // Garde « profil disponible » d'abord : une file servie comme un
  // passage au fauteuil est lisible par n'importe quel App Clip.
  if (!profileAvailable(profile, await params.loadFeatures())) return { kind: 'legacy' };
  if (params.source === 'appclip' && params.profilesHeader?.trim() !== '1') {
    throw new AppError(
      'update_required',
      'Mettez à jour l’App Clip ou ouvrez le suivi dans Safari.',
      426,
    );
  }
  return { kind: 'profile', profile };
}

export async function loadOrganizationFeatures(organizationId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin()
    .from('organization_settings')
    .select('features')
    .eq('organization_id', organizationId)
    .maybeSingle();
  const features = data?.features;
  return features && typeof features === 'object' && !Array.isArray(features)
    ? (features as Record<string, unknown>)
    : null;
}

/* ====================================================================
   Actions du professionnel propres aux profils
   ==================================================================== */

export const PROFILE_STAFF_ACTIONS = [
  'set_stage', 'send_quote', 'update_details', 'set_eta', 'set_claim', 'recall', 'message',
] as const;
export type ProfileStaffAction = (typeof PROFILE_STAFF_ACTIONS)[number];

export function isProfileStaffAction(value: unknown): value is ProfileStaffAction {
  return typeof value === 'string' && (PROFILE_STAFF_ACTIONS as readonly string[]).includes(value);
}

/** Promesse de délai : dans le futur (à la minute près), 60 jours au plus. */
export const READY_ETA_MAX_DAYS = 60;

const readyEtaSchema = z
  .union([z.iso.datetime({ offset: true }), z.null()])
  .refine((value) => {
    if (value === null) return true;
    const at = new Date(value).getTime();
    const now = Date.now();
    return at > now - 60_000 && at <= now + READY_ETA_MAX_DAYS * 86_400_000;
  }, `Choisissez une date à venir, dans les ${READY_ETA_MAX_DAYS} jours.`);

/** Libellé de devis : lu par le client ; ni adresse web, ni texte vide. */
const quoteLabelSchema = z
  .string()
  .max(320)
  .transform((s) => cleanText(s, 80))
  .pipe(
    z.string()
      .min(1, 'Décrivez le devis en quelques mots.')
      .refine((s) => !containsUrl(s), 'Pas d’adresse web dans un devis.'),
  );

/**
 * Options de chaque action, en zod STRICT : une clé inattendue est
 * refusée, jamais transmise à la base. `details` est seulement une forme
 * ici ; son contenu est validé par `detailsSchemaFor` du profil de la
 * file, une fois celle-ci connue (`profileStaffAction`).
 */
export const STAFF_OPTION_SCHEMAS = {
  set_stage: z.object({
    stage: z.string().regex(/^[a-z_]{2,32}$/, 'Étape inconnue.'),
    notify: z.boolean().optional(),
  }).strict(),
  send_quote: z.object({
    amountCents: z.number().int('Montant en centimes.').min(0).max(10_000_000, 'Montant trop élevé.'),
    label: quoteLabelSchema,
    notify: z.boolean().optional(),
  }).strict(),
  update_details: z.object({
    details: z.record(z.string(), z.unknown()),
  }).strict(),
  set_eta: z.object({
    readyEta: readyEtaSchema,
  }).strict(),
  set_claim: z.object({
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    ttlMinutes: z.number().int().min(1).max(1440),
  }).strict(),
  recall: z.object({}).strict(),
  message: z.object({}).strict(),
} as const satisfies Record<ProfileStaffAction, z.ZodType>;

export type StaffActionOptions<A extends ProfileStaffAction> = z.output<(typeof STAFF_OPTION_SCHEMAS)[A]>;

/** Valide les options d'une action ; lève une erreur 422 lisible sinon. */
export function parseStaffOptions<A extends ProfileStaffAction>(action: A, options: unknown): StaffActionOptions<A> {
  const result = STAFF_OPTION_SCHEMAS[action].safeParse(options ?? {}, { error: frenchIssues });
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError('validation', first?.message ?? 'Données invalides.', 422, result.error.issues);
  }
  return result.data as StaffActionOptions<A>;
}

/**
 * Options des actions HISTORIQUES quand un poste à profil les emploie
 * (démarrer, appeler, terminer, décaler…) : mêmes clés que celles que
 * lit `staff_queue_action`, en zod strict.
 */
export const LEGACY_OPTION_SCHEMAS: Record<StaffAction, z.ZodType> = {
  complete: z.object({}).strict(),
  start_serving: z.object({}).strict(),
  call: z.object({ notify: z.boolean().optional(), staffId: z.string().uuid().optional() }).strict(),
  mark_present: z.object({}).strict(),
  mark_absent: z.object({
    policy: z.enum(['hold', 'move_back', 'remove']).optional(),
    by: z.number().int().min(1).max(20).optional(),
  }).strict(),
  defer: z.object({ by: z.number().int().min(1).max(20).optional() }).strict(),
  remove: z.object({ reason: z.string().trim().max(120).optional() }).strict(),
  restore: z.object({ position: z.enum(['front', 'back']).optional() }).strict(),
  cancel: z.object({}).strict(),
  assign_staff: z.object({ staffId: z.string().uuid().nullable() }).strict(),
  note: z.object({ note: z.string().trim().max(280) }).strict(),
};

/**
 * Correctif de fiche par le pro (`update_details`) : chaque clé non nulle
 * passe par le schéma du profil (côté pro : clés reçues, accessoires) ;
 * une clé à `null` retire l'information, et doit être une clé connue.
 *
 * `storedCountry` : le pays DÉJÀ enregistré sur la fiche. Une plaque
 * corrigée sans préciser le pays se lit dans ce pays-là : sans lui, le
 * schéma retomberait sur le format français, refuserait une plaque
 * étrangère juste et réécrirait `country: 'FR'` par-dessus 'other'.
 */
export function parseDetailsPatch(
  profile: QueueProfile,
  options: ProfileOptions,
  patch: Record<string, unknown>,
  storedCountry: 'FR' | 'other' | null = null,
): Record<string, unknown> {
  const removals = Object.entries(patch).filter(([, v]) => v === null).map(([k]) => k);
  // Une clé retirée passe AUSSI par le schéma strict, avec la valeur
  // « absente » : une clé inconnue (ou `quote`, qui n'est jamais posé par
  // ce chemin) est refusée comme si elle portait une valeur.
  const values: Record<string, unknown> = Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v]),
  );
  if (profile === 'vehicle' && typeof values.registration === 'string' && !('country' in patch) && storedCountry) {
    values.country = storedCountry;
  }
  // Le pro corrige une fiche : l'immatriculation n'est pas exigée ici.
  const parsed = detailsSchemaFor(profile, { actor: 'staff', options: { ...options, registrationRequired: false } })
    .safeParse(values, { error: frenchIssues });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError('invalid_details', first?.message ?? 'Informations invalides.', 422, parsed.error.issues);
  }
  const out: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>) };
  for (const key of removals) out[key] = null;
  return out;
}

/** Envoi déclenché par une action, et ce que le pro peut en dire. */
export interface ActionNotification {
  kind: ProfileNotificationKind;
  /** Clé du journal (`stage:…`, `quote:2`…) ; null pour « c'est votre tour ». */
  key: string | null;
  reach: NotificationReach;
  summary?: DispatchSummary;
}

/**
 * « Votre véhicule est prêt » part par le balayage de la file (et non par
 * un envoi à clé) : on lit ce qu'il est devenu dans le journal. Sert aussi
 * aux actions historiques qui appellent (« Prêt · prévenir » = `call`).
 */
export async function turnNotice(entryPublicId: string, since: Date): Promise<ActionNotification | null> {
  const entryId = await internalIdFor(entryPublicId);
  if (!entryId) return null;
  try {
    const reach = await turnReachSince(entryId, since);
    return reach === 'none' ? null : { kind: 'your_turn', key: null, reach };
  } catch (error) {
    console.error('[profiles] état de l’envoi illisible', error);
    return null;
  }
}

export interface ProfileStaffActionResult {
  entry: ProfileStaffEntry;
  promoted: ProfileStaffEntry | null;
  queueId: string;
  organizationId: string;
  locationId: string;
  /** L'envoi à clé déclenché par l'action, s'il y en a un. */
  notification: ActionNotification | null;
  /** Notifications de position envoyées par le balayage de la file. */
  swept: { claimed: number; sent: number; failed: number; skipped: number };
}

interface RawStaffResult {
  entry: ProfileStaffEntry;
  promoted: ProfileStaffEntry | null;
  queueId: string;
  organizationId: string;
  locationId: string;
}

/** Compteurs tenus par `staff_queue_action` dans le journal du ticket. */
function counter(entry: StaffEntry | ProfileStaffEntry, key: 'quote_count' | 'recall_count' | 'custom_count'): number | null {
  const raw = (entry.notified as Record<string, unknown> | null | undefined)?.[key];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Quel envoi à clé une action déclenche-t-elle ? Pur, testé à part.
 * `ready` n'en déclenche aucun : le passage à `next` est vu par le
 * balayage de la file (`your_turn`), qui a déjà tourné dans `propagate`.
 */
export function keyedSendFor(
  action: ProfileStaffAction,
  profile: QueueProfile,
  options: Record<string, unknown>,
  entry: StaffEntry | ProfileStaffEntry,
): { kind: ProfileNotificationKind; key: string } | null {
  switch (action) {
    case 'set_stage': {
      const def = stageDef(profile, typeof options.stage === 'string' ? options.stage : null);
      if (!def || options.notify !== true || def.status === 'next') return null;
      return { kind: def.notifyKind, key: `stage:${def.key}` };
    }
    case 'send_quote': {
      const n = counter(entry, 'quote_count');
      return options.notify !== false && n ? { kind: 'quote_ready', key: `quote:${n}` } : null;
    }
    case 'recall': {
      const n = counter(entry, 'recall_count');
      return n ? { kind: 'recall', key: `recall:${n}` } : null;
    }
    case 'message': {
      const n = counter(entry, 'custom_count');
      return n ? { kind: 'custom', key: `custom:${n}` } : null;
    }
    default:
      return null;
  }
}

/**
 * Action du professionnel propre aux profils :
 * set_stage | send_quote | update_details | set_eta | set_claim | recall | message.
 *
 * Les options sont validées ici (zod strict) PUIS en SQL. Pour
 * `set_stage`, la case « Prévenir le client » est TOUJOURS transmise
 * explicitement à la base : son défaut vient de l'étape (`notifyDefault`),
 * et le serveur comme la base doivent dire la même chose.
 * `message` exige `messageBody`, déjà rendu et contrôlé par l'appelant
 * (`renderTemplate` : 180 caractères, variables sur liste blanche, aucune
 * adresse web).
 */
export async function profileStaffAction(params: {
  entryPublicId: string;
  action: ProfileStaffAction;
  options?: unknown;
  actorUserId?: string | null;
  actorStaffId?: string | null;
  messageBody?: string | null;
  /** Profil et options de la file, s'ils sont déjà connus de l'appelant. */
  queue?: Pick<QueueProfileInfo, 'profile' | 'options'>;
}): Promise<ProfileStaffActionResult> {
  if (!isProfileStaffAction(params.action)) {
    throw new AppError('invalid_action', 'Action inconnue.', 400);
  }
  const action = params.action;
  const parsed = parseStaffOptions(action, params.options) as Record<string, unknown>;

  let queue = params.queue;
  if (!queue) {
    const { data } = await supabaseAdmin()
      .from('queue_entries').select('queue_id').eq('public_id', params.entryPublicId).maybeSingle();
    const info = data ? await getQueueProfileInfo(data.queue_id) : null;
    if (!info) throw new AppError('not_found', 'Ticket introuvable.', 404);
    queue = info;
  }

  let options: Record<string, unknown> = parsed;
  if (action === 'set_stage') {
    const def = stageDef(queue.profile, parsed.stage as string);
    if (!def) throw new AppError('invalid_transition', 'Cette étape n’existe pas pour ce métier.', 409);
    options = { stage: def.key, notify: (parsed.notify as boolean | undefined) ?? def.notifyDefault };
  } else if (action === 'send_quote') {
    options = { ...parsed, notify: (parsed.notify as boolean | undefined) ?? true };
  } else if (action === 'update_details') {
    const patch = parsed.details as Record<string, unknown>;
    const needsCountry = queue.profile === 'vehicle' && typeof patch.registration === 'string' && !('country' in patch);
    const storedCountry = needsCountry ? await storedRegistrationCountry(params.entryPublicId) : null;
    options = { details: parseDetailsPatch(queue.profile, queue.options, patch, storedCountry) };
  } else if (action === 'message') {
    const body = params.messageBody?.trim();
    if (!body) throw new AppError('validation', 'Le message est vide.', 422);
  }

  const startedAt = new Date();
  const result = await rpc<RawStaffResult>('staff_queue_action', {
    p_entry_public_id: params.entryPublicId,
    p_action: action,
    p_actor_user_id: params.actorUserId ?? null,
    p_actor_staff_id: params.actorStaffId ?? null,
    p_options: options,
  });

  const { notifications: swept } = await propagate(result.queueId);

  let notification: ActionNotification | null = null;
  const send = keyedSendFor(action, queue.profile, options, result.entry);
  if (send) {
    const entryId = await internalIdFor(params.entryPublicId);
    if (entryId) {
      try {
        const summary = await dispatchKeyedNotification(
          entryId, send.kind, send.key, action === 'message' ? params.messageBody ?? null : null,
        );
        notification = { ...send, reach: reachOf(summary), summary };
      } catch (error) {
        // L'action est committée : un envoi raté ne la défait pas. Le
        // journal des livraisons et le poste diront « non envoyé ».
        console.error('[profiles] envoi impossible', error);
      }
    }
  } else if (action === 'set_stage' && result.entry.status === 'next') {
    // « Prêt · prévenir » : parti par le balayage de la file.
    notification = await turnNotice(params.entryPublicId, startedAt);
  }

  await broadcastTicketEvent(result.queueId, params.entryPublicId, 'updated');

  return {
    ...result,
    notification,
    swept: { claimed: swept.claimed, sent: swept.sent, failed: swept.failed, skipped: swept.skipped },
  };
}

/* ====================================================================
   Guichet
   ==================================================================== */

/**
 * « Appeler le suivant » à SON guichet : la tête de file est affectée au
 * guichet et passe « appelée » ; « A-042 · Guichet 3 » part par le
 * balayage de la file (`your_turn`). `entry` est null si personne
 * n'attend.
 */
export async function deskCallNext(params: {
  queueId: string;
  deskStaffId: string;
  actorUserId?: string | null;
}): Promise<{ entry: ProfileStaffEntry | null; queueId: string; organizationId: string; locationId: string }> {
  const result = await rpc<{
    entry: ProfileStaffEntry | null; queueId: string; organizationId: string; locationId: string;
  }>('desk_call_next', {
    p_queue_id: params.queueId,
    p_desk_staff_id: params.deskStaffId,
    p_actor_user_id: params.actorUserId ?? null,
  });
  await propagate(result.queueId);
  if (result.entry) await broadcastTicketEvent(result.queueId, result.entry.id, 'called');
  return result;
}

/* ====================================================================
   Actions du client propres aux profils
   ==================================================================== */

export const PROFILE_CLIENT_ACTIONS = ['quote_accept', 'quote_decline', 'unfollow'] as const;
export type ProfileClientAction = (typeof PROFILE_CLIENT_ACTIONS)[number];

/**
 * Décision sur un devis, ou « Ne plus suivre ce véhicule ».
 * `quoteN` (numéro du devis que le client a LU, `details.quote.n`) est
 * transmis à la base pour les deux décisions : si le garage a renvoyé un
 * devis entre-temps, l'accord n'est pas reporté sur un montant que le
 * client n'a jamais vu (VT006, « Le devis a changé »).
 */
export async function profileClientAction(params: {
  entryPublicId: string;
  clientSessionId: string;
  action: ProfileClientAction;
  quoteN?: number | null;
}): Promise<{ entry: ProfileClientEntry; queueId: string }> {
  const isQuote = params.action === 'quote_accept' || params.action === 'quote_decline';
  if (isQuote && !(Number.isInteger(params.quoteN) && (params.quoteN as number) > 0)) {
    throw new AppError('validation', 'Devis inconnu : rechargez la page.', 422);
  }
  const result = await rpc<{ entry: ProfileClientEntry; queueId: string }>('client_queue_action', {
    p_entry_public_id: params.entryPublicId,
    p_client_session_id: params.clientSessionId,
    p_action: params.action,
    p_options: isQuote ? { quoteN: params.quoteN } : {},
  });
  await propagate(result.queueId);
  // Le poste du pro voit la décision par Postgres Changes (RLS) ; un
  // second appareil du même client, par cet événement.
  await broadcastTicketEvent(result.queueId, params.entryPublicId, 'updated');
  return result;
}

/* ====================================================================
   Rattachement par QR de suivi
   ==================================================================== */

/**
 * Aperçu d'une fiche avant rattachement, tel que `peek_claim` le rend :
 * de quoi reconnaître SA fiche, jamais le prénom ni l'immatriculation en
 * clair (masquée en SQL, `internal.mask_registration`).
 */
export interface ClaimPreview {
  organization: { id: string; name: string; logoUrl: string | null };
  location: { name: string; slug: string };
  profile: QueueProfile;
  stage: ProfileStage | null;
  model: string | null;
  deviceKind: DeviceKind | null;
  registrationMasked: string | null;
  ticketNo: string | null;
  expiresAt: string;
}

export async function peekClaim(tokenHash: string): Promise<ClaimPreview | null> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
  return (await rpc<ClaimPreview | null>('peek_claim', { p_token_hash: tokenHash })) ?? null;
}

/**
 * Rattache la fiche à la session de l'appareil. Null pour tout refus
 * (jeton inconnu, expiré, déjà utilisé, fiche déjà suivie, autre
 * organisation) : la base ne dit pas lequel, et l'interface non plus.
 */
export async function claimEntry(tokenHash: string, clientSessionId: string): Promise<{
  entry: ProfileClientEntry;
  queueId: string;
  organizationId: string;
  locationSlug: string;
} | null> {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return null;
  const result = await rpc<{
    entry: ProfileClientEntry; queueId: string; organizationId: string; locationSlug: string;
  } | null>('claim_entry', { p_token_hash: tokenHash, p_client_session_id: clientSessionId });
  if (!result) return null;
  await broadcastTicketEvent(result.queueId, result.entry.id, 'updated');
  return result;
}

/* ====================================================================
   Petits utilitaires partagés avec les routes et les actions
   ==================================================================== */

/** Le mot du sujet suivi, pour les libellés (« Suivre mon véhicule »). */
export function followLabel(profile: QueueProfile): string {
  switch (profile) {
    case 'vehicle': return 'Suivre mon véhicule';
    case 'device': return 'Suivre mon appareil';
    case 'retail': return 'Suivre ma commande';
    case 'table': return 'Suivre ma table';
    case 'desk': return 'Suivre mon ticket';
    default: return 'Suivre ma place';
  }
}
