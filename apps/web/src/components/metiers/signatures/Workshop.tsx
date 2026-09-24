import { DeviceGlyph } from '@/components/objects/DeviceGlyph';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { StageRail } from '@/components/objects/StageRail';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { displayRegistration, maskRegistration } from '@/lib/profiles/registration';
import { formatTicketNo } from '@/lib/profiles/ticket';
import type { SignatureContent } from '@/lib/metiers/types';
import type { ProfileStage } from '@/lib/profiles/types';
import type { ReceptionFraming } from './Props';
import { Reception } from './Reception';
import styles from './signatures.module.css';

/**
 * L'ATELIER — garages (profil `vehicle`) et réparation (`device`).
 *
 * Deux versions, et jamais un mélange :
 *
 *  - PROFIL OUVERT (`open`, toutes les capacités de son socle livrées) :
 *    la fiche d'atelier telle que le produit la dessine. Au garage,
 *    l'immatriculation MASQUÉE (seuls les trois derniers caractères
 *    restent lisibles, comme sur l'écran du hall) ; en réparation, le
 *    numéro de dossier et l'appareil. Puis le rail d'étapes, côté poste
 *    (horizontal) et côté client (vertical). Rail COMPACT des deux côtés :
 *    un devis ou une pièce qui n'a pas eu lieu n'est jamais dessiné, et
 *    la page ne montre donc pas d'étape « Devis » tant que la capacité
 *    devis n'est pas livrée non plus ;
 *
 *  - SINON : la version « Réception », vraie aujourd'hui (la file du
 *    comptoir en relief). Le registre donne alors déjà un repli de genre
 *    `counter` ; la double garde ci-dessous empêche qu'un appel direct ou
 *    un registre mal rempli affiche un objet de profil non livré.
 */

/** Un passage fictif mais plausible : reçu à 8 h 42, diagnostic, puis réparation. */
const HISTORY: ReadonlyArray<{ stage: ProfileStage; at: string }> = [
  { stage: 'received', at: '2026-09-24T06:42:00.000Z' },
  { stage: 'diagnosis', at: '2026-09-24T07:05:00.000Z' },
  { stage: 'in_repair', at: '2026-09-24T08:20:00.000Z' },
];
const CURRENT: ProfileStage = 'in_repair';
const TIME_ZONE = 'Europe/Paris';

/** Exemple d'écran, masqué par la fonction du produit (jamais une forme complète). */
const MASKED_PLATE = maskRegistration(displayRegistration('AB123CD'));

export function Workshop({
  signature,
  profile,
  open,
  framing,
}: {
  signature: SignatureContent;
  profile: 'vehicle' | 'device';
  /** Le profil est-il ouvert sur les pages (`profileOpenOnPages`) ? */
  open: boolean;
  /** Cadrage de la version « Réception » (objet du métier). */
  framing?: ReceptionFraming | null;
}): React.JSX.Element {
  if (!open || signature.kind !== 'workshop') return <Reception signature={signature} framing={framing} />;

  const dossier = formatTicketNo('device', 42) ?? '0042';
  return (
    <div className={`${styles.panel} ${styles.workshop}`}>
      <div className={styles.sheet}>
        <p className={`t-label ${styles.sheetLabel}`}>Sur le poste de l’atelier</p>
        <div className={styles.sheetId}>
          {profile === 'vehicle' ? (
            <Immatriculation maskedValue={MASKED_PLATE} size="lg" />
          ) : (
            <span className={styles.dossier}>
              <DeviceGlyph kind="phone" size={36} />
              <TicketNumber value={dossier} kind="dossier" size="clamp(2.25rem, 1.6rem + 2.4vw, 3.25rem)" />
            </span>
          )}
        </div>
        <StageRail profile={profile} current={CURRENT} history={HISTORY} compact timeZone={TIME_ZONE} />
      </div>
      <div className={styles.phoneView}>
        <p className={`t-label ${styles.sheetLabel}`}>Sur le téléphone du client</p>
        <StageRail
          profile={profile}
          current={CURRENT}
          history={HISTORY}
          orientation="vertical"
          timeZone={TIME_ZONE}
        />
      </div>
    </div>
  );
}
