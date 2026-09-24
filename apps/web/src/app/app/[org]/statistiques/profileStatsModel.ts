import { getProfile } from '@/lib/profiles';
import type { DeviceKind, QueueProfile } from '@/lib/profiles/types';

/**
 * STATISTIQUES PAR MÉTIER — lecture de `profile_stats` (0036).
 *
 * La fonction SQL renvoie `{ range, byProfile: { vehicle: {…}, table: {…} } }`.
 * Ce module la relit DÉFENSIVEMENT (un nombre absent reste absent, jamais
 * inventé) et prépare ce que l'écran affiche. Pur, sans React : testé par
 * `tests/profile-stats.test.ts`.
 *
 * `location_stats` (les chiffres des barbiers) n'est ni lue ni touchée ici.
 */

export interface QuoteStats {
  sent: number;
  accepted: number;
  declined: number;
  /** Accords sur décisions, en % (arrondi au dixième) ; null sans décision. */
  acceptanceRate: number | null;
  medianDecisionSeconds: number | null;
}

export interface WorkshopStats {
  dropped: number;
  handedOver: number;
  medianDropToReadySeconds: number | null;
  medianReadyToPickupSeconds: number | null;
  quote: QuoteStats;
  medianSecondsByStage: Record<string, number>;
  readyNotCollected24h: number;
  reachableRate: number | null;
  byReason: { name: string; count: number }[];
  byDeviceKind: Partial<Record<DeviceKind, number>>;
}

export interface TableStats {
  groupsSeated: number;
  coversSeated: number;
  medianWaitByPartySize: { size: string; groups: number; medianWaitSeconds: number | null }[];
  noShowAfterCallRate: number | null;
  byHour: { hour: number; groups: number; covers: number }[];
  reachableRate: number | null;
}

export interface DeskStats {
  joined: number;
  completed: number;
  medianWaitSeconds: number | null;
  medianDeskSeconds: number | null;
  byDesk: { staffId: string; label: string; served: number; medianDeskSeconds: number | null }[];
  recalls: number;
  absentRate: number | null;
  reachableRate: number | null;
}

export interface RetailStats {
  pickups: number;
  advice: number;
  medianPreparingSeconds: number | null;
  reachableRate: number | null;
}

export interface ProfileStatsView {
  vehicle?: WorkshopStats;
  device?: WorkshopStats;
  table?: TableStats;
  desk?: DeskStats;
  retail?: RetailStats;
}

/* ------------------------------------------------------------------ */
/* Lecture défensive                                                    */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
/** Nombre fini ou null (PostgREST renvoie parfois un numeric en chaîne). */
function num(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
function count(v: unknown): number {
  const n = num(v);
  return n != null && n > 0 ? Math.round(n) : 0;
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

const DEVICE_KINDS: readonly DeviceKind[] = ['phone', 'tablet', 'computer', 'console', 'watch', 'other'];

function readWorkshop(raw: unknown): WorkshopStats {
  const o = obj(raw);
  const q = obj(o.quote);
  const stages: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(o.medianSecondsByStage))) {
    const n = num(v);
    if (n != null && n >= 0) stages[k] = n;
  }
  const kinds: Partial<Record<DeviceKind, number>> = {};
  for (const [k, v] of Object.entries(obj(o.byDeviceKind))) {
    if ((DEVICE_KINDS as readonly string[]).includes(k)) kinds[k as DeviceKind] = count(v);
  }
  return {
    dropped: count(o.dropped),
    handedOver: count(o.handedOver),
    medianDropToReadySeconds: num(o.medianDropToReadySeconds),
    medianReadyToPickupSeconds: num(o.medianReadyToPickupSeconds),
    quote: {
      sent: count(q.sent),
      accepted: count(q.accepted),
      declined: count(q.declined),
      acceptanceRate: num(q.acceptanceRate),
      medianDecisionSeconds: num(q.medianDecisionSeconds),
    },
    medianSecondsByStage: stages,
    readyNotCollected24h: count(o.readyNotCollected24h),
    reachableRate: num(o.reachableRate),
    byReason: arr(o.byReason)
      .map((r) => ({ name: str(obj(r).name, 'Autre'), count: count(obj(r).count) }))
      .filter((r) => r.count > 0),
    byDeviceKind: kinds,
  };
}

function readTable(raw: unknown): TableStats {
  const o = obj(raw);
  return {
    groupsSeated: count(o.groupsSeated),
    coversSeated: count(o.coversSeated),
    medianWaitByPartySize: arr(o.medianWaitByPartySize).map((r) => ({
      size: str(obj(r).size, '?'),
      groups: count(obj(r).groups),
      medianWaitSeconds: num(obj(r).medianWaitSeconds),
    })),
    noShowAfterCallRate: num(o.noShowAfterCallRate),
    byHour: arr(o.byHour)
      .map((r) => ({ hour: Math.round(num(obj(r).hour) ?? -1), groups: count(obj(r).groups), covers: count(obj(r).covers) }))
      .filter((r) => r.hour >= 0 && r.hour <= 23),
    reachableRate: num(o.reachableRate),
  };
}

function readDesk(raw: unknown): DeskStats {
  const o = obj(raw);
  return {
    joined: count(o.joined),
    completed: count(o.completed),
    medianWaitSeconds: num(o.medianWaitSeconds),
    medianDeskSeconds: num(o.medianDeskSeconds),
    byDesk: arr(o.byDesk).map((r, i) => ({
      staffId: str(obj(r).staffId, String(i)),
      label: str(obj(r).label, 'Guichet'),
      served: count(obj(r).served),
      medianDeskSeconds: num(obj(r).medianDeskSeconds),
    })),
    recalls: count(o.recalls),
    absentRate: num(o.absentRate),
    reachableRate: num(o.reachableRate),
  };
}

function readRetail(raw: unknown): RetailStats {
  const o = obj(raw);
  return {
    pickups: count(o.pickups),
    advice: count(o.advice),
    medianPreparingSeconds: num(o.medianPreparingSeconds),
    reachableRate: num(o.reachableRate),
  };
}

/** Relit la sortie de `profile_stats`. walkin et event n'y figurent jamais. */
export function parseProfileStats(raw: unknown): ProfileStatsView {
  const by = obj(obj(raw).byProfile);
  const out: ProfileStatsView = {};
  if ('vehicle' in by) out.vehicle = readWorkshop(by.vehicle);
  if ('device' in by) out.device = readWorkshop(by.device);
  if ('table' in by) out.table = readTable(by.table);
  if ('desk' in by) out.desk = readDesk(by.desk);
  if ('retail' in by) out.retail = readRetail(by.retail);
  return out;
}

/* ------------------------------------------------------------------ */
/* Mises en forme                                                       */
/* ------------------------------------------------------------------ */

const NBSP = ' ';

/**
 * Durée d'atelier : contrairement à `formatDurationBounded` (plafonnée à
 * « + de 24 h », juste pour une file d'attente), une réparation dure
 * souvent plusieurs jours, et c'est précisément ce que le garage veut lire.
 * « 45 s », « 12 min », « 2 h 05 », « 1 j 4 h », « 3 j ».
 */
export function formatSpan(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}${NBSP}s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes}${NBSP}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${NBSP}h${NBSP}${String(minutes % 60).padStart(2, '0')}`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}${NBSP}j ${rest}${NBSP}h` : `${days}${NBSP}j`;
}

/** « 89,5 % » ; « — » sans valeur. */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(rate)}${NBSP}%`;
}

export interface StageDurationRow {
  stage: string;
  label: string;
  seconds: number;
  /** L'étape où le temps passe : la seule mise en avant (emphase). */
  longest: boolean;
}

/**
 * Temps médian par étape, dans l'ORDRE du rail d'étapes du métier (jamais
 * trié par valeur : l'atelier se lit de gauche à droite). Une étape sans
 * valeur n'a pas de ligne.
 */
export function stageDurationRows(profile: QueueProfile, bySeconds: Record<string, number>): StageDurationRow[] {
  const rows = getProfile(profile).stages
    .filter((s) => bySeconds[s.key] != null && bySeconds[s.key]! > 0)
    .map((s) => ({ stage: s.key, label: s.staff, seconds: bySeconds[s.key]!, longest: false }));
  const max = Math.max(0, ...rows.map((r) => r.seconds));
  // Une seule ligne en avant, même à égalité : la première dans l'ordre du rail.
  const i = rows.findIndex((r) => r.seconds === max);
  if (i >= 0 && rows.length > 1) rows[i]!.longest = true;
  return rows;
}

/** Tailles de groupe : « 1-2 » devient « 1 à 2 », « 7+ » devient « 7 et plus ». */
export function partySizeLabel(size: string): string {
  const m = /^(\d+)-(\d+)$/.exec(size);
  if (m) return `${m[1]} à ${m[2]}`;
  const p = /^(\d+)\+$/.exec(size);
  if (p) return `${p[1]} et plus`;
  return size;
}

/** Devis en attente de réponse : envoyés moins décidés (jamais négatif). */
export function pendingQuotes(q: QuoteStats): number {
  return Math.max(0, q.sent - q.accepted - q.declined);
}
