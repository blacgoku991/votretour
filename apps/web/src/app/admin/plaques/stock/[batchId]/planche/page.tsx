import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { formatSerial, formatStockCode, isStockCode, stockPlateUrl } from '@/lib/plate-stock';
import { PrintButton } from './PrintButton';
import styles from './planche.module.css';
import './planche-print.css';

export const metadata: Metadata = { title: 'Planche QR', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Planche imprimable d'un lot : chaque QR avec son code et son numéro.
 *
 * Elle sert de bon à tirer pour le fabricant, et de contrôle à la
 * livraison : on scanne une plaque reçue, on vérifie qu'elle ouvre le
 * même code que sur la planche.
 *
 * Les QR sont générés côté serveur, en correction d'erreur H comme les
 * affiches : ils restent lisibles même rayés ou partiellement masqués.
 */
export default async function PlanchePage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  if (!z.string().uuid().safeParse(batchId).success) notFound();

  const db = supabaseAdmin();
  const { data: batch } = await db
    .from('plate_batches').select('id, label, quantity').eq('id', batchId).maybeSingle();
  if (!batch) notFound();

  const { data: rows } = await db
    .from('plate_stock').select('serial, code, status').eq('batch_id', batchId).order('serial');

  const cells = await Promise.all(
    ((rows ?? []) as { serial: number; code: string; status: string }[])
      // Le code vient de la base et respecte déjà le format ; on le
      // revérifie parce qu'il est injecté tel quel dans le SVG.
      .filter((row) => isStockCode(row.code))
      .map(async (row) => ({
        ...row,
        svg: await QRCode.toString(stockPlateUrl(env.siteUrl, row.code), {
          type: 'svg',
          errorCorrectionLevel: 'H',
          margin: 0,
          color: { dark: '#0B0E13', light: '#FFFFFF' },
        }),
      })),
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div>
          <strong>{batch.label}</strong>
          <span className="t-micro t-faint"> · {cells.length} plaques · format A4, 12 par page</span>
        </div>
        <div className={styles.toolbarActions}>
          <Link className="btn btn--quiet btn--sm" href={`/admin/plaques/stock/${batch.id}`}>Retour au lot</Link>
          <PrintButton />
        </div>
      </div>

      <div className={`${styles.sheet} rv-print-sheet`}>
        {cells.map((cell) => (
          <figure key={cell.code} className={`${styles.cell} ${cell.status === 'void' ? styles.cellVoid : ''}`}>
            <div className={styles.qr} dangerouslySetInnerHTML={{ __html: cell.svg }} />
            <figcaption>
              <span className={styles.code}>{formatStockCode(cell.code)}</span>
              <span className={styles.serial}>N° {formatSerial(cell.serial)}{cell.status === 'void' ? ' · AU REBUT' : ''}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
