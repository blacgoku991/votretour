'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchQueueSnapshot } from '@/server/actions/queue';
import { formatTime, initials } from '@/lib/format';
import type { QueueSnapshot } from '@/lib/types';
import styles from './tv.module.css';

export function TVBoard({
  orgSlug,
  organizationName,
  logoUrl,
  initialSnapshot,
  queues,
}: {
  orgSlug: string;
  organizationName: string;
  logoUrl: string | null;
  initialSnapshot: QueueSnapshot | null;
  queues: { id: string; name: string }[];
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [now, setNow] = useState(new Date());
  const queueId = snapshot?.queue.id ?? queues[0]?.id ?? null;

  const refresh = useCallback(async () => {
    if (!queueId) return;
    const result = await fetchQueueSnapshot(queueId);
    if (result.ok) setSnapshot(result.data.snapshot);
  }, [queueId]);

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

  if (!snapshot) {
    return <main className={styles.screen}><div className={styles.empty}>Aucune file à afficher.</div></main>;
  }

  const { queue, location, serving, counts, staff } = snapshot;

  return (
    <main className={styles.screen}>
      <div className={styles.ambient} />

      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            {logoUrl
              ? <img src={logoUrl} alt="" />
              : <span>{initials(organizationName)}</span>}
          </div>
          <div>
            <p className={styles.kicker}>RANGVIA · FILE EN DIRECT</p>
            <h1>{organizationName}</h1>
            <p className={styles.location}>{location.name}</p>
          </div>
        </div>

        <div className={styles.controls}>
          {queues.length > 1 && (
            <select
              className={styles.select}
              value={queue.id}
              onChange={(e) => { window.location.href = `/app/${orgSlug}/ecran?file=${e.target.value}`; }}
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
        <span>Approchez votre téléphone de la plaque Rangvia pour rejoindre la file.</span>
        <strong>{counts.completedToday} clients servis aujourd’hui</strong>
      </footer>
    </main>
  );
}
