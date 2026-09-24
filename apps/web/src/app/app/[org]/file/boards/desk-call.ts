'use server';

import { callNextAtDesk, type ActionResult, type SentNotice } from '@/server/actions/profile-queue';
import { turnNotice } from '@/server/profiles/queue';
import type { ProfileQueueSnapshot } from '@/lib/profiles/types';

/**
 * « APPELER LE SUIVANT » AU GUICHET, AVEC L'ÉTAT RÉEL DE L'ENVOI.
 *
 * C'est LE geste du guichet : l'agent doit savoir si la personne appelée a
 * vraiment été prévenue (« Prévenu 14:32 ✓ », « Non joignable », « Envoi
 * indisponible »), comme sur les autres postes (conception, § 3.3).
 * `callNextAtDesk` ne le dit pas encore ; en attendant qu'il le fasse
 * lui-même (demande faite au lot P2), cette action l'enveloppe :
 *
 *  1. l'heure est notée AVANT l'appel : seules les livraisons nées de cet
 *     appel comptent ;
 *  2. `callNextAtDesk` fait TOUT le contrôle (organisation, permission
 *     `queue.operate`, file de cette organisation, guichet) : rien n'est
 *     lu ici tant qu'il n'a pas répondu `ok` ;
 *  3. l'état de l'envoi n'est lu que pour la fiche que cet appel vient
 *     d'affecter (`calledId`, rendu par l'action contrôlée).
 *
 * Aucun envoi retrouvé n'est jamais présenté comme un succès : `notice`
 * vaut alors `{ reach: 'none' }` (« Aucun envoi »), pas null.
 */
export async function callNextWithNotice(
  orgSlug: string,
  input: { queueId: string; deskStaffId?: string | null },
): Promise<ActionResult<{ snapshot: ProfileQueueSnapshot | null; calledId: string | null; notice: SentNotice | null }>> {
  const startedAt = new Date();
  const result = await callNextAtDesk(orgSlug, input);
  if (!result.ok) return result;
  const { calledId } = result.data;
  if (!calledId) return { ok: true, data: { ...result.data, notice: null } };
  const turn = await turnNotice(calledId, startedAt);
  return {
    ok: true,
    data: {
      ...result.data,
      notice: turn ? { kind: turn.kind, reach: turn.reach } : { kind: 'your_turn', reach: 'none' },
    },
  };
}
