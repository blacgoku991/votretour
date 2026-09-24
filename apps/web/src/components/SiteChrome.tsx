import Link from 'next/link';
import { Wordmark } from './Wordmark';
import { HeaderScrollFlag, MobileNav, SiteNav } from '@/app/(marketing)/_chrome/HeaderClient';
import { FoundersQueue } from './founders/FoundersQueue';
import type { FounderTicket } from './founders/places';
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
 *
 * DONNÉES DU PIED : les métiers publiés et la vitrine des dix premiers
 * commerces arrivent en PROPS, lues par la page ou le layout
 * (`siteFooterData()`, server/founders.ts). Ce fichier ne lit rien
 * lui-même : `app/error.tsx`, composant client, l'importe, et tout ce
 * qu'il importerait (registre des métiers, client service_role) partirait
 * dans le navigateur, ou casserait la compilation (`server-only`).
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

export interface FooterLink { href: string; label: string }
const FOOTER_GROUPS: ReadonlyArray<{ title: string; links: ReadonlyArray<FooterLink> }> = [
  {
    title: 'Produit',
    links: [
      { href: '/#comment', label: 'Comment ça marche' },
      { href: '/pour', label: 'Métiers' },
      { href: '/tarifs', label: 'Tarifs' },
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

/**
 * Sans la liste des métiers (page qui ne la fournit pas encore), le lien
 * « Événements & drops » reste dans « Produit », comme avant. Avec elle,
 * il est dans le groupe « Métiers » : jamais deux fois.
 */
const EVENTS_LINK: FooterLink = { href: '/pour/evenements-et-drops', label: 'Événements & drops' };

/** Nombre de places dessinées derrière la tête de file (coupées à gauche sur petit écran). */
const QUEUE_MARKS = 26;

export interface SiteFooterProps {
  /** Mentions légales publiées (informations de l'éditeur renseignées côté serveur). */
  legalNotice?: boolean;
  /** Pages métier publiées (`selectPublishedMetiers()`), dans l'ordre du registre. */
  metiers?: readonly FooterLink[];
  /**
   * Vitrine des dix premiers commerces (`getFoundersShowcase()`). `null` :
   * indisponible (build, panne) ou non fournie ; rien n'est alors affiché,
   * plutôt que dix places « libres » peut-être fausses.
   */
  founders?: readonly FounderTicket[] | null;
}

/**
 * Pied « fin de file » : le rail court sur toute la largeur, les places
 * s'y alignent et la dernière — la tête de file — est la latte vermillon.
 * Dessous, les dix premiers commerces de la file, en tickets.
 * Composant serveur : l'année est calculée au rendu.
 */
export function SiteFooter({ legalNotice = false, metiers = [], founders = null }: SiteFooterProps = {}) {
  const year = new Date().getFullYear();
  const product = FOOTER_GROUPS[0]!;
  const groups: Array<{ title: string; links: ReadonlyArray<FooterLink> }> = [
    metiers.length > 0 ? product : { ...product, links: [...product.links, EVENTS_LINK] },
    // Le groupe « Métiers » vient juste après « Produit » : un lien par
    // page publiée, la même liste que l'index /pour.
    ...(metiers.length > 0 ? [{ title: 'Métiers', links: metiers }] : []),
    ...FOOTER_GROUPS.slice(1).map((group) => legalNotice && group.title === 'Légal'
      ? { ...group, links: [...group.links, { href: '/mentions-legales', label: 'Mentions légales' }] }
      : group),
  ];
  const compactLinks = groups.filter((group) => group.title !== 'Métiers').flatMap((group) => group.links);

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

        {founders && <FoundersQueue founders={founders} />}

        <div className={styles.body} data-groups={groups.length}>
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
              {compactLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={styles.compactLink}>{link.label}</Link>
                </li>
              ))}
            </ul>
            {metiers.length > 0 && (
              <div className={styles.compactMetiers}>
                <p className="t-label">Métiers</p>
                <ul className={styles.compactGrid}>
                  {metiers.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={styles.compactGridLink}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>
        </div>

        <p className={styles.legal}>
          © {year} Rangvia · Fait pour les commerces sans rendez‑vous
        </p>
      </div>
    </footer>
  );
}
