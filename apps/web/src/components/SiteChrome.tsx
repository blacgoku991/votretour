import Link from 'next/link';
import { Wordmark } from './Wordmark';
import styles from '@/app/marketing.module.css';

/**
 * En-tête et pied de page du site public.
 *
 * Ils vivent dans un composant dédié et non dans page.tsx : un fichier
 * de page Next.js ne peut exporter que des symboles reconnus
 * (default, metadata, revalidate…), et le compilateur le vérifie.
 */

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`shell ${styles.headerInner}`}>
        <Link href="/" aria-label="VotreTour"><Wordmark /></Link>
        <nav className={styles.nav}>
          <Link href="/#comment">Comment ça marche</Link>
          <Link href="/tarifs">Tarifs</Link>
        </nav>
        <div className={styles.headerActions}>
          <Link href="/connexion" className="btn btn--quiet btn--sm">Connexion</Link>
          <Link href="/inscription" className="btn btn--signal btn--sm">Ouvrir ma file</Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`shell ${styles.footerInner}`}>
        <div className={styles.footerBrand}>
          <Wordmark />
          <p className="t-micro t-faint">
            La file d&apos;attente qui laisse vos clients respirer.
          </p>
        </div>
        <nav className={styles.footerNav}>
          <Link href="/tarifs">Tarifs</Link>
          <Link href="/confidentialite">Confidentialité</Link>
          <Link href="/cgu">Conditions d&apos;utilisation</Link>
          <Link href="/connexion">Connexion</Link>
        </nav>
      </div>
    </footer>
  );
}
