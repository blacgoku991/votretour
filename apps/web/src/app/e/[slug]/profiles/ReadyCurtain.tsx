'use client';

import type { ReactNode, RefObject } from 'react';
import { TurnCurtain } from '../TurnCurtain';
import styles from './profiles.module.css';

/**
 * LE RIDEAU DU MÉTIER — « Votre véhicule est prêt », « Votre table est
 * prête », « Guichet 4 ».
 *
 * C'est le rideau vermillon des barbiers (`TurnCurtain`), même FLIP depuis
 * l'objet du client, même Seuil, même mouvement réduit ; seuls le titre
 * et la consigne parlent le métier. L'enveloppe ne fait que resserrer le
 * titre (un « Votre véhicule est prêt » est plus long que « votre tour »)
 * et poser l'objet (plaque, numéro, chevalet) au-dessus des actions.
 */

export function ReadyCurtain({
  originRef,
  animate,
  locationName,
  clientName,
  title,
  subtitle,
  long = false,
  children,
}: {
  originRef: RefObject<HTMLElement | null>;
  animate: boolean;
  locationName: string;
  clientName: string | null;
  title?: string;
  subtitle?: string;
  /** Titre de plus d'un mot court : corps resserré, sur deux ou trois lignes. */
  long?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.ready} data-long={long ? 'true' : undefined}>
      <TurnCurtain
        originRef={originRef}
        animate={animate}
        locationName={locationName}
        clientName={clientName}
        title={title}
        subtitle={subtitle}
      >
        {children}
      </TurnCurtain>
    </div>
  );
}

/** L'objet du client, posé sur le vermillon au-dessus des actions. */
export function ReadyObject({ children }: { children: ReactNode }) {
  return <div className={styles.readyObject}>{children}</div>;
}

/** « Le garage sait que vous arrivez » : ce que « J'arrive » a déclenché. */
export function ReadyNote({ children }: { children: ReactNode }) {
  return (
    <p className={styles.readyNote} role="status">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="m4 9.4 3.2 3.2L14 5.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
