'use client';

import { useMemo } from 'react';
import type { DeskDisplaySnapshot } from '@/server/display';
import { TicketDestination, TicketNumber } from '@/components/objects/TicketNumber';
import { TicketNumberFlap } from '@/components/objects/TicketNumberFlap';
import { clockOf, DESK_ANNOUNCE_FLAP, DESK_BOARD_FLAP, deskTilesOf, deskView, plural, type DeskTvCall } from './model';
import { TvAnnounce, TvFoot, TvHead, TvStat, TvTag, useNow } from './TvParts';
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
  const { current, others, recent, moreCalls, counts } = view;
  const status = snapshot.queue.status;

  // Annonce : chaque nouvel appel, du plus ancien au plus récent. TOUS les
  // appels en cours y passent (deskView n'en coupe aucun).
  const calls = useMemo(() => (current ? [current, ...others] : others).slice().reverse(), [current, others]);
  const announce = useAnnouncements(calls, (call) => call.id);
  const shown = announce.current;
  const calledAt = now ? clockOf(current?.calledAt) : null;
  // Un appel reste affiché quand les guichets passent en pause ou ferment :
  // l'écran le dit, pour que la salle ne croie pas à un oubli.
  const stateTag = status === 'paused' ? 'Guichets en pause' : status === 'closed' ? 'Guichets fermés' : null;

  return (
    <>
      <div className={common.body}>
        <section className={common.stage} aria-labelledby="tv-appel">
          <TvHead
            id="tv-appel"
            label="Appel en cours"
            note={current && (stateTag || calledAt) ? (
              <span className={styles.note}>
                {stateTag && <TvTag tone="copper">{stateTag}</TvTag>}
                {calledAt && <span>appelé à <strong>{calledAt}</strong></span>}
              </span>
            ) : null}
          />

          <div className={styles.board} data-state={current ? 'call' : 'idle'}>
            {current ? (
              <>
                <div className={styles.number} data-tiles={current.ticketNo ? deskTilesOf(current.ticketNo) : undefined}>
                  {/* Pas de `live` sur le volet : la région de TvAnnounce annonce
                      déjà l'appel, deux régions le feraient entendre deux fois. */}
                  {current.ticketNo ? (
                    <TicketNumberFlap
                      value={current.ticketNo}
                      size={`calc(var(--u) * ${DESK_BOARD_FLAP[deskTilesOf(current.ticketNo)]})`}
                    />
                  ) : (
                    <span className={styles.noNumber}>Personne suivante</span>
                  )}
                </div>
                <div className={styles.dest}>
                  {/* La flèche et le libellé sont décoratifs (aria-hidden) : la
                      destination est redite en clair pour un lecteur d'écran. */}
                  <TicketDestination destination={current.desk ?? 'Au guichet'} />
                  <span className="sr-only">{current.desk ? `, ${current.desk}` : ', au guichet'}</span>
                </div>
              </>
            ) : (
              <div className={styles.waitingBoard}>
                <p className={styles.idleTitle}>
                  {status === 'closed'
                    ? 'Guichets fermés'
                    : status === 'paused'
                      ? 'Guichets en pause, merci de patienter.'
                      : 'Le prochain numéro s’affiche ici.'}
                </p>
                <p className={styles.idleLine}>
                  {status === 'closed'
                    ? 'Merci de votre visite. À bientôt.'
                    : status === 'paused'
                      ? 'Les appels reprennent dans un instant. Gardez votre ticket : votre téléphone vous prévient aussi.'
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
              size={196}
              tone="signal"
              emphasis
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
          {moreCalls > 0 && (
            <p className={styles.logMore}>
              + <strong className="t-num">{moreCalls}</strong> {plural(moreCalls, 'autre appel en cours', 'autres appels en cours')}
            </p>
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
          <div className={styles.announceCall} data-tiles={shown.ticketNo ? deskTilesOf(shown.ticketNo) : undefined}>
            {shown.ticketNo ? (
              <TicketNumber
                value={shown.ticketNo}
                size={`calc(var(--u) * ${DESK_ANNOUNCE_FLAP[deskTilesOf(shown.ticketNo)]})`}
              />
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
    <li
      className={styles.row}
      data-live={live ? 'true' : 'false'}
      data-tiles={call.ticketNo ? deskTilesOf(call.ticketNo) : undefined}
    >
      {call.ticketNo ? (
        <TicketNumber value={call.ticketNo} size="calc(var(--u) * 56)" className={styles.rowTicket} />
      ) : (
        <span className={styles.rowNoNumber}>Suivant</span>
      )}
      <span className={styles.rowDesk}>
        <TicketDestination destination={call.desk ?? 'Guichet'} />
        <span className="sr-only">{call.desk ? `, ${call.desk}` : ', au guichet'}</span>
      </span>
      <span className={styles.rowTime}>{live ? 'Appelé' : time ?? ''}</span>
    </li>
  );
}
