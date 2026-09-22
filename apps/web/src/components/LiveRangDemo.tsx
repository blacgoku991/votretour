'use client';

import { useEffect, useState } from 'react';
import { Rang } from './Rang';
import { FlapNumber } from './FlapNumber';
import styles from './LiveRangDemo.module.css';

/**
 * La démonstration de la page d'accueil.
 *
 * Ce n'est pas une capture d'écran : c'est le composant réel de la file,
 * avec la même animation, le même volet et le même rail que l'écran
 * client. Un visiteur voit littéralement ce que verra son client.
 */
export function LiveRangDemo() {
  const [ahead, setAhead] = useState(4);

  useEffect(() => {
    // La file avance toute seule, puis un nouveau client arrive : le
    // cycle montre les deux mouvements, la descente et l'insertion.
    const timer = setInterval(() => {
      setAhead((current) => (current <= 0 ? 4 : current - 1));
    }, 2600);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={styles.frame} data-theme="dark" aria-hidden="true">
      <div className={styles.head}>
        <span className={styles.logo}>BH</span>
        <span className={styles.headText}>
          <span className={styles.place}>Barber House</span>
          <span className={styles.city}>Paris 11ᵉ</span>
        </span>
        <span className={styles.live}>
          <span className="pip pip--live" />
          En direct
        </span>
      </div>

      <div className={styles.count}>
        {ahead === 0 ? (
          <>
            <span className={styles.turnKicker}>C&apos;est</span>
            <span className={styles.turnTitle}>votre tour</span>
          </>
        ) : (
          <>
            <FlapNumber value={ahead} size="4.5rem" />
            <span className={styles.countLabel}>
              {ahead === 1 ? 'personne devant vous' : 'personnes devant vous'}
            </span>
          </>
        )}
      </div>

      <Rang ahead={ahead} selfLabel="Camille" selfHint={ahead === 0 ? 'À vous' : 'Votre place'} />
    </div>
  );
}
