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

/**
 * Une place dessinée en ticket : prise par un commerce, ou LA place à
 * prendre (la prochaine libre, la seule « place fantôme » de la file).
 */
export type FounderPlace =
  | { place: number; kind: 'taken'; name: string; city: string | null }
  | { place: number; kind: 'open' };

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
 * Ce que dessine la vitrine, à partir des tickets reçus.
 *
 *  - `places` : les tickets pris, puis UNE seule place fantôme, la
 *    prochaine libre (celle qu'un nouveau commerce prendrait), dans
 *    l'ordre des numéros. C'est tout ce que le téléphone empile ;
 *  - `rest` : les autres places libres, regroupées en une latte neutre
 *    (« 05 à 10 : libres ») plutôt que dessinées une à une : une place
 *    vide n'a rien à montrer, et dix cases vides ne doivent pas peser plus
 *    lourd que les vrais tickets ;
 *  - `compact` : aucun commerce encore, la vitrine se réduit à la place
 *    n° 1 et à l'invitation, sans grille.
 */
export interface FoundersLayout {
  places: FounderPlace[];
  rest: number[];
  taken: number;
  free: number;
  compact: boolean;
}

export function foundersLayout(tickets: readonly FounderTicket[]): FoundersLayout {
  const byPlace = new Map(tickets.map((t) => [t.place, t]));
  const places: FounderPlace[] = [];
  const rest: number[] = [];
  let open: number | null = null;
  for (let place = 1; place <= FOUNDERS_PLACES; place += 1) {
    const ticket = byPlace.get(place);
    if (ticket) places.push({ place, kind: 'taken', name: ticket.name, city: ticket.city });
    else if (open === null) {
      open = place;
      places.push({ place, kind: 'open' });
    } else rest.push(place);
  }
  const taken = places.filter((p) => p.kind === 'taken').length;
  return { places, rest, taken, free: FOUNDERS_PLACES - taken, compact: taken === 0 };
}

/** « 01 », « 10 » : le numéro du ticket. */
export function placeNumber(place: number): string {
  return String(place).padStart(2, '0');
}

/** « Place n° 4 : à prendre » — la place fantôme, qui mène à l'inscription. */
export function openPlaceLabel(place: number): string {
  return `Place n\u00b0\u00a0${place}\u00a0: à prendre`;
}

/**
 * La latte des autres places libres : « 05 à 10 : libres », « 09 et 10 :
 * libres », « Place n° 10 : libre ». Des numéros non consécutifs (ligne
 * écartée par `parseFounderRows`) restent exacts : « 03, 04 et 06 à 10 ».
 */
export function restPlacesLabel(rest: readonly number[]): string {
  if (rest.length === 0) return '';
  if (rest.length === 1) return `Place n\u00b0\u00a0${rest[0]}\u00a0: libre`;
  const sorted = [...rest].sort((a, b) => a - b);
  const tokens: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j += 1;
    if (j - i >= 2) tokens.push(`${placeNumber(sorted[i]!)} à ${placeNumber(sorted[j]!)}`);
    else for (let k = i; k <= j; k += 1) tokens.push(placeNumber(sorted[k]!));
    i = j + 1;
  }
  const list = tokens.length === 1 ? tokens[0]! : `${tokens.slice(0, -1).join(', ')} et ${tokens.at(-1)!}`;
  return `${list}\u00a0: libres`;
}

/**
 * Au-delà de cette longueur, un nom passe en corps réduit sur le ticket :
 * il tient alors en deux lignes sans être coupé. Le nom entier reste dans
 * la page (et dans l'infobulle), la coupe n'est que visuelle.
 */
export const LONG_NAME = 26;
