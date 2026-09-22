'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

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
        setError(
          authError.message.includes('Invalid login')
            ? 'Adresse e-mail ou mot de passe incorrect.'
            : authError.message.includes('Email not confirmed')
              ? "Confirmez d'abord votre adresse e-mail."
              : authError.message,
        );
        return;
      }
      router.push(next && next.startsWith('/') ? next : '/app');
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="stack g4" noValidate>
      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Adresse e-mail</label>
        <input
          id="email" className="input" type="email" required
          autoComplete="email" inputMode="email" enterKeyHint="next"
          value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="vous@votre-salon.fr"
        />
      </div>

      <div className="field">
        <label htmlFor="password">Mot de passe</label>
        <input
          id="password" className="input" type="password" required
          autoComplete="current-password" enterKeyHint="go"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button type="submit" className="btn btn--signal btn--lg btn--block" disabled={pending}>
        {pending ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  );
}
