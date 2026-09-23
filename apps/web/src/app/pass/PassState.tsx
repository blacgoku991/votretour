import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { FloorScene, type FloorSlat } from '@/components/objects/FloorScene';
import styles from '../status.module.css';

export type PassStateKind = 'expire' | 'invalide';

/** La place est tenue en pointillés : elle existe, mais ce lien n’y mène plus. */
const SLATS: FloorSlat[] = [
  { id: 'a', state: 'wait' },
  { id: 'b', state: 'wait' },
  { id: 'c', state: 'ghost', label: '—' },
];

const COPY: Record<PassStateKind, { kicker: string; title: string; lead: string }> = {
  expire: {
    kicker: 'Expiré',
    title: 'Ce laisser-passer n’est plus valable',
    lead:
      'Son heure limite est passée, ou il a déjà servi à entrer. Présentez-vous à l’accueil de l’événement : l’équipe vérifiera votre place avec vous.',
  },
  invalide: {
    kicker: 'Lien invalide',
    title: 'Ce lien de laisser-passer n’est pas valide',
    lead:
      'Le lien est incomplet ou a été modifié. Ouvrez à nouveau le lien reçu, en entier, ou présentez-vous à l’accueil de l’événement.',
  },
};

/**
 * Laisser-passer refusé (/pass?etat=expire|invalide).
 *
 * Même coque que la 404 : le sol en relief, un texte adressé à quelqu’un
 * debout devant l’entrée de l’événement, et une seule consigne.
 */
export function PassState({ kind, hasPass }: { kind: PassStateKind; hasPass: boolean }) {
  const copy = COPY[kind];
  return (
    <main className={styles.screen}>
      <div className={`shell ${styles.bar}`}>
        <Link href="/" aria-label="Rangvia" className={styles.home}><Wordmark /></Link>
      </div>

      <div className={styles.stage}>
        <div className={styles.sceneBand} aria-hidden="true">
          <FloorScene size="sm" slats={SLATS} seuil="Accueil" positions={false} />
        </div>

        <div className={`shell ${styles.body}`}>
          <div className={styles.text}>
            <p className="t-kicker"><span className="t-kicker__num">Pass</span> {copy.kicker}</p>
            <h1 className={`t-display ${styles.title}`}>{copy.title}</h1>
            <p className={styles.lead}>{copy.lead}</p>
            {hasPass && (
              <div className={styles.actions}>
                <Link href="/pass" className="btn btn--signal btn--lg">Afficher mon laisser-passer</Link>
              </div>
            )}
          </div>

          <div className={styles.sceneSide} aria-hidden="true">
            <FloorScene size="lg" slats={SLATS} seuil="Accueil" />
          </div>
        </div>
      </div>
    </main>
  );
}
