'use client';

import { useEffect, useState } from 'react';

/** Clé de jour 'AAAA-MM-JJ' à Paris. */
function parisDayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/**
 * Libellé d'un séparateur de jour : « AUJOURD'HUI », « HIER », sinon la
 * date (« LUN. 21 SEPT. »). Le rendu serveur donne toujours la date :
 * « aujourd'hui » dépend de l'heure du lecteur, on ne le décide qu'après
 * montage (aucun écart d'hydratation).
 */
export function DayLabel({ dayKey, date }: { dayKey: string; date: string }) {
  const [relative, setRelative] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    const today = parisDayKey(now);
    const yesterday = parisDayKey(new Date(now.getTime() - 86_400_000));
    setRelative(dayKey === today ? 'Aujourd’hui' : dayKey === yesterday ? 'Hier' : null);
  }, [dayKey]);

  return relative ? (
    <>
      <span>{relative}</span>
      <span data-day-date="">{date}</span>
    </>
  ) : (
    <span>{date}</span>
  );
}
