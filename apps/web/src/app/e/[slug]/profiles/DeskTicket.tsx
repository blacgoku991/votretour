'use client';

import { useRef } from 'react';
import { FlapNumber } from '@/components/FlapNumber';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { TicketNumberFlap } from '@/components/objects/TicketNumberFlap';
import { deskDestination } from '@/lib/profiles/copy';
import { NotificationPanel } from '../ClientExperience';
import { ReadyCurtain, ReadyObject } from './ReadyCurtain';
import { ConfirmAction, ContactRow, CurtainOrigin, type TicketViewProps } from './shared';
import clientStyles from '../client.module.css';
import styles from './desk.module.css';

/**
 * LE GUICHET, CÔTÉ CLIENT — un numéro, puis un guichet.
 *
 * Le numéro (« A-042 ») est l'objet central, à la place du Rang : c'est
 * lui que l'écran de la salle appellera, jamais un nom. En dessous, le
 * volet du nombre de personnes devant, comme au fauteuil. À l'appel, le
 * rideau dit OÙ aller, en très grand : « Guichet 4 », puis le numéro en
 * tuiles, tel que l'écran de la salle l'affiche.
 *
 * Santé (`sensitive`) : aucun prénom n'a été demandé ; le motif n'est
 * affiché qu'ici, sur le téléphone du patient.
 */

const COUNT_SIZE = 'clamp(4rem, 2.6rem + 10vw, 5.75rem)';
const NUMBER_SIZE = 'clamp(3.5rem, 2rem + 9vw, 5.25rem)';

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
        >
          {entry.ticketNo && (
            <ReadyObject>
              {/* Le guichet est déjà le titre : ici, le numéro seul, tel que
                  l'affiche l'écran de la salle. */}
              <TicketNumber value={entry.ticketNo} size="clamp(2.5rem, 1.8rem + 3.4vw, 3.25rem)" className={styles.curtainNumber} />
            </ReadyObject>
          )}
          <ContactRow location={ticket.location} tone="ink" />
          {error && <p className={styles.curtainError} role="alert">{error}</p>}
        </ReadyCurtain>
      )}
    </div>
  );
}
