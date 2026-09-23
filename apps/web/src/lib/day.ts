/**
 * Minuit local d'un établissement, en instant UTC.
 *
 * Même définition que le compteur « aujourd'hui » de la File, calculé en
 * base : date_trunc('day', now() at time zone tz) at time zone tz. Le
 * décalage est lu dans Intl (« GMT+02:00 », « GMT-04:00 ») : juste en
 * heure d'été comme d'hiver, et pour les fuseaux à l'ouest de Greenwich
 * (Antilles, Guyane), où minuit UTC tombe encore la veille.
 */

function offsetMinutes(at: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

export function startOfDayInZone(now: Date, timeZone = 'Europe/Paris'): Date {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'Europe/Paris';
  }
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const utcMidnight = new Date(`${day}T00:00:00Z`).getTime();
  // Premier essai avec le décalage de minuit UTC, puis correction avec
  // celui de l'instant trouvé (utile un jour de changement d'heure).
  const guess = utcMidnight - offsetMinutes(new Date(utcMidnight), zone) * 60_000;
  return new Date(utcMidnight - offsetMinutes(new Date(guess), zone) * 60_000);
}
