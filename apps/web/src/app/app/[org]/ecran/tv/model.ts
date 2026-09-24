import type {
  DeskDisplaySnapshot,
  DisplaySnapshot,
  RetailDisplaySnapshot,
  TableDisplaySnapshot,
  WorkshopDisplaySnapshot,
} from '@/server/display';
import type { QueueStatus } from '@/lib/types';
import type { DeviceKind } from '@/lib/profiles/types';
import { asMaskedRegistration, type MaskedRegistration } from '@/lib/profiles/registration';

/**
 * L'ÉCRAN DE SALLE PAR PROFIL — la partie sans React.
 *
 * Ce module décide QUEL écran afficher et CE QUI s'y lit, à partir du seul
 * DisplaySnapshot (server/display.ts, migration 0036). Les composants de
 * tv/*.tsx ne lisent que ces vues : chaque champ affiché y est recopié un
 * par un (liste blanche). Un champ que le serveur ajouterait un jour par
 * erreur (un prénom au guichet, une plaque en clair) n'atteint donc jamais
 * l'écran : il n'est lu nulle part. Tout est pur, donc testé sans
 * navigateur (tests/tv-display-profiles.test.ts).
 */

/** Les cinq écrans : celui des barbiers (walkin, event) et un par métier. */
export type TvScreen = 'walkin' | 'workshop' | 'table' | 'desk' | 'pickup';

/**
 * Aiguillage. Un instantané à profil dont le bloc manque (serveur d'avant
 * 0036 pendant un déploiement, réponse tronquée) retombe sur l'écran
 * walkin : 0036 lui envoie alors des listes nominatives VIDES et des
 * compteurs cohérents, donc une file lisible, sans rien divulguer.
 */
export function tvScreenFor(snapshot: DisplaySnapshot): TvScreen {
  switch (snapshot.profile) {
    case 'vehicle':
    case 'device':
      return hasBlock(snapshot, 'workshop', 'ready') ? 'workshop' : 'walkin';
    case 'table':
      return hasBlock(snapshot, 'tables', 'ready') ? 'table' : 'walkin';
    case 'desk':
      return hasBlock(snapshot, 'desks', 'currentCalls') ? 'desk' : 'walkin';
    case 'retail':
      return hasBlock(snapshot, 'pickup', 'ready') ? 'pickup' : 'walkin';
    default:
      return 'walkin';
  }
}

function hasBlock(snapshot: object, block: string, list: string): boolean {
  const value = (snapshot as Record<string, unknown>)[block];
  if (!value || typeof value !== 'object') return false;
  const inner = value as Record<string, unknown>;
  return Array.isArray(inner[list]) && typeof inner.counts === 'object' && inner.counts !== null;
}

/* ------------------------------------------------------------------ */
/* Textes partagés                                                      */
/* ------------------------------------------------------------------ */

export function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}

/**
 * État de la file dans le vocabulaire du métier. En walkin, les trois
 * libellés d'avant le lot P5, au caractère près (rendu identique).
 */
export function statusLabelFor(screen: TvScreen, status: QueueStatus): string {
  const words: Record<TvScreen, [string, string, string]> = {
    walkin: ['File ouverte', 'En pause', 'File fermée'],
    workshop: ['Dépôts ouverts', 'Dépôts en pause', 'Dépôts fermés'],
    table: ['Liste ouverte', 'Liste en pause', 'Liste fermée'],
    desk: ['Guichets ouverts', 'Guichets en pause', 'Guichets fermés'],
    pickup: ['File ouverte', 'En pause', 'File fermée'],
  };
  const [open, paused, closed] = words[screen];
  return status === 'open' ? open : status === 'paused' ? paused : closed;
}

/** « 14:32 ». Rendu APRÈS montage seulement (fuseau du téléviseur). */
export function clockOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * « 14:32 », « hier 17:40 » ou « le 22/09 » : un véhicule peut attendre
 * son client plusieurs jours, une heure seule mentirait.
 */
export function sinceOf(iso: string | null | undefined, now: Date): string | null {
  const time = clockOf(iso);
  if (!time || !iso) return null;
  const date = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(date)) / 86_400_000);
  if (diffDays <= 0) return time;
  if (diffDays === 1) return `hier ${time}`;
  return `le ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
}

/* ------------------------------------------------------------------ */
/* Atelier (vehicle, device)                                            */
/* ------------------------------------------------------------------ */

export interface WorkshopTvRow {
  id: string;
  /** Plaque masquée, reconnue par `asMaskedRegistration` ; jamais une chaîne en clair. */
  plate: MaskedRegistration | null;
  ticketNo: string | null;
  deviceKind: DeviceKind | null;
  readySince: string;
}

export interface WorkshopTvView {
  device: boolean;
  /** « Véhicules prêts » : lignes identifiables, la dernière prête en tête. */
  rows: WorkshopTvRow[];
  /**
   * Prêts sans ligne : au-delà des 8 lignes, ou file réglée « compteurs
   * seulement » (`tvRegistration` à `none`), ou ligne sans rien de
   * reconnaissable. L'écran le dit sans rien montrer.
   */
  readyWithoutRow: number;
  counts: WorkshopDisplaySnapshot['workshop']['counts'];
}

export function workshopView(snapshot: WorkshopDisplaySnapshot): WorkshopTvView {
  const device = snapshot.profile === 'device';
  const rows: WorkshopTvRow[] = [];
  for (const row of snapshot.workshop.ready) {
    // Défense en profondeur : une immatriculation qui n'arrive pas masquée
    // (sans « • ») est refusée ; la ligne reste lisible par son dossier, ou
    // disparaît du tableau si elle n'a rien d'autre.
    const plate = device ? null : asMaskedRegistration(row.registrationMasked);
    const ticketNo = row.ticketNo || null;
    const deviceKind = device ? row.deviceKind ?? null : null;
    if (!plate && !ticketNo && !deviceKind) continue;
    rows.push({ id: row.id, plate, ticketNo, deviceKind, readySince: row.readySince });
  }
  const counts = snapshot.workshop.counts;
  return { device, rows, readyWithoutRow: Math.max(0, counts.ready - rows.length), counts };
}

/* ------------------------------------------------------------------ */
/* Restaurant (table)                                                   */
/* ------------------------------------------------------------------ */

export interface TableTvRow {
  id: string;
  /** Ce que l'accueil appelle : le numéro, sinon le prénom en capitales. */
  call: { kind: 'ticket'; value: string } | { kind: 'name'; value: string } | null;
  partySize: number | null;
  calledAt: string | null;
}

export interface TableTvView {
  rows: TableTvRow[];
  counts: TableDisplaySnapshot['tables']['counts'];
}

/** Prénom affiché en volets : 12 cases au plus, comme au comptoir d'un barbier. */
export const TV_NAME_MAX = 12;

export function tableView(snapshot: TableDisplaySnapshot): TableTvView {
  const rows = snapshot.tables.ready.map((row): TableTvRow => {
    const ticket = row.ticketNo?.trim();
    const name = row.name?.trim();
    return {
      id: row.id,
      call: ticket
        ? { kind: 'ticket', value: ticket }
        : name
          ? { kind: 'name', value: Array.from(name.toLocaleUpperCase('fr-FR')).slice(0, TV_NAME_MAX).join('') }
          : null,
      partySize: typeof row.partySize === 'number' && row.partySize > 0 ? row.partySize : null,
      calledAt: row.calledAt,
    };
  });
  return { rows, counts: snapshot.tables.counts };
}

/* ------------------------------------------------------------------ */
/* Guichet (desk)                                                       */
/* ------------------------------------------------------------------ */

/** Un appel, tel que l'écran l'affiche : numéro et guichet, rien d'autre. */
export interface DeskTvCall {
  id: string;
  ticketNo: string | null;
  desk: string | null;
  calledAt: string | null;
}

export interface DeskTvView {
  /** L'appel le plus récent, en grand. */
  current: DeskTvCall | null;
  /** Les autres appels en cours (un guichet appelle pendant qu'un autre attend son client). */
  others: DeskTvCall[];
  /** Derniers appels déjà pris en charge. */
  recent: DeskTvCall[];
  counts: DeskDisplaySnapshot['desks']['counts'];
}

/** Lignes de la colonne « Derniers appels » : ce que la colonne tient à 5 mètres. */
export const DESK_SIDE_ROWS = 6;

function deskCall(row: { id: string; ticketNo: string | null; deskLabel: string | null; calledAt: string | null }): DeskTvCall {
  // Recopie champ par champ : aucune autre clé ne peut atteindre l'écran,
  // même si le serveur en envoyait une (jamais de prénom au guichet).
  return {
    id: row.id,
    ticketNo: row.ticketNo?.trim() || null,
    desk: row.deskLabel?.trim() || null,
    calledAt: row.calledAt,
  };
}

export function deskView(snapshot: DeskDisplaySnapshot): DeskTvView {
  const calls = snapshot.desks.currentCalls.map(deskCall);
  const [current = null, ...rest] = calls;
  const others = rest.slice(0, 3);
  const recent = snapshot.desks.recentCalls.map(deskCall).slice(0, DESK_SIDE_ROWS - others.length);
  return { current, others, recent, counts: snapshot.desks.counts };
}

/* ------------------------------------------------------------------ */
/* Boutique (retail)                                                    */
/* ------------------------------------------------------------------ */

export interface PickupTvRow {
  id: string;
  /** Fin du numéro de commande (« 8731 ») ou, à défaut, numéro de ticket. */
  ref: { kind: 'order'; value: string } | { kind: 'ticket'; value: string };
  readySince: string;
}

export interface PickupTvCall {
  id: string;
  ticketNo: string;
  calledAt: string | null;
}

export interface PickupTvView {
  rows: PickupTvRow[];
  /** Prêtes sans référence affichable : comptées, pas montrées. */
  readyWithoutRow: number;
  calls: PickupTvCall[];
  counts: RetailDisplaySnapshot['pickup']['counts'];
}

export function pickupView(snapshot: RetailDisplaySnapshot): PickupTvView {
  const rows: PickupTvRow[] = [];
  for (const row of snapshot.pickup.ready) {
    const tail = row.orderRefTail?.trim();
    const ticket = row.ticketNo?.trim();
    if (tail) rows.push({ id: row.id, ref: { kind: 'order', value: tail }, readySince: row.readySince });
    else if (ticket) rows.push({ id: row.id, ref: { kind: 'ticket', value: ticket }, readySince: row.readySince });
  }
  const calls = (snapshot.pickup.calls ?? [])
    .filter((call) => Boolean(call.ticketNo?.trim()))
    .map((call) => ({ id: call.id, ticketNo: call.ticketNo.trim(), calledAt: call.calledAt }));
  const counts = snapshot.pickup.counts;
  return { rows, readyWithoutRow: Math.max(0, counts.ready - rows.length), calls, counts };
}

/* ------------------------------------------------------------------ */
/* Mise en page                                                         */
/* ------------------------------------------------------------------ */

/**
 * Densité d'une liste de « prêts » : une ligne héroïque seule, trois
 * grandes lignes, puis deux colonnes. Les tailles suivent (CSS).
 */
export type TvDensity = 'hero' | 'large' | 'grid';

export function densityOf(count: number): TvDensity {
  if (count <= 1) return 'hero';
  if (count <= 3) return 'large';
  return 'grid';
}
