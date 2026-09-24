import { FloorScene, type FloorSlat } from '@/components/objects/FloorScene';
import type { SignatureContent } from '@/lib/metiers/types';
import styles from './signatures.module.css';

/**
 * LA FILE AU COMPTOIR — la signature « vraie aujourd'hui » de tout métier
 * dont le profil n'est pas encore ouvert (garages : « Réception »,
 * réparation : « Comptoir », restaurants : « Salle »…), et celle des
 * salons (« Bac »).
 *
 * La file couchée au sol, en relief, avec le seuil du métier en vermillon.
 * Les premières lattes portent les libellés du registre (états du poste
 * ou prénoms fictifs), les suivantes restent anonymes, comme sur l'écran
 * de salle. Composant serveur, sans JavaScript ; l'intro des lattes est en
 * CSS et n'existe qu'en mouvement permis.
 */
export function Reception({ signature }: { signature: SignatureContent }): React.JSX.Element {
  const named: FloorSlat[] = signature.lanes.slice(0, 5).map((lane, i) => ({
    id: `l${i}`,
    state: i === 0 ? 'serving' : 'wait',
    label: lane.label,
    ...(lane.hint ? { hint: lane.hint } : {}),
  }));
  const anonymous: FloorSlat[] = Array.from({ length: Math.max(0, 5 - named.length) }, (_, i) => ({
    id: `a${i}`,
    state: 'wait',
  }));
  return (
    <div className={`${styles.panel} ${styles.panelTall}`}>
      <FloorScene
        slats={[...named, ...anonymous]}
        seuil={signature.seuil}
        spill
        intro
        size="lg"
        tilt={54}
        turn={6}
        label={`La file vue du poste : ${signature.lanes.map((l) => l.label).join(', ')}, puis les suivants, jusqu’au seuil « ${signature.seuil} ».`}
      />
    </div>
  );
}
