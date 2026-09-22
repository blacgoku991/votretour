'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Wordmark } from './Wordmark';
import { initials } from '@/lib/format';
import type { OrganizationSummary } from '@/lib/types';
import styles from './AppShell.module.css';

/**
 * Coque du tableau de bord.
 *
 * Pensée pour quelqu'un qui travaille : la navigation ne mange pas
 * l'écran. Sur téléphone elle passe en barre basse à portée de pouce,
 * sur tablette et ordinateur en rail latéral étroit. Huit destinations
 * au total, pas cinquante onglets.
 */

export interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: keyof typeof ICONS;
  primary?: boolean;
}

export function buildNav(orgSlug: string): NavItem[] {
  const base = `/app/${orgSlug}`;
  return [
    { href: `${base}/file`,          label: 'File',          short: 'File',    icon: 'rang', primary: true },
    { href: `${base}/equipe`,        label: 'Équipe',        short: 'Équipe',  icon: 'team', primary: true },
    { href: `${base}/statistiques`,  label: 'Statistiques',  short: 'Stats',   icon: 'chart', primary: true },
    { href: `${base}/ecran`,         label: 'Écran TV',      short: 'TV',      icon: 'screen', primary: true },
    { href: `${base}/historique`,    label: 'Historique',    short: 'Historique', icon: 'history' },
    { href: `${base}/notifications`, label: 'Notifications', short: 'Notifs',  icon: 'bell' },
    { href: `${base}/reglages`,      label: 'Réglages',      short: 'Réglages', icon: 'settings' },
    { href: `${base}/abonnement`,    label: 'Abonnement',    short: 'Abonnement', icon: 'card' },
    { href: `${base}/support`,       label: 'Support',       short: 'Support', icon: 'help' },
  ];
}

interface Props {
  organization: OrganizationSummary;
  organizations: OrganizationSummary[];
  user: { fullName: string | null; email: string | null; isPlatformAdmin: boolean };
  children: React.ReactNode;
}

export function AppShell({ organization, organizations, user, children }: Props) {
  const pathname = usePathname();
  const nav = buildNav(organization.slug);
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={styles.shell}>
      {/* ---------- Rail latéral (tablette / ordinateur) ---------- */}
      <aside className={styles.rail}>
        <Link href={`/app/${organization.slug}/file`} className={styles.railBrand}>
          <Wordmark />
        </Link>

        <OrgSwitcher current={organization} organizations={organizations} />

        <nav className={styles.railNav} aria-label="Navigation principale">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.railLink} ${isActive(item.href) ? styles.railLinkActive : ''}`}
              aria-current={isActive(item.href) ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.railFoot}>
          {user.isPlatformAdmin && (
            <Link href="/admin" className={styles.railLink}>
              <Icon name="shield" />
              <span>Plateforme</span>
            </Link>
          )}
          <Link href={`/app/${organization.slug}/compte`} className={styles.account}>
            <span className={styles.avatar}>{initials(user.fullName ?? user.email)}</span>
            <span className={styles.accountText}>
              <span className={styles.accountName}>{user.fullName ?? 'Mon compte'}</span>
              <span className="t-micro t-faint">{user.email}</span>
            </span>
          </Link>
        </div>
      </aside>

      {/* ---------- En-tête mobile ---------- */}
      <header className={styles.topbar}>
        <Link href={`/app/${organization.slug}/file`} className={styles.topbarBrand}>
          <Wordmark compact />
        </Link>
        <span className={styles.topbarTitle}>{organization.name}</span>
        <button
          type="button"
          className={styles.topbarMore}
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label="Plus d'options"
        >
          <Icon name="more" />
        </button>
      </header>

      {menuOpen && (
        <div className={styles.sheet} role="dialog" aria-label="Menu">
          <button type="button" className={styles.sheetBackdrop} onClick={() => setMenuOpen(false)} aria-label="Fermer" />
          <div className={styles.sheetPanel}>
            <OrgSwitcher current={organization} organizations={organizations} />
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.sheetLink} ${isActive(item.href) ? styles.sheetLinkActive : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}
            {user.isPlatformAdmin && (
              <Link href="/admin" className={styles.sheetLink} onClick={() => setMenuOpen(false)}>
                <Icon name="shield" />
                <span>Plateforme</span>
              </Link>
            )}
            <Link href={`/app/${organization.slug}/compte`} className={styles.sheetLink} onClick={() => setMenuOpen(false)}>
              <Icon name="user" />
              <span>Mon compte</span>
            </Link>
          </div>
        </div>
      )}

      <main className={styles.main}>{children}</main>

      {/* ---------- Barre basse (téléphone) ---------- */}
      <nav className={styles.tabbar} aria-label="Navigation">
        {nav.filter((i) => i.primary).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.tab} ${isActive(item.href) ? styles.tabActive : ''}`}
            aria-current={isActive(item.href) ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.short}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

function OrgSwitcher({
  current, organizations,
}: { current: OrganizationSummary; organizations: OrganizationSummary[] }) {
  if (organizations.length <= 1) {
    return (
      <div className={styles.org}>
        <span className={styles.orgMark}>
          {current.logo_url
            ? <img src={current.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
            : initials(current.name)}
        </span>
        <span className={styles.orgName}>{current.name}</span>
      </div>
    );
  }
  return (
    <div className={styles.org}>
      <span className={styles.orgMark}>
        {current.logo_url
          ? <img src={current.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
          : initials(current.name)}
      </span>
      <select
        className={styles.orgSelect}
        value={current.slug}
        onChange={(e) => { window.location.href = `/app/${e.target.value}/file`; }}
        aria-label="Changer d'organisation"
      >
        {organizations.map((org) => (
          <option key={org.slug} value={org.slug}>{org.name}</option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------
   Pictogrammes : dessinés dans la géométrie du produit (lattes, rail,
   angles vifs) plutôt qu'importés d'une bibliothèque générique.
   ------------------------------------------------------------------ */
const ICONS = {
  rang: (
    <>
      <rect x="2" y="3" width="1.8" height="14" rx="0.9" />
      <rect x="6" y="4" width="12" height="3" rx="1.5" />
      <rect x="6" y="8.5" width="9" height="3" rx="1.5" />
      <rect x="6" y="13" width="6" height="3" rx="1.5" />
    </>
  ),
  team: (
    <>
      <circle cx="7.5" cy="7" r="2.8" />
      <circle cx="14" cy="8" r="2.2" />
      <path d="M2.5 17c0-2.8 2.2-4.6 5-4.6s5 1.8 5 4.6" />
      <path d="M13.5 12.6c2.4.1 4 1.8 4 4.4" />
    </>
  ),
  plate: (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <rect x="6" y="6" width="3.2" height="3.2" rx="0.8" />
      <rect x="6" y="10.8" width="3.2" height="3.2" rx="0.8" />
      <rect x="10.8" y="6" width="3.2" height="3.2" rx="0.8" />
      <path d="M10.8 11.4v2.6M13.4 11.4v2.6" />
    </>
  ),
  screen: (
    <>
      <rect x="2.5" y="3.5" width="15" height="11" rx="2.2" />
      <path d="M7 17h6M10 14.5V17" />
    </>
  ),
  chart: (
    <>
      <rect x="3" y="11" width="3.4" height="6" rx="1.2" />
      <rect x="8.3" y="6" width="3.4" height="11" rx="1.2" />
      <rect x="13.6" y="8.5" width="3.4" height="8.5" rx="1.2" />
    </>
  ),
  history: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M10 5.8V10l3 1.8" />
    </>
  ),
  bell: (
    <>
      <path d="M5.2 8.2a4.8 4.8 0 0 1 9.6 0v3l1.3 2.1a.6.6 0 0 1-.5.9H4.4a.6.6 0 0 1-.5-.9l1.3-2.1v-3Z" />
      <path d="M8.3 16.4a2 2 0 0 0 3.4 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.5v2.2M10 15.3v2.2M17.5 10h-2.2M4.7 10H2.5M15.3 4.7l-1.6 1.6M6.3 13.7l-1.6 1.6M15.3 15.3l-1.6-1.6M6.3 6.3 4.7 4.7" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2.5" />
      <path d="M2.5 8.5h15" />
    </>
  ),
  help: (
    <>
      <circle cx="10" cy="10" r="7.2" />
      <path d="M8 7.8a2.1 2.1 0 1 1 2.9 1.9c-.6.3-.9.8-.9 1.4v.4" />
      <circle cx="10" cy="14.2" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  shield: (
    <>
      <path d="M10 2.6 16 5v4.6c0 3.7-2.4 6.6-6 7.8-3.6-1.2-6-4.1-6-7.8V5l6-2.4Z" />
      <path d="m7.4 10 2 2 3.4-3.6" />
    </>
  ),
  user: (
    <>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.8 17c0-3.2 2.8-5.2 6.2-5.2s6.2 2 6.2 5.2" />
    </>
  ),
  more: (
    <>
      <circle cx="4.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
} as const;

export function Icon({ name }: { name: keyof typeof ICONS }) {
  const filled = name === 'rang' || name === 'chart';
  return (
    <svg
      width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      className={styles.icon}
    >
      {ICONS[name]}
    </svg>
  );
}
