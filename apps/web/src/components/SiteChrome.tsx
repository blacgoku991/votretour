import Link from 'next/link';
import { Wordmark } from './Wordmark';
import { HeaderScrollFlag, MobileNav, SiteNav } from '@/app/(marketing)/_chrome/HeaderClient';
import styles from './SiteChrome.module.css';

/**
 * En-tête et pied de page du site public.
 *
 * Ils vivent dans un composant dédié et non dans page.tsx : un fichier
 * de page Next.js ne peut exporter que des symboles reconnus
 * (default, metadata, revalidate…), et le compilateur le vérifie.
 *
 * CONTRAT : l'en-tête mesure EXACTEMENT var(--site-header-h) (56 px, puis
 * 64 px à partir de 760 px). La scène collante de l'accueil se cale
 * dessous. Ne jamais lui ajouter de bordure qui compte dans sa hauteur :
 * le filet bas est un calque (::after) dont seule l'opacité change.
 */

function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={styles.loginIcon}>
      <circle cx="10" cy="6.5" r="3.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 17c.9-3.1 3.4-4.75 6.5-4.75S15.6 13.9 16.5 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className={styles.header}>
      {/* Premier arrêt de tabulation. Chaque page publique porte id="contenu" sur son <main>. */}
      <a href="#contenu" className="skip-link">Aller au contenu</a>
      <HeaderScrollFlag />
      <div className={`shell ${styles.headerInner}`}>
        <Link href="/" aria-label="Rangvia" className={styles.home}>
          <Wordmark />
        </Link>
        <SiteNav className={styles.nav} linkClassName={styles.navLink} />
        <div className={styles.headerActions}>
          <Link href="/connexion" className={`btn btn--quiet btn--sm ${styles.login}`} aria-label="Connexion">
            <UserIcon />
            <span className={styles.loginText}>Connexion</span>
          </Link>
          <Link href="/inscription" className={`btn btn--signal btn--sm ${styles.open}`}>
            Ouvrir ma file
          </Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}

interface FooterLink { href: string; label: string }
const FOOTER_GROUPS: ReadonlyArray<{ title: string; links: ReadonlyArray<FooterLink> }> = [
  {
    title: 'Produit',
    links: [
      { href: '/#comment', label: 'Comment ça marche' },
      { href: '/tarifs', label: 'Tarifs' },
      { href: '/#drops', label: 'Événements & drops' },
    ],
  },
  {
    title: 'Compte',
    links: [
      { href: '/connexion', label: 'Connexion' },
      { href: '/inscription', label: 'Créer un compte' },
    ],
  },
  {
    title: 'Légal',
    links: [
      { href: '/confidentialite', label: 'Confidentialité' },
      { href: '/cgu', label: "Conditions d’utilisation" },
    ],
  },
];

/** Nombre de places dessinées derrière la tête de file (coupées à gauche sur petit écran). */
const QUEUE_MARKS = 26;

/**
 * Pied « fin de file » : le rail court sur toute la largeur, les places
 * s'y alignent et la dernière — la tête de file — est la latte vermillon.
 * Composant serveur : l'année est calculée au rendu.
 */
export function SiteFooter({ legalNotice = false }: {
  /** Mentions légales publiées (informations de l'éditeur renseignées côté serveur). */
  legalNotice?: boolean;
} = {}) {
  const year = new Date().getFullYear();
  const groups = legalNotice
    ? FOOTER_GROUPS.map((group) => group.title === 'Légal'
      ? { ...group, links: [...group.links, { href: '/mentions-legales', label: 'Mentions légales' }] }
      : group)
    : FOOTER_GROUPS;
  return (
    <footer className={styles.footer}>
      <div className="shell">
        <div className={styles.end}>
          <div className={styles.queue} aria-hidden="true">
            {Array.from({ length: QUEUE_MARKS }, (_, i) => (
              <span
                key={i}
                className={styles.mark}
                style={{ ['--i' as string]: QUEUE_MARKS - 1 - i } as React.CSSProperties}
              />
            ))}
          </div>
          <div className={styles.head}>
            <p className={styles.headSlat}>Vous êtes en tête de file.</p>
            <Link href="/inscription" className={`btn btn--ghost btn--sm ${styles.headCta}`}>
              Ouvrir ma file
            </Link>
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.brand}>
            <Link href="/" aria-label="Rangvia" className={styles.home}>
              <Wordmark />
            </Link>
            <p className={styles.tagline}>La file d’attente qui laisse vos clients respirer.</p>
          </div>

          <nav className={styles.columns} aria-label="Pied de page">
            {groups.map((group) => (
              <div key={group.title} className={styles.column}>
                <p className="t-label">{group.title}</p>
                <ul className={styles.columnList}>
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={styles.columnLink}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <nav className={styles.compact} aria-label="Pied de page">
            <ul className={`rail-list ${styles.compactList}`}>
              {groups.flatMap((group) => group.links).map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={styles.compactLink}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <p className={styles.legal}>
          © {year} Rangvia · Fait pour les commerces sans rendez‑vous
        </p>
      </div>
    </footer>
  );
}
