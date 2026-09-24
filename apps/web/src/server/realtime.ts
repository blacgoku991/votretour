import 'server-only';
import { env, requireServiceRoleKey } from '@/lib/env';
import type { PublicQueueState } from '@/lib/types';

/**
 * Diffusion temps réel vers les clients.
 *
 * Pourquoi Broadcast plutôt que Postgres Changes pour les clients ?
 * Parce que queue_entries contient les prénoms des autres personnes. Un
 * abonnement direct, même filtré, exposerait la table. On diffuse donc
 * une charge utile construite côté serveur (public_queue_state) qui ne
 * contient QUE des identifiants opaques de ticket et un nombre de
 * personnes devant. Chaque appareil y reconnaît son propre ticket grâce
 * au public_id qu'il est le seul à connaître.
 *
 * Le tableau de bord professionnel, lui, utilise Postgres Changes sous
 * RLS : il a le droit de voir les prénoms de SA file.
 */

export function queueChannel(queueId: string): string {
  return `queue:${queueId}`;
}

const BROADCAST_EVENT = 'state';

type BroadcastMessage = {
  topic: string;
  event: string;
  payload: unknown;
  private: boolean;
};

async function postBroadcast(messages: BroadcastMessage[]): Promise<boolean> {
  if (messages.length === 0) return true;
  const key = requireServiceRoleKey();

  try {
    const response = await fetch(`${env.supabase.url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('[realtime] diffusion refusée', response.status, await response.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (error) {
    // Une diffusion ratée ne doit jamais faire échouer une action de
    // file : les clients disposent d'un repli par interrogation.
    console.error('[realtime] diffusion impossible', error);
    return false;
  }
}

/** Pousse le nouvel état public d'une file à tous ses clients connectés. */
export async function broadcastQueueState(state: PublicQueueState): Promise<boolean> {
  return postBroadcast([
    {
      topic: queueChannel(state.queueId),
      event: BROADCAST_EVENT,
      payload: state,
      private: false,
    },
  ]);
}

/**
 * Événements ponctuels adressés à un ticket précis.
 *
 * `updated` (profils métier) : l'étape, le devis ou les informations du
 * ticket ont changé SANS que sa position bouge. public_queue_state ne
 * porte aucune donnée métier (et ne doit jamais en porter : il part à
 * tous les appareils de la file) ; seul l'appareil qui reconnaît son
 * public_id relit donc son propre ticket_state, sous sa session.
 */
export type TicketEvent = 'completed' | 'removed' | 'cancelled' | 'called' | 'updated';

/** Événement ponctuel adressé à un ticket précis (fin de visite, retrait, mise à jour). */
export async function broadcastTicketEvent(
  queueId: string,
  entryPublicId: string,
  event: TicketEvent,
  payload: Record<string, unknown> = {},
): Promise<boolean> {
  return postBroadcast([
    {
      topic: queueChannel(queueId),
      event: 'ticket',
      payload: { entryId: entryPublicId, event, ...payload },
      private: false,
    },
  ]);
}
