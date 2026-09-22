import { z } from 'zod';
import { jsonOk, jsonError, parseBody, publicIdSchema, uuidSchema } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { clientAction, getTicketState } from '@/server/queue';
import { getClientSession, requestFingerprint } from '@/server/client-session';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  organizationId: uuidSchema,
  entryId: publicIdSchema,
  action: z.enum(['leave', 'returning', 'present']),
});

/**
 * Actions du client sur SON ticket : quitter la file, signaler son
 * retour, se déclarer présent.
 *
 * La propriété du ticket est vérifiée deux fois : ici par la session de
 * l'appareil, puis à nouveau dans la fonction SQL. Un identifiant de
 * ticket volé ne suffit donc pas à agir dessus.
 */
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, bodySchema);
    const fingerprint = await requestFingerprint();

    await enforceRateLimit(
      `client-action:${fingerprint.ipHash ?? 'inconnue'}`,
      LIMITS.clientAction.max,
      LIMITS.clientAction.window,
    );

    const session = await getClientSession(body.organizationId);
    if (!session) {
      throw new AppError('session_mismatch', "Cet appareil n'a pas de ticket actif.", 403);
    }

    const result = await clientAction(body.entryId, session.id, body.action);
    const ticket = await getTicketState(body.entryId, session.id);

    return jsonOk({ entry: result.entry, ticket });
  } catch (error) {
    return jsonError(error);
  }
}
