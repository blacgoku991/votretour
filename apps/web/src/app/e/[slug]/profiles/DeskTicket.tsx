'use client';

import { useRef } from 'react';
import { FlapNumber } from '@/components/FlapNumber';
import { TicketNumberFlap } from '@/components/objects/TicketNumberFlap';
import { deskDestination } from '@/lib/profiles/copy';
import { NotificationPanel } from '../ClientExperience';
import { ReadyCurtain } from './ReadyCurtain';
import { ConfirmAction, ContactRow, CurtainOrigin, type TicketViewProps } from './shared';
import clientStyles from '../client.module.css';
import styles from './desk.module.css';

/**
 * LE GUICHET, CÔTÉ CLIENT — un numéro, puis un guichet.
 *
 * Le numéro (« A-042 ») est l'objet central, à la place du Rang : c'est
 * lui que l'écran de la salle appellera, jamais un nom. En dessous, le
 * volet du nombre de personnes devant, comme au fauteuil. À l'appel, le
 * rideau dit OÙ aller, en très grand : « Guichet 4 », et juste dessous,
 * DANS le Seuil, le numéro en grandes tuiles (« A-042 »), tel que l'écran
 * de la salle l'affiche et que l'agent l'appellera. Le linteau dit
 * « Guichet », pas « Comptoir ».
 *
 * Santé (`sensitive`) : aucun prénom n'a été demandé ; le motif n'est
 * affiché qu'ici, sur le téléphone du patient.
 */

const COUNT_SIZE = 'clamp(4rem, 2.6rem + 10vw, 5.75rem)';
const NUMBER_SIZE = 'clamp(3.5rem, 2rem + 9vw, 5.25rem)';
/** Dans le Seuil du rideau : le plus grand qui tienne « A-042 » à 390 px. */
const CURTAIN_NUMBER_SIZE = 'clamp(3.25rem, 2.2rem + 5vw, 4.5rem)';

export function DeskTicket({
  ticket, organizationId, phase, busy, error, vapidPublicKey, walletSlot, allowLeave, animateReady, onAction,
}: TicketViewProps) {
  const { entry } = ticket;
  const isReady = phase === 'ready';
  const boardRef = useRef<HTMLDivElement>(null);
  const ahead = Math.max(0, entry.peopleAhead);
  const desk = entry.deskLabel?.trim() || null;
  const serving = entry.status === 'serving';

  return (
    <div className={clientStyles.panel}>
      <div className={clientStyles.queued} inert={isReady}>
        {/* Le tableau : votre numéro, tel que la salle l'affichera. */}
        <section ref={boardRef} className={styles.board} aria-label="Votre numéro">
          <p className={styles.boardLabel}>Votre numéro</p>
          {entry.ticketNo ? (
            <TicketNumberFlap value={entry.ticketNo} size={NUMBER_SIZE} className={styles.number} />
          ) : (
            <p className={styles.noNumber}>Sans numéro : on vous appelle par l’écran de ce téléphone.</p>
          )}
          <div className={styles.boardRule} aria-hidden="true" />
          <div className={styles.boardCount}>
            <FlapNumber
              value={ahead}
              size={COUNT_SIZE}
              label={ahead === 0 ? 'Personne devant vous' : `${ahead} ${ahead > 1 ? 'personnes' : 'personne'} devant vous`}
            />
            <p className={clientStyles.countUnit} aria-hidden="true">
              <span>{ahead > 1 ? 'personnes' : 'personne'}</span>
              <span>devant vous</span>
            </p>
          </div>
          <CurtainOrigin />
        </section>

        {ahead === 0 && !isReady && (
          <div className={`banner banner--warn ${clientStyles.soon}`} role="status">
            <span className={clientStyles.soonMark} aria-hidden="true" />
            <span>Vous êtes le prochain. Gardez un œil sur l’écran de la salle.</span>
          </div>
        )}

        <NotificationPanel organizationId={organizationId} entryId={entry.id} vapidPublicKey={vapidPublicKey} />

        {walletSlot}

        <div className={clientStyles.actions}>
          {error && !isReady && <div className="banner banner--error" role="alert"><span>{error}</span></div>}
          <ContactRow location={ticket.location} />
          {allowLeave && (
            <ConfirmAction
              label="Rendre mon numéro"
              question="Rendre votre numéro ? Votre place sera libérée."
              onConfirm={() => void onAction('leave')}
              busy={busy}
            />
          )}
        </div>
      </div>

      {isReady && (
        <ReadyCurtain
          originRef={boardRef}
          animate={animateReady}
          locationName={ticket.location.name}
          clientName={null}
          title={desk ?? 'Présentez-vous au guichet'}
          subtitle={
            serving
              ? `C’est à vous${desk ? `, ${deskDestination(desk)}` : ''}`
              // Trait d'union insécable : « Présentez-vous » ne se coupe pas.
              : 'Présentez\u2011vous maintenant'
          }
          long={!desk || desk.length > 10}
          profile="desk"
          object={
            entry.ticketNo ? (
              // Le guichet est le titre ; le numéro, celui qu'appelle l'agent.
              <span className={styles.curtainTicket}>
                <TicketNumberFlap value={entry.ticketNo} size={CURTAIN_NUMBER_SIZE} className={styles.curtainNumber} />
              </span>
            ) : undefined
          }
        >
          <ContactRow location={ticket.location} tone="ink" />
          {error && <p className={styles.curtainError} role="alert">{error}</p>}
        </ReadyCurtain>
      )}
    </div>
  );
}
