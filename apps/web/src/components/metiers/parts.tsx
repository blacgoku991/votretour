import Link from 'next/link';
import { safeJsonLd, type JsonLdGraph } from '@/lib/seo/jsonld';
import styles from './metiers.module.css';

/**
 * Petites pièces communes des pages métier. Composants serveur, sans
 * état : ils ne coûtent aucun JavaScript au navigateur.
 */

/** `<script type="application/ld+json">`, sérialisé sans risque d'injection. */
export function JsonLd({ graph }: { graph: JsonLdGraph }): React.JSX.Element {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(graph) }} />;
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Fil d'Ariane visible, aligné sur le `BreadcrumbList` du JSON-LD. Le
 * dernier niveau est la page courante (`aria-current`), sans lien.
 */
export function Breadcrumb({ items, className }: { items: readonly Crumb[]; className?: string }): React.JSX.Element {
  return (
    <nav aria-label="Fil d’Ariane" className={[styles.crumbs, className].filter(Boolean).join(' ')}>
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${item.label}`}>
              {item.href && !last ? (
                <Link href={item.href}>{item.label}</Link>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Numéro en volets de gare, au repos (« 01 », « 02 ») : les mêmes tuiles
 * que le volet du produit, sans animation ni JavaScript. Décoratif : la
 * liste ordonnée porte déjà le rang.
 */
export function FlapIndex({ n, className }: { n: number; className?: string }): React.JSX.Element {
  const digits = String(n).padStart(2, '0');
  return (
    <span className={['flap-row flap-row--tile', styles.flapIndex, className].filter(Boolean).join(' ')} aria-hidden="true">
      {Array.from(digits).map((ch, i) => (
        <span key={i} className="flap flap--tile">
          <span className="flap__face flap__rest">{ch}</span>
        </span>
      ))}
    </span>
  );
}

export interface SectionProps {
  /** Identifiant de base : le titre porte `${id}-titre`. */
  id: string;
  /**
   * Cible du lien « Passer l'animation » de la séquence : la section reçoit
   * cet id et peut prendre le focus (tabIndex -1), comme sur l'accueil.
   */
  anchorId?: string;
  kicker: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  className?: string;
  /** Contenu qui s'aligne sur la grille (`shell`) ; le parent peut la quitter. */
  children: React.ReactNode;
  /** Mise en page de l'en-tête : empilé (défaut) ou à côté du contenu. */
  headClassName?: string;
}

/** Une section de page métier : filet haut, en-tête (étiquette, H2, chapô), contenu. */
export function Section({
  id,
  anchorId,
  kicker,
  title,
  lead,
  className,
  headClassName,
  children,
}: SectionProps): React.JSX.Element {
  const titleId = `${id}-titre`;
  return (
    <section
      id={anchorId ?? id}
      className={[styles.section, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      tabIndex={anchorId ? -1 : undefined}
    >
      <div className="shell">
        <header className={[styles.head, headClassName].filter(Boolean).join(' ')}>
          <p className="t-label">{kicker}</p>
          <h2 id={titleId} className={`t-display ${styles.h2}`}>
            {title}
          </h2>
          {lead ? <p className={`t-lead ${styles.headLead}`}>{lead}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}

/** Lien « Comparer les offres en détail », avec sa latte vermillon qui s'allonge au survol. */
export function MoreLink({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Link href={href} className={styles.more}>
      {children}
      <span aria-hidden="true" className={styles.moreSlat} />
    </Link>
  );
}
