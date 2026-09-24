import { env } from '@/lib/env';
import { constantTimeEquals } from '@/lib/crypto';
import { dispatchDueReviews } from '@/server/notifications/dispatch';
import { reportError } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Avis Google DIFFÉRÉS (profils métier).
 *
 * Au restaurant, on ne demande pas un avis au moment où le groupe
 * s'assoit : `visit_completed` part 75 minutes après « Installer »
 * (réglable de 30 à 240 min, ou jamais). La base retient la demande
 * (`claim_entry_notification` refuse tant que le délai court) ; cette
 * route, appelée chaque minute par le service `cron`, réclame
 * atomiquement les tickets dus (`claim_due_review_notifications`) et les
 * livre. Rejouée, elle ne peut pas envoyer deux fois : ce qui est réclamé
 * est marqué dans le journal du ticket.
 *
 * Route DISTINCTE de `cron/notifications` : une panne ici ne touche ni les
 * notifications de position des barbiers, ni l'expiration des passes
 * d'événement. En walkin, aucune file n'a de délai d'avis : elle ne
 * trouve jamais rien.
 */
export async function GET(request: Request) {
  if (!checkSecret(request)) return new Response('Non autorisé', { status: 401 });

  try {
    const summary = await dispatchDueReviews();
    return Response.json({
      ok: true,
      claimed: summary.claimed,
      sent: summary.sent,
      failed: summary.failed,
      skipped: summary.skipped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'inconnu';
    await reportError({ source: 'cron.reviews', message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const POST = GET;

/** Même contrôle que `cron/notifications` : secret partagé, comparé à temps constant. */
function checkSecret(request: Request): boolean {
  if (!env.cronSecret) return !env.isProduction;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  return constantTimeEquals(token, env.cronSecret);
}
