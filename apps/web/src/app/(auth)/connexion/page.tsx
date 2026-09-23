import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './LoginForm';
import { AuthFrame } from '../AuthFrame';
import { LoginPanel } from '../panels';
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
    <AuthFrame
      switchHref="/inscription"
      switchLabel="Créer un compte"
      band={[
        { id: 'c0', state: 'serving' },
        { id: 'c1', state: 'wait' },
        { id: 'c2', state: 'wait' },
        { id: 'c3', state: 'self' },
      ]}
      aside={<LoginPanel />}
    >
      <div className={styles.head}>
        <h1 className="t-display">Votre file vous attend</h1>
        <p className={`t-lead ${styles.lead}`}>
          Connectez-vous pour reprendre la main sur votre file.
        </p>
      </div>

      {params.inscrit === '1' && (
        <div className={`banner ${styles.notice}`}>
          <span className="pip pip--live" aria-hidden="true" />
          <span>
            Compte créé. Vérifiez votre boîte mail si une confirmation vous est demandée,
            puis connectez-vous.
          </span>
        </div>
      )}

      <LoginForm next={params.next ?? null} />

      <p className={styles.footer}>
        Pas encore de compte&nbsp;? <Link href="/inscription">Créer un compte</Link>
      </p>
    </AuthFrame>
  );
}
