'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { PasswordField } from '../PasswordField';
import { signupErrorMessage } from '../authErrors';
import styles from '../auth.module.css';

export function SignupForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Choisissez un mot de passe d’au moins 8 caractères.');
      return;
    }

    startTransition(async () => {
      const supabase = supabaseBrowser();
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/bienvenue`,
        },
      });

      if (authError) {
        setError(signupErrorMessage(authError));
        return;
      }

      // Si la confirmation par e-mail est désactivée, la session est déjà
      // active : on enchaîne directement sur la création d'établissement.
      if (data.session) {
        router.push('/bienvenue');
        router.refresh();
        return;
      }
      router.push('/connexion?inscrit=1');
    });
  };

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      <div className="field-rail">
        <div className="field">
          <label htmlFor="nom">Votre nom</label>
          <input
            id="nom" className={`input ${styles.input}`} type="text" required
            autoComplete="name" enterKeyHint="next" value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Karim Benali"
          />
        </div>

        <div className="field">
          <label htmlFor="email">Adresse e-mail</label>
          <input
            id="email" className={`input ${styles.input}`} type="email" required
            autoComplete="email" inputMode="email" enterKeyHint="next"
            autoCapitalize="none" spellCheck={false} value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@votre-salon.fr"
          />
        </div>

        <PasswordField
          id="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          enterKeyHint="done"
          meter
        />
      </div>

      <div className={styles.submit}>
        {error && (
          <div className="banner banner--error" role="alert">
            <span>{error}</span>
          </div>
        )}
        <button type="submit" className="btn btn--signal btn--lg btn--block" disabled={pending}>
          {pending ? 'Création…' : 'Créer mon compte'}
        </button>
      </div>
    </form>
  );
}
