/**
 * Types du domaine, calés sur les structures jsonb renvoyées par les
 * fonctions PostgreSQL (voir supabase/migrations/…_queue_api.sql).
 */

export type EntryStatus =
  | 'waiting' | 'notified' | 'returning' | 'present' | 'next'
  | 'serving' | 'completed' | 'absent' | 'skipped' | 'cancelled' | 'expired';

export type QueueMode = 'shared' | 'per_staff';
export type QueueStatus = 'open' | 'paused' | 'closed';
export type EntrySource = 'qr' | 'nfc' | 'appclip' | 'staff' | 'link';
export type AbsentPolicy = 'hold' | 'move_back' | 'remove';
export type AdvanceMode = 'auto_serve' | 'call_next';
export type MemberRole = 'owner' | 'admin' | 'manager' | 'member';
export type ClientPlatform = 'web' | 'ios_appclip' | 'ios_app' | 'android_web' | 'unknown';
export type NotificationChannel =
  | 'web_push' | 'apns_appclip' | 'apns_app' | 'fcm'
  /** Alerte portée par une mise à jour de pass (acceptée par Apple ou Google). */
  | 'apple_wallet' | 'google_wallet';
export type NotificationKind =
  | 'ahead_two' | 'ahead_one' | 'your_turn' | 'visit_completed'
  | 'removed' | 'queue_closed' | 'event_access' | 'event_sold_out'
  | 'event_ended' | 'custom';
export type PlateKind = 'nfc' | 'qr' | 'both';
export type Accent = 'signal' | 'copper' | 'jade' | 'cobalt' | 'brique' | 'ardoise';

/** Statuts pour lesquels le client occupe réellement une place. */
export const ACTIVE_STATUSES: readonly EntryStatus[] = [
  'waiting', 'notified', 'returning', 'present', 'next', 'serving',
];

export function isActiveStatus(status: EntryStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export interface ClientEntry {
  id: string;
  name: string | null;
  status: EntryStatus;
  peopleAhead: number;
  joinedAt: string;
  calledAt: string | null;
  returningAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  staffName: string | null;
  eventId?: string | null;
  eventTicketNumber?: number | null;
}

export interface StaffEntry {
  id: string;
  name: string | null;
  status: EntryStatus;
  peopleAhead: number;
  staffId: string | null;
  serviceId: string | null;
  source: EntrySource;
  note: string | null;
  rejoinCount: number;
  joinedAt: string;
  calledAt: string | null;
  returningAt: string | null;
  presentAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  absentAt: string | null;
  notified: Record<string, string>;
  eventId?: string | null;
  eventTicketNumber?: number | null;
}

export interface StaffMember {
  id: string;
  name: string;
  roleTitle: string | null;
  avatarUrl: string | null;
  accent: Accent;
  isOnBreak: boolean;
  acceptsQueue: boolean;
  userId: string | null;
  servingEntryId: string | null;
  waitingCount: number;
}

export interface ServiceItem {
  id: string;
  name: string;
  durationMinutes: number | null;
  priceCents?: number | null;
}

export interface QueueSnapshot {
  queue: {
    id: string;
    name: string;
    mode: QueueMode;
    status: QueueStatus;
    advanceMode: AdvanceMode;
    absentPolicy: AbsentPolicy;
    absentMoveBackBy: number;
    notifyAheadThreshold: number;
    askClientName: boolean;
    clientNameRequired: boolean;
    allowStaffChoice: boolean;
    allowServiceChoice: boolean;
    pauseReason: string | null;
    maxActiveEntries: number | null;
    locationId: string;
    organizationId: string;
  };
  location: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    googleReviewUrl: string | null;
  };
  serving: StaffEntry[];
  called: StaffEntry[];
  waiting: StaffEntry[];
  parked: StaffEntry[];
  staff: StaffMember[];
  services: ServiceItem[];
  counts: { active: number; waiting: number; serving: number; completedToday: number };
  generatedAt: string;
}

/** Charge utile diffusée en temps réel aux clients : aucune donnée personnelle. */
export interface PublicQueueState {
  queueId: string;
  status: QueueStatus;
  mode: QueueMode;
  waiting: number;
  serving: number;
  entries: { id: string; ahead: number; status: EntryStatus; staffId: string | null }[];
  closedEntries: { id: string; status: EntryStatus }[];
  at: string;
}

export interface EntryPoint {
  status: 'ok' | 'suspended';
  slug: string;
  organization: { id: string; name: string; activity: string; logoUrl: string | null };
  location: {
    id: string;
    name: string;
    slug: string;
    city: string | null;
    addressLine1: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
    mapsUrl: string | null;
    phone: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
    timezone: string;
    hasReviewLink: boolean;
  };
  plate: { id: string; code: string; label: string; kind: PlateKind; staffId: string | null } | null;
  queue: {
    id: string;
    name: string;
    mode: QueueMode;
    status: QueueStatus;
    askClientName: boolean;
    clientNameRequired: boolean;
    allowStaffChoice: boolean;
    allowServiceChoice: boolean;
    pauseReason: string | null;
    waitingCount: number;
  } | null;
  settings: {
    showPeopleAhead: boolean;
    allowClientLeave: boolean;
    brandAccent: Accent;
    locale: string;
  };
  staff: {
    id: string; name: string; roleTitle: string | null; avatarUrl: string | null;
    accent: Accent; onBreak: boolean; waiting: number;
  }[];
  services: ServiceItem[];
}

export interface TicketState {
  entry: ClientEntry;
  queue: { id: string; status: QueueStatus; mode: QueueMode; name: string; pauseReason: string | null; waiting: number };
  location: {
    id: string; name: string; slug: string; city: string | null;
    addressLine1: string | null; postalCode: string | null; phone: string | null;
    latitude: number | null; longitude: number | null; mapsUrl: string | null;
    logoUrl: string | null;
    /** Renseigné uniquement une fois la prestation terminée. */
    googleReviewUrl: string | null;
  };
  organization: { name: string; logoUrl: string | null };
  /**
   * Passes Wallet du ticket, renseigné par /api/client/ticket (lot W4).
   * `appleSaved` : au moins un appareil a RÉELLEMENT inscrit le pass
   * (service web Apple) ; la page ne dit « Wallet vous préviendra »
   * qu'après cette preuve, jamais au clic.
   */
  wallet?: { appleSaved: boolean };
  at: string;
}

export interface OrganizationSummary {
  organization_id: string;
  name: string;
  slug: string;
  activity: string;
  logo_url: string | null;
  status: 'active' | 'suspended' | 'pending_deletion';
  role: MemberRole;
  onboarding_done: boolean;
  location_count: number;
}
