'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { Seuil } from '@/components/objects/Seuil';
import styles from './client.module.css';

/**
 * « C'EST VOTRE TOUR » — le rideau vermillon.
 *
 * Il part du rectangle exact de la latte « Vous » et couvre l'écran
 * (FLIP) : le rectangle est lu UNE seule fois, au changement de phase ;
 * ensuite seul `transform` passe de `translate(…) scale(…)` à `none`
 * (640 ms, départ lent). Le texte n'est jamais déformé : il vit sur un
 * calque à part, qui apparaît en opacité quand le rideau est presque
 * posé, puis le Seuil se dessine autour de lui.
 *
 * En mouvement réduit, ou quand on arrive directement sur cet état (page
 * rechargée), le rideau est simplement là, sans transition.
 *
 * `title` et `subtitle` : le même rideau pour les profils métier
 * (« Votre véhicule est prêt », « Guichet 4 »). Sans eux, il dit
 * exactement ce qu'il disait : « C'est votre tour », « Présentez-vous au
 * comptoir ». Un titre fourni remplace le couple « C'est » / « votre
 * tour » : il se suffit à lui-même.
 */

const FLIP_MS = 640;
/** Départ lent : on voit le rideau quitter la latte « Vous », puis il se pose. */
const FLIP_EASE = 'cubic-bezier(0.6, 0, 0.18, 1)';
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function TurnCurtain({
  originRef,
  animate,
  locationName,
  clientName,
  title,
  subtitle,
  children,
}: {
  /** Conteneur du Rang : on y cherche la latte « Vous » (.slat--self). */
  originRef: React.RefObject<HTMLElement | null>;
  /** false : pas de rideau qui se déploie (arrivée directe sur l'état). */
  animate: boolean;
  locationName: string;
  clientName: string | null;
  /** Titre du métier ; défaut : « C'est votre tour ». */
  title?: string;
  /** Consigne sous le titre ; défaut : « Présentez-vous au comptoir ». */
  subtitle?: string;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    const bg = bgRef.current;
    if (!root || !bg) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const slat = originRef.current?.querySelector<HTMLElement>('.slat--self') ?? null;
    if (animate) titleRef.current?.focus({ preventScroll: true });
    if (!animate || reduced || !slat) return;

    // Une seule lecture de mise en page, avant la première image.
    const r = slat.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (r.width < 1 || r.height < 1 || vw < 1 || vh < 1) return;

    bg.style.transition = 'none';
    bg.style.transform = `translate(${r.left}px, ${r.top}px) scale(${r.width / vw}, ${r.height / vh})`;
    root.dataset.flip = 'from';

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        bg.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
        bg.style.transform = 'none';
        root.dataset.flip = 'play';
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // Lecture unique au montage (= au changement de phase).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={rootRef} className={styles.curtain} role="region" aria-label={title ?? 'C’est votre tour'}>
      <div ref={bgRef} className={styles.curtainBg} aria-hidden="true" />
      <div className={styles.curtainInner}>
        <p className={styles.curtainPlace}>{locationName}</p>

        {/* Une seule annonce : le focus sur le titre quand le rideau se
            déploie ; role="alert" seulement quand il est déjà là. */}
        <div className={styles.curtainMain} role={animate ? undefined : 'alert'}>
          <Seuil tone="ink" draw label="Comptoir" className={styles.curtainSeuil}>
            {clientName && <p className={styles.turnName}>{clientName}</p>}
            {title === undefined && <p className={styles.turnKicker}>C’est</p>}
            <h2 ref={titleRef} tabIndex={-1} className={styles.turnTitle}>{title ?? 'votre tour'}</h2>
            <p className={styles.turnHint}>{subtitle ?? 'Présentez-vous au comptoir'}</p>
          </Seuil>
        </div>

        <div className={styles.curtainActions}>{children}</div>
      </div>
    </div>
  );
}
