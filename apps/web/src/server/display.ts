import 'server-only';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError, toAppError } from '@/lib/errors';
import type { QueueStatus } from '@/lib/types';
import { assertQueueAccess } from './auth';

/**
 * Ce que reçoit un écran de salle, et rien d'autre.
 *
 * Le téléviseur est un appareil public (en salle, sans compte, appairé par
 * cookie) : tout ce qu'on lui envoie est lisible par qui ouvre les outils de
 * son navigateur. Il ne reçoit donc plus queue_snapshot (notes du pro,
 * journal des notifications, prénoms de toute la file, réglages) mais
 * display_snapshot (migration 0031), taillé sur ce que TVBoard affiche :
 * prénoms au comptoir, initiales dans « À suivre », compteurs, équipe.
 *
 * Utilisé par le kiosque (/tv, /api/tv/snapshot), l'écran plein cadre
 * /ecran/[org] et l'aperçu /app/[org]/ecran. TVBoard n'accepte que ce type :
 * lui repasser un QueueSnapshot est une erreur de compilation.
 *
 * Cette forme est un contrat : 0036 (profils) redéfinit display_snapshot
 * avec la même sortie en walkin. Un changement qui casse la lecture d'un
 * bundle déjà chargé change aussi TV_SNAPSHOT_SHAPE (TVBoard.tsx et
 * api/tv/snapshot/route.ts), pour que les téléviseurs allumés se rechargent.
 */

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

export interface DisplaySnapshot {
  queue: { id: string; status: QueueStatus };
  location: { name: string };
  counts: {
    active: number;
    waiting: number;
    serving: number;
    /** Appelés + en attente : la file « À suivre » entière (upcoming en montre 7). */
    upcoming: number;
    completedToday: number;
  };
  /** Six au plus, dans l'ordre du poste du pro. */
  staff: DisplayStaffMember[];
  /** Trois au plus : les volets « Au comptoir ». */
  serving: DisplayServingRow[];
  /** Sept au plus (TV_MAX_SLATS) : appelés d'abord, puis l'attente. */
  upcoming: DisplayUpcomingRow[];
}

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
