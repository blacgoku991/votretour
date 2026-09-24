'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectPushSupport, subscribeToPush, currentPermission } from '@/lib/push-client';
import { directionsUrl } from '@/lib/format';
import type { ProfileTicketState } from '@/lib/profiles/types';
import clientStyles from '../client.module.css';
import styles from './profiles.module.css';

/**
 * Pièces communes aux écrans des profils : actions du client, contact,
 * notifications, confirmation en ligne et pictogrammes. Mêmes classes
 * que l'écran des barbiers (`client.module.css`) partout où l'objet est
 * le même : un client qui passe d'un barbier à un garage retrouve les
 * mêmes gestes, au même endroit.
 */

/* ------------------------------------------------------------------ */
/* Actions du client                                                    */
/* ------------------------------------------------------------------ */

export type ClientAction = 'leave' | 'returning' | 'present' | 'quote_accept' | 'quote_decline' | 'unfollow';

export type ActOutcome = { ok: true } | { ok: false; code: string | null; message: string };

export type OnAction = (action: ClientAction, quoteN?: number) => Promise<ActOutcome>;

/** Ce que reçoit chaque écran de suivi. */
export interface TicketViewProps {
  ticket: ProfileTicketState;
  /** `ticket_state` ne le porte pas : l'inscription aux notifications en a besoin. */
  organizationId: string;
  phase: 'tracking' | 'ready';
  /** Fuseau de l'établissement, pour toutes les heures affichées. */
  timeZone: string;
  busy: boolean;
  error: string | null;
  vapidPublicKey: string | null;
  walletSlot: ReactNode;
  allowLeave: boolean;
  /** Vrai juste après l'inscription (dépliage, balancement) ; faux au rechargement. */
  fresh: boolean;
  /** Le rideau part de l'objet du client (on a vu le suivi avant lui) ; sinon il est déjà là. */
  animateReady: boolean;
  onAction: OnAction;
}

/** Les messages du serveur, à la typographie de l'écran. */
export const typo = (message: string) => message.replace(/'/g, '’');

/* ------------------------------------------------------------------ */
/* Itinéraire et appel                                                  */
/* ------------------------------------------------------------------ */

/** Ce qu'il faut pour aller au commerce ou l'appeler. */
export type ContactLocation = Parameters<typeof directionsUrl>[0] & { name: string; phone: string | null };

export function ContactRow({
  location,
  callLabel = 'Appeler',
  tone = 'surface',
}: {
  location: ContactLocation;
  callLabel?: string;
  tone?: 'surface' | 'ink';
}) {
  const href = useMemo(() => directionsUrl(location), [location]);
  const cls = tone === 'ink' ? 'btn btn--solid' : 'btn btn--ghost';
  return (
    <div className={tone === 'ink' ? clientStyles.curtainRow : clientStyles.actionRow}>
      <a className={cls} href={href} target="_blank" rel="noreferrer">
        <PinIcon />
        Itinéraire
      </a>
      {location.phone && (
        <a className={cls} href={`tel:${location.phone}`}>
          <PhoneIcon />
          {callLabel}
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirmation en ligne (quitter, ne plus suivre)                      */
/* ------------------------------------------------------------------ */

/**
 * Un geste qui ne se défait pas, toujours confirmé en ligne : même
 * mécanique que « Quitter la file » des barbiers (focus sur « Annuler »,
 * la confirmation remonte dans l'écran, le focus revient au bouton).
 */
export function ConfirmAction({
  label,
  question,
  confirmLabel = 'Confirmer',
  onConfirm,
  busy,
  tone = 'surface',
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => void;
  busy: boolean;
  tone?: 'surface' | 'ink';
}) {
  const [open, setOpen] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const was = useRef(open);
  const ink = tone === 'ink';

  useEffect(() => {
    if (open === was.current) return;
    was.current = open;
    if (open) {
      cancelRef.current?.focus({ preventScroll: true });
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      groupRef.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    } else {
      askRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  if (!open) {
    return (
      <button
        ref={askRef}
        type="button"
        className={`btn ${ink ? clientStyles.inkQuiet : 'btn--quiet'} ${clientStyles.leave}`}
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        {label}
      </button>
    );
  }
  return (
    <div ref={groupRef} className={`${clientStyles.confirm} ${ink ? clientStyles.confirmInk : ''}`} role="group" aria-label={label}>
      <p className={clientStyles.confirmText}>{question}</p>
      <div className={clientStyles.confirmRow}>
        <button ref={cancelRef} type="button" className={`btn ${ink ? clientStyles.inkQuiet : 'btn--quiet'}`} onClick={() => setOpen(false)}>
          Annuler
        </button>
        <button type="button" className={`btn ${ink ? clientStyles.inkDanger : 'btn--danger'}`} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications d'un suivi par étapes                                  */
/* ------------------------------------------------------------------ */

/**
 * Le panneau de notifications d'un suivi PAR ÉTAPES (atelier, commande).
 *
 * Même objet, même logique et même honnêteté que `NotificationPanel` des
 * barbiers — que les écrans à position (table, guichet, conseil)
 * réutilisent tel quel. Seul le texte change, parce que la promesse
 * change : ici, on prévient à chaque étape, parfois le lendemain ; « quand
 * il ne restera plus qu'une personne devant vous » serait faux. Sur
 * iPhone hors écran d'accueil, on ne renvoie pas vers l'App Clip, qui ne
 * sait pas encore suivre une fiche d'atelier : on dit ce qui marche.
 */
export function StageNotify({
  organizationId,
  entryId,
  vapidPublicKey,
  promise,
  title = 'Me prévenir à chaque étape',
}: {
  organizationId: string;
  entryId: string;
  vapidPublicKey: string | null;
  /** « Nous vous prévenons à chaque étape, même demain. » */
  promise: string;
  /** Le geste, dans les mots de la promesse (une commande n'a qu'une étape qui compte). */
  title?: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'on' | 'denied' | 'unavailable'>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    if (!vapidPublicKey) {
      setState('unavailable');
      setReason('not_configured');
      return;
    }
    const support = detectPushSupport();
    if (!support.supported) {
      setState('unavailable');
      setReason(support.reason);
      return;
    }
    const permission = currentPermission();
    if (permission === 'granted') setState('on');
    else if (permission === 'denied') setState('denied');
  }, [vapidPublicKey]);

  const enable = useCallback(async () => {
    if (!vapidPublicKey) return;
    setState('working');
    const outcome = await subscribeToPush({ organizationId, vapidPublicKey, entryId });
    if (outcome.status === 'subscribed') setState('on');
    else if (outcome.status === 'denied') setState('denied');
    else {
      setState('unavailable');
      setReason(outcome.status === 'unsupported' ? outcome.reason : outcome.message);
    }
  }, [organizationId, entryId, vapidPublicKey]);

  if (state === 'on') {
    return (
      <div className={clientStyles.notice}>
        <span className={`${clientStyles.noticeIcon} ${clientStyles.noticeIconOn}`}><BellIcon on /></span>
        <div className={clientStyles.noticeText}>
          <p className={clientStyles.noticeTitle}>Vous serez prévenu</p>
          <p className={clientStyles.noticeBody}>{promise}</p>
        </div>
      </div>
    );
  }

  if (state === 'unavailable' || state === 'denied') {
    return (
      <div className={clientStyles.notice}>
        <span className={clientStyles.noticeIcon}><BellIcon on={false} /></span>
        <div className={clientStyles.noticeText}>
          <p className={clientStyles.noticeTitle}>
            {state === 'denied' ? 'Notifications refusées' : 'Notifications indisponibles ici'}
          </p>
          <p className={clientStyles.noticeBody}>
            {reason === 'ios_needs_pwa'
              ? 'Sur iPhone, ajoutez cette page à l’écran d’accueil pour être prévenu, ou gardez-la ouverte.'
              : 'Revenez sur cette page quand vous voulez : le suivi se met à jour tout seul.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className={clientStyles.noticeAction} onClick={enable} disabled={state === 'working'}>
      <span className={`${clientStyles.noticeIcon} ${clientStyles.noticeIconOn}`}><BellIcon on={false} /></span>
      <div className={clientStyles.noticeText}>
        <p className={clientStyles.noticeTitle}>{state === 'working' ? 'Activation…' : title}</p>
        <p className={clientStyles.noticeBody}>{promise}</p>
      </div>
      <ChevronIcon />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Repère en tête d'un rail (« Accueil », « Caisse »)                   */
/* ------------------------------------------------------------------ */

/** Le repère de sortie de la file, comme « Comptoir » chez les barbiers, dans le mot du métier. */
export function Threshold({ label }: { label: string }) {
  return (
    <div className={clientStyles.counter} aria-hidden="true">
      <span className={clientStyles.counterLabel}>{label}</span>
    </div>
  );
}

/**
 * Point de départ du rideau (`TurnCurtain` cherche `.slat--self` dans
 * `originRef`) quand l'objet central n'est pas une latte du Rang : la
 * plaque, le numéro. Invisible, il épouse l'objet : le vermillon part de
 * lui.
 */
export function CurtainOrigin() {
  return <span className={`slat--self ${styles.curtainOrigin}`} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/* Pictogrammes — même géométrie que ceux de l'écran des barbiers       */
/* ------------------------------------------------------------------ */

export function BellIcon({ on }: { on: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5 8a5 5 0 0 1 10 0v3l1.4 2.2a.6.6 0 0 1-.5.9H4.1a.6.6 0 0 1-.5-.9L5 11V8Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
        fill={on ? 'currentColor' : 'none'} fillOpacity={on ? 0.16 : 0}
      />
      <path d="M8.2 16.6a2 2 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className={clientStyles.chevron}>
      <path d="m7 4 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 16s5-4.6 5-8.6A5 5 0 0 0 4 7.4C4 11.4 9 16 9 16Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="9" cy="7.4" r="1.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M6.2 2.8 4.4 3a1.6 1.6 0 0 0-1.4 1.8c.6 5.2 4.9 9.6 10.2 10.2a1.6 1.6 0 0 0 1.8-1.4l.2-1.8a1 1 0 0 0-.7-1l-2.2-.8a1 1 0 0 0-1.1.3l-.8.9a8.2 8.2 0 0 1-3.8-3.8l.9-.8a1 1 0 0 0 .3-1.1l-.8-2.2a1 1 0 0 0-1-.7Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="m4 9.4 3.2 3.2L14 5.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m10 2.8 2.2 4.6 5 .6-3.7 3.5.9 5-4.4-2.4-4.4 2.4.9-5L2.8 8l5-.6L10 2.8Z" fill="currentColor" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 5.6V9l2.4 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WalkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="11.2" cy="3.6" r="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m8 17.4 2.2-5 2.6 2.2v3M6 10.2l2.4-3.4 3.2.4 1.4 3 2.4.8M10.2 12.4 9.6 7.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2.8 16 5v4.6c0 3.7-2.5 6.3-6 7.6-3.5-1.3-6-3.9-6-7.6V5l6-2.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 7v3.4M10 13h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
