import Link from 'next/link';
import { formatSerial, formatStockCode } from '@/lib/plate-stock';
import type { UnassignedStockPlate } from '@/server/plate-stock';
import clientStyles from './client.module.css';
import styles from './unassigned.module.css';

/**
 * Écran d'une plaque livrée mais pas encore attribuée à un commerce.
 *
 * Pour un client : une phrase utile, pas une erreur. Pour le
 * super-admin connecté qui installe les plaques : un bouton qui ouvre
 * directement l'attribution de CETTE plaque. On scanne, on choisit la
 * société, c'est posé.
 */
export function UnassignedPlate({
  plate,
  isPlatformAdmin,
}: {
  plate: UnassignedStockPlate;
  isPlatformAdmin: boolean;
}) {
  const voided = plate.status === 'void';

  return (
    <main className={clientStyles.screen} data-theme="dark">
      <div className={`client-shell ${clientStyles.inner}`}>
        <div className={styles.wrap}>
          {/* Le rail, vide : la file de cette plaque n'existe pas encore. */}
          <div className={styles.rang} aria-hidden="true">
            <span className={styles.rail} />
            <span className={styles.slat} />
            <span className={styles.slat} />
            <span className={styles.slat} />
          </div>

          <p className="t-label">{voided ? 'Plaque désactivée' : 'Plaque Rangvia'}</p>
          <h1 className={styles.title}>
            {voided ? 'Cette plaque n’est plus en service' : 'Cette plaque n’est pas encore activée'}
          </h1>
          <p className="t-body t-muted">
            {voided
              ? 'Elle a été retirée du service. Présentez-vous directement au comptoir.'
              : 'Elle vient d’être installée : le commerce doit encore la relier à sa file. En attendant, présentez-vous directement au comptoir.'}
          </p>

          <p className={styles.code}>
            {formatStockCode(plate.code)}
            <span> · N° {formatSerial(plate.serial)}</span>
          </p>

          {isPlatformAdmin && !voided && (
            <Link
              href={`/admin/plaques/stock?code=${plate.code}`}
              className="btn btn--signal btn--lg btn--block"
            >
              Attribuer cette plaque
            </Link>
          )}
          {isPlatformAdmin && voided && (
            <Link href={`/admin/plaques/stock?code=${plate.code}`} className="btn btn--ghost btn--block">
              Ouvrir dans le super-admin
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
