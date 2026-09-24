'use client';

import { useRef } from 'react';
import { FlapNumber } from '@/components/FlapNumber';
import { StageRail } from '@/components/objects/StageRail';
import { Rang } from '@/components/Rang';
import { NotificationPanel } from '../ClientExperience';
import { hoursLine, isRetailOrder } from './phase';
import { ReadyCurtain, ReadyObject } from './ReadyCurtain';
import { ConfirmAction, ContactRow, CurtainOrigin, StageNotify, Threshold, type TicketViewProps } from './shared';
import clientStyles from '../client.module.css';
import styles from './desk.module.css';

/**
 * LA BOUTIQUE, CÔTÉ CLIENT — deux motifs dans la même file.
 *
 *  - Être conseillé : la file des barbiers, dans le mot de la boutique
 *    (« Caisse » en tête du rail, « un vendeur vous attend ») ;
 *  - Retirer une commande : dès que le vendeur l'a passée en préparation,
 *    une ÉTIQUETTE DE SAC (latte percée en haut) et le rail des étapes,
 *    jusqu'à « Votre commande est prête ».
 *
 * Le numéro de commande est celui du client (son e-mail de confirmation),
 * affiché en entier sur SON téléphone ; la TV n'en montrera que la fin.
 */

const COUNT_SIZE = 'clamp(5rem, 3rem + 14vw, 7.5rem)';

export function RetailTicket({
  ticket, organizationId, phase, timeZone, busy, error, vapidPublicKey, walletSlot, allowLeave, fresh, animateReady, onAction,
}: TicketViewProps) {
  const { entry } = ticket;
  const isReady = phase === 'ready';
  const order = isRetailOrder('retail', entry.stage);
  const orderRef = entry.details.orderRef ?? null;
  const originRef = useRef<HTMLDivElement>(null);
  const ahead = Math.max(0, entry.peopleAhead);
  const hours = hoursLine(ticket.location.todayHours, timeZone);

  return (
    <div className={clientStyles.panel}>
      <div className={clientStyles.queued} inert={isReady}>
        {order ? (
          <>
            <figure ref={originRef} className={styles.bagTag} aria-label={orderRef ? `Commande ${orderRef}` : 'Votre commande'}>
              <span className={styles.bagHole} aria-hidden="true" />
              <p className={styles.bagKicker}>Commande</p>
              <p className={styles.bagRef}>{orderRef ? `n° ${orderRef}` : 'Retrait en caisse'}</p>
              {entry.name && <p className={styles.bagName}>{entry.name}</p>}
              <CurtainOrigin />
            </figure>
            <section className={styles.progress} aria-labelledby="commande-titre">
              <p id="commande-titre" className="t-label">Où en est votre commande</p>
              <StageRail profile="retail" current={entry.stage} history={ticket.stages} orientation="vertical" timeZone={timeZone} />
            </section>
            <StageNotify
              organizationId={organizationId}
              entryId={entry.id}
              vapidPublicKey={vapidPublicKey}
              promise="Nous vous prévenons dès que votre commande est prête."
            />
          </>
        ) : (
          <>
            {orderRef && (
              <p className={styles.orderLine}>
                <span className={styles.orderChip}>Commande n° {orderRef}</span>
                La caisse la prépare quand ce sera votre tour.
              </p>
            )}
            <section className={clientStyles.count} aria-label="Votre position">
              <div className={clientStyles.countRow}>
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
            </section>
            <div ref={originRef} className={`${clientStyles.rangBlock} ${fresh ? clientStyles.unfold : ''}`}>
              <Threshold label="Caisse" />
              <Rang haptics relief ahead={ahead} selfLabel={entry.name} selfHint="Votre place" />
            </div>
            {ahead <= 1 && !isReady && (
              <div className={`banner banner--warn ${clientStyles.soon}`} role="status">
                <span className={clientStyles.soonMark} aria-hidden="true" />
                <span>
                  {ahead === 0
                    ? 'Vous êtes le prochain. Rapprochez-vous de la caisse.'
                    : 'Plus qu’une personne devant vous. Rapprochez-vous de la caisse.'}
                </span>
              </div>
            )}
            <NotificationPanel organizationId={organizationId} entryId={entry.id} vapidPublicKey={vapidPublicKey} />
          </>
        )}

        {walletSlot}

        <div className={clientStyles.actions}>
          {error && !isReady && <div className="banner banner--error" role="alert"><span>{error}</span></div>}
          <ContactRow location={ticket.location} />
          {allowLeave && !order && (
            <ConfirmAction
              label="Quitter la file"
              question="Quitter la file ? Votre place sera libérée."
              onConfirm={() => void onAction('leave')}
              busy={busy}
            />
          )}
        </div>
      </div>

      {isReady && (
        <ReadyCurtain
          originRef={originRef}
          animate={animateReady}
          locationName={ticket.location.name}
          clientName={entry.name}
          {...(order || entry.stage === 'ready'
            ? {
                title: 'Votre commande est prête',
                subtitle: hours?.startsWith('Ouvert') ? `À retirer à la caisse · ${hours}` : 'À retirer à la caisse',
                long: true,
              }
            : { subtitle: entry.status === 'serving' ? 'Un vendeur s’occupe de vous' : 'Un vendeur vous attend' })}
        >
          {orderRef && (
            <ReadyObject>
              <span className={styles.curtainOrder}>n° {orderRef}</span>
            </ReadyObject>
          )}
          <ContactRow location={ticket.location} tone="ink" />
        </ReadyCurtain>
      )}
    </div>
  );
}
