import Link from 'next/link';
import { requirePlatformAdmin } from '@/server/auth';
import { Wordmark } from '@/components/Wordmark';
import { initials } from '@/lib/format';
import styles from './admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * ESPACE PLATEFORME.
 *
 * Volontairement séparé du tableau de bord professionnel : autre URL,
 * autre coque, autre vocabulaire. Le contrôle d'accès n'est pas visuel —
 * requirePlatformAdmin() revérifie profiles.is_platform_admin côté
 * serveur à chaque navigation, et RLS bloque de toute façon les lectures
 * pour quiconque n'a pas le drapeau.
 */
const NAV = [
  { href: '/admin', label: 'Vue d’ensemble' },
  { href: '/admin/etablissements', label: 'Établissements' },
  { href: '/admin/plaques', label: 'Plaques' },
  { href: '/admin/offres', label: 'Offres & abonnements' },
  { href: '/admin/support', label: 'Support' },
  { href: '/admin/erreurs', label: 'Incidents' },
  { href: '/admin/journal', label: 'Journal d’audit' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <div className={`shell ${styles.barInner}`}>
          <Link href="/admin" className={styles.brand}>
            <Wordmark compact />
            <span className={styles.brandLabel}>Plateforme</span>
          </Link>

          <nav className={styles.nav} aria-label="Navigation plateforme">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className={styles.navLink}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className={styles.account}>
            <Link href="/app" className="btn btn--ghost btn--sm">Mon espace</Link>
            <span className={styles.avatar} title={user.email ?? ''}>
              {initials(user.fullName ?? user.email)}
            </span>
          </div>
        </div>
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
