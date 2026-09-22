import { env } from '@/lib/env';
import { constantTimeEquals } from '@/lib/crypto';
import { expireStaleEntries, purgeExpiredData } from '@/server/queue';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { reportError } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Entretien périodique. À appeler toutes les 15 minutes.
 *
 *  1. EXPIRATION des tickets oubliés : quelqu'un scanne, part et ne
 *     revient jamais. Sans cela, il bloquerait la file indéfiniment.
 *     Chaque file concernée est ensuite rediffusée en temps réel.
 *
 *  2. PURGE RGPD : au-delà de la durée de conservation choisie par
 *     l'établissement, les prénoms sont effacés, les sessions
 *     d'appareil supprimées et les abonnements push morts nettoyés.
 *
 * Protégée par CRON_SECRET, comparé en temps constant : une
 * comparaison naïve laisserait fuiter le secret caractère par caractère.
 */
export async function GET(request: Request) {
  const authorized = checkSecret(request);
  if (!authorized) return new Response('Non autorisé', { status: 401 });

  const started = Date.now();
  const report: Record<string, unknown> = {};

  try {
    report.expired = await expireStaleEntries();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'inconnu';
    report.expiredError = message;
    await reportError({ source: 'cron.maintenance.expire', message });
  }

  try {
    report.purge = await purgeExpiredData();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'inconnu';
    report.purgeError = message;
    await reportError({ source: 'cron.maintenance.purge', message });
  }

  try {
    // Les abonnements push dont la fenêtre est passée : côté App Clip,
    // Apple ferme la porte 8 h après le lancement.
    const { data: deactivated } = await supabaseAdmin()
      .from('notification_subscriptions')
      .update({ is_active: false })
      .lt('expires_at', new Date().toISOString())
      .eq('is_active', true)
      .select('id');
    report.deactivatedSubscriptions = deactivated?.length ?? 0;
  } catch (error) {
    report.subscriptionsError = error instanceof Error ? error.message : 'inconnu';
  }

  return Response.json({ ok: true, durationMs: Date.now() - started, ...report });
}

export const POST = GET;

function checkSecret(request: Request): boolean {
  // Vercel Cron signe ses appels avec CRON_SECRET en Bearer.
  if (!env.cronSecret) {
    // Sans secret configuré, on n'expose la route qu'en développement.
    return !env.isProduction;
  }
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  return constantTimeEquals(token, env.cronSecret);
}
