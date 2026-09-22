'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

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
        setError(
          authError.message.includes('already registered')
            ? 'Un compte existe déjà avec cette adresse.'
            : authError.message,
        );
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
    <form onSubmit={submit} className="stack g4" noValidate>
      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className="field">
        <label htmlFor="nom">Votre nom</label>
        <input
          id="nom" className="input" type="text" required
          autoComplete="name" value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Karim Benali"
        />
      </div>

      <div className="field">
        <label htmlFor="email">Adresse e-mail</label>
        <input
          id="email" className="input" type="email" required
          autoComplete="email" inputMode="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vous@votre-salon.fr"
        />
      </div>

      <div className="field">
        <label htmlFor="password">Mot de passe</label>
        <input
          id="password" className="input" type="password" required
          autoComplete="new-password" minLength={8} value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="hint">8 caractères minimum.</p>
      </div>

      <button type="submit" className="btn btn--signal btn--lg btn--block" disabled={pending}>
        {pending ? 'Création…' : 'Créer mon compte'}
      </button>
    </form>
  );
}
