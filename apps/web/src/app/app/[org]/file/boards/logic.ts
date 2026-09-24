/**
 * LOGIQUE PURE DES POSTES À PROFIL — sans React, sans réseau.
 *
 * Tout ce qui décide QUOI afficher (quel poste, quelle colonne, quelle
 * touche, quel libellé d'envoi) vit ici, pour être testé à part du dessin
 * (`tests/board-profiles.test.ts`, `tests/workshop-columns.test.ts`). Les
 * composants `*Board.tsx` ne font que rendre ces décisions.
 *
 * Le vocabulaire vient du registre (`lib/profiles/*`) : une touche porte
 * le mot du profil (« Prêt · prévenir », « Table prête · appeler »), jamais
 * une chaîne recopiée ici.
 */

import { getProfile, isLegacyProfile, stageDef } from '@/lib/profiles';
import { formatAmount } from '@/lib/profiles/copy';
import { WORKSHOP_STAGES } from '@/lib/profiles/stages';
import { normalizeRegistration, registrationMatches } from '@/lib/profiles/registration';
import type {
  ProfileOptions,
  ProfileQueueSnapshot,
  ProfileStaffEntry,
  ProfileStage,
  QueueProfile,
  StageTone,
  WorkshopColumn,
} from '@/lib/profiles/types';
import type { EntryStatus, QueueStatus } from '@/lib/types';

/* ==================================================================
   Aiguillage
   ================================================================== */

/** Les quatre postes : le poste d'aujourd'hui (barbiers, événements) et trois postes métier. */
export type BoardKind = 'queue' | 'workshop' | 'table' | 'desk';

/**
 * Quel poste pour quel profil ? walkin et event gardent `QueueBoard`,
 * INCHANGÉ ; une valeur inconnue (base plus récente que le code) aussi :
 * mieux vaut le poste d'aujourd'hui qu'un écran vide.
 */
export function boardKindFor(profile: QueueProfile | string | null | undefined): BoardKind {
  if (isLegacyProfile(profile)) return 'queue';
  switch (getProfile(profile).id) {
    case 'vehicle':
    case 'device':
      return 'workshop';
    case 'table':
      return 'table';
    case 'desk':
    case 'retail':
      return 'desk';
    default:
      return 'queue';
  }
}

/* ==================================================================
   Ce que le poste dit d'un envoi
   ================================================================== */

/** Miroir de `NotificationReach` (server/notifications/dispatch.ts). */
export type Reach = 'sent' | 'failed' | 'unavailable' | 'unreachable' | 'none';

export interface NoticeLabel {
  /** Ce que lit le pro, sur la fiche et dans l'annonce. */
  text: string;
  /** Ce qu'il doit faire, quand l'envoi n'est pas parti. */
  hint: string | null;
  tone: 'ok' | 'warn' | 'error' | 'muted';
}

/**
 * Libellé HONNÊTE d'un envoi (conception, § 3.3). Le pro ne doit jamais
 * croire le client prévenu quand il ne l'est pas :
 *  - `sent` : un fournisseur a accepté l'envoi → « Prévenu 14:32 ✓ » ;
 *  - `unreachable` : aucun abonnement actif → « Non joignable » ;
 *  - `unavailable` : aucun canal configuré sur ce serveur (identifiants
 *    Apple ou Web Push absents) → « Envoi indisponible » ;
 *  - `failed` : les fournisseurs ont refusé → « Échec de l'envoi » ;
 *  - `none` : rien n'est parti (déjà prévenu pour cette étape, ou envoi
 *    non demandé) → « Aucun envoi ».
 * Aucune indication de lecture : Web Push et APNs ne la fournissent pas.
 */
export function noticeLabel(reach: Reach, at: Date | string | number, timeZone = 'Europe/Paris'): NoticeLabel {
  switch (reach) {
    case 'sent':
      return { text: `Prévenu ${clock(at, timeZone)} ✓`, hint: null, tone: 'ok' };
    case 'unreachable':
      return {
        text: 'Non joignable',
        hint: 'Notifications non activées sur son téléphone : appelez le client.',
        tone: 'warn',
      };
    case 'unavailable':
      return {
        text: 'Envoi indisponible',
        hint: 'Les notifications ne sont pas encore configurées : prévenez le client vous-même.',
        tone: 'error',
      };
    case 'failed':
      return { text: 'Échec de l’envoi', hint: 'Le message n’est pas parti : prévenez le client vous-même.', tone: 'error' };
    case 'none':
      return { text: 'Aucun envoi', hint: null, tone: 'muted' };
  }
}

/** « 14:32 » dans le fuseau de l'établissement. */
export function clock(at: Date | string | number, timeZone = 'Europe/Paris'): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(d);
}

/* ==================================================================
   En-tête : titre d'état et compteurs, dans le vocabulaire du métier
   ================================================================== */

/**
 * « Dépôts ouverts », « Liste en pause », « Guichets fermés ». Le mot est
 * tiré de la touche d'ouverture du profil (« Ouvrir les dépôts »), pour
 * qu'en-tête et réglages disent la même chose.
 */
export function statusTitle(profile: QueueProfile, status: QueueStatus): string {
  const p = getProfile(profile).id;
  const word: Record<QueueProfile, { noun: string; f: boolean; pl: boolean }> = {
    walkin: { noun: 'File', f: true, pl: false },
    event: { noun: 'File', f: true, pl: false },
    vehicle: { noun: 'Dépôts', f: false, pl: true },
    device: { noun: 'Dépôts', f: false, pl: true },
    table: { noun: 'Liste', f: true, pl: false },
    desk: { noun: 'Guichets', f: false, pl: true },
    retail: { noun: 'File', f: true, pl: false },
  };
  const { noun, f, pl } = word[p];
  const agree = (base: string) => `${base}${f ? 'e' : ''}${pl ? 's' : ''}`;
  if (status === 'open') return `${noun} ${agree('ouvert')}`;
  if (status === 'paused') return `${noun} en pause`;
  return `${noun} ${agree('fermé')}`;
}

export interface Counter {
  key: string;
  label: string;
  value: number;
}

/**
 * Accorde un libellé de compteur au nombre : « 1 prêt », « 2 prêts »,
 * « 1 rendu aujourd’hui », « 0 commande prête ». En français, 0 et 1
 * prennent le singulier. Le libellé est donné au pluriel (c'est ainsi que
 * le registre les écrit : « rendus aujourd’hui », « couverts installés ») ;
 * le singulier retire le « s » final de chaque mot qui en porte un.
 * Une forme singulière explicite l'emporte (« au guichet » / « aux guichets »).
 */
export function agreeCount(value: number, plural: string, singular?: string): string {
  if (Math.abs(value) >= 2) return plural;
  return singular ?? plural.split(' ').map((w) => (w.length > 2 && w.endsWith('s') ? w.slice(0, -1) : w)).join(' ');
}

function counter(key: string, value: number, plural: string, singular?: string): Counter {
  return { key, value, label: agreeCount(value, plural, singular) };
}

/** Les compteurs de l'en-tête, propres à chaque métier (conception, § 4.2 à 4.6). */
export function profileCounters(snapshot: ProfileQueueSnapshot): Counter[] {
  const profile = snapshot.queue.profile;
  const { counts } = snapshot;
  const by = counts.byStage ?? {};
  const today = counter('today', counts.completedToday, getProfile(profile).vocab.todayCounter);
  switch (boardKindFor(profile)) {
    case 'workshop':
      return [
        counter('received', by.received ?? 0, 'à prendre en charge'),
        counter(
          'workshop',
          (by.diagnosis ?? 0) + (by.quote_pending ?? 0) + (by.waiting_parts ?? 0) + (by.in_repair ?? 0),
          'en atelier',
        ),
        counter('ready', by.ready ?? 0, 'prêts'),
        today,
      ];
    case 'table': {
      // « À placer » : les groupes en attente ET ceux déjà appelés, qui
      // n'ont pas encore de table. C'est ce que compte `coversWaiting`
      // (appelés compris) ; la liste voisine, « En attente », ne montre que
      // ceux qui n'ont pas été appelés.
      const groups = counts.waiting + snapshot.called.length;
      return [
        counter('groups', groups, 'groupes à placer'),
        counter('covers', counts.coversWaiting ?? 0, 'couverts à placer'),
        counter('seated', counts.coversSeatedToday ?? 0, 'couverts installés'),
      ];
    }
    default:
      if (profile === 'retail') {
        return [
          counter('waiting', counts.waiting, 'en attente'),
          counter('ready', by.ready ?? 0, 'commandes prêtes'),
          today,
        ];
      }
      return [
        counter('waiting', counts.waiting, 'en attente'),
        counter('desks', snapshot.called.length + snapshot.serving.length, 'aux guichets', 'au guichet'),
        today,
      ];
  }
}

/* ==================================================================
   Atelier : colonnes, recherche, touche principale
   ================================================================== */

/** Une colonne du planning d'atelier : une étape, ou « Rendu » (fin). */
export type WorkshopLaneKey = ProfileStage | 'handed_over';

export interface WorkshopLaneDef {
  key: WorkshopLaneKey;
  /** Titre de colonne (le libellé court du rail : « Devis », « Pièce »). */
  label: string;
  /** Ce que la colonne veut dire pour le pro (« Devis envoyé »). */
  staff: string;
  tone: StageTone | 'done';
  /** Famille du registre (réception, atelier, attente, prêt), ou fin. */
  family: WorkshopColumn | 'done';
}

/**
 * Sept colonnes, dans l'ordre du rail : les six étapes d'atelier du
 * registre, puis « Rendu » (les fiches rendues aujourd'hui). Tirées de
 * `WORKSHOP_STAGES` : une étape ajoutée au registre ajoute sa colonne.
 */
export const WORKSHOP_LANES: readonly WorkshopLaneDef[] = [
  ...WORKSHOP_STAGES.map((s): WorkshopLaneDef => ({
    key: s.key,
    label: s.short,
    staff: s.staff,
    tone: s.tone,
    family: s.column ?? 'workshop',
  })),
  { key: 'handed_over', label: 'Rendu', staff: 'Rendu au client', tone: 'done', family: 'done' },
];

/**
 * Colonne d'une fiche : son étape. Une fiche sans étape connue (créée
 * avant le passage au profil, base retouchée) se range selon son statut,
 * jamais nulle part.
 */
export function laneOf(profile: QueueProfile, entry: Pick<ProfileStaffEntry, 'stage' | 'status'>): WorkshopLaneKey {
  const def = stageDef(profile, entry.stage);
  if (def && def.column) return def.key;
  return laneForStatus(entry.status);
}

function laneForStatus(status: EntryStatus): WorkshopLaneKey {
  switch (status) {
    case 'serving':
      return 'in_repair';
    case 'next':
      return 'ready';
    case 'completed':
      return 'handed_over';
    default:
      return 'received';
  }
}

/** Minuscules, sans accents : « Citroën » se trouve en tapant « citroen ». */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Recherche du poste atelier (touche « / ») : immatriculation normalisée
 * (`ab 123-cd` et `123` trouvent `AB-123-CD`), prénom, modèle, numéro de
 * dossier. Faite sur l'instantané déjà reçu : aucune requête.
 */
export function matchesWorkshopQuery(entry: ProfileStaffEntry, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (registrationMatches(q, entry.registrationKey ?? entry.details?.registration ?? null)) return true;
  const f = fold(q);
  const hay = [entry.name, entry.details?.model, entry.ticketNo, entry.details?.orderRef, shortRef(entry.id)]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(fold);
  if (hay.some((h) => h.includes(f))) return true;
  // « 42 » trouve le dossier « 0042 » : une saisie faite de chiffres
  // seulement se compare au numéro sans ses zéros de tête.
  if (!/^\d+$/.test(q) || entry.ticketNo == null) return false;
  const bare = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '');
  const want = bare(q);
  return want.length > 0 && bare(entry.ticketNo) === want;
}

export type WorkshopSort = 'arrival' | 'eta' | 'stage';

/** Toutes les fiches actives de l'instantané, sans doublon. */
export function activeEntries(snapshot: Pick<ProfileQueueSnapshot, 'serving' | 'called' | 'waiting'>): ProfileStaffEntry[] {
  const seen = new Set<string>();
  const out: ProfileStaffEntry[] = [];
  for (const e of [...snapshot.called, ...snapshot.serving, ...snapshot.waiting]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

function time(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * Répartit les fiches par colonne, filtrées par la recherche et triées :
 * par arrivée (défaut, l'ordre du dépôt), par promesse de délai (les
 * promesses les plus proches d'abord, les fiches sans promesse ensuite),
 * ou par ancienneté dans l'étape (la fiche qui attend depuis le plus
 * longtemps d'abord).
 */
export function workshopLanes(
  profile: QueueProfile,
  entries: readonly ProfileStaffEntry[],
  { query = '', sort = 'arrival' }: { query?: string; sort?: WorkshopSort } = {},
): Map<WorkshopLaneKey, ProfileStaffEntry[]> {
  const lanes = new Map<WorkshopLaneKey, ProfileStaffEntry[]>(WORKSHOP_LANES.map((l) => [l.key, []]));
  for (const e of entries) {
    if (!matchesWorkshopQuery(e, query)) continue;
    lanes.get(laneOf(profile, e))?.push(e);
  }
  const compare = workshopComparator(sort);
  for (const list of lanes.values()) list.sort(compare);
  return lanes;
}

/** L'ordre d'une colonne : arrivée, promesse de délai ou ancienneté dans l'étape. */
function workshopComparator(sort: WorkshopSort): (a: ProfileStaffEntry, b: ProfileStaffEntry) => number {
  const key = (e: ProfileStaffEntry): [number, number] => {
    if (sort === 'eta') return [time(e.details?.readyEta ?? null), time(e.joinedAt)];
    if (sort === 'stage') return [time(e.stageChangedAt ?? e.joinedAt), time(e.joinedAt)];
    return [time(e.joinedAt), 0];
  };
  return (a, b) => {
    const [a1, a2] = key(a);
    const [b1, b2] = key(b);
    return a1 - b1 || a2 - b2 || a.id.localeCompare(b.id);
  };
}

/* ------------------------------------------------------------------
   Les quatre colonnes du planning (conception, § 4.2)
   ------------------------------------------------------------------ */

export interface WorkshopColumnDef {
  key: WorkshopColumn;
  /** Titre de colonne au bureau : « En attente client / pièce ». */
  label: string;
  /** Nom court, sur le pupitre du téléphone : « Attente ». */
  short: string;
  tone: StageTone;
  /** Les étapes du registre rangées dans cette colonne, dans l'ordre du rail. */
  stages: readonly ProfileStage[];
}

const COLUMN_WORDS: Record<WorkshopColumn, Omit<WorkshopColumnDef, 'key' | 'stages'>> = {
  intake: { label: 'À prendre en charge', short: 'Reçus', tone: 'neutral' },
  workshop: { label: 'En atelier', short: 'Atelier', tone: 'cobalt' },
  waiting: { label: 'En attente client / pièce', short: 'Attente', tone: 'copper' },
  ready: { label: 'Prêts à récupérer', short: 'Prêts', tone: 'signal' },
};

/**
 * Quatre colonnes, qui tiennent toujours dans la largeur : un planning se
 * lit d'un coup d'œil, sans défilement horizontal. Ce sont les familles du
 * registre (`StageDef.column`) : réception | atelier (diagnostic,
 * réparation) | attente (devis, pièce) | prêts. Chaque fiche garde sa
 * rampe et sa puce d'étape, et l'en-tête de colonne filtre par étape.
 */
export const WORKSHOP_COLUMNS: readonly WorkshopColumnDef[] = (['intake', 'workshop', 'waiting', 'ready'] as const).map(
  (key): WorkshopColumnDef => ({
    key,
    ...COLUMN_WORDS[key],
    stages: WORKSHOP_STAGES.filter((s) => s.column === key).map((s) => s.key),
  }),
);

/** Colonne d'une fiche active : la famille de son étape (ou de son statut). */
export function columnOf(profile: QueueProfile, entry: Pick<ProfileStaffEntry, 'stage' | 'status'>): WorkshopColumn {
  const lane = laneOf(profile, entry);
  if (lane === 'handed_over') return 'ready';
  return stageDef(profile, lane)?.column ?? WORKSHOP_STAGES.find((s) => s.key === lane)?.column ?? 'intake';
}

/**
 * Répartit les fiches dans les quatre colonnes, filtrées par la recherche
 * et triées comme `workshopLanes`.
 */
export function workshopColumns(
  profile: QueueProfile,
  entries: readonly ProfileStaffEntry[],
  { query = '', sort = 'arrival' }: { query?: string; sort?: WorkshopSort } = {},
): Map<WorkshopColumn, ProfileStaffEntry[]> {
  const columns = new Map<WorkshopColumn, ProfileStaffEntry[]>(WORKSHOP_COLUMNS.map((c) => [c.key, []]));
  for (const e of entries) {
    if (!matchesWorkshopQuery(e, query)) continue;
    columns.get(columnOf(profile, e))?.push(e);
  }
  const compare = workshopComparator(sort);
  for (const list of columns.values()) list.sort(compare);
  return columns;
}

/**
 * Une valeur mémorisée sur l'appareil (colonne ouverte au téléphone) :
 * une colonne connue, ou une étape d'une version précédente, ramenée à sa
 * colonne. Autre chose : rien.
 */
export function storedColumn(value: string | null): WorkshopColumn | null {
  if (!value) return null;
  const column = WORKSHOP_COLUMNS.find((c) => c.key === value);
  if (column) return column.key;
  return WORKSHOP_STAGES.find((s) => s.key === value)?.column ?? null;
}

/* ------------------------------------------------------------------
   L'étiquette imprimable : de clé au garage, de dépôt pour un appareil
   ------------------------------------------------------------------ */

export interface LabelKind {
  /** « Étiquette de clé », « Étiquette de dépôt » : onglet, surtitre, menu. */
  title: string;
  /** La touche qui l'ouvre, depuis le QR de suivi. */
  print: string;
}

/**
 * Un téléphone n'a pas de clé : à l'atelier d'appareils, l'étiquette se
 * colle sur le sachet de dépôt.
 */
export function labelKind(profile: 'vehicle' | 'device'): LabelKind {
  return profile === 'device'
    ? { title: 'Étiquette de dépôt', print: 'Imprimer l’étiquette de dépôt' }
    : { title: 'Étiquette de clé', print: 'Imprimer l’étiquette de clé' };
}

/** État du devis d'une fiche, pour la puce (« Devis 184,00 € · en attente »). */
export interface QuoteState {
  status: 'pending' | 'accepted' | 'declined';
  amount: string;
  label: string;
  /** Envoi (en attente) ou décision (accordé, refusé). */
  at: string | null;
}

export function quoteStateOf(entry: Pick<ProfileStaffEntry, 'details'>): QuoteState | null {
  const q = entry.details?.quote;
  if (!q || typeof q.amountCents !== 'number') return null;
  const status = q.decision === 'accepted' ? 'accepted' : q.decision === 'declined' ? 'declined' : 'pending';
  return {
    status,
    amount: formatAmount(q.amountCents),
    label: q.label ?? '',
    at: status === 'pending' ? q.sentAt ?? null : q.decidedAt ?? null,
  };
}

/** Ce que fait la touche principale d'une fiche d'atelier. */
export type WorkshopPrimary =
  | { kind: 'start'; label: string }
  | { kind: 'diagnosed'; label: string }
  | { kind: 'quote_wait'; label: string }
  | { kind: 'repair'; label: string }
  | { kind: 'ready'; label: string }
  | { kind: 'handover'; label: string };

/**
 * La touche principale selon l'étape (conception, § 4.2, point 7) :
 * « Prendre en charge » → « Envoyer un devis » / « Lancer la réparation »
 * → « Prêt · prévenir » (vermillon) → « Rendu au client ». Un devis en
 * attente n'a pas de touche principale : on attend le client, et le
 * poste le dit. Un devis accordé (ou une pièce reçue) relance la
 * réparation.
 */
export function workshopPrimary(
  profile: QueueProfile,
  entry: Pick<ProfileStaffEntry, 'stage' | 'status' | 'details'>,
  options: Pick<ProfileOptions, 'quotes'> = {},
): WorkshopPrimary {
  const vocab = getProfile(profile).vocab;
  const lane = laneOf(profile, entry);
  switch (lane) {
    case 'received':
      return { kind: 'start', label: vocab.start ?? 'Prendre en charge' };
    case 'diagnosis':
      return options.quotes === false
        ? { kind: 'repair', label: 'Lancer la réparation' }
        : { kind: 'diagnosed', label: 'Envoyer un devis' };
    case 'quote_pending': {
      const q = quoteStateOf(entry);
      if (q?.status === 'accepted') return { kind: 'repair', label: 'Lancer la réparation' };
      return { kind: 'quote_wait', label: q?.status === 'declined' ? 'Devis refusé' : 'En attente du client' };
    }
    case 'waiting_parts':
      return { kind: 'repair', label: 'Pièce reçue · réparer' };
    case 'in_repair':
      return { kind: 'ready', label: vocab.call };
    case 'ready':
    case 'handed_over':
      return { kind: 'handover', label: vocab.complete };
    default:
      return { kind: 'start', label: vocab.start ?? 'Prendre en charge' };
  }
}

/**
 * Promesse de délai du garage, telle que le pro la relit : « prêt vers
 * 17 h », « prévu demain 9 h 30 », « prévu jeu. 25 sept. 17 h ». Ce n'est
 * pas une prédiction de Rangvia : c'est la parole du garage.
 */
export function formatEta(iso: string | null | undefined, now: Date, timeZone = 'Europe/Paris'): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const day = (d: Date) => new Intl.DateTimeFormat('fr-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const hour = m === '00' ? `${Number(h)} h` : `${Number(h)} h ${m}`;
  const today = day(now);
  const tomorrow = day(new Date(now.getTime() + 86_400_000));
  if (day(at) === today) return `prêt vers ${hour}`;
  if (day(at) === tomorrow) return `prévu demain ${hour}`;
  const date = new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(at);
  return `prévu ${date} ${hour}`;
}

/* ------------------------------------------------------------------
   Promesse de délai : saisie à l'heure de l'ÉTABLISSEMENT
   ------------------------------------------------------------------
   Le champ `datetime-local` n'a pas de fuseau : il montrerait l'heure du
   navigateur (un poste réglé à l'heure d'hiver, un ordinateur portable
   revenu de voyage) alors que le client lit « prêt vers 17 h » à l'heure
   du garage. On convertit donc nous-mêmes, dans le fuseau du lieu. */

/** Heure murale d'un instant dans un fuseau, lue comme si c'était de l'UTC (ms). */
function wallClockMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
}

/**
 * Valeur d'un champ `datetime-local` (« 2026-09-24T17:00 ») pour une
 * promesse, à l'heure du lieu. Sans promesse : dans deux heures, à l'heure
 * pile.
 */
export function toZonedInput(iso: string | null, timeZone: string, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  let wall: number;
  if (Number.isFinite(t)) {
    wall = wallClockMs(t, timeZone);
  } else {
    wall = wallClockMs(now + 2 * 3_600_000, timeZone);
    wall -= wall % 3_600_000;
  }
  return new Date(wall).toISOString().slice(0, 16);
}

/**
 * Instant (ISO, UTC) d'une saisie `datetime-local` lue à l'heure du lieu.
 * Null si la saisie n'est pas une date. Au changement d'heure, une heure
 * qui n'existe pas (2 h 30 le dernier dimanche de mars) avance d'une heure.
 */
export function fromZonedInput(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (!Number.isFinite(wall)) return null;
  // Deux passes : le décalage du fuseau dépend de l'instant cherché.
  let at = wall - (wallClockMs(wall, timeZone) - wall);
  at = wall - (wallClockMs(at, timeZone) - at);
  return new Date(at).toISOString();
}

/**
 * « 184,50 », « 184.5 », « 184 € » → 18450 centimes. Null si ce n'est pas
 * un montant (le formulaire le dit, sans envoyer).
 */
export function parseAmountToCents(raw: string): number | null {
  const clean = raw.replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

/**
 * Référence courte d'une fiche sans numéro (atelier véhicule) : quatre
 * caractères de l'identifiant public, en capitales. Elle relie l'étiquette
 * de clé imprimée à la fiche du poste, sans rien dire du client.
 */
export function shortRef(publicId: string): string {
  return publicId.replace(/[^0-9a-z]/gi, '').slice(0, 4).toUpperCase();
}

/** Clé de recherche d'une saisie, exposée pour le compteur de résultats. */
export function searchKey(query: string): string {
  return normalizeRegistration(query);
}

/* ==================================================================
   Guichet et boutique
   ================================================================== */

export interface DeskRef {
  id: string;
  /** « Guichet 3 » ; à défaut le nom de la fiche (conception, § 15). */
  label: string;
}

/** Les guichets d'une file : une fiche `staff` = un guichet. */
export function desksOf(snapshot: Pick<ProfileQueueSnapshot, 'staff'>): DeskRef[] {
  return snapshot.staff.map((s) => ({ id: s.id, label: s.deskLabel?.trim() || s.name }));
}

/**
 * Le guichet du poste : le choix mémorisé s'il existe encore, sinon la
 * fiche du compte connecté, sinon rien (le pro choisit). Un guichet
 * mémorisé qui a disparu n'est JAMAIS retenu : l'appel échouerait
 * (`invalid_desk`).
 */
export function resolveDesk(desks: readonly DeskRef[], stored: string | null, actorStaffId: string | null): string | null {
  if (stored && desks.some((d) => d.id === stored)) return stored;
  if (actorStaffId && desks.some((d) => d.id === actorStaffId)) return actorStaffId;
  return desks.length === 1 ? desks[0]!.id : null;
}

/** L'appel en cours à un guichet (appelé ou commencé), s'il y en a un. */
export function currentCallAt(
  snapshot: Pick<ProfileQueueSnapshot, 'called' | 'serving'>,
  deskId: string | null,
): ProfileStaffEntry | null {
  if (!deskId) return null;
  return (
    snapshot.serving.find((e) => e.staffId === deskId) ??
    snapshot.called.find((e) => e.staffId === deskId) ??
    null
  );
}

/**
 * Nom affichable au guichet. Jamais de prénom dans une file `sensitive`
 * (santé), même quand la base en a un : on appelle un numéro.
 */
export function deskDisplayName(entry: Pick<ProfileStaffEntry, 'name'>, options: Pick<ProfileOptions, 'sensitive'>): string | null {
  if (options.sensitive === true) return null;
  const n = entry.name?.trim();
  return n ? n : null;
}

/**
 * Boutique : la fiche est-elle un RETRAIT de commande (étapes, « Commande
 * prête ») plutôt qu'un conseil (file, « Appeler le suivant ») ? Une
 * étape posée, un numéro de commande ou le motif « Retirer une commande »
 * suffisent.
 */
export function isRetailPickup(
  entry: Pick<ProfileStaffEntry, 'stage' | 'details' | 'serviceId'>,
  services: readonly { id: string; name: string }[],
): boolean {
  if (entry.stage) return true;
  if (entry.details?.orderRef) return true;
  const name = services.find((s) => s.id === entry.serviceId)?.name ?? '';
  return /commande/i.test(name);
}

/** Temps restant avant que la table appelée ne soit rendue (secondes, négatif si dépassé). */
export function tableCountdown(calledAt: string | null, graceMinutes: number, now: number): number | null {
  if (!calledAt) return null;
  const t = Date.parse(calledAt);
  if (!Number.isFinite(t)) return null;
  return Math.round((t + graceMinutes * 60_000 - now) / 1000);
}

/* ==================================================================
   Lecture seule (membre sans `queue.operate`)
   ================================================================== */

/**
 * L'instantané d'un poste métier pour un membre qui REGARDE sans faire
 * avancer la file : le bon poste (le vocabulaire du métier), mais sans
 * les informations réservées à `queue.operate`. Partent : immatriculation
 * (et sa clé de recherche), devis, motif écrit par le client, accessoires,
 * numéro de commande, note du pro ; en santé (`sensitive`), les prénoms.
 * Restent : ce qui sert à lire la file d'un coup d'œil (étape, modèle,
 * type d'appareil, couverts, préférence, promesse de délai).
 * Fait côté serveur, avant d'envoyer l'instantané au navigateur.
 */
export function readOnlySnapshot(snapshot: ProfileQueueSnapshot): ProfileQueueSnapshot {
  const sensitive = snapshot.queue.profileOptions?.sensitive === true;
  const strip = (e: ProfileStaffEntry): ProfileStaffEntry => {
    const d = e.details ?? {};
    const details: ProfileStaffEntry['details'] = {};
    if (d.model) details.model = d.model;
    if (d.deviceKind) details.deviceKind = d.deviceKind;
    if (d.stay) details.stay = d.stay;
    if (d.readyEta) details.readyEta = d.readyEta;
    if (typeof d.partySize === 'number') details.partySize = d.partySize;
    if (d.seating) details.seating = d.seating;
    if (d.needs) details.needs = d.needs;
    return {
      ...e,
      name: sensitive ? null : e.name,
      note: null,
      details,
      registrationKey: null,
      claimPending: false,
    };
  };
  return {
    ...snapshot,
    serving: snapshot.serving.map(strip),
    called: snapshot.called.map(strip),
    waiting: snapshot.waiting.map(strip),
    parked: snapshot.parked.map(strip),
  };
}
