import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './LoginForm';
import styles from '../auth.module.css';

export const metadata: Metadata = {
  title: 'Connexion',
  robots: { index: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; erreur?: string; inscrit?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <h1 className="t-title">Votre file vous attend</h1>
        <p className="t-small t-muted">
          Connectez-vous pour reprendre la main sur votre file.
        </p>
      </div>

      {params.inscrit === '1' && (
        <div className="banner">
          <span>
            Compte créé. Vérifiez votre boîte mail si une confirmation vous est demandée,
            puis connectez-vous.
          </span>
        </div>
      )}

      <LoginForm next={params.next ?? null} />

      <p className={styles.footer}>
        Pas encore de compte ? <Link href="/inscription">Créer un compte</Link>
      </p>
    </div>
  );
}
