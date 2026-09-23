/** Formatage en français, sans dépendance externe. */

const TZ = 'Europe/Paris';

export function formatTime(value: string | Date | null | undefined, timeZone = TZ): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(date);
}

export function formatDate(value: string | Date | null | undefined, timeZone = TZ): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone,
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined, timeZone = TZ): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone,
  }).format(date);
}

/** « il y a 4 min », « à l'instant ». */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return '—';
  if (seconds < 45) return "à l'instant";
  if (seconds < 90) return 'il y a 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hier' : `il y a ${days} j`;
}

/** Durée compacte : « 12 min », « 1 h 05 ». */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Durée bornée pour les tableaux de bord : null/NaN → « — » ; 0 → « — » ;
 * ≥ 24 h → « + de 24 h » ; sinon comme formatDuration. Évite d'afficher
 * « 240 h 00 » quand une entrée oubliée fausse une moyenne.
 */
export function formatDurationBounded(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  if (Math.round(seconds) <= 0) return '—';
  if (seconds >= 86_400) return '+ de 24 h';
  return formatDuration(seconds);
}

/** Durée écoulée depuis un horodatage, pour les compteurs vivants. */
export function elapsedSeconds(from: string | Date | null | undefined): number | null {
  if (!from) return null;
  const date = typeof from === 'string' ? new Date(from) : from;
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
}

export function formatPrice(cents: number | null | undefined, currency = 'EUR'): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('fr-FR').format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} %`;
}

export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;

/** Initiales pour les pastilles d'équipe. */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

/** Lien d'itinéraire, en privilégiant les coordonnées exactes. */
export function directionsUrl(location: {
  mapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  name?: string;
  addressLine1?: string | null;
  postalCode?: string | null;
  city?: string | null;
}): string {
  if (location.mapsUrl) return location.mapsUrl;
  if (location.latitude != null && location.longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`;
  }
  const address = [location.name, location.addressLine1, location.postalCode, location.city]
    .filter(Boolean)
    .join(' ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
