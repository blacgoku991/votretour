'use client';

import { useState, type FormEvent } from 'react';
import styles from './claim.module.css';

type State = 'idle' | 'pending' | 'done' | 'error';

/**
 * « Suivre mon véhicule » — le seul geste de la page.
 *
 * Un vrai formulaire (`POST /api/client/claim`), qui marche sans
 * JavaScript (redirection 303). Avec JavaScript, on garde la main : le
 * bouton dit ce qui se passe, une erreur s'affiche en place, et le suivi
 * s'ouvre par `location.replace` : la page du jeton ne reste pas dans
 * l'historique, « Retour » ne ramène pas sur un lien qui a déjà servi.
 */
export function ClaimButton({ token, label, note }: { token: string; label: string; note: string }) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const busy = state === 'pending' || state === 'done';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setState('pending');
    setError(null);
    try {
      const response = await fetch('/api/client/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      const json = (await response.json().catch(() => null)) as
        | { ok: true; data: { redirect: string } }
        | { ok: false; error: string }
        | null;
      if (response.ok && json?.ok && json.data.redirect.startsWith('/')) {
        setState('done');
        window.location.replace(json.data.redirect);
        return;
      }
      setError(json && !json.ok ? json.error : 'Le suivi n’a pas pu s’ouvrir. Réessayez dans un instant.');
      setState('error');
    } catch {
      setError('Pas de connexion pour le moment. Vérifiez le réseau, puis réessayez.');
      setState('error');
    }
  }

  return (
    <form action="/api/client/claim" method="post" onSubmit={onSubmit} className={styles.claimForm}>
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        className={`btn btn--signal btn--lg btn--block ${styles.claimButton}`}
        data-state={state}
        disabled={busy}
        aria-busy={state === 'pending'}
      >
        {state === 'done' ? (
          <>
            <svg className={styles.claimCheck} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M5 10.5 8.5 14 15 6.5" />
            </svg>
            <span>C’est fait, ouverture du suivi…</span>
          </>
        ) : state === 'pending' ? (
          <span>Un instant…</span>
        ) : (
          <span>{label}</span>
        )}
      </button>
      <p className={styles.claimNote} role="status" aria-live="polite">
        {error ? <span className={styles.claimError}>{error}</span> : note}
      </p>
    </form>
  );
}
