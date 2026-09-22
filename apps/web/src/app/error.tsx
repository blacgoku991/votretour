'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import styles from './status.module.css';

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
      <span className={styles.rails} aria-hidden="true" />
      <div className={styles.panel}>
        <Link href="/" aria-label="VotreTour"><Wordmark /></Link>

        <div className={styles.art} aria-hidden="true">
          <span className={styles.rail} />
          <span className={styles.slat} style={{ width: '64%', transform: 'rotate(-1.4deg)' }} />
          <span className={styles.slat} style={{ width: '48%', transform: 'rotate(1deg)' }} />
          <span className={styles.slat} style={{ width: '30%', transform: 'rotate(-0.6deg)' }} />
        </div>

        <div className="stack g3">
          <p className="t-label">Incident</p>
          <h1 className="t-title">Quelque chose s&apos;est mal passé</h1>
          <p className="t-body t-muted">
            Votre file n&apos;a rien perdu : les positions sont enregistrées côté serveur.
            Réessayez — et si cela recommence, dites-le nous.
          </p>
          {error.digest && (
            <p className="t-micro t-faint">Référence de l&apos;incident : {error.digest}</p>
          )}
        </div>

        <div className="row g2 wrap">
          <button type="button" className="btn btn--signal" onClick={reset}>Réessayer</button>
          <Link href="/" className="btn btn--ghost">Retour à l&apos;accueil</Link>
        </div>
      </div>
    </main>
  );
}
