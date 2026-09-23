'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchQueueSnapshot } from '@/server/actions/queue';
import { formatTime, initials } from '@/lib/format';
import type { QueueSnapshot } from '@/lib/types';
import styles from './tv.module.css';

export interface TVEventTheme {
  id?: string;
  name: string;
  status: string;
  heroTitle: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  accentHex: string;
  rulesText: string | null;
  qrLabel: string | null;
}

export function TVBoard({
  orgSlug,
  organizationName,
  logoUrl,
  initialSnapshot,
  queues,
  snapshotEndpoint = null,
  eventTheme: initialEventTheme = null,
  kioskMode = false,
}: {
  orgSlug: string;
  organizationName: string;
  logoUrl: string | null;
  initialSnapshot: QueueSnapshot | null;
  queues: { id: string; name: string }[];
  snapshotEndpoint?: string | null;
  eventTheme?: TVEventTheme | null;
  kioskMode?: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [eventTheme, setEventTheme] = useState<TVEventTheme | null>(initialEventTheme);
  const [now, setNow] = useState(new Date());
  const queueId = snapshot?.queue.id ?? queues[0]?.id ?? null;

  const refresh = useCallback(async () => {
    if (!queueId) return;

    if (snapshotEndpoint) {
      try {
        const response = await fetch(snapshotEndpoint, { cache: 'no-store' });
        if (response.status === 401) {
          window.location.reload();
          return;
        }

        const payload = await response.json() as {
          ok: boolean;
          data?: {
            snapshot?: QueueSnapshot | null;
            event?: TVEventTheme | null;
          };
        };

        if (payload.ok && payload.data) {
          if ('snapshot' in payload.data) setSnapshot(payload.data.snapshot ?? null);
          if ('event' in payload.data) setEventTheme(payload.data.event ?? null);
        }
      } catch {
        // L'écran garde le dernier état connu et réessaie au prochain poll.
      }
      return;
    }

    const result = await fetchQueueSnapshot(queueId);
    if (result.ok) setSnapshot(result.data.snapshot);
  }, [queueId, snapshotEndpoint]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const next = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.called, ...snapshot.waiting].slice(0, 6);
  }, [snapshot]);

  const screenStyle = {
    '--tv-accent': eventTheme?.accentHex || '#FF4B1F',
    ...(eventTheme?.coverUrl
      ? {
          backgroundImage:
            `linear-gradient(145deg, rgba(7,9,13,.90), rgba(7,9,13,.78)), url(${JSON.stringify(eventTheme.coverUrl)})`,
        }
      : {}),
  } as CSSProperties;

  if (!snapshot) {
    return (
      <main className={styles.screen} style={screenStyle}>
        <div className={styles.empty}>Aucune file à afficher.</div>
      </main>
    );
  }

  const { queue, location, serving, counts, staff } = snapshot;
  const activeLogo = eventTheme?.logoUrl || logoUrl;

  return (
    <main className={styles.screen} style={screenStyle} data-event={eventTheme ? 'true' : 'false'}>
      <div className={styles.ambient} />

      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            {activeLogo
              ? <img src={activeLogo} alt="" />
              : <span>{initials(eventTheme?.name || organizationName)}</span>}
          </div>
          <div>
            <p className={styles.kicker}>
              {eventTheme ? 'RANGVIA · EVENT LIVE' : 'RANGVIA · FILE EN DIRECT'}
            </p>
            <h1>{eventTheme?.name || organizationName}</h1>
            <p className={styles.location}>
              {organizationName} · {location.name}
            </p>
          </div>
        </div>

        <div className={styles.controls}>
          {queues.length > 1 && !kioskMode && (
            <select
              className={styles.select}
              value={queue.id}
              onChange={(e) => {
                window.location.href = `/ecran/${orgSlug}?file=${encodeURIComponent(e.target.value)}`;
              }}
            >
              {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          )}
          <button
            type="button"
            className={styles.fullscreen}
            onClick={() => document.documentElement.requestFullscreen?.()}
          >
            Plein écran
          </button>
          <time className={styles.clock}>
            {now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </time>
        </div>
      </header>

      {eventTheme && (
        <section className={styles.eventHero}>
          <div className={styles.eventCopy}>
            <p className={styles.kicker}>DROP / ÉVÉNEMENT</p>
            <h2>{eventTheme.heroTitle || eventTheme.name}</h2>
            {eventTheme.rulesText && <p>{eventTheme.rulesText}</p>}
          </div>

          {eventTheme.id && (
            <div className={styles.eventQr}>
              <img src={'/api/event/qr?event=' + encodeURIComponent(eventTheme.id)} alt="QR pour rejoindre l’événement" />
              <span>{eventTheme.qrLabel || 'Scannez pour rejoindre la file'}</span>
            </div>
          )}
        </section>
      )}

      <section className={styles.hero}>
        <div className={styles.now}>
          <p className={styles.kicker}>EN CE MOMENT</p>
          {serving.length ? (
            <div className={styles.servingGrid}>
              {serving.slice(0, 4).map((entry) => {
                const pro = staff.find((s) => s.id === entry.staffId);
                return (
                  <article className={styles.servingCard} key={entry.id}>
                    <span className={styles.avatar}>{initials(entry.name)}</span>
                    <div>
                      <strong>{entry.name ?? 'Client'}</strong>
                      <small>{pro?.name ? `avec ${pro.name}` : 'En prestation'}</small>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <h2 className={styles.idle}>Prêt pour le prochain client</h2>
          )}
        </div>

        <div className={styles.bigCount}>
          <strong>{counts.waiting}</strong>
          <span>{counts.waiting === 1 ? 'personne en attente' : 'personnes en attente'}</span>
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.kicker}>À SUIVRE</p>
              <h2>Les prochains</h2>
            </div>
            <span className={queue.status === 'open' ? styles.live : styles.closed}>
              {queue.status === 'open' ? '● EN DIRECT' : queue.status.toUpperCase()}
            </span>
          </div>

          <div className={styles.queue}>
            {next.length === 0 ? (
              <div className={styles.emptyRow}>La file est vide.</div>
            ) : next.map((entry, index) => (
              <div className={styles.queueRow} key={entry.id}>
                <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.clientName}>{entry.name ?? 'Client'}</span>
                {entry.status === 'returning' && (
                  <span className={styles.returning}>
                    revient · signalé {entry.returningAt ? formatTime(entry.returningAt) : 'à l’instant'}
                  </span>
                )}
                <span className={styles.proName}>
                  {staff.find((s) => s.id === entry.staffId)?.name ?? 'premier disponible'}
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <p className={styles.kicker}>ÉQUIPE</p>
              <h2>Disponibilité</h2>
            </div>
          </div>

          <div className={styles.team}>
            {staff.length === 0 ? (
              <div className={styles.emptyRow}>Ajoutez votre équipe depuis le dashboard.</div>
            ) : staff.map((member) => (
              <div className={styles.member} key={member.id}>
                <span className={styles.avatar}>{initials(member.name)}</span>
                <div>
                  <strong>{member.name}</strong>
                  <small>
                    {member.isOnBreak ? 'En pause'
                      : member.servingEntryId ? 'En prestation'
                      : member.waitingCount > 0 ? `${member.waitingCount} en attente`
                      : 'Disponible'}
                  </small>
                </div>
                <i className={member.isOnBreak ? styles.offDot : styles.onDot} />
              </div>
            ))}
          </div>
        </article>
      </section>

      <footer className={styles.footer}>
        <span>
          {eventTheme?.qrLabel || 'Approchez votre téléphone de la plaque Rangvia pour rejoindre la file.'}
        </span>
        <strong>{counts.completedToday} clients servis aujourd’hui</strong>
      </footer>
    </main>
  );
}
