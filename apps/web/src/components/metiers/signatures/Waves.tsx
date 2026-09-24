import { DropsWaves } from '@/components/home/DropsWaves';
import styles from './signatures.module.css';

/**
 * LES VAGUES — événements et drops. Le composant de l'accueil, tel quel :
 * trois groupes derrière leur barrière, la première se lève à l'entrée
 * dans la vue (une fois ; état final directement en mouvement réduit).
 */
export function Waves(): React.JSX.Element {
  // Posées sur le sol des autres signatures (panneau, lignes de place) :
  // les barrières ont leur scène, et la section n'a plus de vide autour.
  return (
    <div className={`${styles.panel} ${styles.waves}`}>
      <span className={`floor-marks ${styles.wavesFloor}`} aria-hidden="true" />
      <div className={styles.wavesTrack}>
        <DropsWaves />
      </div>
    </div>
  );
}
