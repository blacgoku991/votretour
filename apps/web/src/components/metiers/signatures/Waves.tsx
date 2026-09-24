import { DropsWaves } from '@/components/home/DropsWaves';
import styles from './signatures.module.css';

/**
 * LES VAGUES — événements et drops. Le composant de l'accueil, tel quel :
 * trois groupes derrière leur barrière, la première se lève à l'entrée
 * dans la vue (une fois ; état final directement en mouvement réduit).
 */
export function Waves(): React.JSX.Element {
  return (
    <div className={styles.waves}>
      <DropsWaves />
    </div>
  );
}
