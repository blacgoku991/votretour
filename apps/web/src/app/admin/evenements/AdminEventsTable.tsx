'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adminEventAction } from '@/server/actions/admin';
import styles from '../admin.module.css';

type Row = {
  id: string;
  name: string;
  status: string;
  waveSize: number;
  passValidMinutes: number;
  graceMinutes: number;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  organizationId: string;
  queueId: string;
  organizationName: string;
  organizationSlug: string;
  locationName: string;
  city: string | null;
  issued: number;
  redeemed: number;
  expired: number;
  revoked: number;
};

export function AdminEventsTable({ events }: { events: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const act = (
    eventId: string,
    action: 'start' | 'pause' | 'resume' | 'wave' | 'sold_out' | 'end',
    count?: number,
  ) => {
    if ((action === 'sold_out' || action === 'end') && !window.confirm(
      action === 'sold_out'
        ? 'Confirmer STOCK ÉPUISÉ ? Tous les accès non utilisés seront révoqués.'
        : 'Confirmer la fin définitive de cet événement ?',
    )) return;

    setBusy(eventId);
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await adminEventAction({ eventId, action, count });
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const bits = [];
      if (result.data.issued != null) bits.push(`${result.data.issued} accès`);
      if (result.data.notifications != null) bits.push(`${result.data.notifications} notifications`);
      setNotice(bits.length ? bits.join(' · ') : 'Action effectuée.');
      router.refresh();
    });
  };

  return (
    <>
      {error && <div className="banner banner--error"><span>{error}</span></div>}
      {notice && <div className="banner"><span>{notice}</span></div>}

      <div className={styles.eventAdminGrid}>
        {events.map((event) => (
          <article className={styles.eventAdminCard} key={event.id}>
            <div className={styles.eventAdminTop}>
              <div>
                <span className={`${styles.statusDot} ${styles[`event_${event.status}`] ?? ''}`} />
                <span className={styles.eventState}>{event.status.replace('_', ' ')}</span>
                <h2>{event.name}</h2>
                <p>{event.organizationName} · {event.locationName}{event.city ? ` · ${event.city}` : ''}</p>
              </div>
              <Link className="btn btn--ghost btn--sm" href={`/admin/etablissements/${event.organizationId}`}>
                Organisation
              </Link>
            </div>

            <div className={styles.eventAdminMetrics}>
              <div><strong>{event.issued}</strong><span>accès actifs</span></div>
              <div><strong>{event.redeemed}</strong><span>entrés</span></div>
              <div><strong>{event.expired}</strong><span>expirés</span></div>
              <div><strong>{event.revoked}</strong><span>révoqués</span></div>
            </div>

            <div className={styles.eventAdminRules}>
              <span>Vague {event.waveSize}</span>
              <span>Pass {event.passValidMinutes} min</span>
              <span>Grâce {event.graceMinutes} min</span>
            </div>

            <div className={styles.eventAdminActions}>
              {event.status === 'draft' && (
                <button className="btn btn--signal btn--sm" disabled={busy === event.id}
                  onClick={() => act(event.id, 'start')}>Démarrer</button>
              )}

              {event.status === 'live' && (
                <>
                  <button className="btn btn--signal btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'wave', event.waveSize)}>Appeler {event.waveSize}</button>
                  <button className="btn btn--ghost btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'wave', 20)}>+20</button>
                  <button className="btn btn--ghost btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'pause')}>Pause</button>
                </>
              )}

              {event.status === 'paused' && (
                <button className="btn btn--signal btn--sm" disabled={busy === event.id}
                  onClick={() => act(event.id, 'resume')}>Reprendre</button>
              )}

              {['live', 'paused'].includes(event.status) && (
                <>
                  <button className="btn btn--danger btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'sold_out')}>Stock épuisé</button>
                  <button className="btn btn--quiet btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'end')}>Terminer</button>
                </>
              )}
            </div>
          </article>
        ))}

        {events.length === 0 && (
          <div className={styles.adminCard}>
            <p className="t-muted">Aucun événement ne correspond aux filtres.</p>
          </div>
        )}
      </div>
    </>
  );
}
