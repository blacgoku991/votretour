'use client';

import { useMemo } from 'react';
import type { RetailDisplaySnapshot } from '@/server/display';
import { FlapText } from '@/components/FlapNumber';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { densityOf, pickupView, plural, sinceOf, type PickupTvCall, type PickupTvRow } from './model';
import { TvAnnounce, TvFoot, TvHead, TvIdle, TvMini, TvStat, TvTag, useNow } from './TvParts';
import { useAnnouncements } from './useAnnouncements';
import common from './tvProfile.module.css';
import styles from './pickup.module.css';

/**
 * « COMMANDES PRÊTES » — l'écran de la caisse d'une boutique.
 *
 * Chaque commande prête est une étiquette de sac (une latte à œillet en
 * haut) qui porte la FIN du numéro de commande (4 caractères, calculés en
 * SQL : un numéro de commande n'identifie personne sans le système du
 * commerçant) ou, à défaut, le numéro de ticket. En bas, les clients
 * « conseil » appelés au comptoir, par numéro. À droite, la boutique en
 * chiffres. Aucun nom, nulle part.
 */

type PickupAnnounce =
  | { key: string; kind: 'ready'; row: PickupTvRow }
  | { key: string; kind: 'call'; call: PickupTvCall };

function RefIdent({ row, size }: { row: PickupTvRow; size: string }) {
  if (row.ref.kind === 'ticket') return <TicketNumber value={row.ref.value} size={size} />;
  return (
    <span className={styles.order}>
      <span className={styles.orderMark} aria-hidden="true">N°</span>
      <FlapText
        static
        fixed
        tile
        text={row.ref.value}
        cells={Array.from(row.ref.value).length}
        label={`Commande se terminant par ${row.ref.value}`}
        size={size}
      />
    </span>
  );
}

function speechOf(item: PickupAnnounce): string {
  if (item.kind === 'call') return `Ticket ${item.call.ticketNo}, présentez-vous au comptoir.`;
  return item.row.ref.kind === 'order'
    ? `Commande se terminant par ${item.row.ref.value} prête à la caisse.`
    : `Commande du ticket ${item.row.ref.value} prête à la caisse.`;
}

export function PickupTV({ snapshot, hint }: { snapshot: RetailDisplaySnapshot; hint: string }) {
  const view = useMemo(() => pickupView(snapshot), [snapshot]);
  const now = useNow();
  const { rows, calls, counts, readyWithoutRow } = view;
  const density = densityOf(rows.length);

  const items = useMemo<PickupAnnounce[]>(
    () => [
      ...rows.slice().reverse().map((row) => ({ key: `r:${row.id}`, kind: 'ready' as const, row })),
      ...calls.slice().reverse().map((call) => ({ key: `c:${call.id}`, kind: 'call' as const, call })),
    ],
    [rows, calls],
  );
  const announce = useAnnouncements(items, (item) => item.key);
  const shown = announce.current;

  return (
    <>
      <div className={common.body}>
        <section className={common.stage} aria-labelledby="tv-commandes">
          <TvHead
            id="tv-commandes"
            label="Commandes prêtes"
            note={rows.length > 0 ? 'À retirer à la caisse' : null}
          />

          {rows.length > 0 ? (
            <ol className={styles.list} data-density={density}>
              {rows.map((row, index) => (
                <li key={row.id} className={styles.card} data-latest={index === 0 ? 'true' : 'false'}>
                  <span className={styles.eyelet} aria-hidden="true" />
                  <RefIdent row={row} size="var(--pk-ref)" />
                  <span className={styles.meta}>
                    <TvTag>Prête</TvTag>
                    <span className={styles.since}>
                      {now ? <>depuis <strong className="t-num">{sinceOf(row.readySince, now)}</strong></> : ' '}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : readyWithoutRow > 0 ? (
            <div className={styles.countOnly}>
              <TvStat
                value={readyWithoutRow}
                label={plural(readyWithoutRow, 'commande prête', 'commandes prêtes')}
                detail="Présentez-vous à la caisse."
                size={220}
                tone="signal"
              />
            </div>
          ) : (
            <TvIdle
              title={snapshot.queue.status === 'closed' ? 'La boutique est fermée.' : 'Aucune commande prête pour l’instant.'}
              line={snapshot.queue.status === 'closed'
                ? 'Merci de votre visite. À bientôt.'
                : 'Votre téléphone vous prévient dès que la vôtre est prête : elle s’affichera aussi ici.'}
            />
          )}

          {calls.length > 0 && (
            <div className={styles.calls}>
              <span className={`t-label ${styles.callsLabel}`}>Au comptoir</span>
              <ul className={styles.callList}>
                {calls.map((call) => (
                  <li key={call.id}>
                    <TicketNumber value={call.ticketNo} size="calc(var(--u) * 64)" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className={common.aside} aria-labelledby="tv-boutique">
          <TvHead id="tv-boutique" label="En boutique" />
          <TvStat
            value={counts.preparing}
            label={plural(counts.preparing, 'commande en préparation', 'commandes en préparation')}
            size={180}
          />
          <div className={common.minis}>
            <TvMini label={plural(counts.waiting, 'Client en attente', 'Clients en attente')} value={counts.waiting} />
            <TvMini label="Appelés au comptoir" value={counts.called} />
          </div>
        </section>
      </div>

      <TvFoot
        hint={hint}
        today={<><strong className="t-num">{snapshot.counts.completedToday}</strong> {plural(snapshot.counts.completedToday, 'client servi', 'clients servis')} aujourd’hui</>}
      />

      <TvAnnounce
        phase={announce.phase}
        hold={announce.hold}
        kicker={shown?.kind === 'call' ? 'Au comptoir' : 'Commande prête'}
        speech={shown ? speechOf(shown) : null}
      >
        {shown && (
          <div className={styles.announceRow}>
            {shown.kind === 'ready' ? (
              <RefIdent row={shown.row} size="calc(var(--u) * 210)" />
            ) : (
              <TicketNumber value={shown.call.ticketNo} size="calc(var(--u) * 210)" />
            )}
            <span className={styles.announceLine}>
              {shown.kind === 'ready' ? 'À retirer à la caisse' : 'Présentez-vous au comptoir'}
            </span>
          </div>
        )}
      </TvAnnounce>
    </>
  );
}
