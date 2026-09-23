import Link from 'next/link';
import { formatSerial, formatStockCode } from '@/lib/plate-stock';
import type { UnassignedStockPlate } from '@/server/plate-stock';
import { FloorScene } from '@/components/objects/FloorScene';
import { Wordmark } from '@/components/Wordmark';
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
      <span className={`floor-marks ${clientStyles.sideMarks}`} aria-hidden="true" />
      <div className={`client-shell ${clientStyles.inner}`}>
        <div className={styles.wrap}>
          {/* La marque en haut, comme sur la 404 et l'écran TV. */}
          <div className={styles.bar}>
            <Link href="/" aria-label="Rangvia" className={styles.home}><Wordmark /></Link>
          </div>

          <div className={styles.group}>
            {/* Le seuil est là, la file pas encore : une seule place, vide
                (ou tombée, si la plaque est retirée du service). Pas de
                numéros au sol : il n'y a personne à compter. */}
            <FloorScene
              size="sm"
              className={styles.scene}
              seuil="Comptoir"
              positions={false}
              slats={[{ id: 'place', state: voided ? 'fallen' : 'ghost' }]}
            />

            <div className={styles.text}>
              <p className="t-label">{voided ? 'Plaque désactivée' : 'Plaque Rangvia'}</p>
              <h1 className={styles.title}>
                {voided ? 'Cette plaque n’est plus en service' : 'Cette plaque n’est pas encore activée'}
              </h1>
              <p className={styles.body}>
                {voided
                  ? 'Elle a été retirée du service. Présentez-vous directement au comptoir.'
                  : 'Elle vient d’être installée : le commerce doit encore la relier à sa file. En attendant, présentez-vous directement au comptoir.'}
              </p>

              <p className={styles.code}>
                <span className={styles.codeValue}>{formatStockCode(plate.code)}</span>
                <span className={styles.codeSerial}>N° {formatSerial(plate.serial)}</span>
              </p>
            </div>
          </div>

          {isPlatformAdmin && !voided && (
            <Link
              href={`/admin/plaques/stock?code=${plate.code}`}
              className={`btn btn--signal btn--lg btn--block ${styles.action}`}
            >
              Attribuer cette plaque
            </Link>
          )}
          {isPlatformAdmin && voided && (
            <Link
              href={`/admin/plaques/stock?code=${plate.code}`}
              className={`btn btn--ghost btn--block ${styles.action}`}
            >
              Ouvrir dans le super-admin
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
