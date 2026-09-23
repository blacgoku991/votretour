'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchQueueSnapshot } from '@/server/actions/queue';
import { initials } from '@/lib/format';
import type { QueueSnapshot } from '@/lib/types';
import { FlapNumber, FlapText } from '@/components/FlapNumber';
import { FloorScene } from '@/components/objects/FloorScene';
import { useReducedMotion } from '@/components/motion/useMotionPreference';
import {
  dropLeaving,
  initialSlats,
  reconcileSlats,
  TV_LEAVE_MS,
  TV_MAX_SLATS,
  unfoldFresh,
  type TvQueueItem,
  type TvSlat,
} from './tvSlats';
import styles from './tv.module.css';

/**
 * L'ÉCRAN DE SALLE — la file en grand, lisible à 5 mètres.
 *
 * Utilisé par /ecran/[org], par le kiosque /tv et, en aperçu, par
 * /app/[org]/ecran. Toute la mise en page est exprimée en unités de
 * conteneur (--u = 1 px d'un écran 1920 × 1080) : l'aperçu du tableau de
 * bord est exactement l'écran du salon, à l'échelle.
 *
 * Gauche : « Au comptoir » (prénoms en volets) et le grand volet des
 * personnes en attente. Droite : « À suivre », la file couchée au sol,
 * en lattes anonymes (position et initiales au plus) qui avancent par
 * crans et passent le seuil.
 *
 * Aucune valeur liée au temps n'est rendue côté serveur : l'horloge et le
 * décalage anti-marquage arrivent après montage.
 */

export interface TVEventTheme {
  id?: string;
  name: string;
  status: string;
  heroTitle: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  accentHex: string;
  rulesText: string | null;
  qrLabel: string | null;
}

/** Décalages anti-marquage (px), un cran toutes les 10 minutes. */
const BURN_SHIFTS: Array<[number, number]> = [
  [0, 0], [2, 0], [2, 2], [0, 2], [-2, 2], [-2, 0], [-2, -2], [0, -2], [2, -2],
];
const BURN_EVERY_MS = 10 * 60 * 1000;

function useClock(): string | null {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return time;
}

/** Lattes « À suivre » : Passage de la tête, avance d'un cran, arrivées qui se déplient. */
function useQueueSlats(items: TvQueueItem[]): TvSlat[] {
  const reduced = useReducedMotion();
  const [slats, setSlats] = useState<TvSlat[]>(() => initialSlats(items));
  const signature = items.map((item) => `${item.id}:${item.called ? 1 : 0}:${item.initials ?? ''}`).join('|');
  const lastSignature = useRef(signature);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    const current = itemsRef.current;
    setSlats((prev) => reconcileSlats(prev, current, !reduced));
    if (reduced) return;

    // Arrivées : repliées pendant une image, puis dépliées (transition).
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setSlats((prev) => unfoldFresh(prev, current)));
    });
    const drop = window.setTimeout(() => setSlats(dropLeaving), TV_LEAVE_MS);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(drop);
      // Un nouveau snapshot pendant le mouvement : on pose l'état final.
      setSlats((prev) => dropLeaving(unfoldFresh(prev, current)));
    };
  }, [signature, reduced]);

  return slats;
}

export function TVBoard({
  orgSlug,
  organizationName,
  logoUrl,
  initialSnapshot,
  queues,
  snapshotEndpoint = null,
  eventTheme: initialEventTheme = null,
  kioskMode = false,
  variant = 'full',
}: {
  orgSlug: string;
  organizationName: string;
  logoUrl: string | null;
  initialSnapshot: QueueSnapshot | null;
  queues: { id: string; name: string }[];
  snapshotEndpoint?: string | null;
  eventTheme?: TVEventTheme | null;
  kioskMode?: boolean;
  /** 'preview' : aperçu à l'échelle dans le tableau de bord (cadre d'écran, lien plein écran). */
  variant?: 'full' | 'preview';
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [eventTheme, setEventTheme] = useState<TVEventTheme | null>(initialEventTheme);
  const clock = useClock();
  const shiftRef = useRef<HTMLDivElement>(null);
  const queueId = snapshot?.queue.id ?? queues[0]?.id ?? null;

  const refresh = useCallback(async () => {
    if (!queueId) return;

    if (snapshotEndpoint) {
      try {
        const response = await fetch(snapshotEndpoint, { cache: 'no-store' });
        if (response.status === 401) {
          window.location.reload();
          return;
        }

        const payload = await response.json() as {
          ok: boolean;
          data?: {
            snapshot?: QueueSnapshot | null;
            event?: TVEventTheme | null;
          };
        };

        if (payload.ok && payload.data) {
          if ('snapshot' in payload.data) setSnapshot(payload.data.snapshot ?? null);
          if ('event' in payload.data) setEventTheme(payload.data.event ?? null);
        }
      } catch {
        // L'écran garde le dernier état connu et réessaie au prochain poll.
      }
      return;
    }

    const result = await fetchQueueSnapshot(queueId);
    if (result.ok) setSnapshot(result.data.snapshot);
  }, [queueId, snapshotEndpoint]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Anti-marquage : tout le contenu se décale de ±2 px toutes les 10 minutes.
  // Écriture directe du style, après montage : aucun rendu React.
  useEffect(() => {
    let step = 0;
    const id = window.setInterval(() => {
      step = (step + 1) % BURN_SHIFTS.length;
      const [x, y] = BURN_SHIFTS[step] ?? [0, 0];
      if (shiftRef.current) shiftRef.current.style.transform = `translate(${x}px, ${y}px)`;
    }, BURN_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);

  const upcoming = useMemo<TvQueueItem[]>(() => {
    if (!snapshot) return [];
    return [
      ...snapshot.called.map((entry) => ({ id: entry.id, called: true, initials: entry.name ? initials(entry.name) : null })),
      ...snapshot.waiting.map((entry) => ({ id: entry.id, called: false, initials: entry.name ? initials(entry.name) : null })),
    ];
  }, [snapshot]);
  const slats = useQueueSlats(upcoming);

  const accent = eventTheme?.accentHex && /^#[0-9A-Fa-f]{6}$/.test(eventTheme.accentHex)
    ? eventTheme.accentHex
    : null;
  const frameStyle = (accent ? { '--tv-event': accent } : {}) as CSSProperties;
  const Root = variant === 'preview' ? 'div' : 'main';

  if (!snapshot) {
    return (
      <div className={styles.frame} data-variant={variant} style={frameStyle}>
        <Root className={styles.screen}>
          <div className={styles.empty}>
            <span className="t-label">Écran de salle</span>
            <p>Aucune file à afficher.</p>
          </div>
        </Root>
      </div>
    );
  }

  const { queue, location, serving, counts, staff } = snapshot;
  const activeLogo = eventTheme?.logoUrl || logoUrl;
  const title = eventTheme?.name || organizationName;
  const shown = serving.slice(0, 3);
  const waitingLabel = counts.waiting > 1 ? 'personnes en attente' : 'personne en attente';
  const statusLabel = queue.status === 'open' ? 'File ouverte' : queue.status === 'paused' ? 'En pause' : 'File fermée';
  const statusPip = queue.status === 'open' ? 'pip pip--live' : queue.status === 'paused' ? 'pip pip--warn' : 'pip pip--off';
  const served = counts.completedToday;
  const sceneSlats = slats.length > 0
    ? slats.map(({ id, state, label, hint }) => ({ id, state, label, hint }))
    : [{ id: 'tv-ghost', state: 'ghost' as const, label: 'Prochain client' }];

  return (
    <div className={styles.frame} data-variant={variant} style={frameStyle}>
      <Root className={styles.screen} data-event={eventTheme ? 'true' : 'false'}>
        <div className={styles.content} ref={shiftRef}>
          <header className={styles.top}>
            <div className={styles.brand}>
              <span className={styles.logo}>
                {activeLogo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={activeLogo} alt="" />
                  : <span>{initials(title)}</span>}
              </span>
              <span className={styles.brandText}>
                <h1 className={`t-board ${styles.name}`}>{title}</h1>
                <span className={styles.meta}>
                  {eventTheme ? `${organizationName} · ` : ''}{location.name}
                </span>
              </span>
            </div>

            <div className={styles.topRight}>
              <span className={styles.status}>
                <i className={statusPip} aria-hidden="true" />
                {statusLabel}
              </span>

              {queues.length > 1 && !kioskMode && (
                <select
                  className={`select ${styles.select}`}
                  value={queue.id}
                  aria-label="File affichée"
                  onChange={(e) => {
                    window.location.href = `/ecran/${orgSlug}?file=${encodeURIComponent(e.target.value)}`;
                  }}
                >
                  {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              )}

              {variant === 'preview' ? (
                <a className={`btn btn--ghost btn--sm ${styles.control}`} href={`/ecran/${orgSlug}`}>
                  Plein écran
                </a>
              ) : (
                <button
                  type="button"
                  className={`btn btn--ghost btn--sm ${styles.control}`}
                  onClick={() => document.documentElement.requestFullscreen?.()}
                >
                  Plein écran
                </button>
              )}

              <time className={styles.clock}>
                <FlapText
                  static
                  fixed
                  tile
                  cells={5}
                  text={clock ?? '--:--'}
                  label={clock ? `Il est ${clock}` : 'Heure'}
                  size="calc(var(--u) * 64)"
                />
              </time>
            </div>
          </header>

          {eventTheme && (
            <section className={styles.event} aria-label="Événement en cours">
              {eventTheme.coverUrl && (
                <span
                  className={styles.eventCover}
                  style={{ backgroundImage: `url(${JSON.stringify(eventTheme.coverUrl)})` }}
                  aria-hidden="true"
                />
              )}
              <div className={styles.eventCopy}>
                <span className={`t-label ${styles.eventKicker}`}>Drop · événement</span>
                <h2 className={styles.eventTitle}>{eventTheme.heroTitle || eventTheme.name}</h2>
                {eventTheme.rulesText && <p className={styles.eventRules}>{eventTheme.rulesText}</p>}
              </div>
              {eventTheme.id && (
                <figure className={styles.eventQr}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={'/api/event/qr?event=' + encodeURIComponent(eventTheme.id)} alt="QR pour rejoindre l’événement" />
                  <figcaption>{eventTheme.qrLabel || 'Scannez pour rejoindre la file'}</figcaption>
                </figure>
              )}
            </section>
          )}

          <div className={styles.main}>
            <section className={styles.counter} aria-labelledby="tv-comptoir">
              <div className={styles.head}>
                <h2 id="tv-comptoir" className={`t-label ${styles.headLabel}`}>Au comptoir</h2>
                {staff.length > 0 && (
                  <ul className={styles.team} aria-label="Équipe">
                    {staff.slice(0, 6).map((member) => {
                      const tone = member.isOnBreak ? 'pause' : member.servingEntryId ? 'busy' : 'free';
                      const state = tone === 'pause' ? 'en pause' : tone === 'busy' ? 'en prestation' : 'disponible';
                      return (
                        <li key={member.id} className={styles.member} data-tone={tone}>
                          <i aria-hidden="true" />
                          <span>{member.name}</span>
                          <span className="sr-only">, {state}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className={styles.serving}>
                {shown.length ? (
                  <ol className={styles.servingList} data-count={shown.length}>
                    {shown.map((entry) => {
                      const pro = staff.find((s) => s.id === entry.staffId);
                      const name = (entry.name ?? 'Client').trim().toUpperCase().slice(0, 12);
                      return (
                        <li key={entry.id} className={styles.servingRow}>
                          <FlapText
                            fixed
                            tile
                            cells={12}
                            stagger={40}
                            text={name}
                            label={entry.name ?? 'Client'}
                            size={shown.length > 1 ? 'calc(var(--u) * 70)' : 'calc(var(--u) * 100)'}
                          />
                          <span className={styles.with}>
                            {pro?.name ? <>avec <strong>{pro.name}</strong></> : 'En prestation'}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className={styles.idle}>Prêt pour le prochain client</p>
                )}
                {serving.length > shown.length && (
                  <p className={styles.more}>+ {serving.length - shown.length} en prestation</p>
                )}
              </div>

              <div className={styles.waiting}>
                <FlapNumber
                  tile
                  value={counts.waiting}
                  label={`${counts.waiting} ${waitingLabel}`}
                  size="calc(var(--u) * 232)"
                />
                <span className={styles.waitingLabel}>{waitingLabel}</span>
              </div>
            </section>

            <section className={styles.next} aria-labelledby="tv-suivre">
              <div className={styles.head}>
                <h2 id="tv-suivre" className={`t-label ${styles.headLabel}`}>À suivre</h2>
                <span className={styles.headNote}>
                  {upcoming.length === 0
                    ? 'Personne pour l’instant'
                    : upcoming.length > TV_MAX_SLATS
                      ? `Les ${TV_MAX_SLATS} premiers sur ${upcoming.length}`
                      : 'Positions dans la file'}
                </span>
              </div>
              <div className={styles.sceneBox}>
                <FloorScene
                  size="lg"
                  spill
                  positions={false}
                  turn={-5}
                  className={styles.scene}
                  slats={sceneSlats}
                  label={upcoming.length === 0
                    ? 'Personne en attente'
                    : `${upcoming.length} ${upcoming.length > 1 ? 'personnes' : 'personne'} à suivre`}
                />
              </div>
            </section>
          </div>

          <footer className={styles.foot}>
            <span className={styles.hintLine}>
              <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={styles.nfc}>
                <g stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
                  <path d="M14 17.5a9 9 0 0 1 0 13" />
                  <path d="M20.5 12a17 17 0 0 1 0 24" />
                  <path d="M27 6.5a25 25 0 0 1 0 35" />
                </g>
                <circle cx="8" cy="24" r="3" fill="currentColor" />
              </svg>
              {eventTheme?.qrLabel || 'Approchez votre téléphone de la plaque Rangvia pour rejoindre la file.'}
            </span>
            <span className={styles.served}>
              <strong className="t-num">{served}</strong> {served > 1 ? 'clients servis' : 'client servi'} aujourd’hui
            </span>
          </footer>
        </div>
      </Root>
    </div>
  );
}
