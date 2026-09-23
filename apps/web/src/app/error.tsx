'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { FloorScene, type FloorSlat } from '@/components/objects/FloorScene';
import styles from './status.module.css';

/** Une place a glissé de la file : le reste tient, rien n'est perdu. */
const SLATS: FloorSlat[] = [
  { id: 'a', state: 'wait' },
  { id: 'b', state: 'wait' },
  { id: 'c', state: 'fallen' },
];

/**
 * Écran d'erreur.
 *
 * On n'affiche jamais la pile d'appel : elle n'aide personne et peut
 * révéler la structure interne. On donne en revanche l'identifiant de
 * l'incident, qui permet de le retrouver dans l'espace plateforme.
 */
export default function ErrorScreen({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[votretour]', error);
  }, [error]);

  return (
    <main className={styles.screen}>
      <div className={`shell ${styles.bar}`}>
        <Link href="/" aria-label="Rangvia" className={styles.home}><Wordmark /></Link>
      </div>

      <div className={styles.stage}>
        <div className={styles.sceneBand} aria-hidden="true">
          <FloorScene size="sm" slats={SLATS} seuil="Comptoir" positions={false} />
        </div>

        <div className={`shell ${styles.body}`}>
          <div className={styles.text}>
            <p className="t-kicker"><span className="t-kicker__num">500</span> Incident</p>
            <h1 className={`t-display ${styles.title}`}>Quelque chose a coincé.</h1>
            <p className={styles.lead}>
              Votre place n&apos;est pas perdue : les positions sont enregistrées côté
              serveur. Réessayez dans un instant.
            </p>
            {error.digest && (
              <p className={styles.ref}>
                Référence de l&apos;incident : <span className={styles.refCode}>{error.digest}</span>
              </p>
            )}
            <div className={styles.actions}>
              <button type="button" className="btn btn--signal btn--lg" onClick={reset}>Réessayer</button>
              <Link href="/" className="btn btn--ghost btn--lg">Retour à l&apos;accueil</Link>
            </div>
          </div>

          <div className={styles.sceneSide} aria-hidden="true">
            <FloorScene size="lg" slats={SLATS} seuil="Comptoir" />
          </div>
        </div>
      </div>
    </main>
  );
}
