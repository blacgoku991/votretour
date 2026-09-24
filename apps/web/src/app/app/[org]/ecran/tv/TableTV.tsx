'use client';

import { useMemo } from 'react';
import type { TableDisplaySnapshot } from '@/server/display';
import { FlapText } from '@/components/FlapNumber';
import { PartySize } from '@/components/objects/PartySize';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { clockOf, densityOf, plural, tableView, type TableTvRow } from './model';
import { TvAnnounce, TvFoot, TvHead, TvIdle, TvMini, TvStat, useNow } from './TvParts';
import { useAnnouncements } from './useAnnouncements';
import common from './tvProfile.module.css';
import styles from './table.module.css';

/**
 * « TABLES PRÊTES » — l'écran de l'accueil d'un restaurant.
 *
 * Chaque groupe appelé est posé à côté de son CHEVALET (le nombre de
 * couverts, en vermillon : sa table est prête) : c'est ce que la salle lit
 * d'abord. À côté, ce que l'accueil appelle : le numéro du ticket, ou le
 * prénom quand la file ne numérote pas (display_snapshot n'envoie alors
 * que lui, en initiales si la file est sensible). À droite, la liste
 * d'attente en chiffres : groupes et couverts, jamais de noms.
 */

function callText(row: TableTvRow): string {
  if (row.call?.kind === 'ticket') return `ticket ${row.call.value}`;
  if (row.call?.kind === 'name') return row.call.value;
  return 'groupe suivant';
}

function speechOf(row: TableTvRow): string {
  const covers = row.partySize ? `, ${row.partySize} ${plural(row.partySize, 'couvert', 'couverts')}` : '';
  return `Table prête pour ${callText(row)}${covers}. Présentez-vous à l’accueil.`;
}

function CallIdent({ row, size }: { row: TableTvRow; size: string }) {
  if (row.call?.kind === 'ticket') return <TicketNumber value={row.call.value} size={size} />;
  if (row.call?.kind === 'name') {
    return (
      <FlapText
        static
        fixed
        tile
        text={row.call.value}
        cells={Array.from(row.call.value).length}
        label={row.call.value}
        size={size}
      />
    );
  }
  return <span className={styles.noCall}>Groupe suivant</span>;
}

export function TableTV({ snapshot, hint }: { snapshot: TableDisplaySnapshot; hint: string }) {
  const view = useMemo(() => tableView(snapshot), [snapshot]);
  const now = useNow();
  const { rows, counts } = view;
  const density = densityOf(rows.length);

  // Du plus ancien appel au plus récent (display_snapshot les trie ainsi).
  const announce = useAnnouncements(rows, (row) => row.id);
  const shown = announce.current;

  return (
    <>
      <div className={common.body}>
        <section className={common.stage} aria-labelledby="tv-tables">
          <TvHead
            id="tv-tables"
            label="Tables prêtes"
            note={rows.length > 0 ? 'Présentez-vous à l’accueil' : null}
          />

          {rows.length > 0 ? (
            <ol className={styles.list} data-density={density} data-rows={Math.ceil(rows.length / 2)}>
              {rows.map((row) => {
                const time = now ? clockOf(row.calledAt) : null;
                return (
                  <li key={row.id} className={styles.card}>
                    {row.partySize ? (
                      <PartySize count={row.partySize} state="ready" size="lg" className={styles.tent} />
                    ) : (
                      <span className={styles.tentEmpty} aria-hidden="true" />
                    )}
                    <span className={styles.ident}>
                      <span className={styles.call}>
                        <CallIdent row={row} size="var(--tb-call)" />
                      </span>
                      <span className={styles.line}>
                        Votre table est prête
                        {time && <span className={styles.time}> · appelé à <strong className="t-num">{time}</strong></span>}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <TvIdle
              title={snapshot.queue.status === 'closed'
                ? 'La liste d’attente est fermée.'
                : snapshot.queue.status === 'paused'
                  ? 'La liste d’attente est en pause.'
                  : 'Pas encore de table prête.'}
              line={snapshot.queue.status === 'open'
                ? 'Votre groupe s’affiche ici dès que sa table est prête, et votre téléphone vous prévient.'
                : 'Adressez-vous à l’accueil : on vous installe dès qu’une table se libère.'}
            />
          )}
        </section>

        <section className={common.aside} aria-labelledby="tv-liste">
          <TvHead id="tv-liste" label="Liste d’attente" />
          <TvStat
            value={counts.groupsWaiting}
            label={plural(counts.groupsWaiting, 'groupe en attente', 'groupes en attente')}
            detail={<><strong className="t-num">{counts.coversWaiting}</strong> {plural(counts.coversWaiting, 'couvert', 'couverts')} au total</>}
            size={180}
          />
          <div className={common.minis}>
            <TvMini label="Groupes installés aujourd’hui" value={counts.groupsSeatedToday} />
            <TvMini label={plural(counts.groupsCalled, 'Groupe appelé', 'Groupes appelés')} value={counts.groupsCalled} />
          </div>
        </section>
      </div>

      <TvFoot
        hint={hint}
        today={<><strong className="t-num">{counts.coversSeatedToday}</strong> {plural(counts.coversSeatedToday, 'couvert installé', 'couverts installés')} aujourd’hui</>}
      />

      <TvAnnounce
        phase={announce.phase}
        hold={announce.hold}
        kicker="Votre table est prête"
        speech={shown ? speechOf(shown) : null}
      >
        {shown && (
          <div className={styles.announceRow}>
            {shown.partySize ? (
              <PartySize count={shown.partySize} state="ready" size="lg" className={styles.announceTent} />
            ) : null}
            <span className={styles.announceCall}>
              <CallIdent row={shown} size="calc(var(--u) * 176)" />
              <span className={styles.announceLine}>Présentez-vous à l’accueil</span>
            </span>
          </div>
        )}
      </TvAnnounce>
    </>
  );
}
