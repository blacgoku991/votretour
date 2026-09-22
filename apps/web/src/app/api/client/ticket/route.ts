import { z } from 'zod';
import { jsonOk, jsonError, parseQuery, uuidSchema, publicIdSchema } from '@/lib/api';
import { findActiveTicket, getTicketState } from '@/server/queue';
import { getClientSession } from '@/server/client-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  organizationId: uuidSchema,
  entryId: publicIdSchema.optional(),
});

/**
 * État courant du ticket de cet appareil.
 *
 * C'est le repli lorsque le temps réel est indisponible (tunnel, métro,
 * Wi-Fi capricieux) et le mécanisme de reprise de session : au retour
 * sur la page, l'appareil retrouve automatiquement sa place sans que le
 * client ait à faire quoi que ce soit.
 */
export async function GET(request: Request) {
  try {
    const query = parseQuery(request, querySchema);
    const session = await getClientSession(query.organizationId);
    if (!session) return jsonOk({ ticket: null });

    const ticket = query.entryId
      ? await getTicketState(query.entryId, session.id)
      : await findActiveTicket(session.id);

    return jsonOk({ ticket });
  } catch (error) {
    return jsonError(error);
  }
}
