'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Wordmark } from '@/components/Wordmark';
import { initials } from '@/lib/format';
import styles from './admin.module.css';

const GROUPS = [
  {
    label: 'Pilotage',
    items: [
      { href: '/admin', label: 'Vue d’ensemble', icon: '◈' },
      { href: '/admin/etablissements', label: 'Établissements', icon: '▦' },
      { href: '/admin/evenements', label: 'Événements', icon: '◫' },
      { href: '/admin/ecrans', label: 'Écrans TV', icon: '▣' },
      { href: '/admin/plaques', label: 'Plaques & NFC', icon: '⌁' },
      { href: '/admin/plaques/stock', label: 'Stock fournisseur', icon: '⧉' },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/admin/offres', label: 'Offres & abonnements', icon: '◍' },
      { href: '/admin/support', label: 'Support', icon: '◇' },
    ],
  },
  {
    label: 'Système',
    items: [
      { href: '/admin/notifications', label: 'Notifications', icon: '◌' },
      { href: '/admin/erreurs', label: 'Incidents', icon: '!' },
      { href: '/admin/journal', label: 'Journal d’audit', icon: '≡' },
    ],
  },
];

/**
 * La latte active : UNE seule latte vermillon qui glisse le long du rail
 * (translateY, 420 ms), comme dans l'espace commerçant. Sa position est
 * mesurée après montage, au changement de page et au redimensionnement ;
 * avant cela, un repli CSS sur [aria-current] donne le bon rendu serveur.
 */
function useSlidingLatte(pathname: string) {
  const navRef = useRef<HTMLElement>(null);
  const latteRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    const latte = latteRef.current;
    if (!nav || !latte) return;

    let frame = 0;
    const place = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
        if (!active) {
          nav.dataset.indicator = 'off';
          return;
        }
        const navBox = nav.getBoundingClientRect();
        const box = active.getBoundingClientRect();
        const y = box.top - navBox.top + nav.scrollTop + box.height / 2 - 10;
        latte.style.transform = `translateY(${Math.round(y)}px)`;
        nav.dataset.indicator = 'on';
        // La latte ne glisse qu'une fois posée : pas de trajet depuis 0.
        if (!nav.dataset.ready) {
          frame = window.requestAnimationFrame(() => { nav.dataset.ready = '1'; });
        }
      });
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  return { navRef, latteRef };
}

/** Mobile : la barre d'onglets défile jusqu'à l'entrée active. */
function useActiveTabInView(pathname: string) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !tab || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = Math.max(0, tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2);
  }, [pathname]);
  return ref;
}

export function AdminShell({
  user,
  children,
}: {
  user: { fullName: string | null; email: string | null };
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Une seule entrée allumée : la plus précise. Sans cela, sur
  // /admin/plaques/stock, « Plaques & NFC » s'allumerait aussi.
  const matches = (href: string) => href === '/admin'
    ? pathname === '/admin'
    : pathname === href || pathname.startsWith(`${href}/`);
  const best = GROUPS.flatMap((group) => group.items)
    .map((item) => item.href)
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  const active = (href: string) => href === best;

  const { navRef, latteRef } = useSlidingLatte(pathname);
  const mobileNavRef = useActiveTabInView(pathname);

  return (
    <div className={styles.adminShell}>
      <aside className={styles.sideRail}>
        <div className={styles.sideBrand}>
          <Link href="/admin"><Wordmark /></Link>
          <span>Super admin</span>
        </div>

        <div className={styles.platformBadge}>
          <i className="pip pip--live" aria-hidden="true" />
          <div>
            <strong>Plateforme active</strong>
            <span>Rangvia Control</span>
          </div>
        </div>

        <nav ref={navRef} className={styles.sideNav} aria-label="Navigation super admin" data-indicator="off">
          <span ref={latteRef} className={styles.sideLatte} aria-hidden="true" />
          {GROUPS.map((group) => (
            <div className={styles.navGroup} key={group.label}>
              <span className={`t-label ${styles.navGroupLabel}`}>{group.label}</span>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active(item.href) ? 'page' : undefined}
                  className={`${styles.sideLink} ${active(item.href) ? styles.sideLinkActive : ''}`}
                >
                  <span className={styles.sideIcon} aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.sideFoot}>
          <Link href="/app" className={styles.backToApp}>← Espace commerçant</Link>
          <div className={styles.adminAccount}>
            <span className={styles.avatar}>{initials(user.fullName ?? user.email)}</span>
            <div>
              <strong>{user.fullName ?? 'Super admin'}</strong>
              <span>{user.email}</span>
            </div>
          </div>
        </div>
      </aside>

      <div className={styles.adminStage}>
        <header className={styles.mobileAdminBar}>
          <Link href="/admin"><Wordmark compact /></Link>
          <span className="t-label">Super admin</span>
          <Link href="/app" className="btn btn--ghost btn--sm">Espace</Link>
        </header>

        <nav ref={mobileNavRef} className={styles.mobileAdminNav} aria-label="Navigation super admin mobile">
          {GROUPS.flatMap((group) => group.items).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? 'page' : undefined}
              className={`${styles.mobileAdminLink} ${active(item.href) ? styles.mobileAdminLinkActive : ''}`}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <main className={styles.adminMain}>{children}</main>
      </div>
    </div>
  );
}
