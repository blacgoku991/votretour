'use client';

import { useEffect, useState } from 'react';
import { FlapText } from '@/components/FlapNumber';
import styles from './billing.module.css';

/**
 * Jours d'essai restants, en volet. Le calcul dépend de l'heure du
 * lecteur : il n'a lieu QU'APRÈS le montage. Le rendu serveur montre
 * « — », puis le chiffre tombe une fois (en mouvement réduit, il
 * remplace le tiret sans animation).
 */
export function TrialFlap({ endsAt }: { endsAt: string }) {
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    const end = new Date(endsAt).getTime();
    if (Number.isNaN(end)) return;
    setDays(Math.max(0, Math.ceil((end - Date.now()) / 86_400_000)));
  }, [endsAt]);

  const text = days === null ? '—' : String(days);
  const unit = days === null
    ? 'jours d’essai restants'
    : days <= 1 ? 'jour d’essai restant' : 'jours d’essai restants';

  return (
    <span className={styles.trial}>
      <span className={styles.trialFlap}>
        <FlapText static fixed tile text={text.padStart(2, ' ')} label={days === null ? 'calcul en cours' : `${days} ${unit}`} />
      </span>
      <span className={styles.trialUnit} aria-hidden="true">{unit}</span>
    </span>
  );
}
