import { DeviceGlyph } from '@/components/objects/DeviceGlyph';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { PartySize } from '@/components/objects/PartySize';
import { StageRail } from '@/components/objects/StageRail';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { getProfile } from '@/lib/profiles';
import { formatTicketNo } from '@/lib/profiles/ticket';
import type { ProfileOptions, ProfileStage, QueueProfile } from '@/lib/profiles/types';
import styles from './metier.module.css';

/**
 * APERÇU D'UN MÉTIER — les objets du produit, posés sur le sol de la
 * scène : l'immatriculation et le rail d'étapes d'un atelier, le chevalet
 * d'une table, le numéro et le guichet d'un accueil.
 *
 * Ce sont les VRAIS composants (`components/objects`), pas des dessins :
 * ce que le pro voit ici est ce que verront son poste, ses clients et sa
 * TV. Les données sont des exemples, et le cadre le dit (« Aperçu »).
 * L'aperçu suit les réglages en cours : préfixe du numéro, tailles de
 * table, immatriculation masquée ou non à l'écran.
 *
 * Rendu pur, sans hook : il se redessine à chaque changement de choix.
 */

const TZ = 'Europe/Paris';

/* Un atelier ordinaire : reçu à 8 h 42, diagnostic, devis accordé, réparation. */
const WORKSHOP_HISTORY: { stage: ProfileStage; at: string }[] = [
  { stage: 'received', at: '2026-09-24T06:42:00Z' },
  { stage: 'diagnosis', at: '2026-09-24T07:10:00Z' },
  { stage: 'quote_pending', at: '2026-09-24T08:05:00Z' },
  { stage: 'in_repair', at: '2026-09-24T10:15:00Z' },
];
const RETAIL_HISTORY: { stage: ProfileStage; at: string }[] = [
  { stage: 'preparing', at: '2026-09-24T09:05:00Z' },
];

export function MetierApercu({
  profile,
  options,
  ticketPrefix,
  chair = true,
}: {
  profile: QueueProfile;
  options: ProfileOptions;
  ticketPrefix: string;
  /** Passage au fauteuil (coiffure, beauté) ; sinon, un passage sans fauteuil. */
  chair?: boolean;
}): React.JSX.Element {
  const def = getProfile(profile);
  return (
    <div className={styles.scene} data-profile={profile}>
      <span className="floor-marks" aria-hidden="true" />
      <div className={styles.sceneObjects}>{objectsFor(profile, options, ticketPrefix, chair)}</div>
      <div className={styles.sceneKeys} aria-hidden="true">
        <span className={`btn btn--signal btn--key ${styles.sceneKey}`}>{def.vocab.call}</span>
        <span className={`btn btn--ghost ${styles.sceneKeyAlt}`}>{def.vocab.complete}</span>
      </div>
    </div>
  );
}

function objectsFor(profile: QueueProfile, options: ProfileOptions, prefix: string, chair: boolean): React.ReactNode {
  switch (profile) {
    case 'vehicle':
      return (
        <div className={styles.objWorkshop}>
          <div className={styles.objPlate}>
            <Immatriculation value="FX-482-KL" width={300} />
            <p className={styles.objCaption}>Peugeot 208 · Freins</p>
          </div>
          <div className={styles.objRail}>
            <StageRail profile="vehicle" current="in_repair" history={WORKSHOP_HISTORY} timeZone={TZ} />
          </div>
        </div>
      );
    case 'device':
      return (
        <div className={styles.objWorkshop}>
          <div className={styles.objDossier}>
            <TicketNumber value={formatTicketNo('device', 42) ?? '0042'} kind="dossier" size="2.4rem" />
            <span className={styles.objDevice}>
              <DeviceGlyph kind="phone" size={30} />
              <span>iPhone 13 · Écran</span>
            </span>
          </div>
          <div className={styles.objRail}>
            <StageRail profile="device" current="in_repair" history={WORKSHOP_HISTORY} timeZone={TZ} />
          </div>
        </div>
      );
    case 'table': {
      const sizes = [...(options.tableSizes ?? [2, 4, 6, 8])].sort((a, b) => a - b);
      return (
        <div className={styles.objTable}>
          <div className={styles.objTents}>
            <PartySize count={4} name="Karim" state="called" size="md" />
            <PartySize count={2} state="waiting" size="sm" />
            <PartySize count={6} state="waiting" size="sm" />
          </div>
          <p className={styles.objFree}>
            <span className={styles.objFreeLabel}>Table libre pour</span>
            {sizes.map((n, i) => (
              <span key={n} className={styles.objFreeKey}>{i === sizes.length - 1 ? `${n}+` : n}</span>
            ))}
          </p>
        </div>
      );
    }
    case 'desk': {
      const numbered = options.numbering !== false;
      return (
        <div className={styles.objDesk}>
          {numbered ? (
            <TicketNumber
              value={formatTicketNo('desk', 42, prefix) ?? 'A-042'}
              destination="Guichet 3"
              size="clamp(2rem, 1.4rem + 1.6vw, 2.75rem)"
            />
          ) : (
            <p className={styles.objCall}>Appelé au guichet 3</p>
          )}
          <p className={styles.objCaption}>
            {options.sensitive ? 'Données de santé : jamais de nom, ni à l’écran ni en salle' : 'Un numéro en salle, jamais un nom'}
          </p>
        </div>
      );
    }
    case 'retail':
      return (
        <div className={styles.objWorkshop}>
          <div className={styles.objDossier}>
            {options.numbering ? (
              <TicketNumber value={formatTicketNo('retail', 18, prefix) ?? 'A-018'} size="2.4rem" />
            ) : (
              <p className={styles.objOrder}>Commande n°&nbsp;1234</p>
            )}
            <span className={styles.objCaption}>Retrait · prête à la caisse</span>
          </div>
          <div className={styles.objRail}>
            <StageRail profile="retail" current="ready" history={RETAIL_HISTORY} timeZone={TZ} />
          </div>
        </div>
      );
    case 'event':
      return <p className={styles.objCall}>Entrée par vagues, avec un laisser-passer</p>;
    case 'walkin':
    default:
      return (
        <div className={styles.objRang}>
          <ol className={styles.miniRang} aria-label="Trois personnes devant le client">
            {[chair ? 'Au fauteuil' : 'En cours', '', '', 'Vous'].map((label, i) => (
              <li key={i} className={styles.miniSlat} data-kind={i === 0 ? 'serving' : i === 3 ? 'self' : undefined}>
                {label}
              </li>
            ))}
          </ol>
          <p className={styles.objWaiting}>
            <span className={styles.objBig}>3</span> personnes devant vous
          </p>
        </div>
      );
  }
}

/** Petit pictogramme de profil, dans la géométrie des icônes (trait 1,6 px). */
export function ProfileGlyph({ profile }: { profile: QueueProfile }): React.JSX.Element {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  switch (profile) {
    case 'vehicle':
      return (
        <svg {...common}>
          <rect x="2.5" y="7" width="19" height="10" rx="1.8" />
          <path d="M6 7v10" />
          <path d="M9.5 12h8" />
        </svg>
      );
    case 'device':
      return <DeviceGlyph kind="phone" size={24} />;
    case 'table':
      return (
        <svg {...common}>
          <path d="M6 19 10 5h4l4 14" />
          <path d="M4 19h16" />
          <path d="M11 11h2" />
        </svg>
      );
    case 'desk':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="11" height="14" rx="1.8" />
          <path d="M6.5 10h4M6.5 14h4" />
          <path d="M16.5 12h5M19 9.5 21.5 12 19 14.5" />
        </svg>
      );
    case 'retail':
      return (
        <svg {...common}>
          <path d="M5 8h14l-1.2 11H6.2z" />
          <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
        </svg>
      );
    case 'event':
      return (
        <svg {...common}>
          <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" />
          <path d="M13 7v10" strokeDasharray="1.6 2.4" />
        </svg>
      );
    case 'walkin':
    default:
      return (
        <svg {...common}>
          <path d="M5 4v16" />
          <path d="M5 7h13M5 12h10M5 17h7" />
        </svg>
      );
  }
}
