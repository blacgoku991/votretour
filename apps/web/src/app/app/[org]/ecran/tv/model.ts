import type {
  DeskDisplaySnapshot,
  DisplaySnapshot,
  RetailDisplaySnapshot,
  TableDisplaySnapshot,
  WorkshopDisplaySnapshot,
} from '@/server/display';
import type { QueueStatus } from '@/lib/types';
import type { DeviceKind, QueueProfile } from '@/lib/profiles/types';
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

/**
 * La consigne du pied de page, dans les mots du métier et selon l'état de
 * la file : en pause ou fermée, on n'invite pas à s'inscrire (la plaque le
 * refuserait), on dit quoi faire. L'atelier et le retrait gardent leur
 * consigne de suivi : un véhicule ou une commande se suit même quand les
 * dépôts sont en pause. L'écran walkin garde la sienne (TVBoard).
 */
export function profileHintFor(profile: QueueProfile | undefined, status: QueueStatus): string {
  const tap = 'Approchez votre téléphone de la plaque Rangvia pour';
  switch (profile) {
    case 'vehicle':
      return `${tap} suivre votre véhicule.`;
    case 'device':
      return `${tap} suivre votre appareil.`;
    case 'table':
      if (status === 'paused') return 'La liste d’attente est en pause : adressez-vous à l’accueil pour une table.';
      if (status === 'closed') return 'La liste d’attente est fermée. Merci de votre visite, à bientôt.';
      return `${tap} vous inscrire sur la liste.`;
    case 'desk':
      if (status === 'paused') return 'Prise de numéro en pause : les personnes déjà en attente seront appelées.';
      if (status === 'closed') return 'Les guichets sont fermés. Merci de votre visite, à bientôt.';
      return `${tap} prendre un numéro.`;
    case 'retail':
      if (status !== 'open') return `${tap} suivre votre commande.`;
      return `${tap} rejoindre la file ou suivre votre commande.`;
    default:
      return `${tap} rejoindre la file.`;
  }
}

/**
 * Le texte de la page de contrôle (/app/[org]/ecran), au-dessus de
 * l'aperçu : ce que l'écran de CE métier montre, dans le vocabulaire de
 * l'écran lui-même. Un guichet ou un centre de santé ne doit pas y lire
 * « prénom » ni « salon » : l'écran promet « jamais de nom ». walkin et
 * event (aucune clé `profile` dans l'instantané) : le texte d'avant P5,
 * au caractère près.
 */
export function tvControlDescription(profile: QueueProfile | null | undefined): string {
  const live = 'L’aperçu ci-dessous est l’écran réel, en direct.';
  switch (profile) {
    case 'vehicle':
      return `Les véhicules prêts, plaque masquée (3 derniers caractères), et l’atelier en chiffres. ${live}`;
    case 'device':
      return `Les appareils prêts, par numéro de dossier, jamais le modèle, et l’atelier en chiffres. ${live}`;
    case 'table':
      return `Les tables prêtes et la liste d’attente en groupes et couverts. ${live}`;
    case 'desk':
      return `Le tableau d’appel : le numéro et le guichet, jamais de nom. ${live}`;
    case 'retail':
      return `Les commandes prêtes (fin du numéro) et les appels au comptoir. ${live}`;
    default:
      return `La file en grand, au mur de votre salon : qui est au comptoir (le prénom que le client a saisi, pour qu’il se reconnaisse), combien attendent, et les places à suivre en initiales seulement. ${live}`;
  }
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
  /**
   * Les autres appels en cours (un guichet appelle pendant qu'un autre
   * attend son client). TOUS ceux que le serveur envoie : une personne
   * appelée doit toujours trouver son numéro à l'écran.
   */
  others: DeskTvCall[];
  /** Derniers appels déjà pris en charge, dans la place que laissent les appels en cours. */
  recent: DeskTvCall[];
  /**
   * Appels en cours que l'instantané ne détaille pas (display_snapshot en
   * envoie 6 au plus) : l'écran dit combien, faute de pouvoir dire qui.
   */
  moreCalls: number;
  counts: DeskDisplaySnapshot['desks']['counts'];
}

/**
 * Lignes de la colonne « Derniers appels » : ce que la colonne tient à 5
 * mètres. Elle suffit aux 5 appels en cours que display_snapshot peut
 * envoyer en plus de celui du panneau (6 au plus, migration 0036).
 */
export const DESK_SIDE_ROWS = 6;

/**
 * Largeur d'un numéro, en tuiles : « A-042 » en compte 4, « AB-1234 » 6
 * (préfixe de 1 ou 2 lettres, 3 chiffres puis 4 au-delà de 999, 0034).
 * Le panneau et l'annonce règlent la taille des volets sur ce nombre : un
 * numéro long ne doit jamais sortir du panneau, un court doit le remplir.
 */
export type DeskTiles = 4 | 5 | 6;

export function deskTilesOf(ticketNo: string): DeskTiles {
  const n = Array.from(ticketNo.replace(/[-\s]/g, '')).length;
  return n <= 4 ? 4 : n === 5 ? 5 : 6;
}

/** Hauteur des volets du panneau (en --u), par largeur de numéro. */
export const DESK_BOARD_FLAP: Record<DeskTiles, number> = { 4: 256, 5: 216, 6: 184 };
/** Même règle pour l'annonce, dont le panneau est plus large. */
export const DESK_ANNOUNCE_FLAP: Record<DeskTiles, number> = { 4: 270, 5: 236, 6: 204 };

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
  // Priorité aux appels en cours : l'historique ne prend que la place
  // qu'ils laissent. Couper un appel en cours pour garder un appel déjà
  // servi cacherait son numéro à la personne qu'on attend au guichet.
  const others = rest.slice(0, DESK_SIDE_ROWS);
  const recent = snapshot.desks.recentCalls.map(deskCall).slice(0, Math.max(0, DESK_SIDE_ROWS - others.length));
  const shownCalls = (current ? 1 : 0) + others.length;
  const moreCalls = Math.max(0, snapshot.desks.counts.called - shownCalls);
  return { current, others, recent, moreCalls, counts: snapshot.desks.counts };
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
