'use client';

import { useEffect, useRef, useState } from 'react';
import { FlapNumber } from '@/components/FlapNumber';
import type { ProfileQueueSnapshot } from '@/lib/profiles/types';
import type { QueueStatus } from '@/lib/types';
import { noticeLabel, profileCounters, statusTitle, type Reach } from './logic';
import type { BoardError, EntryNotice } from './useBoardActions';
import legacy from '../board.module.css';
import styles from './board-common.module.css';

/**
 * L'HABILLAGE COMMUN DES POSTES À PROFIL : en-tête d'état, annonces,
 * badge d'envoi.
 *
 * L'en-tête reprend EXACTEMENT le dessin de `StatusHeader` (mêmes classes
 * de `board.module.css`) : un garagiste qui passe d'une file à l'autre
 * retrouve le même poste. Seuls les mots changent, tirés du registre
 * (« Dépôts ouverts », « rendus aujourd'hui ») ; `StatusHeader` lui-même
 * écrit « File ouverte » en dur, et le fichier des barbiers ne se modifie
 * pas.
 */

interface QueueRef { id: string; name: string; locationName: string; status: string }

const STATUS_OPTIONS: ReadonlyArray<{ value: QueueStatus; label: string }> = [
  { value: 'open', label: 'Ouverte' },
  { value: 'paused', label: 'En pause' },
  { value: 'closed', label: 'Fermée' },
];

export function ProfileStatusHeader({
  snapshot, queues, orgSlug, canOperate, pending, onStatus, children,
}: {
  snapshot: ProfileQueueSnapshot;
  queues: QueueRef[];
  orgSlug: string;
  canOperate: boolean;
  pending: boolean;
  onStatus: (status: QueueStatus, reason?: string) => void;
  /** Outils posés sous les compteurs (recherche, ajout…). */
  children?: React.ReactNode;
}) {
  const { queue, location } = snapshot;
  const status = queue.status;
  const [mode, setMode] = useState<'pause' | 'close' | null>(null);
  const [reason, setReason] = useState('');
  const segRef = useRef<HTMLDivElement | null>(null);

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
    setMode(value === 'paused' ? 'pause' : 'close');
  };

  const title = statusTitle(queue.profile, status);
  const pip = status === 'open' ? 'pip pip--live' : status === 'paused' ? 'pip pip--warn' : 'pip pip--off';
  const counters = profileCounters(snapshot);
  // Atelier : une file fermée ne touche pas les véhicules en cours. On le
  // dit au moment de fermer, pour que personne n'hésite.
  const workshop = queue.profile === 'vehicle' || queue.profile === 'device';

  return (
    <header className={legacy.head}>
      <div className={legacy.headTop}>
        <div className={legacy.headTitle}>
          <p className={legacy.headWhere}>
            <span className={pip} aria-hidden="true" />
            <span className="truncate">{location.name}</span>
          </p>
          <h1 className={legacy.statusLabel}>{title}</h1>
          {queues.length > 1 && (
            <select
              className={`select ${legacy.queuePicker}`}
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
          <div ref={segRef} className={`seg ${legacy.statusSeg}`} role="group" aria-label="État de la file" data-pending={pending ? '1' : undefined}>
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
                  <span className={legacy.segDot} aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {mode === 'pause' && (
        <form
          className={legacy.inlinePanel}
          data-tone="pause"
          onKeyDown={onPanelKey}
          onSubmit={(event) => {
            event.preventDefault();
            onStatus('paused', reason.trim() || undefined);
            setMode(null);
            setReason('');
          }}
        >
          <label className={legacy.inlineText} htmlFor="pause-reason">
            <strong>Mettre en pause ?</strong> Personne ne pourra s’inscrire ; le motif est affiché à vos clients.
            {workshop && ' Les fiches en cours continuent.'}
          </label>
          <div className={legacy.inlineActions}>
            <input
              id="pause-reason"
              className={`input ${legacy.pauseInput}`}
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
        <div className={legacy.inlinePanel} data-tone="close" role="alertdialog" aria-labelledby="close-question" onKeyDown={onPanelKey}>
          <p id="close-question" className={legacy.inlineText}>
            <strong>Fermer ?</strong>{' '}
            {workshop
              ? 'Plus aucun dépôt ne sera accepté. Les véhicules et appareils en cours restent suivis.'
              : 'Les personnes en attente seront prévenues.'}
          </p>
          <div className={legacy.inlineActions}>
            <button type="button" className="btn btn--danger btn--sm" onClick={() => { setMode(null); onStatus('closed'); }}>
              Fermer
            </button>
            <button type="button" className="btn btn--quiet btn--sm" autoFocus onClick={cancel}>Annuler</button>
          </div>
        </div>
      )}

      <dl className={`${legacy.counters} ${styles.counters}`} data-n={counters.length}>
        {counters.map((c) => (
          <div key={c.key} className={`${legacy.counter} ${styles.counter}`}>
            <dt className="t-label">{c.label}</dt>
            <dd><FlapNumber static value={c.value} size="2rem" label={`${c.value} ${c.label}`} /></dd>
          </div>
        ))}
      </dl>

      {children}
    </header>
  );
}

/** Retours d'action, posés comme ceux du poste des barbiers (même dessin). */
export function BoardToasts({
  error, flash, onClose,
}: {
  error: BoardError | null;
  flash: { text: string; tone: 'ok' | 'warn' | 'error' | 'muted' } | null;
  onClose: () => void;
}) {
  return (
    <div className={legacy.toasts} aria-live="polite">
      {error && (
        <div className={legacy.toast}>
          <div className={`banner banner--error ${legacy.toastBody}`} role="alert">
            <span>{error.message}</span>
            <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>Fermer</button>
          </div>
        </div>
      )}
      {flash && (
        <div className={legacy.toast}>
          <div className={`${legacy.flash} ${styles.flash}`} data-tone={flash.tone} role="status">
            <span className={legacy.flashMark} aria-hidden="true" />
            {flash.text}
          </div>
        </div>
      )}
    </div>
  );
}

/** Bandeau « en pause / fermé » (même dessin que le poste des barbiers). */
export function StatusNotice({ status, pauseReason, closedText }: { status: QueueStatus; pauseReason: string | null; closedText: string }) {
  if (status === 'open') return null;
  return (
    <div className={legacy.notices}>
      <div className="banner banner--warn">
        <span>
          {status === 'paused'
            ? `En pause${pauseReason ? ` — ${pauseReason}` : ''}. Personne ne peut s’inscrire.`
            : closedText}
        </span>
      </div>
    </div>
  );
}

/**
 * L'état RÉEL du dernier envoi d'une fiche. Rien n'est affiché tant que
 * le poste ne sait rien : il ne suppose jamais qu'un client est prévenu.
 */
export function NoticeBadge({ notice, timeZone, silenced = false }: { notice: EntryNotice | undefined; timeZone: string; silenced?: boolean }) {
  if (!notice) {
    if (!silenced) return null;
    return (
      <p className={styles.notice} data-tone="muted">
        <span className={styles.noticeDot} aria-hidden="true" />
        Client non prévenu
      </p>
    );
  }
  const label = noticeLabel(notice.reach as Reach, notice.at, timeZone);
  return (
    <p className={styles.notice} data-tone={label.tone}>
      <span className={styles.noticeDot} aria-hidden="true" />
      <span className={styles.noticeText}>{label.text}</span>
      {label.hint && <span className={styles.noticeHint}>{label.hint}</span>}
    </p>
  );
}

/**
 * « il y a 2 h 10 », « depuis hier 17:40 », « depuis lun. 09:12 ».
 * Appelé seulement avec l'horloge de `useNow` (nulle au rendu serveur) :
 * une durée ne casse jamais l'hydratation.
 */
export function sinceText(iso: string | null | undefined, now: number, timeZone: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'à l’instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h ${String(m % 60).padStart(2, '0')}`;
  const day = (d: number) => new Intl.DateTimeFormat('fr-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const at = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(t);
  if (day(t) === day(now - 86_400_000)) return `depuis hier ${at}`;
  const wd = new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(t);
  return `depuis ${wd} ${at}`;
}

/** Attente courte (« 12 min », « 1 h 05 »). */
export function waitShort(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return '< 1 min';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/**
 * Menu « … » d'une fiche : se ferme avec Échap (le focus revient au
 * bouton) et au clic hors du menu.
 */
export function useDisclosure() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);
  return { open, setOpen, buttonRef, panelRef };
}
