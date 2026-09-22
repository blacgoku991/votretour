'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Rang } from '@/components/Rang';
import { FlapNumber } from '@/components/FlapNumber';
import { useQueueRealtime } from '@/hooks/useQueueRealtime';
import { detectPushSupport, subscribeToPush, currentPermission } from '@/lib/push-client';
import { peopleAheadUnit, waitingCountLabel } from '@/lib/copy';
import { directionsUrl, initials } from '@/lib/format';
import type { EntryPoint, PublicQueueState, TicketState } from '@/lib/types';
import styles from './client.module.css';

/**
 * L'EXPÉRIENCE CLIENT.
 *
 * Contrainte fondatrice : zéro compte, zéro mot de passe, zéro
 * installation. On approche son téléphone, on tape son prénom si le
 * commerce le demande, on rejoint, on part.
 *
 * Une seule information compte à l'écran : combien de personnes sont
 * devant. Pas de numéro de ticket, pas de temps estimé — deux promesses
 * qu'on ne peut pas tenir honnêtement et qui angoissent plus qu'elles
 * n'aident.
 */

type Phase = 'join' | 'queued' | 'turn' | 'done' | 'closed';

interface Props {
  entryPoint: EntryPoint;
  initialTicket: TicketState | null;
  source: 'qr' | 'nfc' | 'appclip' | 'link';
  vapidPublicKey: string | null;
  activityLabel: string | null;
}

function phaseFor(ticket: TicketState | null): Phase {
  if (!ticket) return 'join';
  const status = ticket.entry.status;
  if (status === 'completed') return 'done';
  if (status === 'serving' || status === 'next') return 'turn';
  if (status === 'cancelled' || status === 'expired' || status === 'skipped') return 'closed';
  if (status === 'absent') return 'closed';
  return ticket.entry.peopleAhead === 0 ? 'turn' : 'queued';
}

export function ClientExperience({
  entryPoint, initialTicket, source, vapidPublicKey, activityLabel,
}: Props) {
  const [ticket, setTicket] = useState<TicketState | null>(initialTicket);
  const [waitingCount, setWaitingCount] = useState(entryPoint.queue?.waitingCount ?? 0);
  const [servingCount, setServingCount] = useState(0);
  const [name, setName] = useState('');
  const [staffId, setStaffId] = useState<string | null>(entryPoint.plate?.staffId ?? null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const phase = phaseFor(ticket);
  const organizationId = entryPoint.organization.id;
  const queueId = ticket?.queue.id ?? entryPoint.queue?.id ?? null;
  const entryId = ticket?.entry.id ?? null;

  /* ---------------------------------------------------------------
     Synchronisation
     --------------------------------------------------------------- */

  const refetch = useCallback(async () => {
    try {
      const params = new URLSearchParams({ organizationId });
      if (entryId) params.set('entryId', entryId);
      const response = await fetch(`/api/client/ticket?${params}`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as { ok: boolean; data: { ticket: TicketState | null } };
      if (payload.ok) {
        setTicket(payload.data.ticket);
        if (payload.data.ticket) setWaitingCount(payload.data.ticket.queue.waiting);
      }
    } catch {
      /* hors ligne : on garde le dernier état connu à l'écran */
    }
  }, [organizationId, entryId]);

  const applyState = useCallback(
    (state: PublicQueueState) => {
      setWaitingCount(state.waiting);
      setServingCount(state.serving);
      setTicket((current) => {
        if (!current) return current;
        const mine = state.entries.find((e) => e.id === current.entry.id);
        if (mine) {
          if (
            mine.ahead === current.entry.peopleAhead &&
            mine.status === current.entry.status
          ) {
            return current;
          }
          return {
            ...current,
            entry: { ...current.entry, peopleAhead: mine.ahead, status: mine.status },
            queue: { ...current.queue, status: state.status, waiting: state.waiting },
          };
        }
        // Le ticket a quitté la file active : on recharge pour obtenir le
        // statut exact et, le cas échéant, le lien d'avis Google.
        const closed = state.closedEntries.find((e) => e.id === current.entry.id);
        if (closed) void refetch();
        return current;
      });
    },
    [refetch],
  );

  const { connection } = useQueueRealtime({
    queueId,
    enabled: Boolean(queueId),
    onState: applyState,
    onTicketEvent: (event) => {
      if (event.entryId === entryId) void refetch();
    },
    onResync: refetch,
  });

  /* ---------------------------------------------------------------
     Actions
     --------------------------------------------------------------- */

  const join = useCallback(() => {
    setError(null);
    setBusy(true);
    startTransition(async () => {
      try {
        const response = await fetch('/api/client/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: entryPoint.slug,
            name: name.trim() || null,
            staffId,
            serviceId,
            source,
          }),
        });
        const payload = (await response.json()) as
          | { ok: true; data: { entry: { id: string } } }
          | { ok: false; error: string };

        if (!payload.ok) {
          setError(payload.error);
          return;
        }
        await refetch();
      } catch {
        setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
      } finally {
        setBusy(false);
      }
    });
  }, [entryPoint.slug, name, staffId, serviceId, source, refetch]);

  const act = useCallback(
    (action: 'leave' | 'returning' | 'present') => {
      if (!entryId) return;
      setError(null);
      setBusy(true);
      startTransition(async () => {
        try {
          const response = await fetch('/api/client/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizationId, entryId, action }),
          });
          const payload = (await response.json()) as
            | { ok: true; data: { ticket: TicketState | null } }
            | { ok: false; error: string };

          if (!payload.ok) {
            setError(payload.error);
            return;
          }
          setTicket(payload.data.ticket);
          if (action === 'leave') setTicket(null);
        } catch {
          setError("L'action n'a pas pu être enregistrée. Réessayez.");
        } finally {
          setBusy(false);
        }
      });
    },
    [entryId, organizationId],
  );

  /* ---------------------------------------------------------------
     Rendu
     --------------------------------------------------------------- */

  const locationName = ticket?.location.name ?? entryPoint.location.name;
  const subtitle = [
    activityLabel,
    entryPoint.location.city,
  ].filter(Boolean).join(' · ');

  return (
    <div className={styles.stage}>
      <Header
        name={locationName}
        subtitle={subtitle}
        logoUrl={entryPoint.location.logoUrl}
        connection={connection}
        queueStatus={ticket?.queue.status ?? entryPoint.queue?.status ?? 'closed'}
        inQueue={phase === 'queued' || phase === 'turn'}
      />

      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {phase === 'join' && (
        <JoinPanel
          entryPoint={entryPoint}
          waitingCount={waitingCount}
          name={name}
          onName={setName}
          staffId={staffId}
          onStaff={setStaffId}
          serviceId={serviceId}
          onService={setServiceId}
          onJoin={join}
          busy={busy || pending}
        />
      )}

      {(phase === 'queued' || phase === 'turn') && ticket && (
        <QueuedPanel
          ticket={ticket}
          entryPoint={entryPoint}
          phase={phase}
          busy={busy || pending}
          servingCount={servingCount}
          vapidPublicKey={vapidPublicKey}
          onAction={act}
        />
      )}

      {phase === 'done' && ticket && <DonePanel ticket={ticket} onRejoin={() => setTicket(null)} />}

      {phase === 'closed' && ticket && (
        <ClosedPanel ticket={ticket} onRejoin={() => setTicket(null)} />
      )}
    </div>
  );
}

/* ==================================================================
   En-tête : identité du commerce + état de la connexion
   ================================================================== */

function Header({
  name, subtitle, logoUrl, connection, queueStatus, inQueue,
}: {
  name: string;
  subtitle: string;
  logoUrl: string | null;
  connection: 'connecting' | 'live' | 'polling' | 'offline';
  queueStatus: string;
  inQueue: boolean;
}) {
  const label =
    connection === 'live' ? 'En direct'
    : connection === 'offline' ? 'Hors ligne'
    : connection === 'polling' ? 'Reconnexion…'
    : 'Connexion…';

  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className={styles.logo} />
        ) : (
          <span className={styles.logoFallback} aria-hidden="true">{initials(name)}</span>
        )}
        <div className={styles.identityText}>
          <h1 className={styles.placeName}>{name}</h1>
          {subtitle && <p className="t-micro t-faint">{subtitle}</p>}
        </div>
      </div>

      <div className={styles.status} title={label}>
        <span
          className={
            connection === 'live' && inQueue ? 'pip pip--live'
            : connection === 'offline' ? 'pip pip--off'
            : 'pip pip--warn'
          }
        />
        <span className="t-micro t-faint">{inQueue ? label : queueLabel(queueStatus)}</span>
      </div>
    </header>
  );
}

function queueLabel(status: string): string {
  if (status === 'open') return 'File ouverte';
  if (status === 'paused') return 'En pause';
  return 'File fermée';
}

/* ==================================================================
   Écran 1 — rejoindre
   ================================================================== */

function JoinPanel({
  entryPoint, waitingCount, name, onName, staffId, onStaff,
  serviceId, onService, onJoin, busy,
}: {
  entryPoint: EntryPoint;
  waitingCount: number;
  name: string;
  onName: (v: string) => void;
  staffId: string | null;
  onStaff: (v: string | null) => void;
  serviceId: string | null;
  onService: (v: string | null) => void;
  onJoin: () => void;
  busy: boolean;
}) {
  const queue = entryPoint.queue;
  const closed = !queue || queue.status !== 'open';
  const askName = queue?.askClientName ?? true;
  const nameRequired = queue?.clientNameRequired ?? false;
  // Une plaque dédiée à un professionnel impose déjà le choix.
  const lockedStaff = Boolean(entryPoint.plate?.staffId);
  const showStaff =
    !lockedStaff &&
    (queue?.allowStaffChoice || queue?.mode === 'per_staff') &&
    entryPoint.staff.length > 0;
  const showServices = queue?.allowServiceChoice && entryPoint.services.length > 0;

  return (
    <div className={styles.panel}>
      <section className={styles.countBlock}>
        <span className="grain" aria-hidden="true" />
        <FlapNumber value={waitingCount} size="clamp(4.5rem, 2.5rem + 13vw, 7.5rem)" />
        <p className={styles.countLabel}>{waitingCount === 1 ? 'personne dans la file' : 'personnes dans la file'}</p>
        {waitingCount > 0 && (
          <div className={styles.preview}>
            <RangPreview count={waitingCount} />
          </div>
        )}
      </section>

      {closed ? (
        <div className="banner banner--warn">
          <span>
            {queue?.status === 'paused'
              ? queue.pauseReason
                ? `File en pause : ${queue.pauseReason}`
                : 'La file est momentanément en pause. Réessayez dans quelques minutes.'
              : "La file est fermée pour le moment. Présentez-vous au comptoir."}
          </span>
        </div>
      ) : (
        <div className="stack g4">
          {askName && (
            <div className="field">
              <label htmlFor="prenom">
                Prénom {nameRequired ? '' : '(facultatif)'}
              </label>
              <input
                id="prenom"
                className="input"
                type="text"
                inputMode="text"
                autoComplete="given-name"
                autoCapitalize="words"
                enterKeyHint="go"
                maxLength={40}
                placeholder="Pour vous appeler"
                value={name}
                onChange={(e) => onName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (!nameRequired || name.trim())) onJoin();
                }}
              />
            </div>
          )}

          {showStaff && (
            <div className="field">
              <label>Avec qui ?</label>
              <div className={styles.chooser}>
                <button
                  type="button"
                  className={`${styles.choice} ${staffId === null ? styles.choiceActive : ''}`}
                  onClick={() => onStaff(null)}
                  aria-pressed={staffId === null}
                >
                  <span className={styles.choiceName}>Peu importe</span>
                  <span className="t-micro t-faint">Le prochain disponible</span>
                </button>
                {entryPoint.staff.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className={`${styles.choice} ${staffId === member.id ? styles.choiceActive : ''}`}
                    onClick={() => onStaff(member.id)}
                    aria-pressed={staffId === member.id}
                    data-accent={member.accent}
                  >
                    <span className={styles.choiceName}>{member.name}</span>
                    <span className="t-micro t-faint">
                      {member.onBreak
                        ? 'En pause'
                        : member.waiting === 0
                          ? 'Disponible'
                          : `${member.waiting} en attente`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {showServices && (
            <div className="field">
              <label htmlFor="prestation">Prestation</label>
              <select
                id="prestation"
                className="select"
                value={serviceId ?? ''}
                onChange={(e) => onService(e.target.value || null)}
              >
                <option value="">Je verrai sur place</option>
                {entryPoint.services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                    {service.durationMinutes ? ` — ${service.durationMinutes} min` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            className="btn btn--signal btn--hero"
            onClick={onJoin}
            disabled={busy || (nameRequired && !name.trim())}
          >
            {busy ? 'Un instant…' : 'Rejoindre la file'}
          </button>

          <p className={`t-micro t-faint ${styles.reassure}`}>
            Pas de compte, pas d&apos;application à installer, pas de SMS.
            <br />
            Vous pourrez partir et revenir quand ce sera votre tour.
          </p>
        </div>
      )}
    </div>
  );
}

/** Aperçu statique de la file sur l'écran d'accueil. */
function RangPreview({ count }: { count: number }) {
  const slats = Math.min(count, 6);
  return (
    <div className="rang" aria-hidden="true">
      {Array.from({ length: slats }, (_, i) => (
        <div key={i} className="slat" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

/* ==================================================================
   Écran 2 — dans la file
   ================================================================== */

function QueuedPanel({
  ticket, entryPoint, phase, busy, servingCount, vapidPublicKey, onAction,
}: {
  ticket: TicketState;
  entryPoint: EntryPoint;
  phase: Phase;
  busy: boolean;
  servingCount: number;
  vapidPublicKey: string | null;
  onAction: (action: 'leave' | 'returning' | 'present') => void;
}) {
  const ahead = ticket.entry.peopleAhead;
  const isTurn = phase === 'turn';
  const isReturning = ticket.entry.status === 'returning';
  const [confirmLeave, setConfirmLeave] = useState(false);

  const mapsHref = useMemo(
    () => directionsUrl({ ...ticket.location, name: ticket.location.name }),
    [ticket.location],
  );

  return (
    <div className={styles.panel}>
      <section className={`${styles.countBlock} ${isTurn ? styles.countBlockTurn : ''}`}>
        <span className="grain" aria-hidden="true" />
        {isTurn ? (
          <>
            <p className={styles.turnKicker}>C&apos;est</p>
            <h2 className={styles.turnTitle}>votre tour</h2>
            <p className={styles.countLabel}>Présentez-vous au comptoir</p>
          </>
        ) : (
          <>
            <FlapNumber
              value={ahead}
              label={`${ahead} ${peopleAheadUnit(ahead)}`}
            />
            <p className={styles.countLabel}>{peopleAheadUnit(ahead)}</p>
          </>
        )}
      </section>

      <Rang
        ahead={ahead}
        selfLabel={ticket.entry.name}
        selfHint={
          isTurn ? 'À vous' : isReturning ? 'Vous revenez' : ticket.entry.staffName ?? 'Votre place'
        }
        isServing={ticket.entry.status === 'serving'}
        headIsServing={servingCount > 0}
      />

      <NotificationPanel
        organizationId={entryPoint.organization.id}
        entryId={ticket.entry.id}
        vapidPublicKey={vapidPublicKey}
      />

      <div className="stack g3">
        {!isTurn && (
          <button
            type="button"
            className={isReturning ? 'btn btn--ghost btn--hero' : 'btn btn--signal btn--hero'}
            onClick={() => onAction('returning')}
            disabled={busy || isReturning}
          >
            {isReturning ? 'Le salon sait que vous revenez' : 'Je suis de retour'}
          </button>
        )}

        {isTurn && (
          <a className="btn btn--signal btn--hero" href={mapsHref} target="_blank" rel="noreferrer">
            Ouvrir l&apos;itinéraire
          </a>
        )}

        <div className={styles.actionRow}>
          <a className="btn btn--ghost" href={mapsHref} target="_blank" rel="noreferrer">
            Itinéraire
          </a>
          {ticket.location.phone && (
            <a className="btn btn--ghost" href={`tel:${ticket.location.phone}`}>
              Appeler
            </a>
          )}
          {entryPoint.settings.allowClientLeave && (
            confirmLeave ? (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => onAction('leave')}
                disabled={busy}
              >
                Confirmer
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setConfirmLeave(true)}
                disabled={busy}
              >
                Quitter la file
              </button>
            )
          )}
        </div>
        {confirmLeave && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setConfirmLeave(false)}>
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

/* ==================================================================
   Notifications — sans jamais promettre l'impossible
   ================================================================== */

function NotificationPanel({
  organizationId, entryId, vapidPublicKey,
}: {
  organizationId: string;
  entryId: string;
  vapidPublicKey: string | null;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'on' | 'denied' | 'unavailable'>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;

    if (!vapidPublicKey) {
      setState('unavailable');
      setReason('not_configured');
      return;
    }
    const support = detectPushSupport();
    if (!support.supported) {
      setState('unavailable');
      setReason(support.reason);
      return;
    }
    const permission = currentPermission();
    if (permission === 'granted') setState('on');
    else if (permission === 'denied') setState('denied');
  }, [vapidPublicKey]);

  const enable = useCallback(async () => {
    if (!vapidPublicKey) return;
    setState('working');
    const outcome = await subscribeToPush({ organizationId, vapidPublicKey, entryId });
    if (outcome.status === 'subscribed') setState('on');
    else if (outcome.status === 'denied') setState('denied');
    else {
      setState('unavailable');
      setReason(outcome.status === 'unsupported' ? outcome.reason : outcome.message);
    }
  }, [organizationId, entryId, vapidPublicKey]);

  if (state === 'on') {
    return (
      <div className={styles.notice}>
        <BellIcon on />
        <div>
          <p className={styles.noticeTitle}>Vous serez prévenu</p>
          <p className="t-micro t-faint">
            Une notification arrivera quand il ne restera plus qu&apos;une personne devant vous.
          </p>
        </div>
      </div>
    );
  }

  // On ne ment jamais : si le canal n'est pas disponible sur cet
  // appareil, on le dit et on explique quoi faire à la place.
  if (state === 'unavailable' || state === 'denied') {
    return (
      <div className={styles.notice}>
        <BellIcon on={false} />
        <div>
          <p className={styles.noticeTitle}>
            {state === 'denied' ? 'Notifications refusées' : 'Notifications indisponibles ici'}
          </p>
          <p className="t-micro t-faint">
            {reason === 'ios_needs_pwa'
              ? "Sur iPhone, approchez votre téléphone de la plaque : l'App Clip vous préviendra. Sinon, gardez cette page ouverte."
              : state === 'denied'
                ? 'Gardez cette page ouverte : votre position se met à jour toute seule.'
                : 'Gardez un œil sur cette page : votre position se met à jour toute seule.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className={styles.noticeAction} onClick={enable} disabled={state === 'working'}>
      <BellIcon on={false} />
      <div>
        <p className={styles.noticeTitle}>
          {state === 'working' ? 'Activation…' : 'Me prévenir quand c’est mon tour'}
        </p>
        <p className="t-micro t-faint">Vous pouvez partir, on vous rappelle.</p>
      </div>
      <ChevronIcon />
    </button>
  );
}

/* ==================================================================
   Écran 3 — fin de passage + avis Google
   ================================================================== */

function DonePanel({ ticket, onRejoin }: { ticket: TicketState; onRejoin: () => void }) {
  const reviewUrl = ticket.location.googleReviewUrl;

  return (
    <div className={`${styles.panel} fade-in`}>
      <section className={styles.doneBlock}>
        <span className="grain" aria-hidden="true" />
        <CheckMark />
        <h2 className="t-display">Merci pour votre visite</h2>
        <p className="t-body t-muted">{ticket.location.name}</p>
      </section>

      {reviewUrl && (
        <a
          className="btn btn--signal btn--hero"
          href={reviewUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Laisser un avis Google
        </a>
      )}

      <button type="button" className="btn btn--quiet" onClick={onRejoin}>
        Revenir plus tard
      </button>
    </div>
  );
}

function ClosedPanel({ ticket, onRejoin }: { ticket: TicketState; onRejoin: () => void }) {
  const status = ticket.entry.status;
  const message =
    status === 'absent' ? "Vous avez été noté absent. Présentez-vous au comptoir pour reprendre votre place."
    : status === 'skipped' ? 'Vous avez été retiré de la file par le professionnel.'
    : status === 'expired' ? 'Votre place a expiré.'
    : 'Vous avez quitté la file.';

  return (
    <div className={`${styles.panel} fade-in`}>
      <section className={styles.doneBlock}>
        <span className="grain" aria-hidden="true" />
        <h2 className="t-title">{message}</h2>
        <p className="t-body t-muted">{ticket.location.name}</p>
      </section>
      <button type="button" className="btn btn--signal btn--hero" onClick={onRejoin}>
        Rejoindre à nouveau
      </button>
    </div>
  );
}

/* ==================================================================
   Pictogrammes — dessinés à la main, dans la géométrie du produit
   ================================================================== */

function BellIcon({ on }: { on: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={styles.icon}>
      <path
        d="M5 8a5 5 0 0 1 10 0v3l1.4 2.2a.6.6 0 0 1-.5.9H4.1a.6.6 0 0 1-.5-.9L5 11V8Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
        fill={on ? 'currentColor' : 'none'} fillOpacity={on ? 0.16 : 0}
      />
      <path d="M8.2 16.6a2 2 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className={styles.chevron}>
      <path d="m7 4 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true" className={styles.check}>
      <rect x="2" y="2" width="52" height="52" rx="16" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path
        d="m17 28.5 7.5 7.5L39 21"
        stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
