import { splitTicketNo } from '@/lib/profiles/ticket';
import styles from './TicketNumber.module.css';

/**
 * LE NUMÉRO DE TICKET — « A-042 », en volets de gare.
 *
 * L'exception assumée à la règle « pas de numéro » (voir
 * `lib/profiles/ticket.ts`) : au guichet, la salle appelle un numéro et
 * jamais un nom. Le numéro est donc l'objet central de l'écran du client
 * et du tableau d'appel, avec, s'il est appelé, sa destination :
 * « A-042 → GUICHET 3 », la flèche en vermillon.
 *
 * Variante STATIQUE : les mêmes tuiles que `FlapText` (classes `.flap`,
 * charnière comprise), au repos, sans hook. Elle se rend côté serveur
 * (pages métier, étiquette). Le volet qui TOMBE quand le numéro change
 * est ajouté côté client par `TicketNumberFlap`, avec le même dessin.
 *
 * Les tuiles restent encre en thème clair comme en sombre : c'est un
 * tableau d'affichage, un objet.
 */

export interface TicketNumberProps {
  /** Déjà formaté : « A-042 » (guichet) ou « 0042 » (dossier d'atelier). */
  value: string;
  /** Hauteur d'une tuile (pilote --flap-size). */
  size?: string;
  /** Guichet où se présenter (« Guichet 3 ») ; absent tant que le ticket n'est pas appelé. */
  destination?: string | null;
  /** 'ticket' (défaut) ou 'dossier' : le mot lu par les lecteurs d'écran. */
  kind?: 'ticket' | 'dossier';
  className?: string;
}

export const TICKET_DEFAULT_SIZE = 'clamp(2.75rem, 1.6rem + 5vw, 5rem)';

export function ticketLabel(value: string, kind: 'ticket' | 'dossier', destination?: string | null): string {
  const word = kind === 'dossier' ? 'Dossier' : 'Ticket';
  return destination ? `${word} ${value}, ${destination}` : `${word} ${value}`;
}

function StaticCells({ text }: { text: string }) {
  return (
    <span className="flap-row">
      {Array.from(text).map((ch, i) => (
        <span key={i} className="flap flap--tile">
          <span className="flap__face flap__rest">{ch}</span>
        </span>
      ))}
    </span>
  );
}

/** Flèche et guichet : partagés par les variantes statique et animée. */
export function TicketDestination({ destination }: { destination: string }): React.JSX.Element {
  return (
    <span className={styles.dest} aria-hidden="true">
      <svg className={styles.arrow} viewBox="0 0 24 24" focusable="false">
        <path d="M3 12h16M13 5.5 19.5 12 13 18.5" />
      </svg>
      <span className={styles.desk}>{destination}</span>
    </span>
  );
}

export function TicketNumber({
  value,
  size = TICKET_DEFAULT_SIZE,
  destination,
  kind = 'ticket',
  className,
}: TicketNumberProps): React.JSX.Element {
  const { prefix, digits } = splitTicketNo(value);
  return (
    <span
      className={[styles.ticket, className].filter(Boolean).join(' ')}
      style={{ ['--flap-size' as string]: size } as React.CSSProperties}
      data-called={destination ? 'true' : undefined}
    >
      <span className="sr-only">{ticketLabel(value, kind, destination)}</span>
      <span className={styles.cells} aria-hidden="true">
        {prefix && <StaticCells text={prefix} />}
        {prefix && <span className={styles.dash} />}
        <StaticCells text={digits} />
      </span>
      {destination && <TicketDestination destination={destination} />}
    </span>
  );
}
