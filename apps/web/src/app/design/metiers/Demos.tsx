'use client';

import { useState } from 'react';
import { TicketNumberFlap } from '@/components/objects/TicketNumberFlap';
import { useReducedMotion } from '@/components/motion/useMotionPreference';
import { formatTicketNo } from '@/lib/profiles/ticket';
import styles from './metiers.module.css';

/* Îlot interactif de la planche des métiers : le volet du numéro de
   ticket. Tout le reste de la planche est rendu côté serveur, pour
   prouver que les objets s'y rendent sans hook. */

const DESKS = ['Guichet 3', 'Guichet 1', 'Box 2', 'Guichet 4'] as const;

export function TicketFlapDemo() {
  const [n, setN] = useState(42);
  const reduced = useReducedMotion();
  const value = formatTicketNo('desk', n, 'A') ?? 'A-001';
  const desk = DESKS[n % DESKS.length] ?? 'Guichet 3';

  return (
    <div className={styles.flapDemo}>
      <TicketNumberFlap value={value} destination={desk} live size="clamp(2.5rem, 1.6rem + 4vw, 4.25rem)" />
      <div className={styles.flapActions}>
        <button
          type="button"
          className="btn btn--signal"
          onClick={() => setN((v) => (v >= 999 ? 1 : v + 1))}
          data-testid="ticket-next"
        >
          Appeler le suivant
        </button>
        <span className="t-micro t-muted">
          {reduced
            ? 'Mouvement réduit : le numéro change sans chute.'
            : 'Seules les tuiles qui changent tombent, en demi-cellules.'}
        </span>
      </div>
    </div>
  );
}
