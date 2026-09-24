import type { Metadata } from 'next';
import Link from 'next/link';
import { ACTIVITY_LABEL } from '@/lib/copy';
import { parseActivityParam } from '@/app/bienvenue/metiers';
import { SignupForm } from './SignupForm';
import { AuthFrame } from '../AuthFrame';
import { SignupPanel } from '../panels';
import styles from '../auth.module.css';
import local from './signup.module.css';

export const metadata: Metadata = {
  title: 'Créer un compte',
  robots: { index: false },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ activite?: string | string[] }>;
}) {
  // `?activite=garage` (appel à l'action d'une page métier) : liste blanche,
  // la même que l'onboarding ; une valeur inconnue est ignorée, sans erreur.
  const activity = parseActivityParam((await searchParams).activite);
  const activityLabel = activity ? ACTIVITY_LABEL[activity] : null;

  return (
    <AuthFrame
      switchHref="/connexion"
      switchLabel="Connexion"
      band={[
        { id: 's0', state: 'serving' },
        { id: 's1', state: 'wait' },
        { id: 's2', state: 'wait' },
        { id: 's3', state: 'ghost' },
      ]}
      aside={<SignupPanel />}
    >
      <div className={styles.head}>
        {/* En mobile, le panneau n'est pas là : la promesse passe ici. */}
        <p className={`t-label ${styles.trialInline}`}>Essai gratuit · sans carte bancaire</p>
        <h1 className="t-display">Ouvrez votre file</h1>
        <p className={`t-lead ${styles.lead}`}>
          Trois minutes&nbsp;: un compte, un établissement, et votre plaque est prête.
        </p>
        {activityLabel && (
          <p className={local.metier}>
            <span className={local.metierSlat}>{activityLabel}</span>
            <span className={local.metierHint}>Métier présélectionné, modifiable à l’étape suivante.</span>
          </p>
        )}
      </div>

      <SignupForm activity={activity} />

      <div className={styles.outro}>
        <p className={`t-micro ${styles.legal}`}>
          En créant un compte, vous acceptez les{' '}
          <Link href="/cgu">conditions d’utilisation</Link> et la{' '}
          <Link href="/confidentialite">politique de confidentialité</Link>.
        </p>

        <p className={styles.footer}>
          Déjà un compte&nbsp;? <Link href="/connexion">Se connecter</Link>
        </p>
      </div>
    </AuthFrame>
  );
}
