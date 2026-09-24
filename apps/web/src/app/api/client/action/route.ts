import { z } from 'zod';
import { jsonOk, jsonError, parseBody, publicIdSchema, uuidSchema } from '@/lib/api';
import { AppError } from '@/lib/errors';
import { clientAction, getTicketState } from '@/server/queue';
import { getClientSession, requestFingerprint } from '@/server/client-session';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';
import { profileClientAction, getProfileTicketState } from '@/server/profiles/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEGACY_ACTIONS = ['leave', 'returning', 'present'] as const;
const PROFILE_ACTIONS = ['quote_accept', 'quote_decline', 'unfollow'] as const;

const bodySchema = z.object({
  organizationId: uuidSchema,
  entryId: publicIdSchema,
  action: z.enum([...LEGACY_ACTIONS, ...PROFILE_ACTIONS]),
  /**
   * Numéro du devis que le client a lu (`details.quote.n`), exigé pour les
   * décisions. Son absence est refusée par `profileClientAction` (422,
   * « Devis inconnu : rechargez la page. ») : un seul message, sans le
   * préfixe de champ que `parseBody` ajoute aux refus de schéma.
   */
  quoteN: z.number().int().min(1).max(100_000).optional(),
});

function isLegacyAction(action: string): action is (typeof LEGACY_ACTIONS)[number] {
  return (LEGACY_ACTIONS as readonly string[]).includes(action);
}

/**
 * Actions du client sur SON ticket : quitter la file, signaler son
 * retour, se déclarer présent ; et, sur une fiche d'atelier, accepter ou
 * refuser le devis, ou ne plus suivre le véhicule.
 *
 * La propriété du ticket est vérifiée deux fois : ici par la session de
 * l'appareil, puis à nouveau dans la fonction SQL. Un identifiant de
 * ticket volé ne suffit donc pas à agir dessus.
 *
 * L'accord de devis se donne ICI, sur la page, jamais depuis une
 * notification : il exige le cookie de session et le numéro du devis que
 * le client a sous les yeux (un devis renvoyé entre-temps refuse
 * l'accord : « Le devis a changé »).
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

    if (isLegacyAction(body.action)) {
      const result = await clientAction(body.entryId, session.id, body.action);
      const ticket = await getTicketState(body.entryId, session.id);
      return jsonOk({ entry: result.entry, ticket });
    }

    const result = await profileClientAction({
      entryPublicId: body.entryId,
      clientSessionId: session.id,
      action: body.action,
      quoteN: body.quoteN ?? null,
    });
    // « Ne plus suivre » détache la fiche de cette session : `ticket_state`
    // la refuserait désormais (VT009, « n'appartient pas à cette
    // session »), et le client lirait une erreur alors que sa demande a
    // abouti. Rien à relire : l'appareil ne suit plus rien, et ne reçoit
    // donc plus rien de la fiche (immatriculation, devis) : son seul
    // identifiant, pour que l'écran sache laquelle il vient de lâcher.
    if (body.action === 'unfollow') {
      return jsonOk({ entry: { id: result.entry.id, status: result.entry.status }, ticket: null });
    }
    const ticket = await getProfileTicketState(body.entryId, session.id);
    return jsonOk({ entry: result.entry, ticket });
  } catch (error) {
    return jsonError(error);
  }
}
