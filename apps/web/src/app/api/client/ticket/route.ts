import { z } from 'zod';
import { jsonOk, jsonError, parseQuery, uuidSchema, publicIdSchema } from '@/lib/api';
import { findActiveTicket, getTicketState } from '@/server/queue';
import { getClientSession } from '@/server/client-session';
import { eventWalletForTicket } from '@/components/wallet/server';

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
 *
 * Wallet (lot W4) : `walletOffer` et `ticket.wallet` ne concernent QUE
 * les billets d'événement. Pour tout autre ticket, l'offre vaut null et
 * `ticket.wallet` est absent, sans la moindre lecture supplémentaire en
 * base (eventWalletForTicket s'arrête avant). C'est aussi par cette route
 * que l'écran découvre l'offre juste après l'inscription à un drop : la
 * page, rendue avant, n'avait pas encore de ticket.
 */
export async function GET(request: Request) {
  try {
    const query = parseQuery(request, querySchema);
    const session = await getClientSession(query.organizationId);
    if (!session) return jsonOk({ ticket: null, walletOffer: null });

    const ticket = query.entryId
      ? await getTicketState(query.entryId, session.id)
      : await findActiveTicket(session.id);

    const wallet = await eventWalletForTicket({
      ticket,
      organizationId: query.organizationId,
      userAgent: request.headers.get('user-agent'),
    });

    return jsonOk({
      ticket: ticket && wallet.wallet ? { ...ticket, wallet: wallet.wallet } : ticket,
      walletOffer: wallet.offer,
    });
  } catch (error) {
    return jsonError(error);
  }
}
