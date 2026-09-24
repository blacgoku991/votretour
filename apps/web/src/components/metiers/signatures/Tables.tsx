import { PartySize } from '@/components/objects/PartySize';
import type { SignatureContent } from '@/lib/metiers/types';
import { Reception } from './Reception';
import styles from './signatures.module.css';

/**
 * LA LISTE PAR TAILLE DE GROUPE — restaurants, profil `table` OUVERT.
 *
 * Un chevalet par taille de table conseillée (réglage réel `tableSizes`,
 * importé par le registre) : le chiffre des couverts, lu avant le prénom.
 * Un groupe est appelé (cuivre), un autre voit « Votre table est prête »
 * (vermillon). Profil fermé : la file de la salle, vraie aujourd'hui.
 */

const STATES = ['called', 'ready', 'waiting', 'waiting'] as const;

export function Tables({ signature, open }: { signature: SignatureContent; open: boolean }): React.JSX.Element {
  if (!open || signature.kind !== 'tables') return <Reception signature={signature} />;
  const tents = signature.lanes
    .map((lane) => Number.parseInt(lane.label, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 4);
  return (
    <div className={`${styles.panel} ${styles.tables}`}>
      <span className={`floor-marks ${styles.tablesFloor}`} aria-hidden="true" />
      <p className={`t-label ${styles.tablesSeuil}`}>{signature.seuil}</p>
      <ul className={styles.tents}>
        {tents.map((count, i) => (
          <li key={count}>
            <PartySize count={count} state={STATES[i] ?? 'waiting'} size="lg" />
          </li>
        ))}
      </ul>
    </div>
  );
}
