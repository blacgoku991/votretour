'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';
import {
  advanceEntry, addWalkinEntry, changeQueueStatus, fetchQueueSnapshot, toggleStaffBreak,
} from '@/server/actions/queue';
import type { StaffAction } from '@/server/queue';
import { STAFF_STATUS_LABEL, SOURCE_LABEL } from '@/lib/copy';
import { formatTime, elapsedSeconds, formatDurationBounded, relativeTime } from '@/lib/format';
import { FlapNumber } from '@/components/FlapNumber';
import { Icon } from '@/components/AppShell';
import { useReducedMotion } from '@/components/motion/useMotionPreference';
import type { QueueSnapshot, StaffEntry, QueueStatus } from '@/lib/types';
import styles from './board.module.css';

/**
 * L'ÉCRAN DE TRAVAIL DU PROFESSIONNEL.
 *
 * Règle de conception : faire avancer la file doit tenir en UN geste.
 * TERMINER est la seule « touche » de l'écran — une vraie touche, dont la
 * tranche s'écrase à l'appui — et elle déclenche à elle seule la cascade
 * complète : transition, recalcul des positions, diffusion temps réel,
 * notifications, historique.
 *
 * L'écran EST la file : un rail vertical part du comptoir (en cours),
 * passe par le prochain, puis descend le long des personnes en attente.
 * Aucune animation liée au défilement ; seulement des micro-mouvements
 * utiles (le Passage de la latte servie, les volets des compteurs).
 */

interface QueueRef { id: string; name: string; locationName: string; status: string }

interface Props {
  orgSlug: string;
  initialSnapshot: QueueSnapshot | null;
  queues: QueueRef[];
  canOperate: boolean;
  canConfigure: boolean;
}

type Act = (id: string, action: StaffAction, options?: Record<string, unknown>) => void;

/** Copie fantôme d'une prestation terminée, le temps de son Passage. */
interface Ghost {
  key: string;
  entry: StaffEntry;
  staffName: string | null;
  top: number;
  height: number;
}

const PASS_MS = 420;
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function QueueBoard({ orgSlug, initialSnapshot, queues, canOperate, canConfigure }: Props) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(initialSnapshot);
  const [busyEntry, setBusyEntry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [statusPending, startStatus] = useTransition();
  const [, startTransition] = useTransition();
  const queueId = snapshot?.queue.id ?? null;
  const now = useNow(30_000);
  const reduced = useReducedMotion();

  /* Les personnes déjà là à l'ouverture de l'écran ne se « déplient » pas :
     SE DÉPLIER est réservé à quelqu'un qui arrive (ou qui monte d'un cran)
     après le premier instantané. Ensembles figés au montage. */
  const initialIds = useRef<{ serving: Set<string>; next: string | null; all: Set<string> } | null>(null);
  if (initialIds.current === null) {
    const s0 = initialSnapshot;
    const serving0 = s0?.serving ?? [];
    const called0 = s0?.called ?? [];
    const waiting0 = s0?.waiting ?? [];
    initialIds.current = {
      serving: new Set(serving0.map((e) => e.id)),
      next: (called0[0] ?? waiting0[0])?.id ?? null,
      all: new Set([...serving0, ...called0, ...waiting0].map((e) => e.id)),
    };
  }
  const isNew = {
    serving: (id: string) => !initialIds.current!.serving.has(id),
    next: (id: string) => id !== initialIds.current!.next,
    waiting: (id: string) => !initialIds.current!.all.has(id),
  };

  /* ---------------------------------------------------------------
     Temps réel : Postgres Changes sous RLS.
     Le professionnel a le droit de voir les prénoms de SA file ; les
     policies garantissent qu'il ne reçoit jamais ceux d'une autre.
     --------------------------------------------------------------- */
  const refresh = useCallback(async () => {
    if (!queueId) return;
    const result = await fetchQueueSnapshot(queueId);
    if (result.ok) setSnapshot(result.data.snapshot);
  }, [queueId]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!queueId) return;
    const supabase = supabaseBrowser();

    // Canal 1 — Postgres Changes, sous RLS. C'est la voie principale :
    // le professionnel a le droit de voir les lignes de SA file, et les
    // policies garantissent qu'il ne reçoit jamais celles d'une autre.
    const changes = supabase
      .channel(`staff:${queueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queue_entries', filter: `queue_id=eq.${queueId}` },
        () => { void refreshRef.current(); },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'queues', filter: `id=eq.${queueId}` },
        () => { void refreshRef.current(); },
      )
      .subscribe();

    // Canal 2 — le même Broadcast que les clients, utilisé UNIQUEMENT
    // comme signal « quelque chose a bougé ». On ne lit rien de sa
    // charge utile : l'écran va rechercher l'instantané complet par
    // l'action serveur authentifiée.
    //
    // Pourquoi deux canaux : si la réplication logique est coupée ou si
    // les Postgres Changes sont indisponibles, un client qui appuie sur
    // « Je suis de retour » doit quand même apparaître tout de suite au
    // comptoir — c'est le moment où le professionnel en a besoin.
    const signal = supabase
      .channel(`queue:${queueId}`, { config: { broadcast: { self: false, ack: false } } })
      .on('broadcast', { event: 'state' }, () => { void refreshRef.current(); })
      .on('broadcast', { event: 'ticket' }, () => { void refreshRef.current(); })
      .subscribe();

    // Dernier filet : si les deux canaux tombent, l'écran reste juste.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRef.current();
    }, 20_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      void supabase.removeChannel(changes);
      void supabase.removeChannel(signal);
    };
  }, [queueId]);

  /* ---------------------------------------------------------------
     Actions
     --------------------------------------------------------------- */
  const act = useCallback<Act>(
    (entryId, action, options) => {
      if (!canOperate) return;
      setError(null);
      setBusyEntry(entryId);
      startTransition(async () => {
        const result = await advanceEntry({ entryId, action, options });
        setBusyEntry(null);
        if (!result.ok) { setError(result.error); return; }
        setSnapshot(result.data.snapshot);

        // On ne prétend jamais qu'une notification est partie : on
        // affiche ce que les fournisseurs ont réellement accepté.
        const n = result.data.notifications;
        if (n.sent > 0) {
          setFlash(`${n.sent} notification${n.sent > 1 ? 's' : ''} envoyée${n.sent > 1 ? 's' : ''}`);
        } else if (n.failed > 0) {
          setFlash(`${n.failed} notification${n.failed > 1 ? 's' : ''} en échec`);
        }
      });
    },
    [canOperate],
  );

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 3200);
    return () => clearTimeout(timer);
  }, [flash]);

  const setStatus = useCallback((status: QueueStatus, reason?: string) => {
    if (!queueId) return;
    setError(null);
    startStatus(async () => {
      const result = await changeQueueStatus({ queueId, status, reason: reason ?? null });
      if (!result.ok) { setError(result.error); return; }
      setSnapshot(result.data.snapshot);
      router.refresh();
    });
  }, [queueId, router]);

  /* ---------------------------------------------------------------
     LE PASSAGE : quand une prestation disparaît de l'instantané, on
     garde 420 ms une copie fantôme de sa latte, posée exactement où
     elle était, qui se relève comme un volet (.slat--leaving). La
     suivante arrive en dessous en se dépliant (slat-enter).
     --------------------------------------------------------------- */
  const servingRef = useRef<HTMLDivElement | null>(null);
  const geometry = useRef(new Map<string, { top: number; height: number }>());
  const previous = useRef(new Map<string, { entry: StaffEntry; staffName: string | null }>());
  const [ghosts, setGhosts] = useState<Ghost[]>([]);

  const serving = snapshot?.serving;
  const staffList = snapshot?.staff;
  useIsoLayoutEffect(() => {
    const current = new Map<string, { entry: StaffEntry; staffName: string | null }>();
    for (const entry of serving ?? []) {
      current.set(entry.id, {
        entry,
        staffName: staffList?.find((s) => s.id === entry.staffId)?.name ?? null,
      });
    }

    const gone: Ghost[] = [];
    if (!reduced) {
      previous.current.forEach((value, id) => {
        const box = geometry.current.get(id);
        if (!current.has(id) && box) {
          gone.push({ key: `${id}:${Date.now()}`, ...value, ...box });
        }
      });
    }
    previous.current = current;

    // Géométrie des lattes présentes : une lecture par changement
    // d'instantané, jamais dans une boucle d'images.
    const root = servingRef.current;
    geometry.current = new Map();
    root?.querySelectorAll<HTMLElement>('[data-serving-id]').forEach((el) => {
      geometry.current.set(el.dataset.servingId!, { top: el.offsetTop, height: el.offsetHeight });
    });

    if (gone.length > 0) {
      setGhosts((list) => [...list, ...gone]);
      // Retrait à la fin de l'animation (animationend) ; filet de
      // sécurité si l'événement ne vient jamais (onglet en arrière-plan).
      const keys = new Set(gone.map((g) => g.key));
      window.setTimeout(() => {
        setGhosts((list) => list.filter((g) => !keys.has(g.key)));
      }, PASS_MS * 4);
    }
  }, [serving, staffList, reduced]);

  const dropGhost = useCallback((key: string) => {
    setGhosts((list) => list.filter((g) => g.key !== key));
  }, []);

  if (!snapshot) {
    return (
      <div className="shell">
        <div className={styles.unavailable}>
          <p className="t-label">File</p>
          <h1 className="t-title">File indisponible</h1>
          <p className="t-body t-muted">Rechargez la page ou choisissez une autre file.</p>
        </div>
      </div>
    );
  }

  const { queue, called, waiting, parked, staff } = snapshot;
  const servingList = snapshot.serving;
  const nextUp = called[0] ?? waiting[0] ?? null;
  const rest = called.length > 0 ? waiting : waiting.slice(1);
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.name ?? null;
  const empty = servingList.length === 0 && !nextUp;

  return (
    <div className={`shell ${styles.board}`}>
      <StatusHeader
        snapshot={snapshot}
        queues={queues}
        orgSlug={orgSlug}
        canOperate={canOperate}
        pending={statusPending}
        onStatus={setStatus}
      />

      {(error || flash || queue.status !== 'open') && (
        <div className={styles.notices}>
          {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}
          {flash && (
            <div className={styles.flash} role="status">
              <span className={styles.flashMark} aria-hidden="true" />
              {flash}
            </div>
          )}
          {queue.status !== 'open' && (
            <div className="banner banner--warn">
              <span>
                {queue.status === 'paused'
                  ? `File en pause${queue.pauseReason ? ` — ${queue.pauseReason}` : ''}. Personne ne peut la rejoindre.`
                  : 'File fermée. Ouvrez-la pour que vos clients puissent approcher leur téléphone de la plaque.'}
              </span>
            </div>
          )}
        </div>
      )}

      <div className={styles.columns}>
        {/* ======================= LA FILE ======================= */}
        <div className={styles.lane}>
          {empty ? (
            <EmptyLane orgSlug={orgSlug} paused={queue.status !== 'open'} />
          ) : (
            <>
              {/* ---------------- EN COURS ---------------- */}
              <section className={styles.stop} aria-labelledby="stop-serving">
                <h2 id="stop-serving" className={`t-label ${styles.stopLabel}`}>
                  En cours
                  {servingList.length > 1 && <span className={styles.stopCount}>{servingList.length}</span>}
                </h2>

                <div ref={servingRef} className={styles.servingStack}>
                  {servingList.length === 0 ? (
                    <div className={styles.idle} data-notch="idle">
                      <p className={styles.idleTitle}>Personne au comptoir</p>
                      <p className={styles.idleText}>
                        {nextUp
                          ? `Démarrez ${nextUp.name ?? 'le client suivant'} quand vous êtes prêt.`
                          : 'La file est vide.'}
                      </p>
                    </div>
                  ) : (
                    servingList.map((entry) => (
                      <ServingSlat
                        key={entry.id}
                        entry={entry}
                        staffName={staffName(entry.staffId)}
                        busy={busyEntry === entry.id}
                        entering={isNew.serving(entry.id)}
                        disabled={!canOperate}
                        absentPolicy={queue.absentPolicy}
                        moveBackBy={queue.absentMoveBackBy}
                        onAct={act}
                      />
                    ))
                  )}

                  {ghosts.map((ghost) => (
                    <ServingSlat
                      key={ghost.key}
                      ghost
                      entry={ghost.entry}
                      staffName={ghost.staffName}
                      style={{ top: ghost.top, height: ghost.height }}
                      onPassed={() => dropGhost(ghost.key)}
                      busy={false}
                      disabled
                      absentPolicy={queue.absentPolicy}
                      moveBackBy={queue.absentMoveBackBy}
                      onAct={act}
                    />
                  ))}
                </div>
              </section>

              {/* ---------------- PROCHAIN ---------------- */}
              {nextUp && (
                <section className={styles.stop} aria-labelledby="stop-next">
                  <h2 id="stop-next" className={`t-label ${styles.stopLabel}`}>Prochain</h2>
                  <NextSlat
                    key={nextUp.id}
                    entry={nextUp}
                    staffName={staffName(nextUp.staffId)}
                    busy={busyEntry === nextUp.id}
                    entering={isNew.next(nextUp.id)}
                    quiet={servingList.length > 0}
                    disabled={!canOperate}
                    advanceMode={queue.advanceMode}
                    now={now}
                    onAct={act}
                  />
                </section>
              )}

              {/* ---------------- EN ATTENTE ---------------- */}
              <section className={styles.stop} aria-labelledby="stop-waiting">
                <h2 id="stop-waiting" className={`t-label ${styles.stopLabel}`}>
                  En attente
                  <span className={styles.stopCount}>{rest.length}</span>
                </h2>

                {rest.length === 0 ? (
                  <p className={styles.nobody}>Personne d&apos;autre n&apos;attend pour le moment.</p>
                ) : (
                  <ol className={styles.waitList}>
                    {rest.map((entry, index) => (
                      <WaitingRow
                        key={entry.id}
                        entry={entry}
                        position={index + 2}
                        entering={isNew.waiting(entry.id)}
                        staffName={staffName(entry.staffId)}
                        busy={busyEntry === entry.id}
                        disabled={!canOperate}
                        moveBackBy={queue.absentMoveBackBy}
                        now={now}
                        onAct={act}
                      />
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>

        {/* ======================= OUTILS ======================= */}
        <aside className={styles.side} aria-label="Outils du comptoir">
          {canOperate && (
            <section className={styles.tool}>
              <h2 className={`t-label ${styles.toolLabel}`}>Ajouter au comptoir</h2>
              <AddWalkin queueId={queue.id} staff={staff} onAdded={setSnapshot} />
            </section>
          )}

          {parked.length > 0 && (
            <section className={styles.tool}>
              <h2 className={`t-label ${styles.toolLabel}`}>
                Absents et retirés
                <span className={styles.stopCount}>{parked.length}</span>
              </h2>
              <ul className={styles.parked}>
                {parked.map((entry) => (
                  <li key={entry.id} className={styles.parkedRow}>
                    <span className={styles.parkedWho}>
                      <span className={styles.parkedName}>{entry.name ?? 'Client sans prénom'}</span>
                      <span className={styles.parkedMeta}>
                        {STAFF_STATUS_LABEL[entry.status]}
                        {now != null && ` · ${relativeTime(entry.absentAt ?? entry.joinedAt)}`}
                      </span>
                    </span>
                    {canOperate && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busyEntry === entry.id}
                        onClick={() => act(entry.id, 'restore')}
                      >
                        Remettre en file
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {staff.length > 0 && (
            <section className={styles.tool}>
              <h2 className={`t-label ${styles.toolLabel}`}>Équipe</h2>
              <ul className={styles.team}>
                {staff.map((member) => (
                  <li key={member.id}>
                    <StaffPill
                      member={member}
                      disabled={!canConfigure}
                      onToggle={(onBreak) =>
                        startTransition(async () => {
                          await toggleStaffBreak({ staffId: member.id, onBreak });
                          await refresh();
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
              {canConfigure && (
                <p className={styles.toolHint}>Touchez un prénom pour le mettre en pause ou le remettre en service.</p>
              )}
            </section>
          )}

          {!empty && (
            <Link href={`/ecran/${orgSlug}`} className={styles.tvLink}>
              <Icon name="screen" />
              <span>Afficher l&apos;écran TV</span>
              <span aria-hidden="true" className={styles.tvArrow}>→</span>
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ==================================================================
   En-tête : état de la file, sélecteur segmenté, compteurs
   ================================================================== */

const STATUS_OPTIONS: ReadonlyArray<{ value: QueueStatus; label: string }> = [
  { value: 'open', label: 'Ouverte' },
  { value: 'paused', label: 'En pause' },
  { value: 'closed', label: 'Fermée' },
];

function StatusHeader({
  snapshot, queues, orgSlug, canOperate, pending, onStatus,
}: {
  snapshot: QueueSnapshot;
  queues: QueueRef[];
  orgSlug: string;
  canOperate: boolean;
  pending: boolean;
  onStatus: (status: QueueStatus, reason?: string) => void;
}) {
  const { queue, counts, location } = snapshot;
  const status = queue.status;
  const [mode, setMode] = useState<'pause' | 'close' | null>(null);
  const [reason, setReason] = useState('');
  const segRef = useRef<HTMLDivElement | null>(null);

  /** Annuler (bouton ou Échap) : le panneau se ferme, le focus revient au segment. */
  const cancel = () => {
    const from = mode === 'pause' ? 'paused' : mode === 'close' ? 'closed' : null;
    setMode(null);
    if (from) {
      requestAnimationFrame(() => {
        segRef.current?.querySelector<HTMLButtonElement>(`[data-status="${from}"]`)?.focus();
      });
    }
  };
  const onPanelKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  };

  const choose = (value: QueueStatus) => {
    if (value === status) { setMode(null); return; }
    if (value === 'open') { setMode(null); onStatus('open'); return; }
    // La pause garde son formulaire de motif ; la fermeture demande
    // une confirmation en ligne.
    setMode(value === 'paused' ? 'pause' : 'close');
  };

  const title = status === 'open' ? 'File ouverte' : status === 'paused' ? 'File en pause' : 'File fermée';
  const pip = status === 'open' ? 'pip pip--live' : status === 'paused' ? 'pip pip--warn' : 'pip pip--off';

  return (
    <header className={styles.head}>
      <div className={styles.headTop}>
        <div className={styles.headTitle}>
          <p className={styles.headWhere}>
            <span className={pip} aria-hidden="true" />
            <span className="truncate">{location.name}</span>
          </p>
          <h1 className={styles.statusLabel}>{title}</h1>
          {queues.length > 1 && (
            <select
              className={`select ${styles.queuePicker}`}
              value={queue.id}
              onChange={(e) => { window.location.href = `/app/${orgSlug}/file?file=${e.target.value}`; }}
              aria-label="Changer de file"
            >
              {queues.map((q) => (
                <option key={q.id} value={q.id}>{q.locationName} — {q.name}</option>
              ))}
            </select>
          )}
        </div>

        {canOperate && (
          <div ref={segRef} className={`seg ${styles.statusSeg}`} role="group" aria-label="État de la file" data-pending={pending ? '1' : undefined}>
            {STATUS_OPTIONS.map((option) => {
              const pressed = option.value === status;
              const armed = (option.value === 'paused' && mode === 'pause') || (option.value === 'closed' && mode === 'close');
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={pressed}
                  data-armed={armed ? '1' : undefined}
                  data-status={option.value}
                  onClick={() => choose(option.value)}
                >
                  <span className={styles.segDot} aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {mode === 'pause' && (
        // Le motif s'affiche sur l'écran du client : « File en pause :
        // retour dans 10 min » vaut mieux qu'un écran muet.
        <form
          className={styles.inlinePanel}
          data-tone="pause"
          onKeyDown={onPanelKey}
          onSubmit={(event) => {
            event.preventDefault();
            onStatus('paused', reason.trim() || undefined);
            setMode(null);
            setReason('');
          }}
        >
          <label className={styles.inlineText} htmlFor="pause-reason">
            <strong>Mettre la file en pause ?</strong> Personne ne pourra la rejoindre ; le motif est affiché à vos clients.
          </label>
          <div className={styles.inlineActions}>
            <input
              id="pause-reason"
              className={`input ${styles.pauseInput}`}
              autoFocus
              maxLength={120}
              placeholder="Motif (facultatif) — ex. retour dans 10 min"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button type="submit" className="btn btn--solid btn--sm">Mettre en pause</button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={cancel}>Annuler</button>
          </div>
        </form>
      )}

      {mode === 'close' && (
        <div className={styles.inlinePanel} data-tone="close" role="alertdialog" aria-labelledby="close-question" onKeyDown={onPanelKey}>
          <p id="close-question" className={styles.inlineText}>
            <strong>Fermer la file ?</strong> Les personnes en attente seront prévenues.
          </p>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => { setMode(null); onStatus('closed'); }}
            >
              Fermer
            </button>
            <button type="button" className="btn btn--quiet btn--sm" autoFocus onClick={cancel}>Annuler</button>
          </div>
        </div>
      )}

      <dl className={styles.counters}>
        <div className={styles.counter}>
          <dt className="t-label">en attente</dt>
          <dd><FlapNumber static value={counts.waiting} size="2rem" label={`${counts.waiting} en attente`} /></dd>
        </div>
        <div className={styles.counter}>
          <dt className="t-label">en cours</dt>
          <dd><FlapNumber static value={counts.serving} size="2rem" label={`${counts.serving} en cours`} /></dd>
        </div>
        <div className={styles.counter}>
          <dt className="t-label">aujourd&apos;hui</dt>
          <dd><FlapNumber static value={counts.completedToday} size="2rem" label={`${counts.completedToday} aujourd'hui`} /></dd>
        </div>
      </dl>
    </header>
  );
}

/* ==================================================================
   La latte de prestation — TERMINER y est la seule touche
   ================================================================== */

function ServingSlat({
  entry, staffName, busy, disabled, absentPolicy, moveBackBy, onAct, ghost = false, style, onPassed,
  entering = false,
}: {
  /** Se déplie au montage (arrivée après le premier instantané). */
  entering?: boolean;
  /** Fantôme : appelé quand le Passage est joué. */
  onPassed?: () => void;
  entry: StaffEntry;
  staffName: string | null;
  busy: boolean;
  disabled: boolean;
  absentPolicy: string;
  moveBackBy: number;
  onAct: Act;
  /** Copie fantôme pendant le Passage : inerte, positionnée par-dessus. */
  ghost?: boolean;
  style?: React.CSSProperties;
}) {
  const live = useLiveElapsed(ghost ? null : entry.serviceStartedAt);
  // Le fantôme n'existe qu'après une action dans le navigateur : il peut
  // lire l'heure pendant le rendu sans risque d'écart d'hydratation.
  const elapsed = ghost ? elapsedSeconds(entry.serviceStartedAt) : live;
  const name = entry.name ?? 'Client sans prénom';

  const who = (
    <div className={styles.servingTop}>
      <div className={styles.servingWho}>
        <p className={styles.servingMeta}>
          {staffName ? <>avec <strong>{staffName}</strong> · </> : null}
          depuis {formatTime(entry.serviceStartedAt)}
        </p>
        <h3 className={styles.servingName}>{name}</h3>
      </div>
      <p className={styles.timer} aria-label="Durée de la prestation">
        <span className="t-num">{elapsed == null ? '—' : formatDurationBounded(elapsed)}</span>
        <span className={styles.timerLabel}>en prestation</span>
      </p>
    </div>
  );

  if (ghost) {
    return (
      <article className={`${styles.serving} ${styles.ghost} slat--leaving`} style={style}
        aria-hidden="true"
        inert
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === 'slat-pass') onPassed?.();
        }}
      >
        {who}
        <span className={`btn btn--signal btn--key btn--block ${styles.key}`}>Terminer</span>
        <div className={styles.miniActions}>
          <span className="btn btn--ghost btn--sm">Absent</span>
          <span className="btn btn--ghost btn--sm">Décaler</span>
          <span className="btn btn--danger btn--sm">Retirer</span>
        </div>
      </article>
    );
  }

  return (
    <article className={`${styles.serving}${entering ? ' slat--entering' : ''}`} data-serving-id={entry.id}>
      {who}

      <button
        type="button"
        className={`btn btn--signal btn--key btn--block ${styles.key}`}
        disabled={disabled}
        aria-busy={busy || undefined}
        data-busy={busy ? '1' : undefined}
        onClick={() => { if (!busy) onAct(entry.id, 'complete'); }}
      >
        {busy ? 'Un instant…' : 'Terminer'}
      </button>

      <div className={styles.miniActions}>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy || disabled}
          onClick={() => onAct(entry.id, 'mark_absent')}>
          Absent
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy || disabled}
          onClick={() => onAct(entry.id, 'defer', { by: moveBackBy })}>
          Décaler
        </button>
        <button type="button" className="btn btn--danger btn--sm" disabled={busy || disabled}
          onClick={() => onAct(entry.id, 'remove')}>
          Retirer
        </button>
      </div>
      <p className={styles.policy}>
        « Absent » applique le réglage de la file : {absentPolicy === 'move_back'
          ? `recul de ${moveBackBy} place${moveBackBy > 1 ? 's' : ''}`
          : absentPolicy === 'hold' ? 'mise de côté' : 'sortie de la file'}.
      </p>
    </article>
  );
}

/* ==================================================================
   Le prochain
   ================================================================== */

function NextSlat({
  entry, staffName, busy, disabled, advanceMode, now, onAct, entering = false, quiet = false,
}: {
  entering?: boolean;
  /** Quelqu'un est déjà en prestation : TERMINER reste la seule touche pleine. */
  quiet?: boolean;
  entry: StaffEntry;
  staffName: string | null;
  busy: boolean;
  disabled: boolean;
  advanceMode: string;
  now: number | null;
  onAct: Act;
}) {
  return (
    <article className={`${styles.next}${entering ? ' slat--entering' : ''}`}>
      <span className={styles.pos} aria-hidden="true">01</span>
      <div className={styles.nextWho}>
        <p className={styles.nextName}>
          <span className="truncate">{entry.name ?? 'Client sans prénom'}</span>
          {entry.status !== 'waiting' && <StatusChip entry={entry} />}
        </p>
        <p className={styles.rowMeta}>
          {[
            SOURCE_LABEL[entry.source] ?? entry.source,
            staffName ? `pour ${staffName}` : null,
            `arrivé à ${formatTime(entry.joinedAt)}`,
          ].filter(Boolean).join(' · ')}
          {now != null && <> · <span className={styles.nowrap}><span className="t-num">{waitText(entry.joinedAt)}</span> d&apos;attente</span></>}
        </p>
      </div>

      <div className={styles.nextActions}>
        <button
          type="button"
          className={quiet ? 'btn btn--ghost' : 'btn btn--solid'}
          disabled={disabled}
          aria-busy={busy || undefined}
          onClick={() => { if (!busy) onAct(entry.id, 'start_serving'); }}
        >
          {busy ? 'Un instant…' : 'Démarrer'}
        </button>
        {entry.status !== 'next' && advanceMode === 'call_next' && (
          <button type="button" className="btn btn--ghost" disabled={busy || disabled}
            onClick={() => onAct(entry.id, 'call')}>
            Appeler
          </button>
        )}
        <button type="button" className="btn btn--ghost" disabled={busy || disabled}
          onClick={() => onAct(entry.id, 'mark_absent')}>
          Absent
        </button>
      </div>
    </article>
  );
}

/* ==================================================================
   Ligne d'attente : position, prénom, source, attente, actions
   ================================================================== */

function WaitingRow({
  entry, position, staffName, busy, disabled, moveBackBy, now, onAct, entering = false,
}: {
  entering?: boolean;
  entry: StaffEntry;
  position: number;
  staffName: string | null;
  busy: boolean;
  disabled: boolean;
  moveBackBy: number;
  now: number | null;
  onAct: Act;
}) {
  const [open, setOpen] = useState(false);
  const name = entry.name ?? 'Client sans prénom';
  const menuId = `menu-${entry.id}`;

  return (
    <li
      className={`${styles.waitRow}${entering ? ' slat--entering' : ''}`}
      data-open={open ? '1' : undefined}
    >
      <span className={styles.pos} aria-label={`Position ${position}`}>
        {String(position).padStart(2, '0')}
      </span>

      <div className={styles.waitWho}>
        <p className={styles.waitName}>
          <span className={`truncate ${entry.name ? '' : styles.anon}`}>{name}</span>
          {entry.status !== 'waiting' && <StatusChip entry={entry} />}
        </p>
        <p className={styles.rowMeta}>
          {[SOURCE_LABEL[entry.source] ?? entry.source, staffName ? `pour ${staffName}` : null, formatTime(entry.joinedAt)]
            .filter(Boolean).join(' · ')}
        </p>
      </div>

      <p className={styles.wait} aria-label="Attente">
        {now != null ? waitText(entry.joinedAt) : ''}
      </p>

      {!disabled && (
        <div className={styles.rowActions}>
          <button type="button" className={`btn btn--ghost btn--sm ${styles.startBtn}`} disabled={busy}
            onClick={() => onAct(entry.id, 'start_serving')}>
            Démarrer
          </button>
          <button
            type="button"
            className={styles.moreBtn}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={`Plus d'actions pour ${name}`}
          >
            <Icon name="more" />
          </button>
        </div>
      )}

      {open && !disabled && (
        <div className={styles.rowMenu} id={menuId}>
          <button type="button" className={styles.startInMenu}
            onClick={() => { onAct(entry.id, 'start_serving'); setOpen(false); }}>
            Démarrer
          </button>
          <button type="button" onClick={() => { onAct(entry.id, 'call'); setOpen(false); }}>Appeler</button>
          <button type="button" onClick={() => { onAct(entry.id, 'mark_present'); setOpen(false); }}>Présent</button>
          <button type="button" onClick={() => { onAct(entry.id, 'mark_absent'); setOpen(false); }}>Absent</button>
          <button type="button" aria-label={`Décaler de ${moveBackBy} places`}
            onClick={() => { onAct(entry.id, 'defer', { by: moveBackBy }); setOpen(false); }}>
            Décaler +{moveBackBy}
          </button>
          <button type="button" className={styles.danger}
            onClick={() => { onAct(entry.id, 'remove'); setOpen(false); }}>
            Retirer
          </button>
        </div>
      )}
    </li>
  );
}

function StatusChip({ entry }: { entry: StaffEntry }) {
  const className =
    entry.status === 'returning' ? 'chip chip--jade'
    : entry.status === 'present' ? 'chip chip--jade'
    : entry.status === 'notified' || entry.status === 'next' ? 'chip chip--copper'
    : entry.status === 'serving' ? 'chip chip--signal'
    : 'chip';
  return <span className={className}>{STAFF_STATUS_LABEL[entry.status]}</span>;
}

/* ==================================================================
   File vide : un rail et une latte fantôme
   ================================================================== */

function EmptyLane({ orgSlug, paused }: { orgSlug: string; paused: boolean }) {
  return (
    <section className={styles.stop} aria-labelledby="stop-empty">
      <h2 id="stop-empty" className={`t-label ${styles.stopLabel}`}>Au comptoir</h2>
      <div className={styles.emptyGhost} aria-hidden="true">
        <span className={styles.emptyGhostTick} />
        <span>Prochain client</span>
      </div>
      <div className={styles.emptyGhostFaint} aria-hidden="true" />
      <div className={styles.emptyText}>
        <p className={styles.emptyTitle}>La file est vide.</p>
        <p className={styles.emptyBody}>
          {paused
            ? 'Ouvrez-la : elle se remplira dès qu’un client approchera son téléphone de la plaque.'
            : 'Elle se remplit dès qu’un client approche son téléphone de la plaque.'}
        </p>
        <Link href={`/ecran/${orgSlug}`} className={styles.emptyLink}>
          Afficher l&apos;écran TV <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

/* ==================================================================
   Ajout au comptoir
   ================================================================== */

function AddWalkin({
  queueId, staff, onAdded,
}: {
  queueId: string;
  staff: QueueSnapshot['staff'];
  onAdded: (snapshot: QueueSnapshot | null) => void;
}) {
  const [name, setName] = useState('');
  const [staffId, setStaffId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await addWalkinEntry({
        queueId, name: name.trim(), staffId: staffId || null,
      });
      if (!result.ok) { setError(result.error); return; }
      onAdded(result.data.snapshot);
      setName('');
    });
  };

  return (
    <form onSubmit={submit} className={styles.addForm}>
      <input
        className="input"
        placeholder="Prénom de la personne"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        aria-label="Prénom de la personne à ajouter"
        autoComplete="off"
      />
      {staff.length > 1 && (
        <select className="select" value={staffId} onChange={(e) => setStaffId(e.target.value)}
          aria-label="Attribuer à un professionnel">
          <option value="">Au premier disponible</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <button type="submit" className="btn btn--solid" disabled={pending || !name.trim()}>
        {pending ? 'Ajout…' : 'Ajouter'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

/* ==================================================================
   Équipe : pastilles « prénom + point »
   ================================================================== */

function StaffPill({
  member, disabled, onToggle,
}: {
  member: QueueSnapshot['staff'][number];
  disabled: boolean;
  onToggle: (onBreak: boolean) => void;
}) {
  const state = member.isOnBreak ? 'break' : member.servingEntryId ? 'serving' : 'free';
  const label = member.isOnBreak ? 'En pause'
    : member.servingEntryId ? 'En prestation'
    : member.waitingCount > 0 ? `${member.waitingCount} en attente`
    : 'Disponible';
  return (
    <button
      type="button"
      className={styles.pill}
      data-state={state}
      disabled={disabled}
      onClick={() => onToggle(!member.isOnBreak)}
      title={disabled ? undefined : member.isOnBreak ? 'Remettre en service' : 'Mettre en pause'}
      aria-label={`${member.name} — ${label}${disabled ? '' : member.isOnBreak ? ', remettre en service' : ', mettre en pause'}`}
    >
      <span className={styles.pillDot} aria-hidden="true" />
      <span className={styles.pillName}>{member.name}</span>
      <span className={styles.pillState}>{label}</span>
    </button>
  );
}

/* ==================================================================
   Le temps, toujours après montage
   ================================================================== */

/** « 12 min » d'attente depuis l'arrivée, borné (« + de 24 h »). */
function waitText(joinedAt: string): string {
  const seconds = elapsedSeconds(joinedAt);
  if (seconds == null) return '—';
  if (seconds < 60) return '< 1 min';
  return formatDurationBounded(seconds);
}

/**
 * Horloge partagée : `null` au rendu serveur et à l'hydratation, puis
 * l'heure courante, rafraîchie à intervalle régulier.
 */
function useNow(interval: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

/**
 * Compteur vivant : la durée de prestation s'incrémente à l'écran.
 *
 * Le premier rendu reste volontairement vide. Le serveur et le
 * navigateur ne calculent jamais la durée au même instant : « 59 s »
 * côté serveur et « 1 min » une seconde plus tard côté client suffisent
 * à casser l'hydratation de React. On ne compte donc qu'une fois monté.
 */
function useLiveElapsed(from: string | null): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    setValue(elapsedSeconds(from));
    if (!from) return;
    // L'affichage change à la seconde sous une minute, puis à la minute :
    // on ne re-rend qu'à ces instants-là (une minuterie recalée à chaque fois).
    let timer = 0;
    const tick = () => {
      const s = elapsedSeconds(from);
      setValue(s);
      const delay = s == null || s < 60 ? 1000 : (60 - (s % 60)) * 1000;
      timer = window.setTimeout(tick, delay);
    };
    const s0 = elapsedSeconds(from);
    timer = window.setTimeout(tick, s0 == null || s0 < 60 ? 1000 : (60 - (s0 % 60)) * 1000);
    return () => window.clearTimeout(timer);
  }, [from]);
  return value;
}
