import { z } from 'zod';
import { assertPlatformAdmin } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { audit } from '@/server/audit';
import { buildSupplierCsv, buildSupplierUrlList, type SupplierRow } from '@/lib/plate-stock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Fichier à envoyer au fabricant de plaques.
 *
 *   ?format=csv  tableau Excel : numéro, code imprimé, URL à graver, lot
 *   ?format=txt  une URL par ligne, le format des encodeurs NFC
 *
 * Réservé au super-admin. Chaque export est journalisé : ces liens
 * partent chez un tiers, on veut savoir qui les a sortis et quand.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  let admin;
  try {
    admin = await assertPlatformAdmin();
  } catch {
    return new Response('Accès réservé au super-admin.', { status: 403 });
  }

  const { batchId } = await context.params;
  if (!z.string().uuid().safeParse(batchId).success) {
    return new Response('Lot introuvable.', { status: 404 });
  }
  const format = new URL(request.url).searchParams.get('format') === 'txt' ? 'txt' : 'csv';

  const db = supabaseAdmin();
  const { data: batch } = await db
    .from('plate_batches').select('id, label').eq('id', batchId).maybeSingle();
  if (!batch) return new Response('Lot introuvable.', { status: 404 });

  // Les plaques mises au rebut restent dans l'export : le fabricant a
  // gravé le lot entier, la liste doit correspondre à ce qu'il a livré.
  const { data: rows, error } = await db
    .from('plate_stock')
    .select('serial, code')
    .eq('batch_id', batchId)
    .order('serial');
  if (error) return new Response('Export impossible.', { status: 500 });

  const list = (rows ?? []) as SupplierRow[];
  const body = format === 'txt'
    ? buildSupplierUrlList(list, env.siteUrl)
    : buildSupplierCsv(list, env.siteUrl, batch.label);

  await audit({
    actor: 'platform_admin',
    actorUserId: admin.id,
    action: 'plate_stock.batch_exported',
    targetType: 'plate_batch',
    targetId: batch.id,
    metadata: { format, count: list.length },
  });

  const safeName = batch.label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'lot';

  return new Response(body, {
    headers: {
      'Content-Type': format === 'txt' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rangvia-plaques-${safeName}.${format}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
