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
 *  3. CODES D'APPAIRAGE TV expirés depuis plus d'un jour : supprimés.
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

  try {
    // Passes Wallet : effacement 24 h après la fin du passage, suppression
    // 7 jours plus tard, file d'envoi nettoyée (purge_wallet_data, 0021).
    // Délais plus courts que data_retention_days : un pass n'a plus
    // d'utilité une fois le passage terminé.
    const { data, error } = await supabaseAdmin().rpc('purge_wallet_data');
    if (error) throw error;
    report.wallet = data;
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message ?? 'inconnu';
    report.walletError = message;
    await reportError({ source: 'cron.maintenance.wallet', message });
  }

  try {
    // Codes d'appairage TV : utiles 10 minutes, conservés un jour pour
    // l'enquête en cas d'appairage suspect, puis supprimés. Sans cela la
    // table grossit indéfiniment d'empreintes qui ne servent plus à rien.
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: purgedCodes, error } = await supabaseAdmin()
      .from('display_pair_codes')
      .delete()
      .lt('expires_at', cutoff)
      .select('id');
    if (error) throw error;
    report.purgedPairCodes = purgedCodes?.length ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'inconnu';
    report.pairCodesError = message;
    await reportError({ source: 'cron.maintenance.pair_codes', message });
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
