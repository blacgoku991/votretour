'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

export function AccountActions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack g3">
      <button
        type="button"
        className="btn btn--ghost"
        disabled={pending}
        onClick={() => startTransition(async () => {
          await supabaseBrowser().auth.signOut();
          router.push('/connexion');
          router.refresh();
        })}
      >
        {pending ? 'Déconnexion…' : 'Se déconnecter'}
      </button>
      <p className="t-micro t-faint">
        Vous resterez connecté sur vos autres appareils. Pour tout déconnecter,
        changez votre mot de passe.
      </p>
    </div>
  );
}
