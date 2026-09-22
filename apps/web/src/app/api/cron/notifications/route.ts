import { env } from '@/lib/env';
import { constantTimeEquals } from '@/lib/crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { dispatchQueueNotifications } from '@/server/notifications/dispatch';
import { expireEventPasses } from '@/server/queue';
import { reportError } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Filet de sécurité des notifications.
 *
 * En fonctionnement normal, une notification part dans la foulée de
 * l'action du professionnel. Cette route rattrape les cas où l'envoi
 * n'a pas pu aboutir sur le moment : coupure réseau du serveur, APNs
 * momentanément indisponible, fonction interrompue.
 *
 * La réclamation étant atomique côté base, la rejouer ne peut pas
 * produire de doublon : ce qui a déjà été envoyé n'est plus réclamable.
 */
export async function GET(request: Request) {
  if (!checkSecret(request)) return new Response('Non autorisé', { status: 401 });

  const db = supabaseAdmin();
  const summary = {
    queues: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    eventPassesExpired: 0,
  };

  try {
    // Les accès Event ont une durée courte : on les expire à la même
    // cadence que le cron notifications (chaque minute sur le VPS).
    const eventExpiry = await expireEventPasses();
    summary.eventPassesExpired = eventExpiry.expired;

    const { data: queues } = await db
      .from('queues').select('id').eq('status', 'open').limit(500);

    for (const queue of queues ?? []) {
      const result = await dispatchQueueNotifications(queue.id);
      if (result.claimed > 0) {
        summary.queues += 1;
        summary.sent += result.sent;
        summary.failed += result.failed;
        summary.skipped += result.skipped;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'inconnu';
    await reportError({ source: 'cron.notifications', message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  return Response.json({ ok: true, ...summary });
}

export const POST = GET;

function checkSecret(request: Request): boolean {
  if (!env.cronSecret) return !env.isProduction;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  return constantTimeEquals(token, env.cronSecret);
}
