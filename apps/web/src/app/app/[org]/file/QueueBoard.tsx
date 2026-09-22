'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';
import {
  advanceEntry, addWalkinEntry, changeQueueStatus, fetchQueueSnapshot, toggleStaffBreak,
} from '@/server/actions/queue';
import type { StaffAction } from '@/server/queue';
import { STAFF_STATUS_LABEL, SOURCE_LABEL } from '@/lib/copy';
import { formatTime, elapsedSeconds, formatDuration, initials, relativeTime } from '@/lib/format';
import type { QueueSnapshot, StaffEntry, QueueStatus } from '@/lib/types';
import styles from './board.module.css';

/**
 * L'ÉCRAN DE TRAVAIL DU PROFESSIONNEL.
 *
 * Règle de conception : faire avancer la file doit tenir en UN geste.
 * TERMINER est donc un bouton plein, large, toujours au même endroit, et
 * il déclenche à lui seul la cascade complète — transition, recalcul des
 * positions, diffusion temps réel, notifications, historique.
 *
 * Tout le reste (absent, décaler, retirer, appeler) est accessible mais
 * ne dispute jamais l'attention à cette action-là.
 */

interface QueueRef { id: string; name: string; locationName: string; status: string }

interface Props {
  orgSlug: string;
  initialSnapshot: QueueSnapshot | null;
  queues: QueueRef[];
  canOperate: boolean;
  canConfigure: boolean;
}

export function QueueBoard({ orgSlug, initialSnapshot, queues, canOperate, canConfigure }: Props) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(initialSnapshot);
  const [busyEntry, setBusyEntry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const queueId = snapshot?.queue.id ?? null;

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
    const channel = supabase
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

    // Filet de sécurité : si le canal tombe, l'écran reste juste.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRef.current();
    }, 20_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [queueId]);

  /* ---------------------------------------------------------------
     Actions
     --------------------------------------------------------------- */
  const act = useCallback(
    (entryId: string, action: StaffAction, options?: Record<string, unknown>) => {
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
    startTransition(async () => {
      const result = await changeQueueStatus({ queueId, status, reason: reason ?? null });
      if (!result.ok) { setError(result.error); return; }
      setSnapshot(result.data.snapshot);
      router.refresh();
    });
  }, [queueId, router]);

  if (!snapshot) {
    return (
      <div className="shell">
        <div className={styles.empty}>
          <h1 className="t-title">File indisponible</h1>
          <p className="t-body t-muted">Rechargez la page ou choisissez une autre file.</p>
        </div>
      </div>
    );
  }

  const { queue, counts, serving, called, waiting, parked, staff } = snapshot;
  const nextUp = called[0] ?? waiting[0] ?? null;
  const rest = called.length > 0 ? waiting : waiting.slice(1);

  return (
    <div className={`shell ${styles.board}`}>
      <StatusBar
        snapshot={snapshot}
        queues={queues}
        orgSlug={orgSlug}
        canOperate={canOperate}
        onStatus={setStatus}
      />

      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}
      {flash && <div className={styles.flash} role="status">{flash}</div>}

      {queue.status !== 'open' && (
        <div className="banner banner--warn">
          <span>
            {queue.status === 'paused'
              ? `File en pause${queue.pauseReason ? ` — ${queue.pauseReason}` : ''}. Personne ne peut la rejoindre.`
              : 'File fermée. Ouvrez-la pour que vos clients puissent scanner la plaque.'}
          </span>
        </div>
      )}

      {/* ---------------- EN COURS ---------------- */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className="t-label">En cours</h2>
          {counts.serving > 0 && <span className="chip chip--signal">{counts.serving}</span>}
        </div>

        {serving.length === 0 ? (
          <div className={styles.idle}>
            <p className="t-section">Personne en prestation</p>
            <p className="t-small t-muted">
              {nextUp
                ? `Démarrez ${nextUp.name ?? 'le suivant'} quand vous êtes prêt.`
                : 'La file est vide.'}
            </p>
          </div>
        ) : (
          <div className={styles.servingGrid}>
            {serving.map((entry) => (
              <ServingCard
                key={entry.id}
                entry={entry}
                staffName={staff.find((s) => s.id === entry.staffId)?.name ?? null}
                busy={busyEntry === entry.id}
                disabled={!canOperate}
                absentPolicy={queue.absentPolicy}
                moveBackBy={queue.absentMoveBackBy}
                onAct={act}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---------------- PROCHAIN ---------------- */}
      {nextUp && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className="t-label">Prochain</h2>
          </div>
          <NextCard
            entry={nextUp}
            staffName={staff.find((s) => s.id === nextUp.staffId)?.name ?? null}
            busy={busyEntry === nextUp.id}
            disabled={!canOperate}
            advanceMode={queue.advanceMode}
            onAct={act}
          />
        </section>
      )}

      {/* ---------------- EN ATTENTE ---------------- */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className="t-label">En attente</h2>
          <span className="chip">{rest.length}</span>
        </div>

        {rest.length === 0 ? (
          <p className={`t-small t-muted ${styles.hint}`}>
            Personne d&apos;autre n&apos;attend pour le moment.
          </p>
        ) : (
          <div className={`rang ${styles.waitingRang}`}>
            {rest.map((entry, index) => (
              <WaitingRow
                key={entry.id}
                entry={entry}
                index={index}
                staffName={staff.find((s) => s.id === entry.staffId)?.name ?? null}
                busy={busyEntry === entry.id}
                disabled={!canOperate}
                moveBackBy={queue.absentMoveBackBy}
                onAct={act}
              />
            ))}
          </div>
        )}

        {canOperate && <AddWalkin queueId={queue.id} staff={staff} onAdded={setSnapshot} />}
      </section>

      {/* ---------------- ABSENTS / RETIRÉS ---------------- */}
      {parked.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className="t-label">Absents et retirés</h2>
            <span className="chip">{parked.length}</span>
          </div>
          <div className={styles.parked}>
            {parked.map((entry) => (
              <div key={entry.id} className={styles.parkedRow}>
                <span className={styles.parkedName}>{entry.name ?? 'Sans prénom'}</span>
                <span className="chip chip--brique">{STAFF_STATUS_LABEL[entry.status]}</span>
                <span className="t-micro t-faint">{relativeTime(entry.absentAt ?? entry.joinedAt)}</span>
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
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------- ÉQUIPE ---------------- */}
      {staff.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className="t-label">Équipe</h2>
          </div>
          <div className={styles.staffRow}>
            {staff.map((member) => (
              <StaffChip
                key={member.id}
                member={member}
                disabled={!canConfigure}
                onToggle={(onBreak) =>
                  startTransition(async () => {
                    await toggleStaffBreak({ staffId: member.id, onBreak });
                    await refresh();
                  })
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ==================================================================
   Barre d'état : ouvrir / mettre en pause / fermer
   ================================================================== */

function StatusBar({
  snapshot, queues, orgSlug, canOperate, onStatus,
}: {
  snapshot: QueueSnapshot;
  queues: QueueRef[];
  orgSlug: string;
  canOperate: boolean;
  onStatus: (status: QueueStatus, reason?: string) => void;
}) {
  const { queue, counts, location } = snapshot;
  const open = queue.status === 'open';

  return (
    <header className={styles.status}>
      <div className={styles.statusMain}>
        <div className={styles.statusTitle}>
          <span className={open ? 'pip pip--live' : queue.status === 'paused' ? 'pip pip--warn' : 'pip pip--off'} />
          <h1 className={styles.statusLabel}>
            {open ? 'File ouverte' : queue.status === 'paused' ? 'File en pause' : 'File fermée'}
          </h1>
          {queues.length > 1 && (
            <select
              className={styles.queuePicker}
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

        <p className={`t-small t-muted ${styles.statusCounts}`}>
          <strong className="t-num">{counts.waiting}</strong> en attente
          <span className={styles.dot} />
          <strong className="t-num">{counts.serving}</strong> en cours
          <span className={styles.dot} />
          <strong className="t-num">{counts.completedToday}</strong> aujourd&apos;hui
          <span className={styles.dot} />
          <span className="truncate">{location.name}</span>
        </p>
      </div>

      {canOperate && (
        <div className={styles.statusActions}>
          {open ? (
            <>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onStatus('paused')}>
                Pause
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onStatus('closed')}>
                Fermer
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--signal btn--sm" onClick={() => onStatus('open')}>
              Ouvrir la file
            </button>
          )}
        </div>
      )}
    </header>
  );
}

/* ==================================================================
   Carte « en cours » — TERMINER y est l'action dominante
   ================================================================== */

function ServingCard({
  entry, staffName, busy, disabled, absentPolicy, moveBackBy, onAct,
}: {
  entry: StaffEntry;
  staffName: string | null;
  busy: boolean;
  disabled: boolean;
  absentPolicy: string;
  moveBackBy: number;
  onAct: (id: string, action: StaffAction, options?: Record<string, unknown>) => void;
}) {
  const elapsed = useLiveElapsed(entry.serviceStartedAt);

  return (
    <article className={styles.servingCard}>
      <div className={styles.servingHead}>
        <span className={styles.servingAvatar}>{initials(entry.name)}</span>
        <div className={styles.servingWho}>
          <h3 className={styles.servingName}>{entry.name ?? 'Sans prénom'}</h3>
          <p className="t-micro t-faint">
            {staffName ? `avec ${staffName} · ` : ''}
            démarré à {formatTime(entry.serviceStartedAt)}
          </p>
        </div>
        <span className={styles.timer} title="Durée de la prestation">
          {formatDuration(elapsed)}
        </span>
      </div>

      <button
        type="button"
        className="btn btn--signal btn--hero"
        disabled={busy || disabled}
        onClick={() => onAct(entry.id, 'complete')}
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
      <p className="t-micro t-faint">
        « Absent » applique le réglage de la file : {absentPolicy === 'move_back'
          ? `recul de ${moveBackBy} places`
          : absentPolicy === 'hold' ? 'mise de côté' : 'sortie de la file'}.
      </p>
    </article>
  );
}

/* ==================================================================
   Carte « prochain »
   ================================================================== */

function NextCard({
  entry, staffName, busy, disabled, advanceMode, onAct,
}: {
  entry: StaffEntry;
  staffName: string | null;
  busy: boolean;
  disabled: boolean;
  advanceMode: string;
  onAct: (id: string, action: StaffAction, options?: Record<string, unknown>) => void;
}) {
  return (
    <article className={styles.nextCard}>
      <div className={styles.nextWho}>
        <span className={styles.nextAvatar}>{initials(entry.name)}</span>
        <div>
          <h3 className={styles.nextName}>{entry.name ?? 'Sans prénom'}</h3>
          <p className={`t-micro ${styles.nextMeta}`}>
            {entry.status !== 'waiting' && <StatusChip entry={entry} />}
            {staffName && <span className="t-faint">· {staffName}</span>}
            <span className="t-faint">· arrivé à {formatTime(entry.joinedAt)}</span>
          </p>
        </div>
      </div>

      <div className={styles.nextActions}>
        <button
          type="button"
          className="btn btn--solid"
          disabled={busy || disabled}
          onClick={() => onAct(entry.id, 'start_serving')}
        >
          {busy ? '…' : 'Démarrer'}
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
   Ligne d'attente — une latte sur le rail, comme côté client
   ================================================================== */

function WaitingRow({
  entry, index, staffName, busy, disabled, moveBackBy, onAct,
}: {
  entry: StaffEntry;
  index: number;
  staffName: string | null;
  busy: boolean;
  disabled: boolean;
  moveBackBy: number;
  onAct: (id: string, action: StaffAction, options?: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`slat ${styles.waitingSlat}`} style={{ animationDelay: `${Math.min(index, 8) * 26}ms` }}>
      <div className={styles.waitingMain}>
        <span className={`t-num ${styles.position}`}>{entry.peopleAhead}</span>
        <span className={styles.waitingName}>{entry.name ?? 'Sans prénom'}</span>
        {/* On n'affiche une pastille que lorsqu'elle apprend quelque
            chose : « en attente » sur chaque ligne n'est que du bruit. */}
        {entry.status !== 'waiting' && <StatusChip entry={entry} />}
        <span className={`t-micro t-faint ${styles.waitingMeta}`}>
          {staffName ? `${staffName} · ` : ''}{formatTime(entry.joinedAt)}
          {entry.source !== 'staff' && ` · ${SOURCE_LABEL[entry.source] ?? entry.source}`}
        </span>

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
              aria-label={`Plus d'actions pour ${entry.name ?? 'ce client'}`}
            >
              ⋯
            </button>
          </div>
        )}
      </div>

      {open && !disabled && (
        <div className={styles.rowMenu}>
          <button type="button" className={styles.startInMenu}
            onClick={() => { onAct(entry.id, 'start_serving'); setOpen(false); }}>
            Démarrer
          </button>
          <button type="button" onClick={() => { onAct(entry.id, 'call'); setOpen(false); }}>Appeler</button>
          <button type="button" onClick={() => { onAct(entry.id, 'mark_present'); setOpen(false); }}>Présent</button>
          <button type="button" onClick={() => { onAct(entry.id, 'mark_absent'); setOpen(false); }}>Absent</button>
          <button type="button" onClick={() => { onAct(entry.id, 'defer', { by: moveBackBy }); setOpen(false); }}>
            Décaler de {moveBackBy}
          </button>
          <button type="button" className={styles.danger}
            onClick={() => { onAct(entry.id, 'remove'); setOpen(false); }}>
            Retirer
          </button>
        </div>
      )}
    </div>
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
    <form onSubmit={submit} className={styles.addRow}>
      <input
        className="input"
        placeholder="Ajouter une personne au comptoir"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        aria-label="Prénom de la personne à ajouter"
      />
      {staff.length > 1 && (
        <select className="select" value={staffId} onChange={(e) => setStaffId(e.target.value)}
          aria-label="Attribuer à un professionnel">
          <option value="">Au suivant</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <button type="submit" className="btn btn--solid" disabled={pending || !name.trim()}>
        {pending ? '…' : 'Ajouter'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

function StaffChip({
  member, disabled, onToggle,
}: {
  member: QueueSnapshot['staff'][number];
  disabled: boolean;
  onToggle: (onBreak: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.staffChip} ${member.isOnBreak ? styles.staffChipOff : ''}`}
      data-accent={member.accent}
      disabled={disabled}
      onClick={() => onToggle(!member.isOnBreak)}
      title={member.isOnBreak ? 'Remettre en service' : 'Mettre en pause'}
    >
      <span className={styles.staffAvatar}>{initials(member.name)}</span>
      <span className={styles.staffText}>
        <span className={styles.staffName}>{member.name}</span>
        <span className="t-micro t-faint">
          {member.isOnBreak ? 'En pause'
            : member.servingEntryId ? 'En prestation'
            : member.waitingCount > 0 ? `${member.waitingCount} en attente`
            : 'Disponible'}
        </span>
      </span>
    </button>
  );
}

/** Compteur vivant : la durée de prestation s'incrémente à l'écran. */
function useLiveElapsed(from: string | null): number | null {
  const [value, setValue] = useState(() => elapsedSeconds(from));
  useEffect(() => {
    setValue(elapsedSeconds(from));
    if (!from) return;
    const timer = setInterval(() => setValue(elapsedSeconds(from)), 1000);
    return () => clearInterval(timer);
  }, [from]);
  return value;
}
