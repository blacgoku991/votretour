'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Wordmark } from './Wordmark';
import { initials } from '@/lib/format';
import type { OrganizationSummary } from '@/lib/types';
import styles from './AppShell.module.css';

/**
 * Coque du tableau de bord.
 *
 * Pensée pour quelqu'un qui travaille : la navigation ne mange pas
 * l'écran. Sur téléphone, elle passe en barre basse à portée de pouce
 * (quatre destinations et « Plus ») ; à partir de 900 px, en rail latéral
 * où les liens sont accrochés à une ligne, comme les lattes de la file.
 *
 * L'entrée active est UNE latte vermillon qui glisse d'un lien à l'autre
 * (translateY, 420 ms). Sa position est mesurée après montage ; au rendu
 * serveur, un repli CSS dessine la même latte sur le lien courant.
 */

/** Groupes de navigation, dans l'ordre du rail. `aide` vit dans le pied. */
export type NavGroup = 'comptoir' | 'suivi' | 'etablissement' | 'aide';

export const NAV_GROUPS: ReadonlyArray<{ id: Exclude<NavGroup, 'aide'>; label: string }> = [
  { id: 'comptoir', label: 'Au comptoir' },
  { id: 'suivi', label: 'Suivi' },
  { id: 'etablissement', label: 'Établissement' },
];

export interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: keyof typeof ICONS;
  /** Présent dans la barre basse du téléphone. */
  primary?: boolean;
  /** Groupe du rail latéral. */
  group?: NavGroup;
}

/**
 * Destinations du tableau de bord. « Plaques » n'y figure volontairement
 * pas : la gestion des plaques est réservée au super-admin plateforme.
 */
export function buildNav(orgSlug: string): NavItem[] {
  const base = `/app/${orgSlug}`;
  return [
    { href: `${base}/file`,          label: 'File',          short: 'File',       icon: 'rang',     primary: true, group: 'comptoir' },
    { href: `${base}/ecran`,         label: 'Écran TV',      short: 'Écran TV',   icon: 'screen',   primary: true, group: 'comptoir' },
    { href: `${base}/evenements`,    label: 'Événements',    short: 'Événements', icon: 'ticket',   group: 'comptoir' },
    { href: `${base}/statistiques`,  label: 'Statistiques',  short: 'Stats',      icon: 'chart',    primary: true, group: 'suivi' },
    { href: `${base}/historique`,    label: 'Historique',    short: 'Historique', icon: 'history',  group: 'suivi' },
    { href: `${base}/notifications`, label: 'Notifications', short: 'Notifs',     icon: 'bell',     group: 'suivi' },
    { href: `${base}/equipe`,        label: 'Équipe',        short: 'Équipe',     icon: 'team',     primary: true, group: 'etablissement' },
    { href: `${base}/reglages`,      label: 'Réglages',      short: 'Réglages',   icon: 'settings', group: 'etablissement' },
    { href: `${base}/abonnement`,    label: 'Abonnement',    short: 'Abonnement', icon: 'card',     group: 'etablissement' },
    { href: `${base}/support`,       label: 'Support',       short: 'Support',    icon: 'help',     group: 'aide' },
  ];
}

/** Ordre de la barre basse : le travail d'abord, puis le suivi. */
const TAB_ORDER: ReadonlyArray<NavItem['icon']> = ['rang', 'chart', 'screen', 'team'];

interface Props {
  organization: OrganizationSummary;
  organizations: OrganizationSummary[];
  user: { fullName: string | null; email: string | null; isPlatformAdmin: boolean };
  children: React.ReactNode;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function AppShell({ organization, organizations, user, children }: Props) {
  const pathname = usePathname() ?? '';
  const nav = buildNav(organization.slug);
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = useCallback(
    (href: string) => pathname === href || pathname.startsWith(`${href}/`),
    [pathname],
  );

  const tabs = TAB_ORDER
    .map((icon) => nav.find((item) => item.icon === icon))
    .filter((item): item is NavItem => Boolean(item));
  const onTab = tabs.some((item) => isActive(item.href));
  const support = nav.find((item) => item.group === 'aide');

  // La feuille se referme à chaque navigation.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // À la fermeture de la feuille, le focus revient au bouton « Plus »
  // (sauf si une navigation l'a déjà placé ailleurs).
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !menuOpen) {
      const active = document.activeElement;
      if (!active || active === document.body) moreRef.current?.focus();
    }
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  // Feuille modale : Tab boucle du dernier élément au premier (et
  // inversement), le focus ne ressort pas derrière la feuille.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const trapFocus = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !sheetRef.current) return;
    const focusables = Array.from(
      sheetRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.tabIndex >= 0);
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !sheetRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div className={styles.shell}>
      <a href="#contenu" className="skip-link" inert={menuOpen || undefined}>Aller au contenu</a>

      {/* ---------- Rail latéral (≥ 900 px) ---------- */}
      <aside className={styles.rail} inert={menuOpen || undefined}>
        <div className={styles.railInner}>
          <Link href={`/app/${organization.slug}/file`} className={styles.railBrand} aria-label="Rangvia — file en cours">
            <Wordmark />
          </Link>

          <OrgSwitcher current={organization} organizations={organizations} />

          <SlidingNav nav={nav} isActive={isActive} pathname={pathname} />

          <div className={styles.railFoot}>
            {support && (
              <Link
                href={support.href}
                className={styles.footLink}
                aria-current={isActive(support.href) ? 'page' : undefined}
              >
                <Icon name="help" />
                <span>{support.label}</span>
              </Link>
            )}
            {user.isPlatformAdmin && (
              <Link href="/admin" className={styles.footLink}>
                <Icon name="shield" />
                <span>Plateforme</span>
              </Link>
            )}
            <Link
              href={`/app/${organization.slug}/compte`}
              className={styles.account}
              aria-current={isActive(`/app/${organization.slug}/compte`) ? 'page' : undefined}
            >
              <span className={styles.avatar}>{initials(user.fullName ?? user.email)}</span>
              <span className={styles.accountText}>
                <span className={styles.accountName}>{user.fullName ?? 'Mon compte'}</span>
                <span className={styles.accountMail}>{user.email}</span>
              </span>
            </Link>
          </div>
        </div>
      </aside>

      {/* ---------- En-tête mobile : la marque et l'établissement ---------- */}
      <header className={styles.topbar} inert={menuOpen || undefined}>
        <Link href={`/app/${organization.slug}/file`} className={styles.topbarBrand} aria-label="Rangvia — file en cours">
          <Wordmark compact />
        </Link>
        <span className={styles.topbarRule} aria-hidden="true" />
        <span className={styles.topbarTitle}>{organization.name}</span>
      </header>

      <main id="contenu" className={styles.main} inert={menuOpen || undefined}>{children}</main>

      {/* ---------- Barre basse (téléphone) ---------- */}
      <nav className={styles.tabbar} aria-label="Navigation" inert={menuOpen || undefined}>
        {tabs.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={styles.tab}
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.short}</span>
            </Link>
          );
        })}
        <button
          ref={moreRef}
          type="button"
          className={styles.tab}
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          data-current={!onTab ? 'true' : undefined}
        >
          <Icon name="more" />
          <span>Plus</span>
        </button>
      </nav>

      {/* ---------- Feuille « Plus » ---------- */}
      {menuOpen && (
        <div
          ref={sheetRef}
          className={styles.sheet}
          role="dialog"
          aria-modal="true"
          aria-label="Toutes les rubriques"
          onKeyDown={trapFocus}
        >
          <button
            type="button"
            className={styles.sheetBackdrop}
            onClick={() => setMenuOpen(false)}
            aria-label="Fermer le menu"
            tabIndex={-1}
          />
          <div className={styles.sheetPanel}>
            <span className={styles.sheetGrip} aria-hidden="true" />
            <div className={styles.sheetHead}>
              <OrgSwitcher current={organization} organizations={organizations} />
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={() => setMenuOpen(false)}
                autoFocus
              >
                Fermer
              </button>
            </div>

            <div className={styles.sheetGroups}>
              {NAV_GROUPS.map((group) => (
                <div key={group.id} className={styles.sheetGroup}>
                  <p className={`t-label ${styles.groupLabel}`}>{group.label}</p>
                  <ul className={styles.sheetList}>
                    {nav.filter((item) => item.group === group.id).map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={styles.navLink}
                          aria-current={isActive(item.href) ? 'page' : undefined}
                          onClick={() => setMenuOpen(false)}
                        >
                          <Icon name={item.icon} />
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className={styles.sheetFoot}>
              {support && (
                <Link href={support.href} className={styles.footLink} onClick={() => setMenuOpen(false)}
                  aria-current={isActive(support.href) ? 'page' : undefined}>
                  <Icon name="help" />
                  <span>{support.label}</span>
                </Link>
              )}
              {user.isPlatformAdmin && (
                <Link href="/admin" className={styles.footLink} onClick={() => setMenuOpen(false)}>
                  <Icon name="shield" />
                  <span>Plateforme</span>
                </Link>
              )}
              <Link href={`/app/${organization.slug}/compte`} className={styles.footLink} onClick={() => setMenuOpen(false)}
                aria-current={isActive(`/app/${organization.slug}/compte`) ? 'page' : undefined}>
                <Icon name="user" />
                <span>Mon compte</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==================================================================
   Navigation du rail : groupes, encoches et latte active qui glisse
   ================================================================== */

function SlidingNav({
  nav, isActive, pathname,
}: {
  nav: NavItem[];
  isActive: (href: string) => boolean;
  pathname: string;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const latteRef = useRef<HTMLSpanElement | null>(null);

  // Mesure après montage, à chaque changement de page et au
  // redimensionnement. Aucune mesure dans une boucle d'images : une
  // lecture de mise en page par événement, puis une écriture de style.
  useIsoLayoutEffect(() => {
    const root = navRef.current;
    const latte = latteRef.current;
    if (!root || !latte) return;

    const place = () => {
      const link = root.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!link) {
        root.dataset.indicator = 'off';
        return;
      }
      // Coordonnées relatives au <nav> (les listes sont positionnées :
      // offsetTop ne suffit pas).
      const box = link.getBoundingClientRect();
      const y = box.top - root.getBoundingClientRect().top + (box.height - 20) / 2;
      latte.style.transform = `translateY(${Math.round(y)}px)`;
      if (root.dataset.indicator !== 'on') {
        // Première pose : sans transition (lecture forcée avant d'armer).
        void latte.offsetWidth;
        root.dataset.indicator = 'on';
      }
    };

    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null;
    ro?.observe(root);
    return () => ro?.disconnect();
  }, [pathname]);

  return (
    <nav ref={navRef} className={styles.railNav} aria-label="Navigation principale">
      <span ref={latteRef} className={styles.latte} aria-hidden="true" />
      {NAV_GROUPS.map((group) => (
        <Fragment key={group.id}>
          <p className={`t-label ${styles.groupLabel}`}>{group.label}</p>
          <ul className={styles.navList}>
            {nav.filter((item) => item.group === group.id).map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={styles.navLink}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}

/* ==================================================================
   Sélecteur d'établissement : une mini-plaque os, initiales gravées
   ================================================================== */

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  manager: 'Responsable',
  member: 'Membre de l’équipe',
};

function OrgSwitcher({
  current, organizations,
}: { current: OrganizationSummary; organizations: OrganizationSummary[] }) {
  const mark = (
    <span className={styles.orgMark} aria-hidden="true">
      {current.logo_url
        ? <img src={current.logo_url} alt="" className={styles.orgLogo} />
        : initials(current.name)}
    </span>
  );

  if (organizations.length <= 1) {
    return (
      <div className={styles.org}>
        {mark}
        <span className={styles.orgText}>
          <span className={styles.orgName}>{current.name}</span>
          <span className={styles.orgMeta}>
            {ROLE_LABEL[current.role] ?? 'Équipe'}
            {current.location_count > 1 ? ` · ${current.location_count} établissements` : ''}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className={`${styles.org} ${styles.orgMulti}`}>
      {mark}
      <span className={styles.orgText}>
        <span className={styles.orgName}>{current.name}</span>
        <span className={styles.orgMeta}>{organizations.length} organisations · changer</span>
      </span>
      {/* Le vrai select couvre toute la mini-plaque : natif, accessible. */}
      <select
        className={styles.orgSelect}
        value={current.slug}
        onChange={(e) => { window.location.href = `/app/${e.target.value}/file`; }}
        aria-label="Changer d’organisation"
      >
        {organizations.map((org) => (
          <option key={org.slug} value={org.slug}>{org.name}</option>
        ))}
      </select>
      <svg className={styles.orgChevron} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
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
  ticket: (
    <>
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v2a2.5 2.5 0 0 0 0 5v2a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 14.5v-2a2.5 2.5 0 0 0 0-5v-2Z" />
      <path d="M10 5v10" strokeDasharray="2 2" />
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
