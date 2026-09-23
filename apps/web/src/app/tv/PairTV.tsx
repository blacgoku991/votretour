'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { FlapText } from '@/components/FlapNumber';
import { FloorScene } from '@/components/objects/FloorScene';
import { Wordmark } from '@/components/Wordmark';
import styles from './tv.module.css';

/**
 * Appairage d'un écran de salle.
 *
 * Le code à 6 chiffres est généré dans Rangvia (établissement › Écrans
 * TV) puis saisi ici, à la télécommande ou au clavier. Chaque chiffre
 * tombe dans sa case, comme sur un tableau de gare : le vrai champ de
 * saisie est posé, transparent, par-dessus les six cellules.
 */
export function PairTV({ initialCode = '' }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode.replace(/\D/g, '').slice(0, 6));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Mise au point d'office seulement avec un pointeur fin (télécommande,
  // souris) : sur un écran tactile, elle ouvrirait le clavier d'emblée.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  const submit = () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Saisissez le code à 6 chiffres fourni par Rangvia.');
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
      <header className={styles.pairBar}>
        <Wordmark />
      </header>

      <section className={styles.pairCopy} aria-labelledby="pair-title">
        <div className={styles.pairIntro}>
          <span className="t-label">Rangvia Display</span>
          <h1 id="pair-title" className={`t-display ${styles.pairTitle}`}>Connecter cet écran</h1>
          <p className={styles.pairLead}>
            Saisissez le code à 6 chiffres fourni par Rangvia. L’écran affichera ensuite la file
            de l’établissement, en grand.
          </p>
        </div>

        <div className={styles.codeBlock}>
          <label className={styles.codeField} data-length={code.length}>
            <FlapText
              static
              fixed
              tile
              cells={6}
              stagger={40}
              text={code}
              label={code ? `Code saisi : ${code.split('').join(' ')}` : 'Aucun chiffre saisi'}
              size="clamp(3.25rem, 1.8rem + 6vw, 6.5rem)"
            />
            <span
              className={styles.codeCursor}
              style={{ ['--i' as string]: Math.min(code.length, 5) } as React.CSSProperties}
              aria-hidden="true"
            />
            <input
              className={styles.codeInput}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              ref={inputRef}
              aria-label="Code d’appairage à 6 chiffres"
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
          </label>

          <p className={styles.pairState}>
            <i className="pip pip--live" aria-hidden="true" />
            En attente d’appairage
          </p>
        </div>

        {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

        <div className={styles.pairActions}>
          <button
            className="btn btn--signal btn--lg"
            type="button"
            disabled={pending || code.length !== 6}
            onClick={submit}
          >
            {pending ? 'Connexion…' : 'Associer cet écran'}
          </button>
          <p className={styles.pairNote}>
            L’écran reste appairé après redémarrage. Rangvia peut le révoquer à distance.
          </p>
        </div>
      </section>

      <div className={styles.pairScene} aria-hidden="true">
        <FloorScene
          size="lg"
          intro
          spill
          turn={-6}
          positions={false}
          slats={[
            { id: 'p0', state: 'serving' },
            { id: 'p1', state: 'wait' },
            { id: 'p2', state: 'wait' },
            { id: 'p3', state: 'wait' },
            { id: 'p4', state: 'ghost', label: 'Prochain client' },
          ]}
        />
      </div>
    </main>
  );
}
