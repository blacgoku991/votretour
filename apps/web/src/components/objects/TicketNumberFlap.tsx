'use client';

import { FlapText } from '@/components/FlapNumber';
import { splitTicketNo } from '@/lib/profiles/ticket';
import { TICKET_DEFAULT_SIZE, TicketDestination, ticketLabel, type TicketNumberProps } from './TicketNumber';
import styles from './TicketNumber.module.css';

/**
 * LE NUMÉRO DE TICKET, ANIMÉ — même dessin que `TicketNumber`, mais
 * chaque tuile qui change TOMBE (`FlapText`, demi-cellules), de gauche à
 * droite : « A-042 » → « A-043 » ne fait tomber que la dernière tuile.
 *
 * C'est le seul composant client de `components/objects/` : il enveloppe
 * le volet, qui a besoin d'un état. En mouvement réduit, le chiffre
 * change sans chute (géré par `FlapText`).
 *
 * `live` : annonce le nouveau numéro aux lecteurs d'écran (tableau d'appel,
 * poste du guichet). Laisser à faux quand le numéro ne change pas.
 */

export interface TicketNumberFlapProps extends TicketNumberProps {
  live?: boolean;
}

export function TicketNumberFlap({
  value,
  size = TICKET_DEFAULT_SIZE,
  destination,
  kind = 'ticket',
  live = false,
  className,
}: TicketNumberFlapProps): React.JSX.Element {
  const { prefix, digits } = splitTicketNo(value);
  const label = ticketLabel(value, kind, destination);
  return (
    <span
      className={[styles.ticket, className].filter(Boolean).join(' ')}
      style={{ ['--flap-size' as string]: size } as React.CSSProperties}
      data-called={destination ? 'true' : undefined}
    >
      {live ? (
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {label}
        </span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
      <span className={styles.cells} aria-hidden="true">
        {prefix && <FlapText text={prefix} fixed tile static label="" stagger={0} />}
        {prefix && <span className={styles.dash} />}
        <FlapText text={digits} fixed tile static label="" cells={digits.length} />
      </span>
      {destination && <TicketDestination destination={destination} />}
    </span>
  );
}
