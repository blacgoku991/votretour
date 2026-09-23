import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/server/auth';
import { Barrier } from '../evenements/Barrier';
import styles from './suspendu.module.css';

export const metadata: Metadata = { title: 'Compte suspendu', robots: { index: false } };

export default async function SuspendedPage({ params }: { params: Promise<{ org: string }> }) {
  await requireUser();
  const { org } = await params;
  return (
    <div className={`shell ${styles.page}`}>
      <section className={styles.panel} aria-labelledby="suspendu-titre">
        {/* Le rail vide, barré : la file ne prend plus personne. */}
        <div className={styles.scene} aria-hidden="true">
          <span className={styles.rail} />
          <div className={styles.gate}>
            <Barrier ground={false} />
          </div>
          <ol className={styles.places}>
            <li /><li /><li /><li />
          </ol>
        </div>

        <div className={styles.text}>
          <p className="t-label">Accès suspendu</p>
          <h1 id="suspendu-titre" className={`t-title ${styles.title}`}>
            Votre espace est temporairement suspendu
          </h1>
          <p className="t-body t-muted">
            Vos files sont fermées et vos plaques n’ouvrent plus la file. Vos données sont
            intactes. Contactez-nous pour rétablir l’accès.
          </p>
          <div className={styles.actions}>
            <Link className="btn btn--signal" href={`/app/${encodeURIComponent(org)}/abonnement`}>
              Voir mon abonnement
            </Link>
            <Link className="btn btn--quiet" href="/">Retour à l’accueil</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
