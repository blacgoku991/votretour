'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Rang } from '@/components/Rang';
import { FlapNumber } from '@/components/FlapNumber';
import { useQueueRealtime } from '@/hooks/useQueueRealtime';
import { detectPushSupport, subscribeToPush, currentPermission } from '@/lib/push-client';
import { peopleAheadUnit } from '@/lib/copy';
import { directionsUrl, initials } from '@/lib/format';
import type { EntryPoint, PublicQueueState, TicketState } from '@/lib/types';
import { TurnCurtain } from './TurnCurtain';
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
  eventId?: string | null;
  eventTheme?: {
    name: string;
    heroTitle: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
    accentHex: string;
    rulesText: string | null;
    qrLabel: string | null;
  } | null;
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
  entryPoint,
  initialTicket,
  source,
  vapidPublicKey,
  activityLabel,
  eventId = null,
  eventTheme = null,
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
            eventId,
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
  }, [entryPoint.slug, name, staffId, serviceId, source, eventId, refetch]);

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

  // La latte fantôme « Votre place » ne se déplie qu'après un vrai
  // passage par l'écran « Rejoindre » dans cette session (pas au
  // rechargement d'une place déjà prise).
  const sawJoin = useRef(phase === 'join');
  if (phase === 'join') sawJoin.current = true;

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
        logoUrl={eventTheme?.logoUrl ?? entryPoint.location.logoUrl}
        connection={connection}
        queueStatus={ticket?.queue.status ?? entryPoint.queue?.status ?? 'closed'}
        inQueue={phase === 'queued' || phase === 'turn'}
      />

      {eventTheme && (phase === 'join' || phase === 'queued') && (
        <EventWelcome theme={eventTheme} />
      )}

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
          unfold={sawJoin.current}
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
   En-tête : identité du commerce, puis l'état de la file (ou de la
   connexion, une fois dans la file) SOUS le nom.
   ================================================================== */

type Connection = 'connecting' | 'live' | 'polling' | 'offline';

function Header({
  name, subtitle, logoUrl, connection, queueStatus, inQueue,
}: {
  name: string;
  subtitle: string;
  logoUrl: string | null;
  connection: Connection;
  queueStatus: string;
  inQueue: boolean;
}) {
  const connectionLabel =
    connection === 'live' ? 'En direct'
    : connection === 'offline' ? 'Hors ligne'
    : connection === 'polling' ? 'Reconnexion…'
    : 'Connexion…';

  // Avant de rejoindre : l'état de la FILE (jade ouverte, cuivre en pause,
  // éteinte fermée). Dans la file : l'état de la CONNEXION.
  const pip = inQueue
    ? connection === 'live' ? 'pip pip--live'
      : connection === 'offline' ? 'pip pip--off'
      : 'pip pip--warn'
    : queueStatus === 'open' ? 'pip pip--live'
      : queueStatus === 'paused' ? 'pip pip--warn'
      : 'pip pip--off';
  const label = inQueue ? connectionLabel : queueLabel(queueStatus);

  return (
    <header className={styles.header}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className={styles.logo} />
      ) : (
        <span className={styles.logoFallback} aria-hidden="true">{initials(name)}</span>
      )}
      <div className={styles.identityText}>
        <h1 className={styles.placeName}>{name}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        <p className={styles.status}>
          <span className={pip} aria-hidden="true" />
          <span>{label}</span>
        </p>
      </div>
    </header>
  );
}

function queueLabel(status: string): string {
  if (status === 'open') return 'File ouverte';
  if (status === 'paused') return 'En pause';
  return 'File fermée';
}

/** « personne » / « personnes » + le reste, sur deux lignes à côté du volet. */
function CountUnit({ count, rest }: { count: number; rest: string }) {
  return (
    <p className={styles.countUnit} aria-hidden="true">
      <span>{count <= 1 ? 'personne' : 'personnes'}</span>
      <span>{rest}</span>
    </p>
  );
}

/** Le repère du comptoir en tête du rail : la sortie de la file. */
function CounterLine() {
  return (
    <div className={styles.counter} aria-hidden="true">
      <span className={styles.counterLabel}>Comptoir</span>
    </div>
  );
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

  const unit = waitingCount <= 1 ? 'personne dans la file' : 'personnes dans la file';
  const typed = name.trim();

  return (
    <div className={styles.panel}>
      <section className={styles.count} aria-label="État de la file">
        <div className={styles.countRow}>
          <FlapNumber
            value={waitingCount}
            size="clamp(5rem, 3rem + 14vw, 7.5rem)"
            label={`${waitingCount} ${unit}`}
          />
          <CountUnit count={waitingCount} rest="dans la file" />
        </div>
        {waitingCount === 0 && !closed && (
          <p className={styles.countNote}>Vous serez le prochain.</p>
        )}
      </section>

      {/* L'aperçu du Rang, couché en légère perspective (statique) : la
          file telle qu'elle est, et au bout, votre place. */}
      <div className={`${styles.preview} ${closed ? styles.previewOff : ''}`} aria-hidden="true">
        <div className={styles.previewPlane}>
          <CounterLine />
          <Rang
            ahead={waitingCount}
            ghostSelf
            relief
            maxSlats={4}
            selfLabel={typed || 'Votre place'}
            selfHint={typed ? 'Votre place' : null}
          />
          {/* Derrière vous, les places marquées au sol, encore libres. */}
          <div className={styles.floorPlaces}>
            {Array.from({ length: Math.max(1, 4 - Math.min(waitingCount, 4)) }, (_, i) => (
              <span key={i} className={styles.floorPlace} />
            ))}
          </div>
        </div>
      </div>

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
        <div className={styles.form}>
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
                placeholder="Votre prénom"
                aria-describedby="prenom-aide"
                value={name}
                onChange={(e) => onName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (!nameRequired || name.trim())) onJoin();
                }}
              />
              <p id="prenom-aide" className="hint">Pour vous appeler au comptoir</p>
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
                  <span className={styles.choiceMeta}>Le prochain disponible</span>
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
                    <span className={styles.choiceMeta}>
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

          {/* À portée de pouce : collé en bas quand le contenu dépasse. */}
          <div className={styles.dock}>
            <button
              type="button"
              className="btn btn--signal btn--hero"
              onClick={onJoin}
              disabled={busy || (nameRequired && !name.trim())}
            >
              {busy ? 'Un instant…' : 'Rejoindre la file'}
            </button>
          </div>

          <p className={styles.reassure}>
            Pas de compte, pas d&apos;application, pas de SMS.
          </p>
        </div>
      )}
    </div>
  );
}

function EventWelcome({
  theme,
}: {
  theme: NonNullable<Props['eventTheme']>;
}) {
  // Fonds en aplat : la couverture éventuelle est voilée par un calque
  // uni (::before), jamais par un dégradé.
  const style = {
    '--event-accent': /^#[0-9A-Fa-f]{6}$/.test(theme.accentHex)
      ? theme.accentHex
      : '#FF4B1F',
    ...(theme.coverUrl
      ? { '--event-cover': 'url(' + JSON.stringify(theme.coverUrl) + ')' }
      : {}),
  } as CSSProperties;

  return (
    <section
      className={`${styles.eventWelcome} ${theme.coverUrl ? styles.eventWelcomeCover : ''}`}
      style={style}
    >
      <div className={styles.eventWelcomeHead}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {theme.logoUrl && <img src={theme.logoUrl} alt="" />}
        <div>
          <span>Événement Rangvia</span>
          <h2>{theme.heroTitle || theme.name}</h2>
        </div>
      </div>

      {theme.rulesText && <p>{theme.rulesText}</p>}

      <div className={styles.eventWelcomeFoot}>
        <i aria-hidden="true" />
        <span>{theme.qrLabel || 'Vous êtes sur la file officielle de cet événement.'}</span>
      </div>
    </section>
  );
}

/* ==================================================================
   Écran 2 — dans la file (et le rideau « C'est votre tour »)
   ================================================================== */

function QueuedPanel({
  ticket, entryPoint, phase, busy, servingCount, vapidPublicKey, onAction, unfold,
}: {
  ticket: TicketState;
  entryPoint: EntryPoint;
  phase: Phase;
  busy: boolean;
  servingCount: number;
  vapidPublicKey: string | null;
  onAction: (action: 'leave' | 'returning' | 'present') => void;
  unfold: boolean;
}) {
  const ahead = ticket.entry.peopleAhead;
  const isTurn = phase === 'turn';
  const isReturning = ticket.entry.status === 'returning';
  const [confirmLeave, setConfirmLeave] = useState(false);
  const rangRef = useRef<HTMLDivElement>(null);
  // Le rideau ne part de la latte que si on l'a vue avant : au
  // rechargement directement sur « C'est votre tour », il est déjà là.
  const sawQueued = useRef(!isTurn);
  if (!isTurn) sawQueued.current = true;

  const mapsHref = useMemo(
    () => directionsUrl({ ...ticket.location, name: ticket.location.name }),
    [ticket.location],
  );

  // Le compteur reste sur la dernière valeur utile (≥ 1) pendant que le
  // rideau recouvre l'écran : pas de « 0 » qui clignote dessous.
  const shown = Math.max(1, ahead);

  return (
    <div className={styles.panel}>
      <div className={styles.queued} inert={isTurn}>
        <section className={styles.count} aria-label="Votre position">
          <div className={styles.countRow}>
            <FlapNumber
              value={shown}
              size="7.5rem"
              label={`${shown} ${peopleAheadUnit(shown)}`}
            />
            <CountUnit count={shown} rest="devant vous" />
          </div>
        </section>

        <div ref={rangRef} className={`${styles.rangBlock} ${unfold ? styles.unfold : ''}`}>
          <CounterLine />
          <Rang
            haptics
            relief
            ahead={ahead}
            selfLabel={ticket.entry.name}
            selfHint={
              isTurn ? 'À vous' : isReturning ? 'Vous revenez' : ticket.entry.staffName ?? 'Votre place'
            }
            isServing={ticket.entry.status === 'serving'}
            headIsServing={servingCount > 0}
          />
        </div>

        {/* Sous le Rang : son apparition ne fait pas sauter la file. */}
        {ahead === 1 && !isTurn && (
          <div className={`banner banner--warn ${styles.soon}`} role="status">
            <span className={styles.soonMark} aria-hidden="true" />
            <span>Plus qu&apos;une personne devant vous. Commencez à revenir.</span>
          </div>
        )}

        <NotificationPanel
          organizationId={entryPoint.organization.id}
          entryId={ticket.entry.id}
          vapidPublicKey={vapidPublicKey}
        />

        <div className={styles.actions}>
          <button
            type="button"
            className={isReturning ? 'btn btn--ghost btn--hero' : 'btn btn--signal btn--hero'}
            onClick={() => onAction('returning')}
            disabled={busy || isReturning}
          >
            {isReturning ? 'Le salon sait que vous revenez' : 'Je suis de retour'}
          </button>

          <div className={styles.actionRow}>
            <a className="btn btn--ghost" href={mapsHref} target="_blank" rel="noreferrer">
              <PinIcon />
              Itinéraire
            </a>
            {ticket.location.phone && (
              <a className="btn btn--ghost" href={`tel:${ticket.location.phone}`}>
                <PhoneIcon />
                Appeler
              </a>
            )}
          </div>

          {entryPoint.settings.allowClientLeave && (
            <LeaveControl
              confirm={confirmLeave}
              onAsk={() => setConfirmLeave(true)}
              onCancel={() => setConfirmLeave(false)}
              onLeave={() => onAction('leave')}
              busy={busy}
            />
          )}
        </div>
      </div>

      {isTurn && (
        <TurnCurtain
          originRef={rangRef}
          animate={sawQueued.current}
          locationName={ticket.location.name}
          clientName={ticket.entry.name}
        >
          <a className="btn btn--solid btn--hero" href={mapsHref} target="_blank" rel="noreferrer">
            <PinIcon />
            Ouvrir l&apos;itinéraire
          </a>
          <div className={styles.curtainRow}>
            {ticket.location.phone && (
              <a className="btn btn--solid" href={`tel:${ticket.location.phone}`}>
                <PhoneIcon />
                Appeler
              </a>
            )}
            {entryPoint.settings.allowClientLeave && (
              <LeaveControl
                confirm={confirmLeave}
                onAsk={() => setConfirmLeave(true)}
                onCancel={() => setConfirmLeave(false)}
                onLeave={() => onAction('leave')}
                busy={busy}
                tone="ink"
              />
            )}
          </div>
        </TurnCurtain>
      )}
    </div>
  );
}

/** « Quitter la file », toujours avec une confirmation en ligne. */
function LeaveControl({
  confirm, onAsk, onCancel, onLeave, busy, tone = 'surface',
}: {
  confirm: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onLeave: () => void;
  busy: boolean;
  tone?: 'surface' | 'ink';
}) {
  const ink = tone === 'ink';
  if (!confirm) {
    return (
      <button
        type="button"
        className={`btn ${ink ? styles.inkQuiet : 'btn--quiet'} ${styles.leave}`}
        onClick={onAsk}
        disabled={busy}
      >
        Quitter la file
      </button>
    );
  }
  return (
    <div className={`${styles.confirm} ${ink ? styles.confirmInk : ''}`} role="group" aria-label="Quitter la file">
      <p className={styles.confirmText}>Quitter la file ? Votre place sera libérée.</p>
      <div className={styles.confirmRow}>
        <button type="button" className={`btn ${ink ? styles.inkQuiet : 'btn--quiet'}`} onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className={`btn ${ink ? styles.inkDanger : 'btn--danger'}`}
          onClick={onLeave}
          disabled={busy}
        >
          Confirmer
        </button>
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
        <span className={`${styles.noticeIcon} ${styles.noticeIconOn}`}><BellIcon on /></span>
        <div className={styles.noticeText}>
          <p className={styles.noticeTitle}>Vous serez prévenu</p>
          <p className={styles.noticeBody}>
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
        <span className={styles.noticeIcon}><BellIcon on={false} /></span>
        <div className={styles.noticeText}>
          <p className={styles.noticeTitle}>
            {state === 'denied' ? 'Notifications refusées' : 'Notifications indisponibles ici'}
          </p>
          <p className={styles.noticeBody}>
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
      <span className={`${styles.noticeIcon} ${styles.noticeIconOn}`}><BellIcon on={false} /></span>
      <div className={styles.noticeText}>
        <p className={styles.noticeTitle}>
          {state === 'working' ? 'Activation…' : 'Me prévenir quand c’est mon tour'}
        </p>
        <p className={styles.noticeBody}>Vous pouvez partir, on vous rappelle.</p>
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
    <div className={styles.panel}>
      <div className={styles.doneGroup}>
        {/* Le mini-rail : votre latte passe le comptoir, une fois. */}
        <div className={styles.doneRail} aria-hidden="true">
          <CounterLine />
          <div className={styles.doneTrack}>
            <span className={styles.doneSlot}>
              <CheckIcon />
              <span>Passage terminé</span>
            </span>
            <span className={styles.doneSlat}>
              <span className={styles.doneDot} />
              {ticket.entry.name || 'Vous'}
            </span>
          </div>
        </div>

        <section className={styles.doneText}>
          <h2 className="t-display">Merci pour votre visite</h2>
          <p className={styles.doneName}>{ticket.location.name}</p>
        </section>
      </div>

      <div className={styles.bottom}>
        {reviewUrl && (
          <a
            className="btn btn--signal btn--hero"
            href={reviewUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            <StarIcon />
            Laisser un avis Google
          </a>
        )}

        <button type="button" className="btn btn--quiet btn--block" onClick={onRejoin}>
          Revenir dans la file
        </button>
      </div>
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
  const kicker =
    status === 'absent' ? 'Absent'
    : status === 'skipped' ? 'Retiré de la file'
    : status === 'expired' ? 'Place expirée'
    : 'File quittée';

  return (
    <div className={styles.panel}>
      <section className={styles.closed}>
        <p className="t-label">{kicker}</p>
        <h2 className={styles.closedTitle}>{message}</h2>
        <p className={styles.doneName}>{ticket.location.name}</p>
      </section>
      <div className={styles.bottom}>
        <button type="button" className="btn btn--signal btn--hero" onClick={onRejoin}>
          Rejoindre à nouveau
        </button>
      </div>
    </div>
  );
}

/* ==================================================================
   Pictogrammes — dessinés à la main, dans la géométrie du produit
   ================================================================== */

function BellIcon({ on }: { on: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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

function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 16s5-4.6 5-8.6A5 5 0 0 0 4 7.4C4 11.4 9 16 9 16Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
      />
      <circle cx="9" cy="7.4" r="1.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M6.2 2.8 4.4 3a1.6 1.6 0 0 0-1.4 1.8c.6 5.2 4.9 9.6 10.2 10.2a1.6 1.6 0 0 0 1.8-1.4l.2-1.8a1 1 0 0 0-.7-1l-2.2-.8a1 1 0 0 0-1.1.3l-.8.9a8.2 8.2 0 0 1-3.8-3.8l.9-.8a1 1 0 0 0 .3-1.1l-.8-2.2a1 1 0 0 0-1-.7Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="m10 2.8 2.2 4.6 5 .6-3.7 3.5.9 5-4.4-2.4-4.4 2.4.9-5L2.8 8l5-.6L10 2.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="m4 9.4 3.2 3.2L14 5.6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
