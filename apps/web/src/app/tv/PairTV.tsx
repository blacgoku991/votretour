'use client';

import { useState, useTransition } from 'react';
import styles from './tv.module.css';

export function PairTV({ initialCode = '' }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode.replace(/\D/g, '').slice(0, 6));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez le code à 6 chiffres affiché dans le super-admin.');
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/tv/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const payload = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || 'Appairage impossible.');
        }
        window.location.href = '/tv';
      } catch (pairError) {
        setError(pairError instanceof Error ? pairError.message : 'Appairage impossible.');
      }
    });
  };

  return (
    <main className={styles.pairScreen}>
      <div className={styles.pairGlow} />
      <section className={styles.pairCard}>
        <div className={styles.pairMark}>R</div>
        <span className={styles.pairKicker}>RANGVIA DISPLAY</span>
        <h1>Connecter cet écran</h1>
        <p>
          Dans le super-admin, ouvre l’établissement puis <strong>Écrans TV</strong>
          et génère un code d’appairage.
        </p>

        <input
          className={styles.codeInput}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label="Code d’appairage à 6 chiffres"
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />

        {error && <div className={styles.pairError}>{error}</div>}

        <button
          className={styles.pairButton}
          type="button"
          disabled={pending || code.length !== 6}
          onClick={submit}
        >
          {pending ? 'Connexion…' : 'Associer cet écran'}
        </button>

        <small>
          L’écran reste appairé après redémarrage. Le super-admin peut le révoquer à distance.
        </small>
      </section>
    </main>
  );
}
