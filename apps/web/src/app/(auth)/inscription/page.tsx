import type { Metadata } from 'next';
import Link from 'next/link';
import { SignupForm } from './SignupForm';
import styles from '../auth.module.css';

export const metadata: Metadata = {
  title: 'Créer un compte',
  robots: { index: false },
};

export default function SignupPage() {
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <h1 className="t-title">Ouvrez votre file</h1>
        <p className="t-small t-muted">
          Quelques minutes suffisent : un compte, un établissement, et votre plaque est prête.
        </p>
      </div>

      <SignupForm />

      <p className={styles.legal}>
        En créant un compte, vous acceptez les{' '}
        <Link href="/cgu">conditions d&apos;utilisation</Link> et la{' '}
        <Link href="/confidentialite">politique de confidentialité</Link>.
      </p>

      <p className={styles.footer}>
        Déjà un compte ? <Link href="/connexion">Se connecter</Link>
      </p>
    </div>
  );
}
