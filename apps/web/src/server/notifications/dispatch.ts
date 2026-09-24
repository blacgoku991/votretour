import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import type { NotificationChannel, NotificationKind } from '@/lib/types';
import { profileNotificationCopy, type OpeningState, type ProfileCopyContext } from '@/lib/profiles/copy';
import { isLegacyProfile, isQueueProfile } from '@/lib/profiles';
import { formatTicketNo } from '@/lib/profiles/ticket';
import type {
  EntryDetails, ProfileNotificationKind, ProfileStage, QueueProfile,
} from '@/lib/profiles/types';
import { sendApns, apnsConfigured } from './apns';
import { sendWebPush, webPushConfigured } from './webpush';

/**
 * Chaîne d'envoi des notifications.
 *
 * Règle de fond : une notification n'est déclarée « envoyée » que si le
 * fournisseur (APNs ou service Push du navigateur) l'a acceptée. Chaque
 * tentative laisse une ligne dans notification_deliveries avec son
 * statut réel. Aucune interface n'affiche « notification envoyée » sur
 * la foi d'un appel de fonction.
 */

interface PendingNotification {
  entry_id: string;
  entry_public_id: string;
  kind: ProfileNotificationKind;
  client_session_id: string | null;
  organization_id: string;
  location_id: string;
  client_name: string | null;
  people_ahead: number;
  status: string;
  destination_url?: string | null;
  /** Texte d'un message du pro (`custom`), déjà rendu et contrôlé. */
  body_override?: string | null;
}

interface SubscriptionRow {
  id: string;
  channel: NotificationChannel;
  endpoint: string | null;
  p256dh: string | null;
  auth_secret: string | null;
  device_token: string | null;
  bundle_id: string | null;
  apns_environment: 'sandbox' | 'production' | null;
  invocation_url: string | null;
  expires_at: string | null;
  client_session_id: string;
}

interface LocationInfo {
  id: string;
  name: string;
  slug: string;
  google_review_url: string | null;
  timezone: string | null;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  reasons: string[];
}

const EMPTY: DispatchSummary = { claimed: 0, sent: 0, failed: 0, skipped: 0, reasons: [] };

/**
 * Durée de vie d'une notification : au-delà, elle n'a plus de sens.
 *
 * Le profil ne change que ce qui dure plus longtemps chez lui : un
 * véhicule prêt le reste jusqu'au lendemain (12 h, contre 10 min pour
 * « c'est votre tour » au fauteuil), un devis attend la décision du
 * client une journée. En walkin, les durées d'aujourd'hui, inchangées.
 */
export function ttlSecondsFor(kind: ProfileNotificationKind, profile: QueueProfile = 'walkin'): number {
  switch (kind) {
    case 'your_turn':
      return profile === 'vehicle' || profile === 'device' ? 43_200 : 600; // 12 h en atelier, 10 min ailleurs
    case 'quote_ready': return 86_400;   // 24 h : le client décide quand il peut
    case 'stage_update': return 43_200;  // 12 h
    case 'recall': return 600;           // 10 min : un rappel périmé n'a plus de sens
    case 'ahead_one': return 900;        // 15 min
    case 'ahead_two': return 900;
    case 'visit_completed': return 86_400; // l'avis Google peut attendre
    case 'event_access': return 900;
    case 'event_sold_out': return 3600;
    case 'event_ended': return 3600;
    default: return 1800;
  }
}

function ticketUrl(slug: string, kind: ProfileNotificationKind): string {
  // Un devis s'ouvre sur sa carte (`#devis`) : l'acceptation se fait
  // TOUJOURS sur la page, sous la session de l'appareil, jamais depuis la
  // notification (pas d'accord accidentel d'un geste sur l'écran verrouillé).
  const anchor = kind === 'quote_ready' ? '#devis' : '';
  return `${env.siteUrl}/e/${slug}?src=push&k=${kind}${anchor}`;
}

/**
 * Ce que le pro peut lire d'un envoi (conception, § 3.3). Seul le
 * fournisseur fait foi : « sent » veut dire qu'APNs ou le service Push a
 * accepté le message, jamais qu'il a été lu.
 *   sent        : au moins une livraison acceptée → « Prévenu 14:32 » ;
 *   failed      : le fournisseur a refusé toutes les tentatives ;
 *   unreachable : réclamé, mais aucun canal utilisable (pas d'abonnement,
 *                 fiche sans appareil) → « Non joignable » : le pro sait
 *                 qu'il doit appeler lui-même ;
 *   none        : rien à envoyer (déjà envoyé, ou étape passée sans prévenir).
 */
export type NotificationReach = 'sent' | 'failed' | 'unreachable' | 'none';

export function reachOf(summary: Pick<DispatchSummary, 'claimed' | 'sent' | 'failed' | 'skipped'>): NotificationReach {
  if (summary.sent > 0) return 'sent';
  if (summary.failed > 0) return 'failed';
  if (summary.claimed > 0) return 'unreachable';
  return 'none';
}

/**
 * Traite toutes les notifications en attente d'une file.
 * La réclamation est atomique côté base : deux appels concurrents ne
 * peuvent pas produire deux fois le même message.
 */
export async function dispatchQueueNotifications(queueId: string): Promise<DispatchSummary> {
  const db = supabaseAdmin();

  // En mode Event / Drop, l'organisateur contrôle explicitement les
  // vagues. Les notifications classiques "1 personne devant" /
  // "c'est votre tour" seraient dangereuses car elles pourraient faire
  // revenir une foule avant qu'un laisser-passer ait été émis.
  const { data: runningEvent, error: eventError } = await db
    .from('event_campaigns')
    .select('id')
    .eq('queue_id', queueId)
    .in('status', ['live', 'paused'])
    .limit(1)
    .maybeSingle();

  if (eventError) {
    console.error('[notifications] détection event impossible', eventError);
    return { ...EMPTY, reasons: [eventError.message] };
  }
  if (runningEvent) return EMPTY;

  const { data, error } = await db.rpc('claim_pending_notifications', { p_queue_id: queueId });
  if (error) {
    console.error('[notifications] réclamation impossible', error);
    return { ...EMPTY, reasons: [error.message] };
  }

  const pending = (data ?? []) as PendingNotification[];
  if (pending.length === 0) return EMPTY;

  return deliverAll(pending);
}

/** Notification ponctuelle sur un ticket (fin de visite, retrait de file). */
export async function dispatchEventEntryNotification(
  entryId: string,
  kind: 'event_access' | 'event_sold_out' | 'event_ended',
  destinationUrl?: string | null,
): Promise<DispatchSummary> {
  const db = supabaseAdmin();

  const { data: claimed, error: claimError } = await db.rpc('claim_entry_notification', {
    p_entry_id: entryId,
    p_kind: kind,
  });
  if (claimError) {
    console.error('[notifications] réclamation event impossible', claimError);
    return { ...EMPTY, reasons: [claimError.message] };
  }
  if (claimed !== true) {
    return { ...EMPTY, skipped: 1, reasons: ['déjà envoyée'] };
  }

  const { data: entry, error } = await db
    .from('queue_entries')
    .select('id, public_id, organization_id, location_id, client_session_id, client_name, people_ahead, status')
    .eq('id', entryId)
    .maybeSingle();

  if (error || !entry) return { ...EMPTY, skipped: 1, reasons: ['ticket introuvable'] };

  return deliverAll([{
    entry_id: entry.id,
    entry_public_id: entry.public_id,
    kind,
    client_session_id: entry.client_session_id,
    organization_id: entry.organization_id,
    location_id: entry.location_id,
    client_name: entry.client_name,
    people_ahead: entry.people_ahead,
    status: entry.status,
    destination_url: destinationUrl ?? null,
  }]);
}

export async function dispatchEntryNotification(
  entryId: string,
  kind: NotificationKind,
): Promise<DispatchSummary> {
  const db = supabaseAdmin();

  const { data: claimed, error: claimError } = await db.rpc('claim_entry_notification', {
    p_entry_id: entryId,
    p_kind: kind,
  });
  if (claimError) {
    console.error('[notifications] réclamation ponctuelle impossible', claimError);
    return { ...EMPTY, reasons: [claimError.message] };
  }
  if (claimed !== true) {
    return { ...EMPTY, skipped: 1, reasons: ['déjà envoyée'] };
  }

  const { data: entry, error } = await db
    .from('queue_entries')
    .select('id, public_id, organization_id, location_id, client_session_id, client_name, people_ahead, status')
    .eq('id', entryId)
    .maybeSingle();

  if (error || !entry) return { ...EMPTY, skipped: 1, reasons: ['ticket introuvable'] };

  return deliverAll([
    {
      entry_id: entry.id,
      entry_public_id: entry.public_id,
      kind,
      client_session_id: entry.client_session_id,
      organization_id: entry.organization_id,
      location_id: entry.location_id,
      client_name: entry.client_name,
      people_ahead: entry.people_ahead,
      status: entry.status,
    },
  ]);
}

/* ====================================================================
   Profils métier : envois à clé et avis différés
   ==================================================================== */

async function pendingForEntry(
  entryId: string,
  kind: ProfileNotificationKind,
  bodyOverride: string | null,
): Promise<PendingNotification | null> {
  const { data: entry, error } = await supabaseAdmin()
    .from('queue_entries')
    .select('id, public_id, organization_id, location_id, client_session_id, client_name, people_ahead, status')
    .eq('id', entryId)
    .maybeSingle();
  if (error || !entry) return null;
  return {
    entry_id: entry.id,
    entry_public_id: entry.public_id,
    kind,
    client_session_id: entry.client_session_id,
    organization_id: entry.organization_id,
    location_id: entry.location_id,
    client_name: entry.client_name,
    people_ahead: entry.people_ahead,
    status: entry.status,
    body_override: bodyOverride,
  };
}

/**
 * Envoi IDEMPOTENT d'une notification de profil, sous une clé du journal
 * du ticket (`claim_entry_notification_key`) :
 *   stage:<étape>  changement d'étape (la base efface la clé à chaque
 *                  entrée dans l'étape : une seconde pièce commandée
 *                  prévient de nouveau, la même transition jamais deux fois) ;
 *   quote:<n>      n-ième devis envoyé ;
 *   recall:<n>     n-ième rappel ;
 *   custom:<n>     n-ième message du pro.
 * Un double clic, une action rejouée ou deux postes simultanés ne
 * produisent donc qu'UN message : la réclamation est atomique en base.
 */
export async function dispatchKeyedNotification(
  entryId: string,
  kind: ProfileNotificationKind,
  key: string,
  bodyOverride?: string | null,
): Promise<DispatchSummary> {
  const db = supabaseAdmin();
  const { data: claimed, error: claimError } = await db.rpc('claim_entry_notification_key', {
    p_entry_id: entryId,
    p_key: key,
  });
  if (claimError) {
    console.error('[notifications] réclamation à clé impossible', claimError);
    return { ...EMPTY, reasons: [claimError.message] };
  }
  if (claimed !== true) {
    return { ...EMPTY, reasons: ['déjà envoyée'] };
  }

  const pending = await pendingForEntry(entryId, kind, bodyOverride ?? null);
  if (!pending) return { ...EMPTY, skipped: 1, reasons: ['ticket introuvable'] };
  return deliverAll([pending]);
}

/**
 * Avis différés (restaurant : 75 min après « Installer ») : la base
 * réclame atomiquement les tickets dont le délai est écoulé
 * (`claim_due_review_notifications`, même forme de retour que
 * `claim_pending_notifications`), puis la livraison suit le chemin commun.
 * Appelée chaque minute par `api/cron/reviews`, y compris quand la file
 * est fermée : un restaurant ferme souvent juste après le service.
 */
export async function dispatchDueReviews(limit = 200): Promise<DispatchSummary> {
  const { data, error } = await supabaseAdmin().rpc('claim_due_review_notifications', { p_limit: limit });
  if (error) {
    // Levée, pas avalée : le cron doit répondre 500 et laisser une trace,
    // sans quoi une panne passerait pour « aucun avis dû ».
    throw new Error(`réclamation des avis différés impossible : ${error.message}`);
  }
  const pending = (data ?? []) as PendingNotification[];
  if (pending.length === 0) return { ...EMPTY, reasons: [] };
  return deliverAll(pending);
}

/**
 * Ce qu'est devenu « c'est votre tour » (« Votre véhicule est prêt ») :
 * celui-là part par le balayage de la file, pas par un envoi à clé. On
 * relit donc le journal du ticket, puis les livraisons écrites depuis
 * `since`. Une réclamation sans aucune livraison journalisée veut dire
 * « aucun appareil rattaché » : non joignable.
 */
export async function turnReachSince(entryId: string, since: Date): Promise<NotificationReach> {
  const db = supabaseAdmin();
  const { data: entry } = await db
    .from('queue_entries').select('notification_status').eq('id', entryId).maybeSingle();
  const flag = (entry?.notification_status as Record<string, unknown> | null | undefined)?.your_turn;
  // Absent, ou « Prêt » passé sans prévenir ('silenced') : rien n'est parti.
  if (typeof flag !== 'string' || flag === 'silenced') return 'none';
  const claimedAt = Date.parse(flag);
  if (Number.isFinite(claimedAt) && claimedAt < since.getTime() - 5_000) return 'none';

  const { data: rows } = await db
    .from('notification_deliveries')
    .select('status')
    .eq('queue_entry_id', entryId)
    .eq('kind', 'your_turn')
    .gte('created_at', new Date(since.getTime() - 5_000).toISOString());
  const statuses = ((rows ?? []) as { status: string }[]).map((r) => r.status);
  if (statuses.includes('sent')) return 'sent';
  if (statuses.includes('failed')) return 'failed';
  return 'unreachable';
}

/* ====================================================================
   Contexte de rédaction (profils métier)
   ==================================================================== */

export interface WeeklyHoursRow {
  location_id: string;
  /** 0 = lundi, comme la colonne `opening_hours.weekday`. */
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
}

export interface HoursOverrideRow {
  location_id: string;
  on_date: string;
  opens_at: string | null;
  closes_at: string | null;
  is_closed: boolean;
}

interface Slot { opensAt: string; closesAt: string }

const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

function hhmm(value: string | null): string | null {
  const m = value ? /^(\d{2}):(\d{2})/.exec(value) : null;
  return m ? `${m[1]}:${m[2]}` : null;
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone });
    return timeZone;
  } catch {
    return 'Europe/Paris';
  }
}

/** Date et heure locales d'un instant dans un fuseau : « 2026-09-24 », « 14:05 ». */
function localParts(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(timeZone),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = lundi. */
function mondayIndex(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Créneaux d'un jour local : la dérogation datée l'emporte sur la semaine
 * type. Null si l'on ne sait rien de ce jour (aucune ligne) : on ne
 * devine pas un horaire.
 */
function slotsOn(date: string, weekly: readonly WeeklyHoursRow[], overrides: readonly HoursOverrideRow[]): Slot[] | null {
  const override = overrides.find((o) => o.on_date === date);
  if (override) {
    const opensAt = hhmm(override.opens_at);
    const closesAt = hhmm(override.closes_at);
    if (override.is_closed || !opensAt || !closesAt || closesAt <= opensAt) return [];
    return [{ opensAt, closesAt }];
  }
  const rows = weekly.filter((h) => h.weekday === mondayIndex(date));
  if (rows.length === 0) return null;
  return rows
    .filter((h) => !h.is_closed)
    .map((h) => ({ opensAt: hhmm(h.opens_at), closesAt: hhmm(h.closes_at) }))
    .filter((h): h is Slot => !!h.opensAt && !!h.closesAt && h.closesAt > h.opensAt)
    .sort((a, b) => a.opensAt.localeCompare(b.opensAt));
}

/**
 * État d'ouverture au moment de l'envoi, d'après les VRAIS horaires de
 * l'établissement — même règle que `internal.today_hours` (0034) :
 * créneau en cours → « Ouvert jusqu'à 19 h 00 » ; sinon prochain créneau
 * du jour → « Réouverture aujourd'hui à 14 h 00 » ; sinon premier jour
 * ouvert des sept suivants → « Réouverture demain / lundi à … ». Null
 * quand les horaires du jour sont inconnus : le texte n'en dit rien.
 */
export function openingStateAt(
  now: Date,
  timeZone: string,
  weekly: readonly WeeklyHoursRow[],
  overrides: readonly HoursOverrideRow[] = [],
): OpeningState | null {
  const { date, time } = localParts(now, timeZone);
  const today = slotsOn(date, weekly, overrides);
  if (today === null) return null;

  const current = today.find((s) => s.closesAt > time);
  if (current) {
    return current.opensAt <= time
      ? { status: 'open', closesAt: current.closesAt }
      : { status: 'closed', reopensAt: current.opensAt, reopensDay: 'today' };
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = addDays(date, offset);
    const first = slotsOn(day, weekly, overrides)?.[0];
    if (first) {
      return {
        status: 'closed',
        reopensAt: first.opensAt,
        reopensDay: offset === 1 ? 'tomorrow' : WEEKDAY_NAMES[mondayIndex(day)] ?? 'demain',
      };
    }
  }
  return null;
}

/**
 * Horaires cités par les modèles de messages du pro : `{heure_fermeture}`
 * (fin du créneau en cours ou du prochain créneau du jour) et
 * `{heure_ouverture}` (prochaine ouverture APRÈS maintenant, aujourd'hui ou
 * dans les sept jours). Null quand on ne sait pas : le message est alors
 * refusé (`renderTemplate`), jamais envoyé avec un trou.
 */
export function templateHoursAt(
  now: Date,
  timeZone: string,
  weekly: readonly WeeklyHoursRow[],
  overrides: readonly HoursOverrideRow[] = [],
): { closesAt: string | null; opensAt: string | null } {
  const { date, time } = localParts(now, timeZone);
  const today = slotsOn(date, weekly, overrides) ?? [];
  const closesAt = today.find((s) => s.closesAt > time)?.closesAt ?? null;
  let opensAt = today.find((s) => s.opensAt > time)?.opensAt ?? null;
  for (let offset = 1; !opensAt && offset <= 7; offset += 1) {
    opensAt = slotsOn(addDays(date, offset), weekly, overrides)?.[0]?.opensAt ?? null;
  }
  return { closesAt, opensAt };
}

/** Ce que la rédaction sait d'un ticket, en plus de ce qu'a réclamé la base. */
export type EntryCopyContext = Omit<ProfileCopyContext, 'locationName' | 'peopleAhead' | 'clientName' | 'body'>;

interface EntryRow {
  id: string;
  queue_id: string;
  location_id: string;
  details: EntryDetails | null;
  stage: string | null;
  ticket_no: number | null;
  staff_id: string | null;
  called_at: string | null;
}

interface QueueRow {
  id: string;
  profile: string;
  absent_grace_minutes: number | null;
  ticket_prefix: string | null;
}

const HOURS_PROFILES: ReadonlySet<QueueProfile> = new Set<QueueProfile>(['vehicle', 'device']);

/**
 * Contexte de rédaction d'un lot (conception, § 7.2) : profil de la file,
 * informations métier du ticket, numéro, guichet, délai de présentation
 * et horaires réels. Quelques lectures PAR LOT, jamais par notification.
 *
 * En walkin et en event, seuls le ticket et sa file sont lus : le profil
 * suffit à `profileNotificationCopy` pour déléguer À L'IDENTIQUE à
 * `notificationCopy`. Si une lecture échoue, le lot part avec le texte
 * d'aujourd'hui plutôt que pas du tout : une notification sans nuance de
 * métier vaut mieux qu'un client jamais prévenu.
 */
async function loadCopyContexts(
  pending: readonly PendingNotification[],
  locations: ReadonlyMap<string, LocationInfo>,
  now: Date,
): Promise<Map<string, EntryCopyContext>> {
  const out = new Map<string, EntryCopyContext>();
  const db = supabaseAdmin();
  try {
    const entryIds = [...new Set(pending.map((p) => p.entry_id))];
    const { data: entryData, error: entryError } = await db
      .from('queue_entries')
      .select('id, queue_id, location_id, details, stage, ticket_no, staff_id, called_at')
      .in('id', entryIds);
    if (entryError) throw entryError;
    const entries = (entryData ?? []) as EntryRow[];

    const queueIds = [...new Set(entries.map((e) => e.queue_id))];
    const queues = new Map<string, QueueRow>();
    if (queueIds.length) {
      const { data, error } = await db
        .from('queues').select('id, profile, absent_grace_minutes, ticket_prefix').in('id', queueIds);
      if (error) throw error;
      for (const q of (data ?? []) as QueueRow[]) queues.set(q.id, q);
    }

    const profileOf = (e: EntryRow): QueueProfile => {
      const raw = queues.get(e.queue_id)?.profile;
      return isQueueProfile(raw) ? raw : 'walkin';
    };
    const profiled = entries.filter((e) => !isLegacyProfile(profileOf(e)));

    // Guichets : « Guichet 3 », ou le nom de la fiche à défaut.
    const deskStaffIds = [...new Set(
      profiled.filter((e) => profileOf(e) === 'desk' && e.staff_id).map((e) => e.staff_id as string),
    )];
    const desks = new Map<string, string>();
    if (deskStaffIds.length) {
      const { data } = await db.from('staff').select('id, desk_label, display_name').in('id', deskStaffIds);
      for (const row of (data ?? []) as { id: string; desk_label: string | null; display_name: string }[]) {
        desks.set(row.id, row.desk_label?.trim() || row.display_name);
      }
    }

    // Horaires : seulement pour les ateliers, les seuls textes qui les citent.
    const hoursLocations = [...new Set(
      profiled.filter((e) => HOURS_PROFILES.has(profileOf(e))).map((e) => e.location_id),
    )];
    let weekly: WeeklyHoursRow[] = [];
    let overrides: HoursOverrideRow[] = [];
    if (hoursLocations.length) {
      const since = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
      const [w, o] = await Promise.all([
        db.from('opening_hours')
          .select('location_id, weekday, opens_at, closes_at, is_closed')
          .in('location_id', hoursLocations),
        db.from('opening_hours_overrides')
          .select('location_id, on_date, opens_at, closes_at, is_closed')
          .in('location_id', hoursLocations)
          .gte('on_date', since),
      ]);
      weekly = (w.data ?? []) as WeeklyHoursRow[];
      overrides = (o.data ?? []) as HoursOverrideRow[];
    }

    for (const e of entries) {
      const profile = profileOf(e);
      if (isLegacyProfile(profile)) {
        out.set(e.id, { profile });
        continue;
      }
      const queue = queues.get(e.queue_id);
      const grace = queue?.absent_grace_minutes ?? null;
      const details: EntryDetails = e.details ?? {};
      out.set(e.id, {
        profile,
        details,
        stage: (e.stage as ProfileStage | null) ?? null,
        ticketNo: formatTicketNo(profile, e.ticket_no, queue?.ticket_prefix ?? 'A'),
        deskLabel: e.staff_id ? desks.get(e.staff_id) ?? null : null,
        hours: HOURS_PROFILES.has(profile)
          ? openingStateAt(
              now,
              locations.get(e.location_id)?.timezone ?? 'Europe/Paris',
              weekly.filter((h) => h.location_id === e.location_id),
              overrides.filter((h) => h.location_id === e.location_id),
            )
          : null,
        graceMinutes: grace,
        // Table appelée : minutes restantes avant que la table soit rendue.
        remainingMinutes: grace != null && e.called_at
          ? Math.ceil((new Date(e.called_at).getTime() + grace * 60_000 - now.getTime()) / 60_000)
          : null,
        quote: details.quote ? { amountCents: details.quote.amountCents, label: details.quote.label } : null,
      });
    }
  } catch (error) {
    console.error('[notifications] contexte de rédaction indisponible', error);
  }
  return out;
}

async function deliverAll(pending: PendingNotification[]): Promise<DispatchSummary> {
  const db = supabaseAdmin();
  const summary: DispatchSummary = { claimed: pending.length, sent: 0, failed: 0, skipped: 0, reasons: [] };

  const sessionIds = [...new Set(pending.map((p) => p.client_session_id).filter((v): v is string => !!v))];
  const locationIds = [...new Set(pending.map((p) => p.location_id))];

  if (sessionIds.length === 0) {
    summary.skipped = pending.length;
    summary.reasons.push('aucun appareil rattaché (client ajouté au comptoir)');
    return summary;
  }

  const [{ data: subsData }, { data: locData }] = await Promise.all([
    db
      .from('notification_subscriptions')
      .select('id, channel, endpoint, p256dh, auth_secret, device_token, bundle_id, apns_environment, invocation_url, expires_at, client_session_id')
      .in('client_session_id', sessionIds)
      .eq('is_active', true),
    db.from('locations').select('id, name, slug, google_review_url, timezone').in('id', locationIds),
  ]);

  const subsBySession = new Map<string, SubscriptionRow[]>();
  for (const sub of (subsData ?? []) as SubscriptionRow[]) {
    const list = subsBySession.get(sub.client_session_id) ?? [];
    list.push(sub);
    subsBySession.set(sub.client_session_id, list);
  }
  const locations = new Map<string, LocationInfo>(
    ((locData ?? []) as LocationInfo[]).map((l) => [l.id, l]),
  );

  const deliveries: Record<string, unknown>[] = [];
  const deactivate: string[] = [];
  const now = Date.now();
  const contexts = await loadCopyContexts(pending, locations, new Date(now));

  for (const item of pending) {
    const location = locations.get(item.location_id);
    if (!location) {
      summary.skipped += 1;
      continue;
    }

    const subs = (item.client_session_id ? subsBySession.get(item.client_session_id) : undefined) ?? [];
    const usable = subs.filter((s) => !s.expires_at || new Date(s.expires_at).getTime() > now);

    if (usable.length === 0) {
      summary.skipped += 1;
      // On trace le fait qu'aucun canal n'était disponible : c'est ce qui
      // permet à l'interface de dire honnêtement « surveillez l'écran ».
      deliveries.push({
        organization_id: item.organization_id,
        queue_entry_id: item.entry_id,
        entry_public_id: item.entry_public_id,
        kind: item.kind,
        status: 'skipped',
        error: subs.length === 0 ? 'aucun abonnement push actif' : 'abonnements expirés',
        title: null,
        body: null,
      });
      continue;
    }

    // En walkin et en event, profileNotificationCopy rend EXACTEMENT
    // notificationCopy (même titre, même corps) : les barbiers reçoivent
    // les textes d'aujourd'hui, caractère pour caractère.
    const context = contexts.get(item.entry_id);
    const profile = context?.profile ?? 'walkin';
    const copy = profileNotificationCopy(item.kind, {
      ...context,
      profile,
      locationName: location.name,
      peopleAhead: item.people_ahead,
      clientName: item.client_name,
      body: item.body_override ?? null,
    });

    for (const sub of usable) {
      const result = await sendOne(sub, item, location, copy, profile);
      if (result.status === 'sent') summary.sent += 1;
      else if (result.status === 'failed') summary.failed += 1;
      else summary.skipped += 1;
      if (result.deactivate) deactivate.push(sub.id);
      if (result.error) summary.reasons.push(`${sub.channel}: ${result.error}`);
      deliveries.push(result.record);
    }
  }

  if (deliveries.length > 0) {
    const { error } = await db.from('notification_deliveries').insert(deliveries);
    if (error) console.error('[notifications] journalisation impossible', error);
  }

  if (deactivate.length > 0) {
    await db
      .from('notification_subscriptions')
      .update({ is_active: false, last_failure_at: new Date().toISOString() })
      .in('id', deactivate);
  }

  return summary;
}

async function sendOne(
  sub: SubscriptionRow,
  item: PendingNotification,
  location: LocationInfo,
  copy: { title: string; body: string },
  profile: QueueProfile,
): Promise<{
  status: 'sent' | 'failed' | 'skipped';
  deactivate: boolean;
  error?: string;
  record: Record<string, unknown>;
}> {
  const base = {
    organization_id: item.organization_id,
    location_id: item.location_id,
    queue_entry_id: item.entry_id,
    entry_public_id: item.entry_public_id,
    subscription_id: sub.id,
    channel: sub.channel,
    kind: item.kind,
    title: copy.title,
    body: copy.body,
    attempts: 1,
  };

  const reviewUrl = item.kind === 'visit_completed' && location.google_review_url
    ? `${env.siteUrl}/api/client/review/click?entry=${encodeURIComponent(item.entry_public_id)}&source=notification`
    : null;
  const destinationUrl = item.destination_url ?? ticketUrl(location.slug, item.kind);

  /* ---------------- App Clip / application iOS (APNs) ---------------- */
  if (sub.channel === 'apns_appclip' || sub.channel === 'apns_app') {
    if (!apnsConfigured()) {
      return {
        status: 'skipped', deactivate: false, error: 'APNs non configuré',
        record: { ...base, status: 'skipped', error: 'APNs non configuré' },
      };
    }
    if (!sub.device_token || !sub.bundle_id) {
      return {
        status: 'skipped', deactivate: true, error: 'jeton APNs incomplet',
        record: { ...base, status: 'skipped', error: 'jeton APNs incomplet' },
      };
    }

    const result = await sendApns(
      sub.device_token,
      // Le topic est le bundle ID de la cible (App Clip ou app complète).
      sub.bundle_id,
      {
        title: copy.title,
        subtitle: copy.title === location.name ? undefined : location.name,
        body: copy.body,
        // Indispensable pour un App Clip multi-commerces : c'est ce qui
        // route la notification vers la bonne instance.
        targetContentId: sub.invocation_url ?? `${env.siteUrl}/e/${location.slug}`,
        // QUOTE_READY : l'App Clip (lot iOS) y ajoute « Voir le devis »,
        // qui OUVRE le suivi ; l'accord se donne toujours sur la page.
        category: item.kind === 'visit_completed' ? 'VISIT_COMPLETED'
          : item.kind === 'quote_ready' ? 'QUOTE_READY'
          : 'QUEUE_UPDATE',
        threadId: item.entry_public_id,
        collapseId: `${item.entry_public_id}`,
        interruptionLevel: item.kind === 'your_turn' || item.kind === 'recall' ? 'time-sensitive' : 'active',
        expiration: Math.floor(Date.now() / 1000) + ttlSecondsFor(item.kind, profile),
        data: {
          kind: item.kind,
          entryId: item.entry_public_id,
          peopleAhead: item.people_ahead,
          locationName: location.name,
          locationSlug: location.slug,
          reviewUrl,
          eventUrl: item.kind.startsWith('event_') ? destinationUrl : null,
        },
      },
      sub.apns_environment ?? env.apns.environment,
    );

    if (result.ok) {
      await touchSuccess(sub.id);
      return {
        status: 'sent', deactivate: false,
        record: { ...base, status: 'sent', http_status: result.status,
                  provider_message_id: result.apnsId, sent_at: new Date().toISOString() },
      };
    }
    await touchFailure(sub.id, result.reason);
    return {
      status: 'failed', deactivate: result.shouldDeactivate, error: result.reason,
      record: { ...base, status: 'failed', http_status: result.status, error: result.reason },
    };
  }

  /* ---------------------- Web Push (Android, PWA) --------------------- */
  if (sub.channel === 'web_push') {
    if (!webPushConfigured()) {
      return {
        status: 'skipped', deactivate: false, error: 'Web Push non configuré',
        record: { ...base, status: 'skipped', error: 'Web Push non configuré' },
      };
    }
    if (!sub.endpoint || !sub.p256dh || !sub.auth_secret) {
      return {
        status: 'skipped', deactivate: true, error: 'abonnement incomplet',
        record: { ...base, status: 'skipped', error: 'abonnement incomplet' },
      };
    }

    const result = await sendWebPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth_secret },
      {
        title: copy.title,
        body: copy.body,
        url: destinationUrl,
        tag: item.entry_public_id,
        kind: item.kind,
        entryId: item.entry_public_id,
        renotify: true,
        requireInteraction: item.kind === 'your_turn' || item.kind === 'quote_ready',
        actions: reviewUrl
          ? [{ action: 'review', title: 'Laisser un avis Google', url: reviewUrl }]
          : item.kind === 'quote_ready'
            ? [{ action: 'quote', title: 'Voir le devis', url: destinationUrl }]
            : undefined,
      },
      {
        ttlSeconds: ttlSecondsFor(item.kind, profile),
        urgency: item.kind === 'your_turn' || item.kind === 'recall' ? 'high' : 'normal',
      },
    );

    if (result.ok) {
      await touchSuccess(sub.id);
      return {
        status: 'sent', deactivate: false,
        record: { ...base, status: 'sent', http_status: result.status, sent_at: new Date().toISOString() },
      };
    }
    await touchFailure(sub.id, result.reason);
    return {
      status: 'failed', deactivate: result.shouldDeactivate, error: result.reason,
      record: { ...base, status: 'failed', http_status: result.status, error: result.reason.slice(0, 500) },
    };
  }

  return {
    status: 'skipped', deactivate: false, error: `canal non pris en charge: ${sub.channel}`,
    record: { ...base, status: 'skipped', error: `canal non pris en charge: ${sub.channel}` },
  };
}

async function touchSuccess(subscriptionId: string): Promise<void> {
  await supabaseAdmin()
    .from('notification_subscriptions')
    .update({ last_success_at: new Date().toISOString(), failure_count: 0, last_error: null })
    .eq('id', subscriptionId);
}

async function touchFailure(subscriptionId: string, reason: string): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('notification_subscriptions')
    .select('failure_count')
    .eq('id', subscriptionId)
    .maybeSingle();
  await db
    .from('notification_subscriptions')
    .update({
      failure_count: (data?.failure_count ?? 0) + 1,
      last_failure_at: new Date().toISOString(),
      last_error: reason.slice(0, 500),
    })
    .eq('id', subscriptionId);
}
