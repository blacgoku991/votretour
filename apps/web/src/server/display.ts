import 'server-only';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError, toAppError } from '@/lib/errors';
import type { QueueStatus } from '@/lib/types';
import type { DeviceKind, QueueProfile, WorkshopColumn } from '@/lib/profiles/types';
import { assertQueueAccess } from './auth';

/**
 * Ce que reçoit un écran de salle, et rien d'autre.
 *
 * Le téléviseur est un appareil public (en salle, sans compte, appairé par
 * cookie) : tout ce qu'on lui envoie est lisible par qui ouvre les outils de
 * son navigateur. Il ne reçoit donc plus queue_snapshot (notes du pro,
 * journal des notifications, prénoms de toute la file, réglages) mais
 * display_snapshot (migrations 0031 et 0036), taillé sur ce que l'écran
 * affiche.
 *
 * Utilisé par le kiosque (/tv, /api/tv/snapshot), l'écran plein cadre
 * /ecran/[org] et l'aperçu /app/[org]/ecran. TVBoard n'accepte que ce type :
 * lui repasser un QueueSnapshot est une erreur de compilation.
 *
 * Union discriminée par `profile` (migration 0036) :
 *   - walkin et event : AUCUNE clé `profile`, forme de 0031 à l'identique
 *     (`WalkinDisplaySnapshot`). C'est ce que TVBoard lit aujourd'hui ;
 *   - autres profils : les mêmes six clés, dont `staff`, `serving` et
 *     `upcoming` toujours VIDES (ce sont les listes qui portent des noms),
 *     plus `profile` et un bloc propre : `workshop` (vehicle, device),
 *     `tables` (table), `desks` (desk), `pickup` (retail). Un écran qui ne
 *     connaît pas encore ces blocs (TVBoard avant le lot P5) affiche donc
 *     les compteurs d'une file cohérente, sans planter ni rien divulguer.
 *
 * Cette forme est un contrat. Un changement qui casse la lecture d'un
 * bundle déjà chargé change aussi TV_SNAPSHOT_SHAPE (TVBoard.tsx et
 * api/tv/snapshot/route.ts), pour que les téléviseurs allumés se rechargent.
 * 0036 n'en change rien : un bloc en plus n'empêche pas l'ancien bundle de
 * lire les clés qu'il connaît.
 */

/* ------------------------------------------------------------------ */
/* Tronc commun (0031)                                                  */
/* ------------------------------------------------------------------ */

export interface DisplayStaffMember {
  id: string;
  name: string;
  isOnBreak: boolean;
  /** Occupé : une prestation en cours dans cette file. */
  isServing: boolean;
}

export interface DisplayServingRow {
  id: string;
  /** Le prénom saisi par le client (il doit s'y reconnaître), ou null. */
  name: string | null;
  /** Le pro de l'équipe active qui le sert, sinon null (« En prestation »). */
  staffName: string | null;
}

export interface DisplayUpcomingRow {
  id: string;
  /** Appelé au comptoir : latte allumée. */
  called: boolean;
  /** Initiales calculées en base ; null si la personne n'a pas donné de prénom. */
  initials: string | null;
}

/** Compteurs de la file, mêmes définitions que queue_snapshot, pour tous les profils. */
export interface DisplayCounts {
  active: number;
  waiting: number;
  serving: number;
  /** Appelés + en attente : la file « À suivre » entière (upcoming en montre 7). */
  upcoming: number;
  completedToday: number;
}

interface DisplayHead {
  queue: { id: string; status: QueueStatus };
  location: { name: string };
  counts: DisplayCounts;
}

/** walkin et event : la forme de 0031, sans clé `profile`. */
export interface WalkinDisplaySnapshot extends DisplayHead {
  profile?: undefined;
  /** Six au plus, dans l'ordre du poste du pro. */
  staff: DisplayStaffMember[];
  /** Trois au plus : les volets « Au comptoir ». */
  serving: DisplayServingRow[];
  /** Sept au plus (TV_MAX_SLATS) : appelés d'abord, puis l'attente. */
  upcoming: DisplayUpcomingRow[];
}

/** Hors walkin et event : les listes nominatives de 0031 existent, toujours vides. */
interface ProfileDisplayHead<P extends QueueProfile> extends DisplayHead {
  profile: P;
  staff: [];
  serving: [];
  upcoming: [];
}

/* ------------------------------------------------------------------ */
/* Atelier (vehicle, device) : bloc `workshop`                          */
/* ------------------------------------------------------------------ */

export interface DisplayWorkshopItem {
  /** Identifiant public du ticket (clé d'animation), jamais l'identifiant interne. */
  id: string;
  /**
   * Immatriculation MASQUÉE en base (`••-••3-CD` : 3 derniers caractères),
   * ou null (atelier appareil, `tvRegistration` à `none` ou `model_only`).
   * L'immatriculation en clair ne quitte jamais le serveur, le modèle non plus.
   */
  registration: string | null;
  /** Numéro de dossier formaté (« 0042 »), si la file numérote. */
  ticketNo: string | null;
  /** Pictogramme de l'appareil (atelier appareil) ; jamais le modèle. */
  deviceKind: DeviceKind | null;
  /** Entrée dans l'étape (ISO 8601) : « prêt depuis 14:32 ». */
  since: string;
}

export interface DisplayWorkshopColumn {
  key: WorkshopColumn;
  /** Toute la colonne ; `items` n'en porte que les premières lignes. */
  total: number;
  /** 6 lignes au plus, 8 pour « ready » (le dernier prêt en tête). */
  items: DisplayWorkshopItem[];
}

export interface WorkshopDisplaySnapshot extends ProfileDisplayHead<'vehicle' | 'device'> {
  workshop: {
    /**
     * Toujours quatre colonnes, dans l'ordre du planning : intake, workshop,
     * waiting (devis et pièce réunis : rien ne dit qu'un client a un devis),
     * ready.
     */
    columns: DisplayWorkshopColumn[];
    today: { received: number; handedOver: number };
  };
}

/* ------------------------------------------------------------------ */
/* Restaurant (table) : bloc `tables`                                   */
/* ------------------------------------------------------------------ */

export interface DisplayTableRow {
  id: string;
  /** « A-012 » si la file numérote ; le numéro remplace alors le prénom. */
  ticketNo: string | null;
  /** Prénom que l'accueil appelle, seulement quand il n'y a pas de numéro. */
  name: string | null;
  /** Couverts ; null si l'accueil ne les a pas saisis. */
  partySize: number | null;
  /** Heure de l'appel (ISO 8601) : compte à rebours de présentation. */
  calledAt: string | null;
}

export interface TableDisplaySnapshot extends ProfileDisplayHead<'table'> {
  tables: {
    counts: {
      groupsWaiting: number;
      coversWaiting: number;
      groupsCalled: number;
      groupsSeatedToday: number;
      coversSeatedToday: number;
    };
    /** « Table prête » : 6 au plus, l'appel le plus ancien d'abord. */
    ready: DisplayTableRow[];
  };
}

/* ------------------------------------------------------------------ */
/* Guichet (desk) : bloc `desks`                                        */
/* ------------------------------------------------------------------ */

/** Un appel : numéro et guichet. Jamais de prénom ni de motif. */
export interface DisplayDeskCall {
  id: string;
  ticketNo: string | null;
  /** `desk_label` du guichet, à défaut le nom de la fiche. */
  deskLabel: string | null;
  calledAt: string | null;
}

export interface DeskDisplaySnapshot extends ProfileDisplayHead<'desk'> {
  desks: {
    counts: { waiting: number; called: number; servedToday: number };
    /** Appels en cours, le plus récent d'abord (l'écran le met en grand). 6 au plus. */
    current: DisplayDeskCall[];
    /** Derniers appels du jour déjà pris en charge. 5 au plus. */
    recent: DisplayDeskCall[];
  };
}

/* ------------------------------------------------------------------ */
/* Boutique (retail) : bloc `pickup`                                    */
/* ------------------------------------------------------------------ */

export interface DisplayPickupRow {
  id: string;
  /** 4 derniers caractères du numéro de commande (« 8731 »). */
  orderTail: string | null;
  ticketNo: string | null;
  since: string;
}

export interface DisplayPickupCall {
  id: string;
  ticketNo: string;
  calledAt: string | null;
}

export interface RetailDisplaySnapshot extends ProfileDisplayHead<'retail'> {
  pickup: {
    counts: { waiting: number; preparing: number; ready: number };
    /** « Commandes prêtes » : 8 au plus, la dernière prête en tête. */
    ready: DisplayPickupRow[];
    /** Clients « conseil » appelés, s'ils ont un numéro. 4 au plus. */
    calls: DisplayPickupCall[];
  };
}

/* ------------------------------------------------------------------ */
/* Union                                                                */
/* ------------------------------------------------------------------ */

export type ProfileDisplaySnapshot =
  | WorkshopDisplaySnapshot
  | TableDisplaySnapshot
  | DeskDisplaySnapshot
  | RetailDisplaySnapshot;

/**
 * L'instantané d'un écran de salle, tous profils. Discriminant : `profile`,
 * absent en walkin et en event (`snapshot.profile === undefined`).
 */
export type DisplaySnapshot = WalkinDisplaySnapshot | ProfileDisplaySnapshot;

export type DisplayRefresh =
  | { ok: true; data: { snapshot: DisplaySnapshot | null } }
  | { ok: false; error: string; code: string };

export async function getDisplaySnapshot(queueId: string): Promise<DisplaySnapshot | null> {
  const { data, error } = await supabaseAdmin().rpc('display_snapshot', { p_queue_id: queueId });
  if (error) throw toAppError(error);
  return (data as DisplaySnapshot | null) ?? null;
}

/**
 * Rafraîchissement de l'écran ouvert par un membre (/ecran/[org] et aperçu).
 * Appelé par une action serveur : l'identifiant de file vient du navigateur,
 * donc on revérifie tout à chaque appel (même garde que fetchQueueSnapshot).
 * Ne lève jamais : l'écran garde son dernier état et réessaie.
 */
export async function refreshDisplaySnapshot(queueId: unknown): Promise<DisplayRefresh> {
  try {
    const parsed = z.string().uuid().safeParse(queueId);
    if (!parsed.success) throw new AppError('validation', 'File invalide.', 422);
    await assertQueueAccess(parsed.data, 'queue.operate');
    return { ok: true, data: { snapshot: await getDisplaySnapshot(parsed.data) } };
  } catch (error) {
    const appError = toAppError(error);
    if (appError.status >= 500) console.error('[display]', appError);
    return { ok: false, error: appError.message, code: appError.code };
  }
}
