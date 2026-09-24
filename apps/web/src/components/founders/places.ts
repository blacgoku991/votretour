/**
 * LES DIX PREMIERS COMMERCES — la logique pure, sans accès réseau.
 *
 * Partagée par le serveur (`server/founders.ts`, qui lit la base) et par
 * le pied de page (`FoundersQueue`, qui dessine les tickets). Elle vit
 * hors de `server/` parce que le pied de page est aussi importé par des
 * composants client (`app/error.tsx`) : ce module ne doit rien tirer de
 * serveur derrière lui.
 *
 * Règle d'honnêteté : les places sans commerce volontaire restent LIBRES.
 * Aucun nom, aucune ville n'est jamais inventé pour remplir la file.
 */

/** Nombre de places de la vitrine (01 à 10). */
export const FOUNDERS_PLACES = 10;

/** Un commerce volontaire, tel que le renvoie `founders_showcase()` (0041). */
export interface FounderTicket {
  /** 1 à 10, dans l'ordre de création des organisations. */
  place: number;
  name: string;
  /** Ville du premier établissement actif ; `null` si aucune n'est connue. */
  city: string | null;
}

/** Une place de la vitrine : prise par un commerce, ou libre. */
export type FounderPlace =
  | { place: number; kind: 'taken'; name: string; city: string | null }
  | { place: number; kind: 'free' };

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Retours à la ligne et caractères de contrôle : rien à faire sur un ticket.
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, max);
}

/**
 * Lignes brutes de la base → tickets valides. Une ligne douteuse (place
 * hors de 1 à 10, nom vide, place en double) est écartée plutôt que
 * montrée de travers : sa place s'affichera libre.
 */
export function parseFounderRows(rows: unknown): FounderTicket[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<number>();
  const out: FounderTicket[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const place = typeof r.place === 'number' ? r.place : Number.NaN;
    const name = cleanText(r.name, 120);
    if (!Number.isInteger(place) || place < 1 || place > FOUNDERS_PLACES || !name || seen.has(place)) continue;
    seen.add(place);
    out.push({ place, name, city: cleanText(r.city, 80) });
  }
  return out.sort((a, b) => a.place - b.place);
}

/**
 * Les dix places, du 1er au 10e. Les tickets occupent leur place ; toutes
 * les autres sont libres (moins de dix volontaires, ou aucun).
 */
export function foundersPlaces(tickets: readonly FounderTicket[]): FounderPlace[] {
  const byPlace = new Map(tickets.map((t) => [t.place, t]));
  return Array.from({ length: FOUNDERS_PLACES }, (_, i) => {
    const place = i + 1;
    const ticket = byPlace.get(place);
    return ticket
      ? { place, kind: 'taken' as const, name: ticket.name, city: ticket.city }
      : { place, kind: 'free' as const };
  });
}

/** « 01 », « 10 » : le numéro du ticket. */
export function placeNumber(place: number): string {
  return String(place).padStart(2, '0');
}

/** « Place n° 7 : libre » — la phrase d'une place sans commerce. */
export function freePlaceLabel(place: number): string {
  return `Place n° ${place} : libre`;
}
