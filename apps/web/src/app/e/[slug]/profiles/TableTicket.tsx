'use client';

import { useEffect, useRef, useState } from 'react';
import { FlapNumber } from '@/components/FlapNumber';
import { PartySize } from '@/components/objects/PartySize';
import { Rang } from '@/components/Rang';
import type { ProfileTicketState, TableSeating } from '@/lib/profiles/types';
import { NotificationPanel } from '../ClientExperience';
import { formatCountdown, graceRemaining } from './phase';
import { ReadyCurtain, ReadyNote, ReadyObject } from './ReadyCurtain';
import { ConfirmAction, ContactRow, Threshold, WalkIcon, type TicketViewProps } from './shared';
import clientStyles from '../client.module.css';
import styles from './table.module.css';

/**
 * LA TABLE, CÔTÉ CLIENT — le groupe attend que la bonne table se libère.
 *
 * On compte des GROUPES, pas des personnes : « 2 groupes avant vous ». Le
 * chevalet porte les couverts, à côté du volet. « Vous êtes les
 * prochains » n'est PAS « votre table est prête » : c'est l'hôte qui
 * appelle, selon la table qui se libère. Le rideau ne tombe qu'à l'appel.
 *
 * À l'appel, le délai pour se présenter est le VRAI : `called_at` +
 * `absent_grace_minutes`, celui que le moteur applique. Dépassé, on ne
 * dit pas que la table est perdue (l'hôte décide) : on presse, c'est tout.
 */

const COUNT_SIZE = 'clamp(5rem, 3rem + 14vw, 7.5rem)';

const SEATING: Record<TableSeating, string | null> = { any: null, indoor: 'en salle', terrace: 'en terrasse' };

export function TableTicket({
  ticket, organizationId, phase, busy, error, vapidPublicKey, walletSlot, allowLeave, fresh, animateReady, onAction,
  graceMinutes,
}: TicketViewProps & { graceMinutes: number | null }) {
  const { entry } = ticket;
  const ahead = Math.max(0, entry.peopleAhead);
  const isReady = phase === 'ready';
  const rangRef = useRef<HTMLDivElement>(null);
  const covers = entry.details.partySize ?? 1;
  const seating = SEATING[entry.details.seating ?? 'any'];
  const selfHint = [`${covers} ${covers > 1 ? 'couverts' : 'couvert'}`, seating].filter(Boolean).join(' · ');
  const remaining = useGraceCountdown(isReady ? entry.calledAt : null, graceMinutes);
  const present = entry.status === 'present';

  return (
    <div className={clientStyles.panel}>
      <div className={clientStyles.queued} inert={isReady}>
        <section className={styles.head} aria-label="Votre place">
          <div className={clientStyles.countRow}>
            <FlapNumber
              value={ahead}
              size={COUNT_SIZE}
              label={ahead === 0 ? 'Aucun groupe avant vous' : `${ahead} ${ahead > 1 ? 'groupes' : 'groupe'} avant vous`}
            />
            <p className={clientStyles.countUnit} aria-hidden="true">
              <span>{ahead > 1 ? 'groupes' : 'groupe'}</span>
              <span>avant vous</span>
            </p>
          </div>
          <span className={styles.tent}>
            <PartySize count={covers} size="sm" name={entry.name} />
          </span>
        </section>

        <div ref={rangRef} className={`${clientStyles.rangBlock} ${fresh ? clientStyles.unfold : ''}`}>
          <Threshold label="Accueil" />
          <Rang haptics relief ahead={ahead} selfLabel={entry.name} selfHint={selfHint} />
        </div>

        {ahead <= 1 && !isReady && (
          <div className={`banner banner--warn ${clientStyles.soon}`} role="status">
            <span className={clientStyles.soonMark} aria-hidden="true" />
            <span>
              {ahead === 0
                ? 'Vous êtes les prochains. Rapprochez-vous de l’entrée.'
                : 'Plus qu’un groupe avant vous. Restez dans les parages.'}
            </span>
          </div>
        )}

        <NotificationPanel organizationId={organizationId} entryId={entry.id} vapidPublicKey={vapidPublicKey} />

        {walletSlot}

        <div className={clientStyles.actions}>
          {error && !isReady && <div className="banner banner--error" role="alert"><span>{error}</span></div>}
          <ContactRow location={ticket.location} />
          {allowLeave && (
            <ConfirmAction
              label="Quitter la liste"
              question="Quitter la liste d’attente ? Votre place sera libérée."
              onConfirm={() => void onAction('leave')}
              busy={busy}
            />
          )}
        </div>
      </div>

      {isReady && (
        <ReadyCurtain
          originRef={rangRef}
          animate={animateReady}
          locationName={ticket.location.name}
          clientName={entry.name}
          title="Votre table est prête"
          subtitle={
            graceMinutes
              ? `Présentez-vous à l’accueil dans les ${graceMinutes} minutes`
              : 'Présentez-vous à l’accueil'
          }
          long
        >
          <ReadyObject>
            <div className={styles.readyRow}>
              <PartySize count={covers} size="md" />
              {remaining !== null && (
                <p className={styles.countdown} data-late={remaining === 0 ? 'true' : undefined}>
                  <span className={styles.countdownLabel}>{remaining > 0 ? 'Encore' : 'Délai passé'}</span>
                  <span className={styles.countdownValue}>
                    {remaining > 0 ? formatCountdown(remaining) : 'Vite !'}
                  </span>
                  {/* Une annonce à la minute, pas à la seconde. */}
                  <span className="sr-only" aria-live="polite">
                    {remaining > 0 ? `${Math.ceil(remaining / 60)} minutes pour vous présenter` : 'Présentez-vous vite à l’accueil'}
                  </span>
                </p>
              )}
            </div>
          </ReadyObject>
          {present ? (
            <ReadyNote>L’accueil sait que vous arrivez.</ReadyNote>
          ) : (
            <button type="button" className="btn btn--solid btn--hero" onClick={() => void onAction('present')} disabled={busy}>
              <WalkIcon />
              J’arrive
            </button>
          )}
          <ContactRow location={ticket.location} tone="ink" />
          {allowLeave && (
            <ConfirmAction
              label="Quitter la liste"
              question="Laisser la table ? Elle sera proposée au groupe suivant."
              onConfirm={() => void onAction('leave')}
              busy={busy}
              tone="ink"
            />
          )}
        </ReadyCurtain>
      )}
    </div>
  );
}

/**
 * Secondes restantes, recalculées chaque seconde. Seul le texte change,
 * sans animation : rien à couper en mouvement réduit.
 */
function useGraceCountdown(calledAt: string | null, graceMinutes: number | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!calledAt || !graceMinutes) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [calledAt, graceMinutes]);
  // Pas de valeur au premier rendu serveur : l'heure du serveur et celle
  // du téléphone diffèrent, le chiffre apparaît une fois monté.
  return now === null ? null : graceRemaining(calledAt, graceMinutes, now);
}

/**
 * Installé : « Bon appétit ». Pas de bouton d'avis ici : on ne demande pas
 * un avis à qui vient de s'asseoir. La demande part après le repas, si le
 * restaurant l'a réglée (`reviewDelayMinutes`, appliqué en SQL).
 */
export function TableDone({ ticket }: { ticket: ProfileTicketState }) {
  const covers = ticket.entry.details.partySize ?? 1;
  return (
    <div className={clientStyles.panel}>
      <div className={clientStyles.doneGroup}>
        <div className={styles.doneTent} aria-hidden="true">
          <PartySize count={covers} size="lg" name={ticket.entry.name} />
        </div>
        <section className={clientStyles.doneText}>
          <h2 className="t-display">Bon appétit</h2>
          <p className={clientStyles.doneName}>{ticket.location.name}</p>
        </section>
      </div>
      <p className={`${clientStyles.reassure} ${clientStyles.bottom}`}>Merci d’avoir patienté.</p>
    </div>
  );
}
