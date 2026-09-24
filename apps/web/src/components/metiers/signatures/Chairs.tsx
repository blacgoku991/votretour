import { FloorScene, type FloorSlat } from '@/components/objects/FloorScene';
import type { SignatureContent } from '@/lib/metiers/types';
import styles from './signatures.module.css';

/**
 * UN FAUTEUIL, UNE FILE — la file par professionnel (`mode = per_staff`)
 * des barbiers.
 *
 * Trois files couchées côte à côte sur le même sol, chacune avec son seuil
 * au prénom du barbier (fictifs, ceux du jeu de démonstration). Le client
 * qui veut Sofia attend dans la file de Sofia : sa latte vermillon est
 * dans la file du milieu. Trois `FloorScene` accolées : même inclinaison,
 * même pas, même sol, elles se lisent comme une seule scène.
 */

const LANES: ReadonlyArray<readonly FloorSlat['state'][]> = [
  ['serving', 'wait', 'wait'],
  ['serving', 'self', 'wait'],
  ['serving', 'wait'],
];

export function Chairs({ signature }: { signature: SignatureContent }): React.JSX.Element {
  const lanes = signature.lanes.slice(0, 3);
  return (
    <div
      className={`${styles.panel} ${styles.chairs}`}
      role="img"
      aria-label={`Trois files, une par professionnel : ${lanes.map((l) => l.label).join(', ')}. Le client qui a choisi ${lanes[1]?.label ?? 'son barbier'} attend dans sa file.`}
    >
      {lanes.map((lane, i) => (
        <FloorScene
          key={lane.label}
          className={styles.chair}
          slats={(LANES[i] ?? ['serving']).map((state, j) => ({
            id: `${i}-${j}`,
            state,
            ...(state === 'self' ? { label: 'Vous', hint: `Avec ${lane.label}` } : {}),
          }))}
          seuil={lane.label}
          spill={i === 1}
          intro
          size="md"
          tilt={54}
          turn={0}
          positions={i === 0}
        />
      ))}
    </div>
  );
}
