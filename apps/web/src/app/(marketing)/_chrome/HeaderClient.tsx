'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Parties client de l'en-tête public (SiteChrome).
 *
 * Elles vivent ici, et non dans SiteChrome.tsx, pour que l'en-tête et le
 * pied restent des composants serveur (l'année du pied est calculée côté
 * serveur). Le dossier `_chrome` est privé : Next.js n'en fait pas une
 * route.
 */

const NAV = [
  { href: '/#comment', label: 'Comment ça marche', path: null },
  { href: '/tarifs', label: 'Tarifs', path: '/tarifs' },
  { href: '/#drops', label: 'Événements & drops', path: null },
] as const;

/**
 * Navigation principale. Le lien de la page courante porte
 * aria-current="page" : le CSS le marque d'une latte vermillon de 14 × 2 px.
 * Les ancres de l'accueil (#comment, #drops) ne sont jamais « courantes » :
 * le fragment n'existe pas côté serveur.
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
          aria-current={item.path !== null && pathname === item.path ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
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
