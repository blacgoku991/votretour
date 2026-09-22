'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
      { href: '/admin/plaques', label: 'Plaques & NFC', icon: '⌁' },
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
      { href: '/admin/erreurs', label: 'Incidents', icon: '!' },
      { href: '/admin/journal', label: 'Journal d’audit', icon: '≡' },
    ],
  },
];

export function AdminShell({
  user,
  children,
}: {
  user: { fullName: string | null; email: string | null };
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const active = (href: string) => href === '/admin'
    ? pathname === '/admin'
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={styles.adminShell}>
      <aside className={styles.sideRail}>
        <div className={styles.sideBrand}>
          <Link href="/admin"><Wordmark /></Link>
          <span>SUPER ADMIN</span>
        </div>

        <div className={styles.platformBadge}>
          <i />
          <div>
            <strong>Plateforme active</strong>
            <span>Rangvia Control</span>
          </div>
        </div>

        <nav className={styles.sideNav} aria-label="Navigation super admin">
          {GROUPS.map((group) => (
            <div className={styles.navGroup} key={group.label}>
              <span className={styles.navGroupLabel}>{group.label}</span>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.sideLink} ${active(item.href) ? styles.sideLinkActive : ''}`}
                >
                  <span className={styles.sideIcon}>{item.icon}</span>
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
          <span>Super Admin</span>
          <Link href="/app" className="btn btn--ghost btn--sm">Espace</Link>
        </header>
        <main className={styles.adminMain}>{children}</main>
      </div>
    </div>
  );
}
