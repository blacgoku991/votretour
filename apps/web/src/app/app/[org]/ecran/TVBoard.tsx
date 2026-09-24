'use client';

import type { CSSProperties, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { initials } from '@/lib/format';
import type { DisplayRefresh, DisplaySnapshot } from '@/server/display';
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
import { profileHintFor, statusLabelFor, tvScreenFor, type TvScreen } from './tv/model';
import { DeskTV } from './tv/DeskTV';
import { PickupTV } from './tv/PickupTV';
import { TableTV } from './tv/TableTV';
import { WorkshopTV } from './tv/WorkshopTV';
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
 *
 * Données : un DisplaySnapshot (server/display.ts, migrations 0031 et
 * 0036), jamais l'instantané du poste du pro. Le téléviseur est public ; il
 * ne reçoit que ce qu'il affiche : prénoms au comptoir, initiales dans
 * « À suivre ».
 *
 * PAR MÉTIER (lot P5) : l'instantané est une union discriminée par
 * `profile`. Le cadre (bande haute, horloge, rafraîchissement,
 * anti-marquage, plein écran) est commun ; le corps est aiguillé par
 * `tvScreenFor` (tv/model.ts) :
 *   walkin, event     le corps ci-dessous, INCHANGÉ (mêmes nœuds, mêmes
 *                     classes : les barbiers ne voient rien bouger) ;
 *   vehicle, device   tv/WorkshopTV : « Véhicules prêts », plaque masquée ;
 *   table             tv/TableTV : « Tables prêtes », chevalets ;
 *   desk              tv/DeskTV : le tableau d'appel, numéros seulement ;
 *   retail            tv/PickupTV : « Commandes prêtes ».
 * Le mode événement (bandeau, QR) ne concerne que walkin et event.
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

/** Vrai quand la page est déjà en plein écran (le bouton devient inutile). */
function useIsFullscreen(): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => setFull(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return full;
}

/**
 * Pointeur au repos : après IDLE_MS sans mouvement, `data-idle` passe à
 * « true » sur le cadre et le bouton « Plein écran » s'efface. Écriture
 * directe de l'attribut : aucun rendu React.
 */
const IDLE_MS = 4000;
function useIdleFlag(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    let timer = 0;
    const wake = () => {
      node.dataset.idle = 'false';
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { node.dataset.idle = 'true'; }, IDLE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      delete node.dataset.idle;
    };
  }, [ref, enabled]);
}

/** Le lieu sans le nom de l'enseigne : « Barber House — Paris 11 » → « Paris 11 ». */
function placeLabel(locationName: string, brand: string): string {
  const name = locationName.trim();
  const head = brand.trim();
  if (!head || !name.toLocaleLowerCase('fr').startsWith(head.toLocaleLowerCase('fr'))) return name;
  // « Barber Housekeeping » ne commence pas par l'enseigne « Barber House ».
  if (/[\p{L}\p{N}]/u.test(name.charAt(head.length))) return name;
  const rest = name.slice(head.length).replace(/^[\s\-–—·,:|/]+/, '').trim();
  return rest || name;
}

/** Cases du tableau pour un prénom : juste sa longueur (6 au moins), 12 au plus. */
function nameCells(name: string): number {
  return Math.min(12, Math.max(6, Array.from(name).length));
}

/**
 * Marqueur de forme envoyé à /api/tv/snapshot (même valeur dans route.ts).
 * Un téléviseur reste allumé pendant les déploiements : il fait tourner le
 * bundle d'avant, qui ne sait pas lire la forme d'aujourd'hui. La route
 * répond 401 à toute requête sans ce marqueur, et l'ancien bundle se
 * recharge alors de lui-même (son cookie d'appairage est intact) au lieu de
 * planter sur un champ absent. Toute évolution de DisplaySnapshot qui casse
 * la lecture change cette valeur, des deux côtés.
 */
const TV_SNAPSHOT_SHAPE = 'display-1';

/**
 * Garde de réception : pendant un déploiement progressif, le nouveau bundle
 * peut encore interroger un ancien serveur. On n'accepte que la forme de
 * l'écran ; sinon l'écran garde son dernier état et réessaie.
 */
function isDisplaySnapshot(value: unknown): value is DisplaySnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Record<keyof DisplaySnapshot, unknown>>;
  return Array.isArray(candidate.upcoming)
    && Array.isArray(candidate.serving)
    && Array.isArray(candidate.staff)
    && typeof candidate.counts === 'object' && candidate.counts !== null;
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
  refresh: refreshAction,
  eventTheme: initialEventTheme = null,
  kioskMode = false,
  variant = 'full',
}: {
  orgSlug: string;
  organizationName: string;
  logoUrl: string | null;
  /** L'instantané d'affichage (server/display.ts), jamais celui du poste du pro. */
  initialSnapshot: DisplaySnapshot | null;
  queues: { id: string; name: string }[];
  /** Kiosque : route appairée par cookie (/api/tv/snapshot). */
  snapshotEndpoint?: string | null;
  /** Écran d'un membre connecté : action serveur qui revérifie l'accès. */
  refresh?: (queueId: string) => Promise<DisplayRefresh>;
  eventTheme?: TVEventTheme | null;
  kioskMode?: boolean;
  /** 'preview' : aperçu à l'échelle dans le tableau de bord (cadre d'écran, lien plein écran). */
  variant?: 'full' | 'preview';
}) {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(initialSnapshot);
  const [eventTheme, setEventTheme] = useState<TVEventTheme | null>(initialEventTheme);
  const clock = useClock();
  const isFullscreen = useIsFullscreen();
  const shiftRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  useIdleFlag(frameRef, variant === 'full' && !kioskMode && snapshot !== null);
  const queueId = snapshot?.queue.id ?? queues[0]?.id ?? null;

  const refreshNow = useCallback(async () => {
    if (!queueId) return;

    if (snapshotEndpoint) {
      try {
        const response = await fetch(snapshotEndpoint, {
          cache: 'no-store',
          headers: { 'x-tv-shape': TV_SNAPSHOT_SHAPE },
        });
        if (response.status === 401) {
          window.location.reload();
          return;
        }

        const payload = await response.json() as {
          ok: boolean;
          data?: {
            snapshot?: unknown;
            event?: TVEventTheme | null;
          };
        };

        if (payload.ok && payload.data) {
          if ('snapshot' in payload.data) {
            const next = payload.data.snapshot;
            if (next === null) setSnapshot(null);
            else if (isDisplaySnapshot(next)) setSnapshot(next);
          }
          if ('event' in payload.data) setEventTheme(payload.data.event ?? null);
        }
      } catch {
        // L'écran garde le dernier état connu et réessaie au prochain poll.
      }
      return;
    }

    if (!refreshAction) return;
    try {
      const result = await refreshAction(queueId);
      if (result.ok) setSnapshot(result.data.snapshot);
    } catch {
      // Réseau coupé : même règle, le dernier état reste affiché.
    }
  }, [queueId, snapshotEndpoint, refreshAction]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshNow();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshNow]);

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

  // Initiales calculées en base : les prénoms de la file n'arrivent plus ici.
  const upcoming = useMemo<TvQueueItem[]>(() => snapshot?.upcoming ?? [], [snapshot]);
  const slats = useQueueSlats(upcoming);
  // La file entière : upcoming n'en porte que les TV_MAX_SLATS premières.
  const upcomingCount = snapshot?.counts.upcoming ?? 0;

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
  const screen = tvScreenFor(snapshot);
  // Un bandeau d'événement n'a de sens que sur une file de passage.
  const theme = screen === 'walkin' ? eventTheme : null;
  const activeLogo = theme?.logoUrl || logoUrl;
  const title = theme?.name || organizationName;
  const shown = serving.slice(0, 3);
  const waitingLabel = counts.waiting > 1 ? 'personnes en attente' : 'personne en attente';
  // Le téléphone compte toute la file (prestation comprise) ; l'écran met
  // en grand ceux qui attendent. La ligne du dessous relie les deux.
  const atCounter = Math.max(0, counts.active - counts.waiting);
  const brand = theme ? organizationName : title;
  const place = placeLabel(location.name, brand);
  const statusLabel = statusLabelFor(screen, queue.status);
  const statusPip = queue.status === 'open' ? 'pip pip--live' : queue.status === 'paused' ? 'pip pip--warn' : 'pip pip--off';
  const served = counts.completedToday;
  const sceneSlats = slats.length > 0
    ? slats.map(({ id, state, label, hint }) => ({ id, state, label, hint }))
    : [{ id: 'tv-ghost', state: 'ghost' as const, label: 'Prochain client' }];

  return (
    <div className={styles.frame} data-variant={variant} style={frameStyle} ref={frameRef}>
      <Root
        className={styles.screen}
        data-event={theme ? 'true' : 'false'}
        data-screen={screen === 'walkin' ? undefined : screen}
      >
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
                  {theme ? `${organizationName} · ` : ''}{place}
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
              ) : kioskMode || isFullscreen ? null : (
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

          {screen !== 'walkin' && <ProfileBody snapshot={snapshot} screen={screen} />}

          {theme && (
            <section className={styles.event} aria-label="Événement en cours">
              {theme.coverUrl && (
                <span
                  className={styles.eventCover}
                  style={{ backgroundImage: `url(${JSON.stringify(theme.coverUrl)})` }}
                  aria-hidden="true"
                />
              )}
              <div className={styles.eventCopy}>
                <span className={`t-label ${styles.eventKicker}`}>Drop · événement</span>
                <h2 className={styles.eventTitle}>{theme.heroTitle || theme.name}</h2>
                {theme.rulesText && <p className={styles.eventRules}>{theme.rulesText}</p>}
              </div>
              {theme.id && (
                <figure className={styles.eventQr}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={'/api/event/qr?event=' + encodeURIComponent(theme.id)} alt="QR pour rejoindre l’événement" />
                  <figcaption>{theme.qrLabel || 'Scannez pour rejoindre la file'}</figcaption>
                </figure>
              )}
            </section>
          )}

          {screen === 'walkin' && (
            <div className={styles.main}>
              <section className={styles.counter} aria-labelledby="tv-comptoir">
                <div className={styles.head}>
                  <h2 id="tv-comptoir" className={`t-label ${styles.headLabel}`}>Au comptoir</h2>
                  {staff.length > 0 && (
                    <ul className={styles.team} aria-label="Équipe">
                      {staff.slice(0, 6).map((member) => {
                        const tone = member.isOnBreak ? 'pause' : member.isServing ? 'busy' : 'free';
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
                        const name = (entry.name ?? 'Client').trim().toUpperCase().slice(0, 12);
                        const cells = nameCells(name);
                        // Une tuile fait 0,74em + 0,06em d'écart : la rangée tient la colonne.
                        const unit = Math.min(shown.length > 1 ? 76 : 128, Math.floor(1000 / (cells * 0.8)));
                        return (
                          <li key={entry.id} className={styles.servingRow}>
                            <FlapText
                              fixed
                              tile
                              cells={cells}
                              stagger={40}
                              text={name}
                              label={entry.name ?? 'Client'}
                              size={`calc(var(--u) * ${unit})`}
                            />
                            <span className={styles.with}>
                              {entry.staffName ? <>avec <strong>{entry.staffName}</strong></> : 'En prestation'}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className={styles.idle}>Prêt pour le prochain client</p>
                  )}
                  {counts.serving > shown.length && (
                    <p className={styles.more}>+ {counts.serving - shown.length} en prestation</p>
                  )}
                </div>

                <div className={styles.waiting}>
                  <FlapNumber
                    tile
                    value={counts.waiting}
                    label={`${counts.waiting} ${waitingLabel}`}
                    size="calc(var(--u) * 232)"
                  />
                  <span className={styles.waitingText}>
                    <span className={styles.waitingLabel}>{waitingLabel}</span>
                    {atCounter > 0 && (
                      <span className={styles.waitingTotal}>
                        + {atCounter} au comptoir · <strong>{counts.active}</strong> dans la file
                      </span>
                    )}
                  </span>
                </div>
              </section>

              <section className={styles.next} aria-labelledby="tv-suivre">
                <div className={styles.head}>
                  <h2 id="tv-suivre" className={`t-label ${styles.headLabel}`}>À suivre</h2>
                  <span className={styles.headNote}>
                    {upcomingCount === 0
                      ? 'Personne pour l’instant'
                      : upcomingCount > TV_MAX_SLATS
                        ? `Les ${TV_MAX_SLATS} premiers sur ${upcomingCount}`
                        : 'Positions dans la file'}
                  </span>
                </div>
                <div
                  className={styles.sceneBox}
                  style={{ ['--tv-fit' as string]: Math.min(1, 4.6 / Math.max(1, sceneSlats.length)).toFixed(3) } as CSSProperties}
                >
                  <FloorScene
                    size="lg"
                    spill
                    positions={false}
                    tilt={40}
                    turn={-3}
                    className={styles.scene}
                    slats={sceneSlats}
                    label={upcomingCount === 0
                      ? 'Personne en attente'
                      : `${upcomingCount} ${upcomingCount > 1 ? 'personnes' : 'personne'} à suivre`}
                  />
                </div>
              </section>
            </div>
          )}

          {screen === 'walkin' && (
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
                {theme?.qrLabel || 'Approchez votre téléphone de la plaque Rangvia pour rejoindre la file.'}
              </span>
              <span className={styles.served}>
                <strong className="t-num">{served}</strong> {served > 1 ? 'clients servis' : 'client servi'} aujourd’hui
              </span>
            </footer>
          )}
        </div>
      </Root>
    </div>
  );
}

/**
 * Le corps d'un écran de métier. Le double contrôle (écran ET profil)
 * rétrécit le type sans conversion : chaque écran ne reçoit que sa forme.
 */
function ProfileBody({ snapshot, screen }: { snapshot: DisplaySnapshot; screen: TvScreen }) {
  // La consigne du pied dépend du métier ET de l'état de la file (tv/model.ts).
  const hint = profileHintFor(snapshot.profile, snapshot.queue.status);
  if (screen === 'workshop' && (snapshot.profile === 'vehicle' || snapshot.profile === 'device')) {
    return <WorkshopTV snapshot={snapshot} hint={hint} />;
  }
  if (screen === 'table' && snapshot.profile === 'table') return <TableTV snapshot={snapshot} hint={hint} />;
  if (screen === 'desk' && snapshot.profile === 'desk') return <DeskTV snapshot={snapshot} hint={hint} />;
  if (screen === 'pickup' && snapshot.profile === 'retail') return <PickupTV snapshot={snapshot} hint={hint} />;
  return null;
}
