'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '@/components/SiteChrome.module.css';

/**
 * Parties client de l'en-tête public (SiteChrome).
 *
 * Elles vivent ici, et non dans SiteChrome.tsx, pour que l'en-tête et le
 * pied restent des composants serveur (l'année du pied est calculée côté
 * serveur). Le dossier `_chrome` est privé : Next.js n'en fait pas une
 * route.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Chemin qui rend le lien « courant » ; `null` pour une ancre de l'accueil. */
  path: string | null;
  /** Courant aussi sur les pages filles (/pour/garages pour « Métiers »). */
  prefix?: boolean;
  /** Page fille qui a SON propre lien : elle n'allume pas le parent. */
  except?: string;
}

export const NAV: readonly NavItem[] = [
  { href: '/#comment', label: 'Comment ça marche', path: null },
  { href: '/pour', label: 'Métiers', path: '/pour', prefix: true, except: '/pour/evenements-et-drops' },
  { href: '/tarifs', label: 'Tarifs', path: '/tarifs' },
  { href: '/pour/evenements-et-drops', label: 'Événements & drops', path: '/pour/evenements-et-drops' },
];

/**
 * Le lien est-il celui de la page courante ? « Métiers » l'est sur /pour
 * et sur chaque page métier, sauf celle des événements, qui a son lien.
 * Les ancres de l'accueil (#comment) ne le sont jamais : le fragment
 * n'existe pas côté serveur.
 */
export function navCurrent(item: NavItem, pathname: string): boolean {
  if (item.path === null) return false;
  if (pathname === item.path) return true;
  if (!item.prefix || pathname === item.except) return false;
  return pathname.startsWith(`${item.path}/`);
}

/**
 * Navigation principale. Le lien de la page courante porte
 * aria-current="page" : le CSS le marque d'une latte vermillon de 14 × 2 px.
 */
export function SiteNav({ className, linkClassName }: { className?: string; linkClassName?: string }) {
  const pathname = usePathname();
  return (
    <nav className={className} aria-label="Navigation principale">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={linkClassName}
          aria-current={navCurrent(item, pathname) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Navigation mobile (< 760 px) : un bouton « Menu » qui déplie, sous la
 * barre, la même navigation posée sur un rail. Motif de divulgation
 * (aria-expanded + aria-controls) : le focus reste sur le bouton.
 *
 * Fermé, le volet est `inert` (ni focus, ni lecteur d'écran) et
 * transparent ; seules son opacité et sa translation changent. Il se
 * referme au choix d'un lien, sur Échap (le focus revient au bouton), au
 * toucher hors de l'en-tête et au changement de page.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Changement de page : ajusté pendant le rendu, pas dans un effet.
  if (open && openedAt !== pathname) setOpen(false);

  useEffect(() => {
    if (!open) return;
    const header = buttonRef.current?.closest('header');
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (header && event.target instanceof Node && !header.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn--quiet btn--sm ${styles.menuButton}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Menu"
        data-open={open ? '1' : undefined}
        onClick={() => {
          setOpenedAt(pathname);
          setOpen((v) => !v);
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className={styles.menuIcon}>
          <rect className={styles.menuBarTop} x="3" y="5.5" width="14" height="2" rx="1" fill="currentColor" />
          <rect className={styles.menuBarBottom} x="3" y="12.5" width="14" height="2" rx="1" fill="currentColor" />
        </svg>
      </button>
      <div id={panelId} className={styles.menuPanel} data-open={open ? '1' : undefined} inert={!open || undefined}>
        <nav aria-label="Navigation principale" className="shell">
          <ul className={`rail-list ${styles.menuList}`}>
            {NAV.map((item) => {
              const current = navCurrent(item, pathname);
              return (
                <li key={item.href} aria-current={current ? 'true' : undefined}>
                  <Link
                    href={item.href}
                    className={styles.menuLink}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}

/**
 * Pose data-scrolled="1" sur l'en-tête parent dès qu'on a défilé de plus
 * de 8 px (le filet bas apparaît alors, en opacité). Écoute passive, une
 * seule image en attente, aucun état React : rien n'est rendu côté serveur
 * qui dépende du défilement.
 */
export function HeaderScrollFlag() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = ref.current?.closest('header');
    if (!header) return;
    let frame = 0;
    let last: boolean | null = null;
    const apply = () => {
      frame = 0;
      const scrolled = window.scrollY > 8;
      if (scrolled === last) return;
      last = scrolled;
      if (scrolled) header.setAttribute('data-scrolled', '1');
      else header.removeAttribute('data-scrolled');
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <span ref={ref} hidden />;
}
