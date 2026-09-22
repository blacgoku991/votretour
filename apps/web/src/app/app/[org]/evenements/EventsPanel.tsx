'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { callEventWave, changeEventState, createEventCampaign } from '@/server/actions/events';
import styles from './events.module.css';

type QueueRef = { id: string; name: string; locationName: string };
type EventRow = {
  id: string;
  name: string;
  status: string;
  queue_id: string;
  location_id: string;
  wave_size: number;
  pass_valid_minutes: number;
  grace_minutes: number;
  public_note: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  stats: { waiting: number; issued: number; redeemed: number; expired: number; revoked: number };
};

export function EventsPanel({
  orgSlug, canOperate, canConfigure, queues, events,
}: {
  orgSlug: string;
  canOperate: boolean;
  canConfigure: boolean;
  queues: QueueRef[];
  events: EventRow[];
}) {
  const router = useRouter();
  const [openCreate, setOpenCreate] = useState(events.length === 0);
  const [name, setName] = useState('');
  const [queueId, setQueueId] = useState(queues[0]?.id ?? '');
  const [waveSize, setWaveSize] = useState(10);
  const [validMinutes, setValidMinutes] = useState(10);
  const [graceMinutes, setGraceMinutes] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const act = (
    eventId: string,
    action: 'start' | 'pause' | 'resume' | 'sold_out' | 'end',
  ) => {
    if ((action === 'sold_out' || action === 'end') && !window.confirm(
      action === 'sold_out'
        ? 'Confirmer STOCK ÉPUISÉ ? Tous les laisser-passer non utilisés seront révoqués et les personnes encore en attente seront prévenues.'
        : 'Confirmer la fin de l’événement ? Tous les accès restants seront fermés.',
    )) return;

    setBusy(eventId);
    setError(null);
    startTransition(async () => {
      const result = await changeEventState({ eventId, action });
      setBusy(null);
      if (!result.ok) { setError(result.error); return; }
      if (result.data.notified > 0) {
        setFlash(`${result.data.notified} notification(s) envoyée(s)`);
      }
      router.refresh();
    });
  };

  const wave = (eventId: string, count: number) => {
    setBusy(eventId);
    setError(null);
    startTransition(async () => {
      const result = await callEventWave({ eventId, count });
      setBusy(null);
      if (!result.ok) { setError(result.error); return; }
      setFlash(
        `${result.data.issued} accès créé(s) · ${result.data.notificationsSent} notification(s) envoyée(s)`,
      );
      router.refresh();
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>RANGVIA EVENT / DROP</p>
          <h1>Contrôlez le flux, pas la foule.</h1>
          <p>
            File virtuelle, vagues d’accès, QR dynamiques à usage unique et bouton Stock épuisé.
          </p>
        </div>
        {canConfigure && (
          <button className="btn btn--signal" type="button" onClick={() => setOpenCreate((v) => !v)}>
            {openCreate ? 'Fermer' : 'Nouvel événement'}
          </button>
        )}
      </header>

      {flash && <div className="banner" role="status"><span>{flash}</span></div>}
      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

      {openCreate && canConfigure && (
        <form
          className={styles.create}
          onSubmit={(event) => {
            event.preventDefault();
            if (!queueId || !name.trim()) return;
            setBusy('create');
            setError(null);
            startTransition(async () => {
              const result = await createEventCampaign({
                queueId,
                name: name.trim(),
                waveSize,
                passValidMinutes: validMinutes,
                graceMinutes,
              });
              setBusy(null);
              if (!result.ok) { setError(result.error); return; }
              setName('');
              setOpenCreate(false);
              router.refresh();
            });
          }}
        >
          <div className={styles.createIntro}>
            <span className={styles.createIcon}>🎟️</span>
            <div>
              <h2>Créer un Event / Drop</h2>
              <p>Les inscriptions restent ouvertes tant que vous ne décidez pas de fermer.</p>
            </div>
          </div>

          <label className="field">
            <span>Nom de l’événement</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Drop Sneakers — Samedi" maxLength={120} />
          </label>

          <label className="field">
            <span>File utilisée</span>
            <select className="select" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
              {queues.map((q) => <option key={q.id} value={q.id}>{q.locationName} · {q.name}</option>)}
            </select>
          </label>

          <div className={styles.three}>
            <label className="field">
              <span>Taille d’une vague</span>
              <input className="input" type="number" min={1} max={200}
                value={waveSize} onChange={(e) => setWaveSize(Number(e.target.value))} />
            </label>
            <label className="field">
              <span>Pass valide</span>
              <input className="input" type="number" min={1} max={120}
                value={validMinutes} onChange={(e) => setValidMinutes(Number(e.target.value))} />
            </label>
            <label className="field">
              <span>Grâce</span>
              <input className="input" type="number" min={0} max={60}
                value={graceMinutes} onChange={(e) => setGraceMinutes(Number(e.target.value))} />
            </label>
          </div>

          <button className="btn btn--solid btn--lg" type="submit"
            disabled={busy === 'create' || !queueId || !name.trim()}>
            {busy === 'create' ? 'Création…' : 'Créer l’événement'}
          </button>
        </form>
      )}

      <div className={styles.events}>
        {events.length === 0 ? (
          <div className={styles.empty}>
            <span>🎫</span>
            <h2>Aucun événement</h2>
            <p>Créez votre premier drop, pop-up ou lancement limité.</p>
          </div>
        ) : events.map((event) => (
          <article className={styles.eventCard} key={event.id}>
            <div className={styles.eventHead}>
              <div>
                <span className={`${styles.status} ${styles[`status_${event.status}`] ?? ''}`}>
                  {event.status === 'live' ? '● EN DIRECT'
                    : event.status === 'paused' ? 'EN PAUSE'
                    : event.status === 'sold_out' ? 'STOCK ÉPUISÉ'
                    : event.status === 'ended' ? 'TERMINÉ'
                    : 'BROUILLON'}
                </span>
                <h2>{event.name}</h2>
              </div>
              <span className={styles.eventId}>#{event.id.slice(0, 8)}</span>
            </div>

            <div className={styles.metrics}>
              <Metric value={event.stats.waiting} label="en attente" />
              <Metric value={event.stats.issued} label="accès actifs" />
              <Metric value={event.stats.redeemed} label="entrés" accent />
              <Metric value={event.stats.expired} label="expirés" />
            </div>

            <div className={styles.rules}>
              <span>Vague <strong>{event.wave_size}</strong></span>
              <span>Pass <strong>{event.pass_valid_minutes} min</strong></span>
              <span>Grâce <strong>{event.grace_minutes} min</strong></span>
            </div>

            {canOperate && (
              <div className={styles.controls}>
                {event.status === 'draft' && (
                  <button className="btn btn--signal" disabled={busy === event.id}
                    onClick={() => act(event.id, 'start')}>Démarrer</button>
                )}

                {event.status === 'live' && (
                  <>
                    <button className="btn btn--signal" disabled={busy === event.id}
                      onClick={() => wave(event.id, event.wave_size)}>
                      Appeler {event.wave_size}
                    </button>
                    <button className="btn btn--ghost" disabled={busy === event.id}
                      onClick={() => wave(event.id, 5)}>+ 5</button>
                    <button className="btn btn--ghost" disabled={busy === event.id}
                      onClick={() => wave(event.id, 20)}>+ 20</button>
                    <button className="btn btn--ghost" disabled={busy === event.id}
                      onClick={() => act(event.id, 'pause')}>Pause appels</button>
                  </>
                )}

                {event.status === 'paused' && (
                  <button className="btn btn--signal" disabled={busy === event.id}
                    onClick={() => act(event.id, 'resume')}>Reprendre</button>
                )}

                {['live', 'paused'].includes(event.status) && (
                  <>
                    <button className="btn btn--danger" disabled={busy === event.id}
                      onClick={() => act(event.id, 'sold_out')}>Stock épuisé</button>
                    <button className="btn btn--quiet" disabled={busy === event.id}
                      onClick={() => act(event.id, 'end')}>Fin événement</button>
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function Metric({ value, label, accent = false }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className={accent ? styles.metricAccent : styles.metric}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
