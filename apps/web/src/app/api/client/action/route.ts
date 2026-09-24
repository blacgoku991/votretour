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

const bodySchema = z
  .object({
    organizationId: uuidSchema,
    entryId: publicIdSchema,
    action: z.enum([...LEGACY_ACTIONS, ...PROFILE_ACTIONS]),
    /** Numéro du devis que le client a lu (`details.quote.n`), pour les décisions. */
    quoteN: z.number().int().min(1).max(100_000).optional(),
  })
  .superRefine((body, ctx) => {
    const decision = body.action === 'quote_accept' || body.action === 'quote_decline';
    if (decision && body.quoteN === undefined) {
      ctx.addIssue({ code: 'custom', path: ['quoteN'], message: 'Devis inconnu : rechargez la page.' });
    }
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
    // Après « Ne plus suivre », l'appareil n'a plus accès au ticket : null.
    const ticket = await getProfileTicketState(body.entryId, session.id);
    return jsonOk({ entry: result.entry, ticket });
  } catch (error) {
    return jsonError(error);
  }
}
