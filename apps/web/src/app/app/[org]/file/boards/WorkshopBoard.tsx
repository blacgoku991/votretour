'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { FlapNumber } from '@/components/FlapNumber';
import { Icon } from '@/components/AppShell';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { StageRail } from '@/components/objects/StageRail';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { DeviceGlyph, DEVICE_LABEL } from '@/components/objects/DeviceGlyph';
import { getProfile, stageDef } from '@/lib/profiles';
import { profileNotificationCopy } from '@/lib/profiles/copy';
import { DEVICE_ACCESSORIES, DEVICE_KINDS, TEXT_LIMITS } from '@/lib/profiles/details';
import { formatRegistrationInput, parseRegistration } from '@/lib/profiles/registration';
import { defaultTemplates } from '@/lib/profiles/templates';
import type {
  DeviceAccessory,
  DeviceKind,
  ProfileQueueSnapshot,
  ProfileStaffEntry,
  ProfileStage,
  QueueProfile,
  RegistrationCountry,
  StayChoice,
  WorkshopColumn,
} from '@/lib/profiles/types';
import {
  addProfileEntryAction,
  issueTrackingLink,
  sendTemplateMessage,
  type TrackingLink,
} from '@/server/actions/profile-queue';
import { useNow } from '../QueueBoard';
import {
  BoardToasts,
  NoticeBadge,
  ProfileStatusHeader,
  StatusNotice,
  sinceText,
  useDisclosure,
} from './BoardChrome';
import {
  activeEntries,
  agreeCount,
  clock,
  formatEta,
  fromZonedInput,
  labelKind,
  laneOf,
  parseAmountToCents,
  quoteStateOf,
  shortRef,
  storedColumn,
  toZonedInput,
  WORKSHOP_COLUMNS,
  workshopColumns,
  workshopPrimary,
  type WorkshopLaneKey,
  type WorkshopSort,
} from './logic';
import { useProfileBoard, type ProfileBoardApi } from './useBoardActions';
import common from './board-common.module.css';
import styles from './workshop.module.css';

/**
 * LE POSTE D'ATELIER — véhicules (garages, centres auto) et appareils
 * (réparation, SAV).
 *
 * Un planning d'atelier en quatre colonnes (conception, § 4.2), qui
 * tiennent toujours dans la largeur : à prendre en charge | en atelier
 * (diagnostic, réparation) | en attente client ou pièce (devis, pièce) |
 * prêts à récupérer. Les six étapes restent lisibles sur chaque fiche
 * (puce et rampe d'étapes) et filtrables en tête de colonne ; les fiches
 * rendues aujourd'hui sont dans une bande repliable, sous les colonnes.
 *
 * Au garage, chaque fiche est une latte dont l'encoche est devenue
 * l'œillet d'une étiquette de clé ; à l'atelier d'appareils, un ticket de
 * dépôt au bord droit dentelé (sa souche). Chacune porte SES actions : un
 * atelier rend ses véhicules dans le désordre, il n'y a jamais de
 * « suivant » automatique.
 *
 * La touche vermillon « Prêt · prévenir » est la seule couleur forte : le
 * garagiste prévient le client LUI-MÊME, au moment qu'il choisit, et le
 * poste dit ce qui s'est réellement passé (« Prévenu 14:32 ✓ », « Non
 * joignable », « Envoi indisponible »).
 *
 * Téléphone d'atelier d'abord (390 px) : une colonne à la fois, choisie
 * sur le pupitre à quatre stations. Tablette : deux colonnes sur deux
 * rangs. Bureau : les quatre côte à côte, sans défilement horizontal.
 */

interface QueueRef { id: string; name: string; locationName: string; status: string }

interface Props {
  orgSlug: string;
  initialSnapshot: ProfileQueueSnapshot;
  queues: QueueRef[];
  canOperate: boolean;
  canConfigure: boolean;
  actorStaffId?: string | null;
}

/** Fiche rendue pendant cette session, montrée dans « Rendu » (le serveur ne garde que le compte). */
interface HandedOver {
  id: string;
  title: string;
  at: number;
}

const SORTS: ReadonlyArray<{ value: WorkshopSort; label: string }> = [
  { value: 'arrival', label: 'Arrivée' },
  { value: 'eta', label: 'Promesse' },
  { value: 'stage', label: 'Étape' },
];

function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* confort seulement */ }
}

export function WorkshopBoard({ orgSlug, initialSnapshot, queues, canOperate }: Props) {
  const api = useProfileBoard({ orgSlug, initialSnapshot, canOperate });
  const { snapshot } = api;
  const profile = snapshot.queue.profile;
  const vocab = getProfile(profile).vocab;
  const now = useNow(30_000);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WorkshopSort>('arrival');
  const [adding, setAdding] = useState(false);
  const [handedOver, setHandedOver] = useState<HandedOver[]>([]);
  const [handedOpen, setHandedOpen] = useState(false);
  const columnKey = `rangvia:atelier:colonne:${snapshot.queue.id}`;
  const [active, setActive] = useState<WorkshopColumn>('intake');
  // Filtre par étape, colonne par colonne (« Diagnostic » dans « En atelier »).
  const [stageFilter, setStageFilter] = useState<Partial<Record<WorkshopColumn, ProfileStage>>>({});
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Dernière colonne choisie au téléphone : relue après le montage
  // (jamais au rendu serveur), confort seulement. Une étape mémorisée par
  // une version précédente est ramenée à sa colonne.
  useEffect(() => {
    const stored = storedColumn(readStored(columnKey));
    if (stored) setActive(stored);
  }, [columnKey]);

  // « / » place le curseur dans la recherche, sauf pendant une saisie.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const t = event.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const entries = useMemo(() => activeEntries(snapshot), [snapshot]);
  // Les fiches déjà là à l'ouverture ne se « posent » pas : l'arrivée
  // animée est réservée à un dépôt nouveau ou à une fiche qui change
  // d'étape pendant qu'on regarde. Étapes figées au montage.
  const initialLanes = useRef<Map<string, WorkshopLaneKey> | null>(null);
  if (initialLanes.current === null) {
    initialLanes.current = new Map(activeEntries(initialSnapshot).map((e) => [e.id, laneOf(profile, e)]));
  }
  const isFresh = (entry: ProfileStaffEntry) => initialLanes.current!.get(entry.id) !== laneOf(profile, entry);
  const columns = useMemo(() => workshopColumns(profile, entries, { query, sort }), [profile, entries, query, sort]);
  const matches = query.trim() ? [...columns.values()].reduce((n, l) => n + l.length, 0) : null;
  const serviceName = useCallback(
    (id: string | null) => snapshot.services.find((s) => s.id === id)?.name ?? null,
    [snapshot.services],
  );

  const select = (key: WorkshopColumn) => {
    setActive(key);
    writeStored(columnKey, key);
  };

  // Une recherche qui ne trouve rien dans la colonne ouverte au téléphone
  // bascule sur la première colonne qui a un résultat.
  useEffect(() => {
    if (!query.trim()) return;
    if ((columns.get(active)?.length ?? 0) > 0) return;
    const first = WORKSHOP_COLUMNS.find((c) => (columns.get(c.key)?.length ?? 0) > 0);
    if (first) setActive(first.key);
  }, [query, columns, active]);

  const onHandedOver = useCallback((entry: ProfileStaffEntry) => {
    setHandedOver((list) => [{ id: entry.id, title: entryTitle(profile, entry), at: Date.now() }, ...list].slice(0, 12));
  }, [profile]);

  const handedCount = Math.max(snapshot.counts.completedToday, handedOver.length);

  return (
    <div className={`shell ${styles.board}`} data-profile={profile}>
      <ProfileStatusHeader
        snapshot={snapshot}
        queues={queues}
        orgSlug={orgSlug}
        canOperate={canOperate}
        pending={api.statusPending}
        onStatus={api.setStatus}
      >
        <div className={`${common.toolbar} ${styles.toolbar}`}>
          <label className={common.search}>
            <span className="sr-only">
              {profile === 'vehicle' ? 'Rechercher une immatriculation, un prénom ou un modèle' : 'Rechercher un dossier, un prénom ou un modèle'}
            </span>
            <svg className={common.searchIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="8.6" cy="8.6" r="5.6" />
              <path d="m13 13 4.2 4.2" />
            </svg>
            <input
              ref={searchRef}
              className="input"
              type="search"
              inputMode="search"
              autoComplete="off"
              spellCheck={false}
              placeholder={profile === 'vehicle' ? 'Plaque, prénom, modèle…' : 'Dossier, prénom, modèle…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
            />
            <kbd className={common.kbd} aria-hidden="true">/</kbd>
          </label>
          <p className={common.searchCount} role="status" aria-live="polite">
            {matches == null ? '' : matches === 0 ? 'Aucune fiche' : `${matches} fiche${matches > 1 ? 's' : ''}`}
          </p>
          <div className={`seg ${styles.sortSeg}`} role="group" aria-label="Trier les fiches">
            {SORTS.map((s) => (
              <button key={s.value} type="button" aria-pressed={sort === s.value} onClick={() => setSort(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
          {canOperate && (
            <button
              type="button"
              className={`btn ${adding ? 'btn--ghost' : 'btn--solid'} ${styles.addBtn}`}
              aria-expanded={adding}
              aria-controls="atelier-ajout"
              onClick={() => setAdding((v) => !v)}
            >
              <span aria-hidden="true" className={styles.plus}>{adding ? '×' : '+'}</span>
              {adding ? 'Fermer' : (
                <span>Ajouter<span className={styles.addLong}>{profile === 'vehicle' ? ' un véhicule' : ' un appareil'}</span></span>
              )}
            </button>
          )}
        </div>
      </ProfileStatusHeader>

      <BoardToasts error={api.error} flash={api.flash} onClose={api.clearError} />
      <StatusNotice
        status={snapshot.queue.status}
        pauseReason={snapshot.queue.pauseReason}
        closedText="Dépôts fermés : les clients ne peuvent plus s’inscrire. Les fiches en cours restent suivies."
      />

      {adding && canOperate && (
        <div id="atelier-ajout">
          <AddDropoff
            orgSlug={orgSlug}
            snapshot={snapshot}
            onDone={() => setAdding(false)}
            api={api}
          />
        </div>
      )}

      {/* ------------------------------------------------ Le pupitre (téléphone)
          Quatre stations, une par colonne : il choisit la colonne affichée.
          Au bureau, les quatre colonnes sont côte à côte et il disparaît. */}
      <nav className={styles.strip} aria-label="Colonnes de l’atelier">
        <ol className={styles.stripList}>
          {WORKSHOP_COLUMNS.map((column) => {
            const n = columns.get(column.key)?.length ?? 0;
            return (
              <li key={column.key} className={styles.station} data-tone={column.tone} data-filled={n > 0 ? '1' : undefined}>
                <button
                  type="button"
                  aria-pressed={active === column.key}
                  aria-controls={`colonne-${column.key}`}
                  onClick={() => select(column.key)}
                  className={styles.stationBtn}
                >
                  <span className={styles.stationPip} aria-hidden="true">
                    <FlapNumber static value={n} size="1.125rem" label={`${n}`} />
                  </span>
                  <span className={styles.stationLabel} aria-hidden="true">{column.short}</span>
                  <span className="sr-only">{`${column.label} : ${n} fiche${n > 1 ? 's' : ''}`}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ------------------------------------------------ Les colonnes */}
      <div className={styles.lanes}>
        {WORKSHOP_COLUMNS.map((column) => {
          const all = columns.get(column.key) ?? [];
          const filter = stageFilter[column.key] ?? null;
          const list = filter ? all.filter((e) => laneOf(profile, e) === filter) : all;
          const headingId = `colonne-${column.key}-titre`;
          return (
            <section
              key={column.key}
              id={`colonne-${column.key}`}
              className={styles.lane}
              data-lane={column.key}
              data-tone={column.tone}
              data-active={active === column.key ? '1' : undefined}
              aria-labelledby={headingId}
            >
              <div className={styles.laneHead}>
                <h2 id={headingId} className={styles.laneTitle}>
                  <span className={styles.laneDot} aria-hidden="true" />
                  <span className={styles.laneName}>{column.label}</span>
                  <span className={common.count}>{all.length}</span>
                </h2>
                {column.stages.length > 1 && (
                  <div className={styles.laneFilters} role="group" aria-label={`Filtrer « ${column.label} » par étape`}>
                    {column.stages.map((stage) => {
                      const def = stageDef(profile, stage);
                      const n = all.filter((e) => laneOf(profile, e) === stage).length;
                      return (
                        <button
                          key={stage}
                          type="button"
                          className={styles.laneFilter}
                          data-tone={def?.tone ?? 'neutral'}
                          aria-pressed={filter === stage}
                          onClick={() => setStageFilter((f) => ({ ...f, [column.key]: f[column.key] === stage ? undefined : stage }))}
                        >
                          {def?.short ?? stage}
                          <span className={styles.laneFilterCount}>{n}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {list.length === 0 ? (
                <p className={styles.laneEmpty}>
                  {query.trim() || filter ? 'Aucune fiche ne correspond.' : emptyText(column.key)}
                </p>
              ) : (
                <ol className={styles.cards}>
                  {list.map((entry) => (
                    <li key={entry.id} data-lane={laneOf(profile, entry)}>
                      <WorkshopCard
                        entry={entry}
                        snapshot={snapshot}
                        api={api}
                        orgSlug={orgSlug}
                        canOperate={canOperate}
                        now={now}
                        serviceName={serviceName(entry.serviceId)}
                        onHandedOver={onHandedOver}
                        fresh={isFresh(entry)}
                        stageChip={column.stages.length > 1}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>

      {/* ------------------------------------------------ Rendus aujourd'hui */}
      <section className={styles.handed} data-open={handedOpen ? '1' : undefined} aria-labelledby="rendus-titre">
        <h2 id="rendus-titre" className={styles.handedTitle}>
          <button
            type="button"
            className={styles.handedToggle}
            aria-expanded={handedOpen}
            aria-controls="rendus-liste"
            onClick={() => setHandedOpen((v) => !v)}
          >
            <span className={styles.handedCount}>
              <FlapNumber static value={handedCount} size="1.375rem" label={`${handedCount}`} />
            </span>
            <span className={styles.handedLabel}>{agreeCount(handedCount, vocab.todayCounter)}</span>
            <svg className={styles.chevron} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 8 4 4 4-4" />
            </svg>
          </button>
        </h2>
        {handedOpen && (
          <div id="rendus-liste" className={styles.handedBody}>
            {handedOver.length === 0 ? (
              <p className={styles.handedNote}>
                {handedCount > 0
                  ? `Rendus avant l’ouverture de cet écran : ils sont comptés, pas listés.`
                  : `Rien de rendu pour l’instant aujourd’hui.`}
              </p>
            ) : (
              <ol className={styles.doneList}>
                {handedOver.map((h) => (
                  <li key={`${h.id}:${h.at}`}>
                    <span className="truncate">{h.title}</span>
                    <span className={styles.doneAt}>{clock(h.at, api.timeZone)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function emptyText(key: WorkshopColumn): string {
  switch (key) {
    case 'intake': return 'Aucun dépôt en attente.';
    case 'workshop': return 'Rien en diagnostic ni en réparation.';
    case 'waiting': return 'Aucun devis ni aucune pièce en attente.';
    case 'ready': return 'Rien à rendre pour l’instant.';
    default: return '';
  }
}

/**
 * Titre d'une fiche rendue, pour la bande « Rendus aujourd'hui » : « AB-123-CD
 * · Peugeot 208 », « Dossier 0042 · iPhone 13 ». L'immatriculation complète
 * reste sur le poste (réservé à `queue.operate`) ; l'écran de salle et
 * l'étiquette n'en reçoivent que la forme masquée.
 */
function entryTitle(profile: QueueProfile, entry: ProfileStaffEntry): string {
  const model = entry.details?.model?.trim();
  if (profile === 'device') return [entry.ticketNo ? `Dossier ${entry.ticketNo}` : null, model].filter(Boolean).join(' · ') || 'Appareil';
  return [entry.details?.registration, model].filter(Boolean).join(' · ') || 'Véhicule';
}

/* ==================================================================
   La fiche d'atelier
   ================================================================== */

type Panel =
  | { kind: 'menu' }
  | { kind: 'stage'; stage?: ProfileStage }
  | { kind: 'quote' }
  | { kind: 'eta' }
  | { kind: 'message'; key?: string }
  | { kind: 'edit' }
  | { kind: 'qr'; link: TrackingLink }
  | { kind: 'remove' };

function WorkshopCard({
  entry, snapshot, api, orgSlug, canOperate, now, serviceName, onHandedOver, fresh = false, stageChip = false,
}: {
  /** Arrivée dans la colonne après l'ouverture de l'écran : la fiche se pose. */
  fresh?: boolean;
  /** Colonne à plusieurs étapes (atelier, attente) : la puce dit laquelle. */
  stageChip?: boolean;
  entry: ProfileStaffEntry;
  snapshot: ProfileQueueSnapshot;
  api: ProfileBoardApi;
  orgSlug: string;
  canOperate: boolean;
  now: number | null;
  serviceName: string | null;
  onHandedOver: (entry: ProfileStaffEntry) => void;
}) {
  const profile = snapshot.queue.profile;
  const options = snapshot.queue.profileOptions ?? {};
  const vocab = getProfile(profile).vocab;
  const [panel, setPanel] = useState<Panel | null>(null);
  const menu = useDisclosure();
  const busy = api.busy === entry.id || api.busy === `qr:${entry.id}` || api.busy === `msg:${entry.id}`;
  const lane = laneOf(profile, entry);
  const def = stageDef(profile, entry.stage);
  const tone = def?.tone ?? 'neutral';
  const kind = labelKind(profile === 'device' ? 'device' : 'vehicle');
  const primary = workshopPrimary(profile, entry, options);
  const quote = quoteStateOf(entry);
  const details = entry.details ?? {};
  const eta = now == null ? null : formatEta(details.readyEta ?? null, new Date(now), api.timeZone);
  const etaLate = now != null && details.readyEta ? Date.parse(details.readyEta) < now && lane !== 'ready' : false;
  const who = entry.name?.trim() || null;
  const motif = serviceName ?? null;
  const label = profile === 'vehicle'
    ? `Fiche ${details.registration ?? shortRef(entry.id)}${details.model ? `, ${details.model}` : ''}`
    : `Dossier ${entry.ticketNo ?? shortRef(entry.id)}${details.model ? `, ${details.model}` : ''}`;
  const subject = profile === 'vehicle' ? (details.model || details.registration || 'Véhicule') : (details.model || `Dossier ${entry.ticketNo ?? ''}`.trim());

  const openPanel = (p: Panel) => { setPanel(p); menu.setOpen(false); };

  const act = (action: Parameters<ProfileBoardApi['advance']>[1], opts?: Record<string, unknown>, success?: string) =>
    api.advance(entry.id, action, opts, { success, subject });

  const onPrimary = async () => {
    if (!canOperate || busy) return;
    switch (primary.kind) {
      case 'start':
        await act('start_serving', undefined, `${subject} : pris en charge`);
        return;
      case 'diagnosed':
        openPanel({ kind: 'quote' });
        return;
      case 'repair':
        await act('set_stage', { stage: 'in_repair', notify: stageDef(profile, 'in_repair')?.notifyDefault ?? false }, `${subject} : en réparation`);
        return;
      case 'ready':
        // « Prêt · prévenir » : le garagiste prévient le client, maintenant.
        await act('set_stage', { stage: 'ready', notify: true });
        return;
      case 'handover': {
        const result = await act('complete', undefined, `${subject} : ${vocab.complete.toLowerCase()}`);
        if (result.ok) onHandedOver(entry);
        return;
      }
      default:
    }
  };

  const issueQr = async () => {
    menu.setOpen(false);
    const result = await api.run(`qr:${entry.id}`, () => issueTrackingLink(orgSlug, { entryId: entry.id }));
    if (result.ok) {
      setPanel({ kind: 'qr', link: result.data });
      api.say('QR de suivi prêt : faites-le scanner au client.', 'ok');
    }
  };

  return (
    <article
      className={styles.card}
      data-tone={tone}
      data-lane={lane}
      data-busy={busy ? '1' : undefined}
      data-fresh={fresh ? '1' : undefined}
      aria-label={label}
    >
      {profile === 'vehicle' && <span className={styles.eyelet} aria-hidden="true" />}

      <div className={styles.cardTop}>
        {profile === 'vehicle' ? (
          details.registration ? (
            <Immatriculation value={details.registration} country={details.country ?? 'FR'} size="md" className={styles.plate} />
          ) : (
            <span className={styles.noPlate}>Sans immatriculation · réf. {shortRef(entry.id)}</span>
          )
        ) : (
          <span className={styles.dossier}>
            <DeviceGlyph kind={details.deviceKind ?? 'other'} size={22} />
            {entry.ticketNo ? (
              <TicketNumber value={entry.ticketNo} kind="dossier" size="1.625rem" />
            ) : (
              <span className={styles.noPlate}>Réf. {shortRef(entry.id)}</span>
            )}
          </span>
        )}
        {canOperate && (
          // Le menu « … » en coin : la touche principale garde toute la
          // largeur de la fiche, même dans une colonne étroite.
          <button
            ref={menu.buttonRef}
            type="button"
            className={`${common.moreBtn} ${styles.more}`}
            aria-expanded={menu.open}
            aria-controls={`menu-${entry.id}`}
            aria-label={`Plus d’actions pour ${subject}`}
            onClick={() => menu.setOpen((v) => !v)}
          >
            <Icon name="more" />
          </button>
        )}
      </div>

      {((stageChip && def) || quote || details.keys || entry.claimPending) && (
        <p className={styles.flags}>
          {stageChip && def && <span className={styles.stageChip} data-tone={def.tone}>{def.short}</span>}
          {quote && <QuoteChip quote={quote} now={now} timeZone={api.timeZone} />}
          {details.keys && <span className="chip">Clés reçues</span>}
          {entry.claimPending && <span className="chip chip--copper" title="Un QR de suivi attend d’être scanné">QR en attente</span>}
        </p>
      )}

      <p className={styles.meta}>
        <strong>{details.model || (profile === 'device' && details.deviceKind ? DEVICE_LABEL[details.deviceKind] : 'Modèle non précisé')}</strong>
        {who && <span className={styles.who}>· {who}</span>}
        {motif && <span className="chip">{motif}</span>}
      </p>
      {details.reasonText && <p className={styles.reason}>« {details.reasonText} »</p>}
      {profile === 'device' && details.accessories && details.accessories.length > 0 && (
        <p className={styles.reason}>Déposé avec : {details.accessories.map((a) => ACCESSORY_LABEL[a]).join(', ')}</p>
      )}

      <p className={styles.times}>
        <span>{now == null ? ' ' : `Déposé ${sinceText(entry.joinedAt, now, api.timeZone)}`}</span>
        {details.stay === 'onsite' && <span className={styles.onsite}>attend sur place</span>}
        {eta && <span className={styles.eta} data-late={etaLate ? '1' : undefined}>{etaLate ? `${eta} · dépassé` : eta}</span>}
      </p>

      <StageRail profile={profile} current={entry.stage} timeZone={api.timeZone} />

      <NoticeBadge
        notice={api.notices[entry.id]}
        timeZone={api.timeZone}
        silenced={lane === 'ready' && entry.notified?.your_turn === 'silenced'}
      />

      {canOperate && (
        <div className={styles.actions}>
          <div className={styles.keyRow}>
            {primary.kind === 'quote_wait' ? (
              <p className={styles.waitNote} data-declined={quote?.status === 'declined' ? '1' : undefined}>
                {quote?.status === 'declined'
                  ? 'Devis refusé par le client. Proposez-en un autre, ou rendez-le en l’état.'
                  : 'Devis envoyé : la réponse du client s’affichera ici.'}
              </p>
            ) : (
              <button
                type="button"
                className={
                  primary.kind === 'ready'
                    ? `btn btn--signal btn--key ${styles.key}`
                    : primary.kind === 'handover'
                      ? `btn btn--solid ${styles.handover}`
                      : `btn btn--ghost ${styles.primary}`
                }
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={onPrimary}
              >
                {busy ? 'Un instant…' : primary.label}
              </button>
            )}
          </div>
          {(primary.kind === 'diagnosed' || primary.kind === 'quote_wait' || primary.kind === 'handover') && (
            <div className={styles.secondary}>
              {primary.kind === 'diagnosed' && (
                <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
                  onClick={() => act('set_stage', { stage: 'in_repair', notify: false }, `${subject} : en réparation`)}>
                  Réparer sans devis
                </button>
              )}
              {primary.kind === 'quote_wait' && (
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => openPanel({ kind: 'quote' })}>
                  Nouveau devis
                </button>
              )}
              {primary.kind === 'handover' && (
                <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => act('recall')}>
                  Relancer le client
                </button>
              )}
            </div>
          )}

          {menu.open && (
            <div ref={menu.panelRef} id={`menu-${entry.id}`} className={common.menu}>
              <button type="button" onClick={() => openPanel({ kind: 'stage' })}>Changer d’étape</button>
              <button type="button" onClick={() => openPanel({ kind: 'message' })}>Envoyer un message</button>
              <button type="button" onClick={() => openPanel({ kind: 'eta' })}>Promesse de délai</button>
              {profile === 'vehicle' && (
                <button type="button" aria-pressed={details.keys === true}
                  onClick={() => { menu.setOpen(false); void act('update_details', { details: { keys: !details.keys } }, details.keys ? 'Clés rendues' : 'Clés reçues'); }}>
                  {details.keys ? 'Clés rendues' : 'Clés reçues'}
                </button>
              )}
              {options.quotes !== false && lane !== 'quote_pending' && lane !== 'ready' && (
                <button type="button" onClick={() => openPanel({ kind: 'quote' })}>Envoyer un devis</button>
              )}
              <button type="button" onClick={issueQr}>QR de suivi</button>
              <a href={`/app/${orgSlug}/file/etiquette/${entry.id}`} target="_blank" rel="noopener">
                {kind.title} <span aria-hidden="true">↗</span>
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
              <button type="button" onClick={() => openPanel({ kind: 'edit' })}>Modifier la fiche</button>
              <button type="button" className={common.danger} onClick={() => openPanel({ kind: 'remove' })}>Retirer</button>
            </div>
          )}

          {panel?.kind === 'stage' && (
            <StagePanel
              entry={entry}
              snapshot={snapshot}
              busy={busy}
              onCancel={() => setPanel(null)}
              onConfirm={async (stage, notify) => {
                const result = await act('set_stage', { stage, notify }, `${subject} : ${stageDef(profile, stage)?.staff ?? stage}`);
                if (result.ok) setPanel(null);
              }}
            />
          )}
          {panel?.kind === 'quote' && (
            <QuotePanel
              busy={busy}
              initial={quote?.status === 'declined' ? null : entry.details?.quote ?? null}
              onCancel={() => setPanel(null)}
              onSend={async (amountCents, label, notify) => {
                const result = await act('send_quote', { amountCents, label, notify }, 'Devis enregistré');
                if (result.ok) setPanel(null);
              }}
            />
          )}
          {panel?.kind === 'eta' && (
            <EtaPanel
              current={details.readyEta ?? null}
              timeZone={api.timeZone}
              who={profile === 'vehicle' ? 'le garage' : 'l’atelier'}
              busy={busy}
              onCancel={() => setPanel(null)}
              onSave={async (iso) => {
                const result = await act('set_eta', { readyEta: iso }, iso ? 'Promesse enregistrée' : 'Promesse retirée');
                if (result.ok) setPanel(null);
              }}
            />
          )}
          {panel?.kind === 'message' && (
            <MessagePanel
              profile={profile}
              busy={api.busy === `msg:${entry.id}`}
              onCancel={() => setPanel(null)}
              onSend={async (templateKey) => {
                const result = await api.run(`msg:${entry.id}`, () => sendTemplateMessage(orgSlug, { entryId: entry.id, templateKey }));
                if (result.ok) {
                  api.recordNotice(entry.id, result.data.notice, subject);
                  if (!result.data.notice) api.say('Message envoyé');
                  setPanel(null);
                }
              }}
            />
          )}
          {panel?.kind === 'edit' && (
            <EditPanel
              profile={profile}
              entry={entry}
              busy={busy}
              onCancel={() => setPanel(null)}
              onSave={async (patch) => {
                const result = await act('update_details', { details: patch }, 'Fiche mise à jour');
                if (result.ok) setPanel(null);
              }}
            />
          )}
          {panel?.kind === 'qr' && (
            <div className={common.inline} style={{ ['--tone' as string]: 'var(--copper-500)' }}>
              <QrBlock link={panel.link} orgSlug={orgSlug} entryId={entry.id} printLabel={kind.print} timeZone={api.timeZone} onClose={() => setPanel(null)} compact />
            </div>
          )}
          {panel?.kind === 'remove' && (
            <div className={common.inline} role="alertdialog" aria-labelledby={`rm-${entry.id}`} style={{ ['--tone' as string]: 'var(--danger-text)' }}>
              <p id={`rm-${entry.id}`} className={common.inlineTitle}>
                Retirer cette fiche ? Le client ne pourra plus la suivre. À réserver aux erreurs de saisie.
              </p>
              <div className={common.inlineRow}>
                <button type="button" className="btn btn--danger btn--sm" disabled={busy}
                  onClick={async () => { const r = await act('remove', undefined, 'Fiche retirée'); if (r.ok) setPanel(null); }}>
                  Retirer
                </button>
                <button type="button" className="btn btn--quiet btn--sm" autoFocus onClick={() => setPanel(null)}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

const ACCESSORY_LABEL: Record<DeviceAccessory, string> = {
  charger: 'chargeur',
  case: 'coque',
  sim_removed: 'carte SIM retirée',
  memory_card: 'carte mémoire',
  box: 'boîte',
};

function QuoteChip({
  quote, now, timeZone,
}: { quote: NonNullable<ReturnType<typeof quoteStateOf>>; now: number | null; timeZone: string }) {
  // L'heure de la décision se lit dans le fuseau de l'atelier, comme le
  // reste du poste, et seulement une fois monté (jamais au rendu serveur).
  const at = quote.at && now != null ? clock(quote.at, timeZone) : null;
  if (quote.status === 'accepted') return <span className="chip chip--jade">Accordé{at ? ` ${at}` : ''}</span>;
  if (quote.status === 'declined') return <span className="chip chip--brique">Refusé{at ? ` ${at}` : ''}</span>;
  // « Devis 184,00 € · en attente depuis 42 min » (conception, § 4.2).
  const since = quote.at && now != null ? Math.max(0, Math.round((now - Date.parse(quote.at)) / 60_000)) : null;
  const wait = since == null
    ? null
    : since < 1
      ? 'envoyé à l’instant'
      : `en attente depuis ${since < 60 ? `${since} min` : `${Math.floor(since / 60)} h${since % 60 ? ` ${String(since % 60).padStart(2, '0')}` : ''}`}`;
  return (
    <span className={styles.quote} title={quote.label || undefined}>
      <strong>Devis {quote.amount}</strong>
      {wait && <span>{wait}</span>}
    </span>
  );
}

/* ------------------------------------------------ Changer d'étape */

function StagePanel({
  entry, snapshot, busy, onCancel, onConfirm,
}: {
  entry: ProfileStaffEntry;
  snapshot: ProfileQueueSnapshot;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (stage: ProfileStage, notify: boolean) => void;
}) {
  const profile = snapshot.queue.profile;
  // Le devis a sa propre action (montant, libellé) : pas d'étape « Devis » à vide.
  const choices = getProfile(profile).stages.filter((s) => s.key !== entry.stage && s.key !== 'quote_pending');
  const [stage, setStage] = useState<ProfileStage | null>(null);
  const def = stage ? stageDef(profile, stage) : null;
  const [notify, setNotify] = useState(false);
  const id = useId();
  const preview = def
    ? profileNotificationCopy(def.notifyKind === 'your_turn' ? 'your_turn' : 'stage_update', {
        profile,
        locationName: snapshot.location.name,
        stage: def.key,
        details: entry.details,
        ticketNo: entry.ticketNo,
      })
    : null;
  return (
    <div className={common.inline} style={{ ['--tone' as string]: 'var(--cobalt-500)' }} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <p className={common.inlineTitle} id={`${id}-t`}>Passer à l’étape…</p>
      <div className={common.chips} role="radiogroup" aria-labelledby={`${id}-t`}>
        {choices.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={stage === s.key}
            className={common.chipBtn}
            onClick={() => { setStage(s.key); setNotify(s.notifyDefault); }}
          >
            {s.staff}
          </button>
        ))}
      </div>
      {def && (
        <>
          <label className={common.check}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Prévenir le client
          </label>
          {notify && preview && (
            <p className={common.preview}><strong>{preview.title}</strong>{preview.body}</p>
          )}
        </>
      )}
      <div className={common.inlineRow}>
        <button type="button" className="btn btn--solid btn--sm" disabled={!def || busy} onClick={() => def && onConfirm(def.key, notify)}>
          {def ? `Passer à « ${def.short} »` : 'Choisissez une étape'}
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------ Devis */

function QuotePanel({
  busy, initial, onCancel, onSend,
}: {
  busy: boolean;
  initial: { amountCents: number; label: string } | null;
  onCancel: () => void;
  onSend: (amountCents: number, label: string, notify: boolean) => void;
}) {
  const [amount, setAmount] = useState(initial ? (initial.amountCents / 100).toFixed(2).replace('.', ',') : '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [notify, setNotify] = useState(true);
  const [touched, setTouched] = useState(false);
  const id = useId();
  const cents = parseAmountToCents(amount);
  const valid = cents != null && label.trim().length > 0;
  return (
    <form
      className={common.inline}
      style={{ ['--tone' as string]: 'var(--copper-500)' }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid && cents != null) onSend(cents, label.trim(), notify);
      }}
    >
      <p className={common.inlineTitle}>Devis à faire valider</p>
      <div className={styles.quoteFields}>
        <label className={styles.amount}>
          <span className="sr-only">Montant TTC en euros</span>
          <input
            id={`${id}-a`}
            className="input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="184,00"
            value={amount}
            autoFocus
            aria-invalid={touched && cents == null ? true : undefined}
            onChange={(e) => setAmount(e.target.value)}
          />
          <span className={styles.euro} aria-hidden="true">€</span>
        </label>
        <label className={styles.quoteLabel}>
          <span className="sr-only">Libellé du devis</span>
          <input
            className="input"
            maxLength={80}
            placeholder="Plaquettes + disques AV"
            value={label}
            aria-invalid={touched && !label.trim() ? true : undefined}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      </div>
      {touched && !valid && (
        <p className={common.formError} role="alert">
          {cents == null ? 'Indiquez un montant, par exemple 184,00.' : 'Décrivez le devis en quelques mots.'}
        </p>
      )}
      <label className={common.check}>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        Prévenir le client (« Devis à valider{cents != null ? ` · ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)}` : ''} »)
      </label>
      <p className={styles.legal}>
        Le client accepte ou refuse depuis son téléphone ; sa réponse arrive ici, avec l’heure. Elle ne remplace pas un devis signé si vous en demandez un.
      </p>
      <div className={common.inlineRow}>
        <button type="submit" className="btn btn--solid btn--sm" disabled={busy}>Envoyer le devis</button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

/* ------------------------------------------------ Promesse de délai */

function EtaPanel({
  current, timeZone, who, busy, onCancel, onSave,
}: {
  current: string | null;
  /** Fuseau de l'établissement : le champ se remplit et se lit à son heure. */
  timeZone: string;
  /** « le garage », « l'atelier » : qui s'engage, tel que le client le lira. */
  who: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (iso: string | null) => void;
}) {
  const [value, setValue] = useState(() => toZonedInput(current, timeZone));
  const id = useId();
  return (
    <form
      className={common.inline}
      style={{ ['--tone' as string]: 'var(--jade-500)' }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      onSubmit={(e) => {
        e.preventDefault();
        const iso = fromZonedInput(value, timeZone);
        if (iso) onSave(iso);
      }}
    >
      <label className={common.inlineTitle} htmlFor={`${id}-eta`}>Prêt quand ? Le client lira « annoncé par {who} ».</label>
      <input id={`${id}-eta`} className="input" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <div className={common.inlineRow}>
        <button type="submit" className="btn btn--solid btn--sm" disabled={busy}>Enregistrer</button>
        {current && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onSave(null)}>Retirer la promesse</button>}
        <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

/* ------------------------------------------------ Message */

function MessagePanel({
  profile, busy, onCancel, onSend,
}: { profile: QueueProfile; busy: boolean; onCancel: () => void; onSend: (key: string) => void }) {
  const templates = defaultTemplates(profile);
  const [key, setKey] = useState<string | null>(null);
  const chosen = templates.find((t) => t.key === key) ?? null;
  const id = useId();
  return (
    <div className={common.inline} style={{ ['--tone' as string]: 'var(--ardoise-500)' }} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <p className={common.inlineTitle} id={`${id}-t`}>Message en un geste</p>
      <div className={common.chips} role="radiogroup" aria-labelledby={`${id}-t`}>
        {templates.map((t) => (
          <button key={t.key} type="button" role="radio" aria-checked={key === t.key} className={common.chipBtn} onClick={() => setKey(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {chosen && <p className={common.preview}><strong>Aperçu</strong>{chosen.body}</p>}
      <p className={styles.legal}>Les variables (horaires, téléphone) sont remplies à l’envoi. Modèles modifiables dans Réglages.</p>
      <div className={common.inlineRow}>
        <button type="button" className="btn btn--solid btn--sm" disabled={!chosen || busy} onClick={() => chosen && onSend(chosen.key)}>
          {busy ? 'Envoi…' : 'Envoyer'}
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------ Modifier la fiche */

function EditPanel({
  profile, entry, busy, onCancel, onSave,
}: {
  profile: QueueProfile;
  entry: ProfileStaffEntry;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const d = entry.details ?? {};
  const [registration, setRegistration] = useState(d.registration ?? '');
  const [model, setModel] = useState(d.model ?? '');
  const [reason, setReason] = useState(d.reasonText ?? '');
  const id = useId();
  const country: RegistrationCountry = d.country ?? 'FR';
  return (
    <form
      className={common.inline}
      style={{ ['--tone' as string]: 'var(--text-muted)' }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      onSubmit={(e) => {
        e.preventDefault();
        const patch: Record<string, unknown> = {};
        if (profile === 'vehicle' && registration.trim() !== (d.registration ?? '')) patch.registration = registration.trim() || null;
        if (model.trim() !== (d.model ?? '')) patch.model = model.trim() || null;
        if (reason.trim() !== (d.reasonText ?? '')) patch.reasonText = reason.trim() || null;
        if (Object.keys(patch).length === 0) { onCancel(); return; }
        onSave(patch);
      }}
    >
      <p className={common.inlineTitle}>Corriger la fiche</p>
      {profile === 'vehicle' && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Immatriculation</span>
          <input id={`${id}-r`} className="input" autoCapitalize="characters" spellCheck={false} value={registration}
            onChange={(e) => setRegistration(country === 'FR' ? formatRegistrationInput(e.target.value) : e.target.value.toUpperCase())} />
        </label>
      )}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Modèle</span>
        <input className="input" maxLength={TEXT_LIMITS.model} value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Motif</span>
        <input className="input" maxLength={TEXT_LIMITS.reasonText} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className={common.inlineRow}>
        <button type="submit" className="btn btn--solid btn--sm" disabled={busy}>Enregistrer</button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

/* ==================================================================
   QR de suivi
   ================================================================== */

export function QrBlock({
  link, orgSlug, entryId, printLabel, timeZone, onClose, compact = false,
}: {
  link: TrackingLink;
  orgSlug: string;
  entryId: string;
  /** « Imprimer l'étiquette de clé » (garage), « … de dépôt » (appareil). */
  printLabel: string;
  /** Fuseau de l'établissement : l'échéance se lit à son heure. */
  timeZone: string;
  onClose?: () => void;
  compact?: boolean;
}) {
  const expires = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(link.expiresAt));
  return (
    <div className={common.qr} data-compact={compact ? '1' : undefined}>
      {/* SVG produit par notre serveur (bibliothèque qrcode), jamais par une saisie. */}
      <div className={common.qrCode} role="img" aria-label="QR de suivi à faire scanner par le client" dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
      <div className={common.qrText}>
        <p className={common.qrTitle}>Faites scanner ce QR au client</p>
        <p className="t-small t-muted">
          Il suit sa fiche sans rien saisir. Usage unique, valable jusqu’à {expires}. En générer un autre annule celui-ci.
        </p>
        <div className={common.qrActions}>
          <a className="btn btn--ghost btn--sm" href={`/app/${orgSlug}/file/etiquette/${entryId}`} target="_blank" rel="noopener">
            {printLabel}
            <span className="sr-only"> (nouvel onglet)</span>
          </a>
          {onClose && <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>Fermer</button>}
        </div>
      </div>
    </div>
  );
}

/* ==================================================================
   Ajouter un véhicule / un appareil au comptoir
   ================================================================== */

const DEVICE_ORDER: readonly DeviceKind[] = DEVICE_KINDS;

function AddDropoff({
  orgSlug, snapshot, onDone, api,
}: {
  orgSlug: string;
  snapshot: ProfileQueueSnapshot;
  onDone: () => void;
  api: ProfileBoardApi;
}) {
  const profile = snapshot.queue.profile;
  const vehicle = profile === 'vehicle';
  const [registration, setRegistration] = useState('');
  const [country, setCountry] = useState<RegistrationCountry>('FR');
  const [model, setModel] = useState('');
  const [name, setName] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [stay, setStay] = useState<StayChoice>('away');
  const [keys, setKeys] = useState(true);
  const [deviceKind, setDeviceKind] = useState<DeviceKind>('phone');
  const [accessories, setAccessories] = useState<DeviceAccessory[]>([]);
  const [withQr, setWithQr] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ entry: ProfileStaffEntry; link: TrackingLink | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { firstRef.current?.focus(); }, [created]);

  const parsed = vehicle && registration.trim() ? parseRegistration(registration, country) : null;

  const reset = () => {
    setRegistration(''); setModel(''); setName(''); setServiceId(null); setReason('');
    setStay('away'); setKeys(true); setAccessories([]); setFormError(null); setCreated(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (vehicle && parsed && !parsed.ok) { setFormError(parsed.reason); return; }
    const details: Record<string, unknown> = vehicle
      ? {
          ...(registration.trim() ? { registration: registration.trim(), country } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(reason.trim() ? { reasonText: reason.trim() } : {}),
          stay,
          keys,
        }
      : {
          deviceKind,
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(reason.trim() ? { reasonText: reason.trim() } : {}),
          ...(accessories.length ? { accessories } : {}),
        };
    startTransition(async () => {
      const result = await api.run('add', () => addProfileEntryAction(orgSlug, {
        queueId: snapshot.queue.id,
        name: name.trim() || null,
        serviceId,
        details,
        issueTrackingLink: withQr,
      }));
      if (!result.ok) { setFormError(result.error); return; }
      setCreated({ entry: result.data.entry, link: result.data.trackingLink });
      api.say(vehicle ? 'Véhicule ajouté à l’atelier' : 'Appareil ajouté à l’atelier');
    });
  };

  if (created) {
    const title = vehicle
      ? created.entry.details?.registration ?? 'Véhicule ajouté'
      : created.entry.ticketNo ? `Dossier ${created.entry.ticketNo}` : 'Appareil ajouté';
    return (
      <section className={common.addPanel} aria-labelledby={`${id}-done`}>
        <div className={common.addHead}>
          <h2 id={`${id}-done`} className={common.addTitle}>{title} : fiche créée</h2>
        </div>
        {created.link ? (
          <QrBlock
            link={created.link}
            orgSlug={orgSlug}
            entryId={created.entry.id}
            printLabel={labelKind(vehicle ? 'vehicle' : 'device').print}
            timeZone={api.timeZone}
          />
        ) : (
          <p className="t-small t-muted">La fiche est dans « Reçu ». Vous pourrez générer un QR de suivi depuis son menu.</p>
        )}
        <div className={common.addActions}>
          <button type="button" className="btn btn--solid btn--sm" onClick={reset}>
            {vehicle ? 'Ajouter un autre véhicule' : 'Ajouter un autre appareil'}
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onDone}>Terminé</button>
        </div>
      </section>
    );
  }

  return (
    <form className={common.addPanel} onSubmit={submit} aria-labelledby={`${id}-t`} noValidate>
      <div className={common.addHead}>
        <h2 id={`${id}-t`} className={common.addTitle}>{vehicle ? 'Dépôt d’un véhicule' : 'Dépôt d’un appareil'}</h2>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onDone}>Annuler</button>
      </div>

      <div className={common.grid}>
        {vehicle ? (
          <div className={`${styles.field} ${styles.plateField}`}>
            <label className={styles.fieldLabel} htmlFor={`${id}-reg`}>Immatriculation</label>
            <div className={styles.plateInput}>
              <input
                ref={firstRef}
                id={`${id}-reg`}
                className={`input ${styles.regInput}`}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder={country === 'FR' ? 'AB-123-CD' : 'M-AB 1234'}
                value={registration}
                aria-invalid={parsed && !parsed.ok ? true : undefined}
                aria-describedby={`${id}-reg-h`}
                onChange={(e) => setRegistration(country === 'FR' ? formatRegistrationInput(e.target.value) : e.target.value.toUpperCase().slice(0, 16))}
              />
              <div className="seg" role="group" aria-label="Pays de l’immatriculation">
                <button type="button" aria-pressed={country === 'FR'} onClick={() => { setCountry('FR'); setRegistration((r) => formatRegistrationInput(r)); }}>France</button>
                <button type="button" aria-pressed={country === 'other'} onClick={() => setCountry('other')}>Étranger</button>
              </div>
            </div>
            <p id={`${id}-reg-h`} className={parsed && !parsed.ok ? common.formError : 'hint'}>
              {parsed && !parsed.ok ? parsed.reason : parsed?.ok && parsed.warnings[0] ? parsed.warnings[0] : 'Facultative au comptoir ; elle permet la recherche par plaque.'}
            </p>
            {parsed?.ok && (
              <div className={styles.platePreview} aria-hidden="true">
                <Immatriculation value={parsed.display} country={country} size="md" />
              </div>
            )}
          </div>
        ) : (
          <div className={`${styles.field} ${common.full}`}>
            <span className={styles.fieldLabel} id={`${id}-kind`}>Appareil</span>
            <div className={common.chips} role="radiogroup" aria-labelledby={`${id}-kind`}>
              {DEVICE_ORDER.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={deviceKind === k} className={common.chipBtn} onClick={() => setDeviceKind(k)}>
                  <DeviceGlyph kind={k} size={18} />
                  {DEVICE_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className={styles.field}>
          <span className={styles.fieldLabel}>{vehicle ? 'Modèle' : 'Marque et modèle'}</span>
          <input
            ref={vehicle ? undefined : firstRef}
            className="input"
            maxLength={TEXT_LIMITS.model}
            placeholder={vehicle ? 'Peugeot 208' : 'iPhone 13'}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Prénom <span className={common.muted}>(facultatif)</span></span>
          <input className="input" maxLength={40} autoComplete="off" placeholder="Camille" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        {snapshot.services.length > 0 && (
          <div className={`${styles.field} ${common.full}`}>
            <span className={styles.fieldLabel} id={`${id}-motif`}>Motif</span>
            <div className={common.chips} role="radiogroup" aria-labelledby={`${id}-motif`}>
              {snapshot.services.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={serviceId === s.id} className={common.chipBtn}
                  onClick={() => setServiceId((v) => (v === s.id ? null : s.id))}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className={`${styles.field} ${common.full}`}>
          <span className={styles.fieldLabel}>{vehicle ? 'Précisions' : 'Panne'} <span className={common.muted}>(80 caractères)</span></span>
          <input className="input" maxLength={TEXT_LIMITS.reasonText} placeholder={vehicle ? 'Bruit au freinage' : 'Écran fissuré, tactile OK'} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>

        {vehicle ? (
          <div className={`${styles.field} ${common.full} ${styles.toggles}`}>
            <div className="seg" role="group" aria-label="Le client">
              <button type="button" aria-pressed={stay === 'away'} onClick={() => setStay('away')}>Laisse le véhicule</button>
              <button type="button" aria-pressed={stay === 'onsite'} onClick={() => setStay('onsite')}>Attend sur place</button>
            </div>
            <label className={common.check}>
              <input type="checkbox" checked={keys} onChange={(e) => setKeys(e.target.checked)} />
              Clés reçues
            </label>
          </div>
        ) : (
          <div className={`${styles.field} ${common.full}`}>
            <span className={styles.fieldLabel} id={`${id}-acc`}>Déposé avec</span>
            <div className={common.chips} role="group" aria-labelledby={`${id}-acc`}>
              {DEVICE_ACCESSORIES.map((a) => (
                <button key={a} type="button" aria-pressed={accessories.includes(a)} className={common.chipBtn}
                  onClick={() => setAccessories((list) => (list.includes(a) ? list.filter((x) => x !== a) : [...list, a]))}>
                  {ACCESSORY_LABEL[a]}
                </button>
              ))}
            </div>
            <p className={styles.warnCode}>Ne notez jamais le code de déverrouillage : Rangvia ne le demande pas.</p>
          </div>
        )}
      </div>

      <label className={common.check}>
        <input type="checkbox" checked={withQr} onChange={(e) => setWithQr(e.target.checked)} />
        Afficher un QR de suivi pour le client
      </label>
      {formError && <p className={common.formError} role="alert">{formError}</p>}
      <div className={common.addActions}>
        <button type="submit" className="btn btn--solid" disabled={pending}>
          {pending ? 'Création…' : vehicle ? 'Créer la fiche' : 'Créer le dossier'}
        </button>
      </div>
    </form>
  );
}
