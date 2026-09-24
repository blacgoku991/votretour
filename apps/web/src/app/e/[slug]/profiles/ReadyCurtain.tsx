'use client';

import type { ReactNode, RefObject } from 'react';
import { getProfile } from '@/lib/profiles';
import type { QueueProfile } from '@/lib/profiles/types';
import { TurnCurtain } from '../TurnCurtain';
import styles from './profiles.module.css';

/**
 * LE RIDEAU DU MÉTIER — « Votre véhicule est prêt », « Votre table est
 * prête », « Guichet 4 ».
 *
 * C'est le rideau vermillon des barbiers (`TurnCurtain`), même FLIP depuis
 * l'objet du client, même Seuil, même mouvement réduit ; le titre, la
 * consigne ET le linteau parlent le métier : « Réception atelier »,
 * « Accueil », « Guichet », « Caisse » (`vocab.counter`), jamais
 * « Comptoir » au-dessus de « Présentez-vous à l'accueil ».
 *
 * L'objet du client (plaque, numéro, chevalet, commande) passe DANS le
 * Seuil, sous le titre : c'est lui qu'on vient chercher. Le cadre se
 * resserre alors sur son contenu au lieu d'occuper toute la hauteur, et
 * le bloc se tient au milieu de l'écran, les actions en bas.
 */

export function ReadyCurtain({
  originRef,
  animate,
  locationName,
  clientName,
  title,
  subtitle,
  long = false,
  profile,
  object,
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
  /** Le métier : il donne le mot du linteau. */
  profile: QueueProfile;
  /** L'objet du client, posé dans le Seuil sous le titre. */
  object?: ReactNode;
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
        thresholdLabel={getProfile(profile).vocab.counter}
        emblem={object ? <div className={styles.readyObject}>{object}</div> : undefined}
        frameClassName={object ? styles.readyFrame : undefined}
      >
        {children}
      </TurnCurtain>
    </div>
  );
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
