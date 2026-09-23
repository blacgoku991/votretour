import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { FloorScene, type FloorSlat } from '@/components/objects/FloorScene';
import styles from './status.module.css';

export const metadata = { title: 'Page introuvable', robots: { index: false } };

/** Le seuil est vide : personne au comptoir, et la dernière place n'est qu'un contour. */
const SLATS: FloorSlat[] = [
  { id: 'a', state: 'wait' },
  { id: 'b', state: 'wait' },
  { id: 'c', state: 'ghost', label: '—' },
];

/**
 * 404.
 *
 * Le cas le plus probable n'est pas une faute de frappe : c'est un
 * client qui scanne une plaque désactivée ou retirée. On lui parle
 * comme à quelqu'un debout devant un comptoir, pas comme à un
 * développeur.
 */
export default function NotFound() {
  return (
    <main className={styles.screen}>
      <div className={`shell ${styles.bar}`}>
        <Link href="/" aria-label="Rangvia" className={styles.home}><Wordmark /></Link>
      </div>

      <div className={styles.stage}>
        <div className={styles.sceneBand} aria-hidden="true">
          <FloorScene size="sm" slats={SLATS} seuil="Comptoir" positions={false} />
        </div>

        <div className={`shell ${styles.body}`}>
          <div className={styles.text}>
            <p className="t-kicker"><span className="t-kicker__num">404</span> Introuvable</p>
            <h1 className={`t-display ${styles.title}`}>Cette file n&apos;existe pas</h1>
            <p className={styles.lead}>
              La plaque a peut-être été retirée, ou le lien est incomplet. Si vous êtes
              dans un commerce, présentez-vous directement au comptoir : on s&apos;occupera
              de vous.
            </p>
            <div className={styles.actions}>
              <Link href="/" className="btn btn--signal btn--lg">Retour à l&apos;accueil</Link>
            </div>
          </div>

          <div className={styles.sceneSide} aria-hidden="true">
            <FloorScene size="lg" slats={SLATS} seuil="Comptoir" />
          </div>
        </div>
      </div>
    </main>
  );
}
