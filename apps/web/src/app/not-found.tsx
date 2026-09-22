import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import styles from './status.module.css';

export const metadata = { title: 'Page introuvable', robots: { index: false } };

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
      <span className={styles.rails} aria-hidden="true" />
      <div className={styles.panel}>
        <Link href="/" aria-label="VotreTour"><Wordmark /></Link>

        {/* Une file dont la dernière latte manque. */}
        <div className={styles.art} aria-hidden="true">
          <span className={styles.rail} />
          <span className={styles.slat} style={{ width: '72%' }} />
          <span className={styles.slat} style={{ width: '54%' }} />
          <span className={`${styles.slat} ${styles.slatGhost}`} style={{ width: '36%' }} />
        </div>

        <div className="stack g3">
          <p className="t-label">Introuvable</p>
          <h1 className="t-title">Cette file n&apos;existe pas</h1>
          <p className="t-body t-muted">
            La plaque a peut-être été retirée, ou le lien est incomplet. Si vous êtes
            dans un commerce, présentez-vous directement au comptoir : on s&apos;occupera
            de vous.
          </p>
        </div>

        <Link href="/" className="btn btn--ghost">Retour à l&apos;accueil</Link>
      </div>
    </main>
  );
}
