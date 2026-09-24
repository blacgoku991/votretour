import { TicketNumber } from '@/components/objects/TicketNumber';
import type { SignatureContent } from '@/lib/metiers/types';
import type { ReceptionFraming } from './Props';
import { Reception } from './Reception';
import styles from './signatures.module.css';

/**
 * LE TABLEAU D'APPEL — guichets, profil `desk` OUVERT.
 *
 * Un numéro, un guichet : les tickets en volets de gare, tels que l'écran
 * de salle et le téléphone de la personne appelée les affichent. Aucun
 * prénom, jamais. Le guichet du seuil (« Guichet 2 ») est celui qui
 * appelle en ce moment. Profil fermé : la file de l'accueil, vraie
 * aujourd'hui.
 */
export function Guichets({
  signature,
  open,
  framing,
}: {
  signature: SignatureContent;
  open: boolean;
  framing?: ReceptionFraming | null;
}): React.JSX.Element {
  if (!open || signature.kind !== 'guichets') return <Reception signature={signature} framing={framing} />;
  return (
    <div className={`${styles.panel} ${styles.callBoard}`}>
      <p className={`t-label ${styles.callHead}`}>Appel en cours</p>
      <ol className={styles.calls}>
        {signature.lanes.map((lane) => (
          <li key={lane.label} data-now={lane.label === signature.seuil ? '1' : undefined}>
            {lane.hint ? (
              <TicketNumber value={lane.hint} destination={lane.label} size="clamp(1.75rem, 1.2rem + 2vw, 2.75rem)" />
            ) : (
              <span className="t-board">{lane.label}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
