'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useQueueRealtime } from '@/hooks/useQueueRealtime';
import { getProfile, isLegacyProfile } from '@/lib/profiles';
import type { ProfileEntryPoint, ProfileTicketState, QueueProfile } from '@/lib/profiles/types';
import type { PublicQueueState } from '@/lib/types';
import { ClientExperience, ClosedPanel, DonePanel, Header, type StaffGate } from '../ClientExperience';
import { buildDetails, INITIAL_JOIN_VALUES, type JoinField, type JoinOptions, type JoinValues } from './JoinFields';
import { ProfileJoin } from './ProfileJoin';
import { profilePhase, type PublicEntryLite } from './phase';
import { typo, type ActOutcome, type ClientAction, type TicketViewProps } from './shared';
import { WorkshopTicket, WorkshopDone, WorkshopClosed, Unfollowed } from './WorkshopTicket';
import { TableTicket, TableDone } from './TableTicket';
import { DeskTicket } from './DeskTicket';
import { RetailTicket } from './RetailTicket';
import clientStyles from '../client.module.css';

/**
 * L'OSSATURE DES ÉCRANS À PROFIL — synchronisation, temps réel, actions
 * et phases ; le dessin est délégué à l'écran du métier.
 *
 * Le temps réel est EXACTEMENT celui des barbiers (`ClientExperience`) :
 * même canal Broadcast sans donnée personnelle, même repli par
 * interrogation, même resynchronisation au retour de veille. Deux ajouts :
 *
 *  - un changement de STATUT relit le ticket (`ticket_state`) : l'étape,
 *    le guichet (« Guichet 4 ») et la promesse n'existent pas dans la
 *    diffusion publique, par construction ;
 *  - un changement d'ÉTAPE sans changement de statut (devis envoyé en
 *    plein diagnostic) arrive par l'événement `updated` du ticket, que
 *    `onTicketEvent` traite comme tous les autres : relire.
 */

interface Props {
  entryPoint: ProfileEntryPoint;
  initialTicket: ProfileTicketState | null;
  initialPublic: PublicEntryLite[] | null;
  graceMinutes: number | null;
  source: 'qr' | 'nfc' | 'appclip' | 'link';
  staffGate: StaffGate | null;
  vapidPublicKey: string | null;
  activityLabel: string | null;
  walletSlot: ReactNode;
}

type ActionResponse =
  | { ok: true; data: { ticket: ProfileTicketState | null; entry?: { id: string; status: string } } }
  | { ok: false; error: string; code?: string };

export function ProfileShell({
  entryPoint,
  initialTicket,
  initialPublic,
  graceMinutes,
  source,
  staffGate,
  vapidPublicKey,
  activityLabel,
  walletSlot,
}: Props) {
  const [ticket, setTicket] = useState<ProfileTicketState | null>(initialTicket);
  const [publicEntries, setPublicEntries] = useState<PublicEntryLite[] | null>(initialPublic);
  const [waitingCount, setWaitingCount] = useState(entryPoint.queue?.waitingCount ?? 0);
  const [name, setName] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [values, setValues] = useState<JoinValues>(INITIAL_JOIN_VALUES);
  const [fieldError, setFieldError] = useState<{ field: JoinField; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  /** « Ne plus suivre » : le sujet lâché, pour le dire à l'écran de fin. */
  const [unfollowed, setUnfollowed] = useState<QueueProfile | null>(null);

  const joinProfile = getProfile(entryPoint.queue?.profile).id;
  const profile = ticket?.queue.profile ?? joinProfile;
  const phase = profilePhase(ticket);
  const organizationId = entryPoint.organization.id;
  const queueId = ticket?.queue.id ?? entryPoint.queue?.id ?? null;
  const entryId = ticket?.entry.id ?? null;
  const timeZone = entryPoint.location.timezone || 'Europe/Paris';

  /* ---------------------------------------------------------------
     Synchronisation
     --------------------------------------------------------------- */

  const fetchTicket = useCallback(async (id: string | null): Promise<void> => {
    try {
      const params = new URLSearchParams({ organizationId });
      if (id) params.set('entryId', id);
      const response = await fetch(`/api/client/ticket?${params}`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as { ok: boolean; data: { ticket: ProfileTicketState | null } };
      if (payload.ok) {
        setTicket(payload.data.ticket);
        if (payload.data.ticket) setWaitingCount(payload.data.ticket.queue.waiting);
      }
    } catch {
      /* hors ligne : on garde le dernier état connu à l'écran */
    }
  }, [organizationId]);

  const refetch = useCallback(() => fetchTicket(entryId), [fetchTicket, entryId]);

  const applyState = useCallback(
    (state: PublicQueueState) => {
      setWaitingCount(state.waiting);
      setPublicEntries(state.entries.map(({ id, ahead, status }) => ({ id, ahead, status })));
      setTicket((current) => {
        if (!current) return current;
        const mine = state.entries.find((e) => e.id === current.entry.id);
        if (mine) {
          if (mine.ahead === current.entry.peopleAhead && mine.status === current.entry.status) return current;
          // Un statut qui change (appelé, prêt, servi) : l'étape et le
          // guichet vont avec, et seul `ticket_state` les connaît.
          if (mine.status !== current.entry.status) void refetch();
          return {
            ...current,
            entry: { ...current.entry, peopleAhead: mine.ahead, status: mine.status },
            queue: { ...current.queue, status: state.status, waiting: state.waiting },
          };
        }
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

  const joinOptions: JoinOptions = entryPoint.queue?.publicOptions ?? {};

  const join = useCallback(() => {
    setError(null);
    setFieldError(null);
    const serviceName = entryPoint.services.find((s) => s.id === serviceId)?.name ?? null;
    const built = buildDetails(joinProfile, values, joinOptions, serviceName);
    if (!built.ok) {
      setFieldError({ field: built.field, message: built.message });
      if (built.field === 'registration') document.getElementById('immatriculation')?.focus();
      return;
    }
    setBusy(true);
    startTransition(async () => {
      try {
        const response = await fetch('/api/client/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: entryPoint.slug,
            name: joinOptions.sensitive ? null : name.trim() || null,
            staffId: entryPoint.plate?.staffId ?? null,
            serviceId,
            source,
            eventId: null,
            details: built.details,
          }),
        });
        const payload = (await response.json()) as
          | { ok: true; data: { entry: { id: string } } }
          | { ok: false; error: string };
        if (!payload.ok) {
          setError(typo(payload.error));
          return;
        }
        setUnfollowed(null);
        await fetchTicket(payload.data.entry.id);
      } catch {
        setError('Connexion impossible. Vérifiez votre réseau et réessayez.');
      } finally {
        setBusy(false);
      }
    });
    // joinOptions dérive d'entryPoint : stable pendant la vie de l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPoint, joinProfile, values, serviceId, name, source, fetchTicket]);

  const act = useCallback(
    async (action: ClientAction, quoteN?: number): Promise<ActOutcome> => {
      if (!entryId) return { ok: false, code: null, message: 'Aucun ticket.' };
      setError(null);
      setBusy(true);
      try {
        const response = await fetch('/api/client/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId, entryId, action, ...(quoteN ? { quoteN } : {}) }),
        });
        const payload = (await response.json()) as ActionResponse;
        if (!payload.ok) {
          const message = typo(payload.error);
          const code = payload.code ?? null;
          // Le devis a changé sous les yeux du client : on relit la fiche,
          // et la carte du devis le dit elle-même (pas d'erreur générique).
          if (code === 'quote_changed') await refetch();
          else setError(message);
          return { ok: false, code, message };
        }
        if (action === 'unfollow') {
          // La fiche reste à l'atelier ; ce téléphone ne la suit plus et
          // n'en reçoit plus rien : écran de fin propre.
          setUnfollowed(ticket?.queue.profile ?? profile);
          setTicket(null);
        } else if (action === 'leave') {
          setTicket(null);
        } else {
          setTicket(payload.data.ticket);
        }
        return { ok: true };
      } catch {
        const message = 'L’action n’a pas pu être enregistrée. Réessayez.';
        setError(message);
        return { ok: false, code: null, message };
      } finally {
        setBusy(false);
      }
    },
    [entryId, organizationId, refetch, ticket, profile],
  );

  /* ---------------------------------------------------------------
     Rendu
     --------------------------------------------------------------- */

  // Dépliage et balancement seulement après une vraie inscription dans
  // cette session, pas au rechargement d'un suivi en cours.
  const [sawJoin, setSawJoin] = useState(phase === 'join');
  useEffect(() => {
    if (phase === 'join') setSawJoin(true);
  }, [phase]);

  // Un nouvel écran (inscrit, rendu, clos) repart du haut : le formulaire
  // d'atelier est long, et le suivi ne doit pas s'ouvrir au milieu.
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === phase) return;
    const from = lastPhase.current;
    lastPhase.current = phase;
    // Le rideau recouvre l'écran : inutile de faire défiler dessous.
    if (phase === 'ready' || (from === 'ready' && phase === 'tracking')) return;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [phase]);

  // Le rideau ne se déploie que si l'on a vu le suivi avant lui : au
  // rechargement directement sur « prêt », il est déjà là.
  const [sawTracking, setSawTracking] = useState(phase !== 'ready');
  useEffect(() => {
    if (phase !== 'ready') setSawTracking(true);
  }, [phase]);

  const queueStatus = ticket?.queue.status ?? entryPoint.queue?.status ?? 'closed';
  const locationName = ticket?.location.name ?? entryPoint.location.name;
  const subtitle = [activityLabel, entryPoint.location.city].filter(Boolean).join(' · ');
  const inTicket = phase === 'tracking' || phase === 'ready';

  const view: TicketViewProps | null = ticket && inTicket
    ? {
        ticket,
        organizationId,
        phase,
        timeZone,
        busy: busy || pending,
        error,
        vapidPublicKey,
        walletSlot,
        allowLeave: entryPoint.settings.allowClientLeave,
        fresh: sawJoin,
        animateReady: sawTracking,
        onAction: act,
      }
    : null;

  const reset = () => {
    setTicket(null);
    setUnfollowed(null);
  };

  // Un ticket de passage au fauteuil relu sur cet appareil (autre file du
  // même établissement) : l'écran des barbiers, tel quel.
  if (ticket && isLegacyProfile(ticket.queue.profile)) {
    return (
      <ClientExperience
        entryPoint={entryPoint}
        initialTicket={ticket}
        source={source}
        staffGate={staffGate}
        vapidPublicKey={vapidPublicKey}
        activityLabel={activityLabel}
      />
    );
  }

  return (
    <div className={clientStyles.stage}>
      <Header
        name={locationName}
        subtitle={subtitle}
        logoUrl={entryPoint.location.logoUrl}
        connection={connection}
        queueStatus={phase === 'join' && queueStatus === 'open' && staffGate && !staffGate.autoAssign ? 'no_staff' : queueStatus}
        inQueue={inTicket}
      />

      {error && !inTicket && phase !== 'join' && (
        <div className="banner banner--error" role="alert"><span>{error}</span></div>
      )}

      {phase === 'join' && unfollowed && (
        <Unfollowed profile={unfollowed} location={entryPoint.location} onAgain={reset} />
      )}

      {phase === 'join' && !unfollowed && (
        <ProfileJoin
          profile={joinProfile}
          entryPoint={entryPoint}
          waitingCount={waitingCount}
          options={joinOptions}
          staffGate={staffGate}
          name={name}
          onName={setName}
          values={values}
          onValues={(patch) => {
            setValues((v) => ({ ...v, ...patch }));
            setFieldError(null);
          }}
          serviceId={serviceId}
          onService={setServiceId}
          fieldError={fieldError}
          error={error}
          busy={busy || pending}
          onJoin={join}
        />
      )}

      {view && (profile === 'vehicle' || profile === 'device') && (
        <WorkshopTicket
          {...view}
          publicEntries={publicEntries}
          onSwitch={(id) => void fetchTicket(id)}
        />
      )}
      {view && profile === 'table' && <TableTicket {...view} graceMinutes={graceMinutes} />}
      {view && profile === 'desk' && <DeskTicket {...view} />}
      {view && profile === 'retail' && <RetailTicket {...view} />}

      {phase === 'done' && ticket && (
        profile === 'vehicle' || profile === 'device'
          ? <WorkshopDone ticket={ticket} onAgain={reset} />
          : profile === 'table'
            ? <TableDone ticket={ticket} />
            : <DonePanel ticket={ticket} onRejoin={reset} />
      )}

      {phase === 'closed' && ticket && (
        profile === 'vehicle' || profile === 'device'
          ? <WorkshopClosed ticket={ticket} onAgain={reset} />
          : <ClosedPanel ticket={ticket} onRejoin={reset} />
      )}
    </div>
  );
}
