'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { callEventWave, changeEventState, createEventCampaign } from '@/server/actions/events';
import { FlapNumber, FlapText } from '@/components/FlapNumber';
import { Barrier } from './Barrier';
import { WavePreview } from './WavePreview';
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

const STATUS: Record<string, { label: string; tone: 'live' | 'paused' | 'soldout' | 'ended' | 'draft' }> = {
  live: { label: 'En direct', tone: 'live' },
  paused: { label: 'En pause', tone: 'paused' },
  sold_out: { label: 'Stock épuisé', tone: 'soldout' },
  ended: { label: 'Terminé', tone: 'ended' },
  draft: { label: 'Brouillon', tone: 'draft' },
};

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

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
  const formId = useId();
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

  const anyLive = events.some((event) => event.status === 'live');
  const formOpen = openCreate && canConfigure;

  return (
    <div className={`shell ${styles.page}`}>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <p className="t-label">Rangvia Event / Drop</p>
          <h1 className={`t-display ${styles.heroTitle}`}>Contrôlez le flux, pas la foule.</h1>
          <p className={`t-lead ${styles.heroLead}`}>
            File virtuelle, vagues d’accès, QR dynamiques à usage unique et bouton Stock épuisé.
          </p>
        </div>
        {canConfigure && (
          <div className={styles.heroAction}>
            {formOpen ? (
              <button
                className="btn btn--ghost"
                type="button"
                aria-expanded="true"
                aria-controls={formId}
                onClick={() => setOpenCreate(false)}
              >
                <CloseIcon />
                Fermer le formulaire
              </button>
            ) : (
              <button
                className="btn btn--signal"
                type="button"
                aria-expanded="false"
                aria-controls={formId}
                onClick={() => setOpenCreate(true)}
              >
                <PlusIcon />
                Nouvel événement
              </button>
            )}
          </div>
        )}
        <div className={styles.heroBarrier} data-raised={anyLive ? '1' : undefined}>
          <Barrier raised={anyLive} lift />
        </div>
        <p className={`t-label ${styles.heroState}`}>
          <span className={`pip ${anyLive ? 'pip--live' : ''}`} />
          {anyLive ? 'Flux ouvert · en direct' : 'Flux fermé'}
        </p>
      </header>

      {flash && <div className="banner" role="status"><span>{flash}</span></div>}
      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

      {formOpen && (
        <section className={styles.composer} aria-labelledby={`${formId}-titre`}>
          <form
            id={formId}
            className={styles.form}
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
            <div className={styles.formHead}>
              <h2 id={`${formId}-titre`} className="t-title">Créer un Event / Drop</h2>
              <p className="t-small t-muted">
                Les inscriptions restent ouvertes tant que vous ne décidez pas de fermer.
              </p>
            </div>

            <div className={styles.rows}>
              <FormRow id={`${formId}-nom`} label="Nom de l’événement" hint="Visible par vos clients sur leur pass.">
                <input
                  id={`${formId}-nom`}
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Drop Sneakers — Samedi"
                  maxLength={120}
                  autoComplete="off"
                />
              </FormRow>

              <FormRow id={`${formId}-file`} label="File utilisée" hint="Les inscrits rejoignent cette file.">
                <select
                  id={`${formId}-file`}
                  className="select"
                  value={queueId}
                  onChange={(e) => setQueueId(e.target.value)}
                >
                  {queues.map((q) => <option key={q.id} value={q.id}>{q.locationName} · {q.name}</option>)}
                </select>
              </FormRow>

              <FormRow id={`${formId}-vague`} label="Taille d’une vague" hint="Nombre d’accès envoyés à chaque ouverture.">
                <UnitField
                  id={`${formId}-vague`}
                  value={waveSize}
                  onChange={setWaveSize}
                  min={1}
                  max={200}
                  unit={waveSize > 1 ? 'personnes' : 'personne'}
                  label="la taille d’une vague"
                />
              </FormRow>

              <FormRow id={`${formId}-pass`} label="Pass valide" hint="Durée pendant laquelle le QR d’accès fonctionne.">
                <UnitField
                  id={`${formId}-pass`}
                  value={validMinutes}
                  onChange={setValidMinutes}
                  min={1}
                  max={120}
                  unit="min"
                  label="la durée du pass"
                />
              </FormRow>

              <FormRow id={`${formId}-grace`} label="Grâce" hint="Retard toléré après la fin du pass.">
                <UnitField
                  id={`${formId}-grace`}
                  value={graceMinutes}
                  onChange={setGraceMinutes}
                  min={0}
                  max={60}
                  unit="min"
                  label="la grâce"
                />
              </FormRow>
            </div>

            <div className={styles.formFoot}>
              <button
                className="btn btn--signal btn--lg"
                type="submit"
                disabled={busy === 'create' || !queueId || !name.trim()}
              >
                {busy === 'create' ? 'Création…' : 'Créer l’événement'}
              </button>
              {!name.trim() && (
                <p className="hint">Donnez un nom à l’événement pour le créer.</p>
              )}
            </div>
          </form>

          <WavePreview waveSize={waveSize} validMinutes={validMinutes} graceMinutes={graceMinutes} />
        </section>
      )}

      <section className={styles.list} aria-labelledby="evenements-liste">
        <div className={styles.listHead}>
          <h2 id="evenements-liste" className="t-label">Vos événements</h2>
          {events.length > 0 && (
            <span className={`t-label ${styles.listCount}`}>{events.length}</span>
          )}
        </div>

        {events.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyGate} aria-hidden="true">
              <Barrier ground={false} />
            </div>
            <div className={styles.emptyText}>
              <h3 className="t-title">Aucun événement</h3>
              <p className="t-body t-muted">Créez votre premier drop, pop-up ou lancement limité.</p>
            </div>
          </div>
        ) : (
          <ol className={`rail-list ${styles.events}`}>
            {events.map((event) => (
              <EventLine
                key={event.id}
                event={event}
                canOperate={canOperate}
                busy={busy === event.id}
                onAct={act}
                onWave={wave}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function EventLine({
  event, canOperate, busy, onAct, onWave,
}: {
  event: EventRow;
  canOperate: boolean;
  busy: boolean;
  onAct: (eventId: string, action: 'start' | 'pause' | 'resume' | 'sold_out' | 'end') => void;
  onWave: (eventId: string, count: number) => void;
}) {
  const status = STATUS[event.status] ?? STATUS.draft!;
  const { waiting, issued, redeemed, expired, revoked } = event.stats;
  const emitted = issued + redeemed + expired + revoked;
  const size = Math.max(1, event.wave_size);
  // Vagues ouvertes : déduites des accès émis (une vague = wave_size accès).
  const waves = Math.ceil(emitted / size);
  const waitingWaves = Math.ceil(waiting / size);
  const ratio = (n: number) => (emitted > 0 ? Math.min(1, n / emitted) : 0);

  return (
    <li className={styles.event} data-tone={status.tone}>
      <div className={styles.eventTop}>
        <div className={styles.eventTitle}>
          <p className={styles.status}>
            <span className={`pip ${status.tone === 'live' ? 'pip--live' : ''} ${styles.statusPip}`} />
            {status.label}
            <span className={styles.eventId}>#{event.id.slice(0, 8)}</span>
          </p>
          <h3 className={styles.eventName}>{event.name}</h3>
          <p className={styles.rules}>
            <span>Vagues de <strong>{event.wave_size}</strong></span>
            <span>Pass <strong>{event.pass_valid_minutes} min</strong></span>
            <span>Grâce <strong>{event.grace_minutes} min</strong></span>
          </p>
        </div>
        <div className={styles.waveBoard}>
          <FlapText
            static
            fixed
            tile
            cells={8}
            text={waves > 0 ? `VAGUE ${waves}` : 'VAGUE —'}
            label={waves > 0 ? `${waves} ${plural(waves, 'vague ouverte', 'vagues ouvertes')}` : 'Aucune vague ouverte'}
            size="clamp(1.375rem, 1.1rem + 0.8vw, 1.75rem)"
          />
        </div>
      </div>

      <div className={`kpi-band ${styles.kpis}`}>
        <Metric
          label="En attente"
          value={waiting}
          note={waiting > 0 ? `≈ ${waitingWaves} ${plural(waitingWaves, 'vague', 'vagues')}` : 'Personne'}
        />
        <Metric label="Accès actifs" value={issued} gauge={ratio(issued)} tone="signal" />
        <Metric label="Entrés" value={redeemed} gauge={ratio(redeemed)} tone="jade" />
        <Metric label="Expirés" value={expired} gauge={ratio(expired)} tone="brique" />
      </div>
      <p className={styles.emitted}>
        {emitted > 0
          ? `${emitted} ${plural(emitted, 'accès émis', 'accès émis')} au total${revoked > 0 ? ` · ${revoked} ${plural(revoked, 'révoqué', 'révoqués')}` : ''}`
          : 'Aucun accès émis pour l’instant.'}
      </p>

      {canOperate && ['draft', 'live', 'paused'].includes(event.status) && (
        <div className={styles.controls}>
          {event.status === 'draft' && (
            <button className="btn btn--signal" disabled={busy}
              onClick={() => onAct(event.id, 'start')}>Démarrer</button>
          )}

          {event.status === 'live' && (
            <>
              <button className={`btn btn--signal ${styles.primary}`} disabled={busy}
                onClick={() => onWave(event.id, event.wave_size)}>
                Ouvrir la vague suivante
                <span className={styles.btnCount}>{event.wave_size}</span>
              </button>
              <div className={styles.extra} role="group" aria-label="Appeler quelques personnes de plus">
                <button className="btn btn--ghost" disabled={busy}
                  aria-label="Appeler 5 personnes de plus"
                  onClick={() => onWave(event.id, 5)}>+ 5</button>
                <button className="btn btn--ghost" disabled={busy}
                  aria-label="Appeler 20 personnes de plus"
                  onClick={() => onWave(event.id, 20)}>+ 20</button>
              </div>
              <button className="btn btn--ghost" disabled={busy}
                onClick={() => onAct(event.id, 'pause')}>Pause appels</button>
            </>
          )}

          {event.status === 'paused' && (
            <button className="btn btn--signal" disabled={busy}
              onClick={() => onAct(event.id, 'resume')}>Reprendre</button>
          )}

          {['live', 'paused'].includes(event.status) && (
            <span className={styles.danger}>
              <button className="btn btn--danger" disabled={busy}
                onClick={() => onAct(event.id, 'sold_out')}>Stock épuisé</button>
              <button className="btn btn--quiet" disabled={busy}
                onClick={() => onAct(event.id, 'end')}>Fin de l’événement</button>
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function Metric({
  label, value, note, gauge, tone,
}: {
  label: string;
  value: number;
  note?: string;
  gauge?: number;
  tone?: 'signal' | 'jade' | 'brique';
}) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <span className="t-label">{label}</span>
      <span className={styles.metricValue}>
        <FlapNumber static value={value} size="1.75rem" />
      </span>
      <span className={styles.metricFoot}>
        {gauge !== undefined ? (
          <span className={styles.gauge} aria-hidden="true">
            <span className={styles.gaugeFill} style={{ transform: `scaleX(${gauge})` }} />
          </span>
        ) : (
          <span className={styles.metricNote}>{note}</span>
        )}
      </span>
    </div>
  );
}

/** Champ numérique avec son unité visible et deux crans − / +. */
function UnitField({
  id, value, onChange, min, max, unit, label,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  unit: string;
  label: string;
}) {
  const safe = Number.isFinite(value) ? value : min;
  const step = (delta: number) => onChange(Math.max(min, Math.min(max, Math.round(safe) + delta)));
  return (
    <div className={styles.unitField}>
      <button
        type="button"
        className={styles.stepBtn}
        aria-label={`Diminuer ${label}`}
        disabled={safe <= min}
        onClick={() => step(-1)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
      </button>
      <span className={styles.unitInput}>
        <input
          id={id}
          className="input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className={styles.unit} aria-hidden="true">{unit}</span>
      </span>
      <button
        type="button"
        className={styles.stepBtn}
        aria-label={`Augmenter ${label}`}
        disabled={safe >= max}
        onClick={() => step(1)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg>
      </button>
    </div>
  );
}

function FormRow({
  id, label, hint, children,
}: { id: string; label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <label htmlFor={id} className={styles.rowLabel}>{label}</label>
        <p className={styles.rowHint}>{hint}</p>
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
