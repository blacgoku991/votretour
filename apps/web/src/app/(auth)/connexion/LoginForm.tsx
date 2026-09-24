'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { PasswordField } from '../PasswordField';
import { loginErrorMessage } from '../authErrors';
import styles from '../auth.module.css';

/**
 * L'authentification professionnelle passe par Supabase Auth côté
 * navigateur : c'est lui qui pose les cookies de session, que le
 * middleware rafraîchit ensuite à chaque navigation.
 */
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const { error: authError } = await supabaseBrowser().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(loginErrorMessage(authError));
        return;
      }
      router.push(safeRedirectPath(next));
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      <div className="field-rail">
        <div className="field">
          <label htmlFor="email">Adresse e-mail</label>
          <input
            id="email" className={`input ${styles.input}`} type="email" required
            autoComplete="email" inputMode="email" enterKeyHint="next"
            autoCapitalize="none" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@votre-salon.fr"
          />
        </div>

        <PasswordField
          id="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          enterKeyHint="go"
        />
      </div>

      <div className={styles.submit}>
        {error && (
          <div className="banner banner--error" role="alert">
            <span>{error}</span>
          </div>
        )}
        <button type="submit" className="btn btn--signal btn--lg btn--block" disabled={pending}>
          {pending ? 'Connexion…' : 'Se connecter'}
        </button>
      </div>
    </form>
  );
}
