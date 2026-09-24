'use client';

import { useMemo } from 'react';
import type { DeskDisplaySnapshot } from '@/server/display';
import { TicketDestination, TicketNumber } from '@/components/objects/TicketNumber';
import { TicketNumberFlap } from '@/components/objects/TicketNumberFlap';
import { clockOf, deskView, plural, type DeskTvCall } from './model';
import { TvAnnounce, TvFoot, TvHead, TvStat, useNow } from './TvParts';
import { useAnnouncements } from './useAnnouncements';
import common from './tvProfile.module.css';
import styles from './desk.module.css';

/**
 * LE TABLEAU D'APPEL — guichets (comptoir, service administratif, santé).
 *
 * À gauche, l'appel courant, énorme : « A-042 → GUICHET 3 », la flèche en
 * vermillon, le numéro en volets qui tombent quand le guichet appelle le
 * suivant. À droite, les autres appels en cours puis les derniers appels.
 * En bas, la salle en chiffres.
 *
 * Au guichet, on appelle un NUMÉRO, jamais un nom : ce composant ne lit
 * que `deskView` (numéro, libellé du guichet, heure). Aucun prénom ni
 * motif ne peut s'y afficher, même si la file demande le prénom au client
 * (en santé, un motif peut révéler une information médicale).
 */

function speechOf(call: DeskTvCall): string {
  const who = call.ticketNo ? `Ticket ${call.ticketNo}` : 'Personne suivante';
  return call.desk ? `${who}, ${call.desk}` : who;
}

export function DeskTV({ snapshot, hint }: { snapshot: DeskDisplaySnapshot; hint: string }) {
  const view = useMemo(() => deskView(snapshot), [snapshot]);
  const now = useNow();
  const { current, others, recent, counts } = view;

  // Annonce : chaque nouvel appel, du plus ancien au plus récent.
  const calls = useMemo(() => (current ? [current, ...others] : others).slice().reverse(), [current, others]);
  const announce = useAnnouncements(calls, (call) => call.id);
  const shown = announce.current;
  const calledAt = now ? clockOf(current?.calledAt) : null;

  return (
    <>
      <div className={common.body}>
        <section className={common.stage} aria-labelledby="tv-appel">
          <TvHead
            id="tv-appel"
            label="Appel en cours"
            note={calledAt ? <>appelé à <strong>{calledAt}</strong></> : null}
          />

          <div className={styles.board} data-state={current ? 'call' : 'idle'}>
            {current ? (
              <>
                <div className={styles.number}>
                  {current.ticketNo ? (
                    <TicketNumberFlap value={current.ticketNo} size="calc(var(--u) * 236)" live />
                  ) : (
                    <span className={styles.noNumber}>Personne suivante</span>
                  )}
                </div>
                <div className={styles.dest}>
                  <TicketDestination destination={current.desk ?? 'Au guichet'} />
                </div>
              </>
            ) : (
              <div className={styles.waitingBoard}>
                <p className={styles.idleTitle}>
                  {snapshot.queue.status === 'closed' ? 'Guichets fermés' : 'Le prochain numéro s’affiche ici.'}
                </p>
                <p className={styles.idleLine}>
                  {snapshot.queue.status === 'closed'
                    ? 'Merci de votre visite. À bientôt.'
                    : 'Gardez votre ticket sous les yeux : votre téléphone vous prévient aussi.'}
                </p>
              </div>
            )}
          </div>

          <div className={styles.counts}>
            <TvStat
              value={counts.waiting}
              label={plural(counts.waiting, 'personne en attente', 'personnes en attente')}
              detail={counts.called > 1 ? <><strong>{counts.called}</strong> appels en cours</> : null}
              size={150}
              tone="signal"
            />
          </div>
        </section>

        <section className={common.aside} aria-labelledby="tv-derniers">
          <TvHead id="tv-derniers" label="Derniers appels" />
          {others.length + recent.length > 0 ? (
            <ol className={styles.log}>
              {others.map((call) => (
                <CallRow key={call.id} call={call} live now={now} />
              ))}
              {recent.map((call) => (
                <CallRow key={call.id} call={call} now={now} />
              ))}
            </ol>
          ) : (
            <p className={styles.logEmpty}>Les appels de la journée s’affichent ici.</p>
          )}
        </section>
      </div>

      <TvFoot
        hint={hint}
        today={<><strong className="t-num">{counts.servedToday}</strong> {plural(counts.servedToday, 'personne servie', 'personnes servies')} aujourd’hui</>}
      />

      <TvAnnounce
        phase={announce.phase}
        hold={announce.hold}
        kicker="Appel au guichet"
        speech={shown ? speechOf(shown) : null}
      >
        {shown && (
          <div className={styles.announceCall}>
            {shown.ticketNo ? (
              <TicketNumber value={shown.ticketNo} size="calc(var(--u) * 250)" />
            ) : (
              <span className={styles.noNumber}>Personne suivante</span>
            )}
            <span className={styles.announceDest}>
              <TicketDestination destination={shown.desk ?? 'Au guichet'} />
            </span>
          </div>
        )}
      </TvAnnounce>
    </>
  );
}

function CallRow({ call, live = false, now }: { call: DeskTvCall; live?: boolean; now: Date | null }) {
  const time = now ? clockOf(call.calledAt) : null;
  return (
    <li className={styles.row} data-live={live ? 'true' : 'false'}>
      {call.ticketNo ? (
        <TicketNumber value={call.ticketNo} size="calc(var(--u) * 56)" className={styles.rowTicket} />
      ) : (
        <span className={styles.rowNoNumber}>Suivant</span>
      )}
      <span className={styles.rowDesk}>
        <TicketDestination destination={call.desk ?? 'Guichet'} />
      </span>
      <span className={styles.rowTime}>{live ? 'Appelé' : time ?? ''}</span>
    </li>
  );
}
