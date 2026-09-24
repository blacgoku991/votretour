import type { DeviceKind } from '@/lib/profiles/types';
import styles from './DeviceGlyph.module.css';

/**
 * LES PICTOGRAMMES D'APPAREILS — téléphone, tablette, ordinateur,
 * console, montre, autre.
 *
 * Même géométrie que les icônes de l'application (`AppShell`, grille de
 * 20, trait de 1,6 et angles arrondis) : ils se posent à côté d'elles
 * sans détonner. Ils servent aux grosses puces de la saisie client, à la
 * fiche du pro et au tableau de la TV (« Dossier 0042 · iPhone »).
 *
 * Décoratifs par défaut (`aria-hidden`) : le mot est toujours écrit à
 * côté. `title` en fait une image nommée, quand il est seul.
 *
 * Rendu pur, compatible serveur.
 */

export const DEVICE_LABEL: Record<DeviceKind, string> = {
  phone: 'Téléphone',
  tablet: 'Tablette',
  computer: 'Ordinateur',
  console: 'Console',
  watch: 'Montre',
  other: 'Autre',
};

const PATHS: Record<DeviceKind, React.ReactNode> = {
  phone: (
    <>
      <rect x="5.5" y="1.8" width="9" height="16.4" rx="2.4" />
      <path d="M8.6 4.4h2.8" />
      <path d="M8.9 15.4h2.2" />
    </>
  ),
  tablet: (
    <>
      <rect x="3" y="2.2" width="14" height="15.6" rx="2.2" />
      <path d="M8.9 15.2h2.2" />
    </>
  ),
  computer: (
    <>
      <rect x="3.6" y="3.8" width="12.8" height="9" rx="1.4" />
      <path d="M1.6 15.8h16.8l-.9 1.4a1 1 0 0 1-.85.46H3.35a1 1 0 0 1-.85-.46z" />
      <path d="M8.6 15.8h2.8" />
    </>
  ),
  console: (
    <>
      <path d="M6.2 6h7.6c2.4 0 4 1.5 4.4 3.9l.6 3.6c.3 1.9-.9 3.3-2.5 3.3-1 0-1.7-.5-2.2-1.4l-.9-1.6H6.8l-.9 1.6c-.5.9-1.2 1.4-2.2 1.4-1.6 0-2.8-1.4-2.5-3.3l.6-3.6C2.2 7.5 3.8 6 6.2 6z" />
      <path d="M5.8 9v3.2M4.2 10.6h3.2" />
      <circle cx="13.6" cy="9.6" r="0.35" />
      <circle cx="15.4" cy="11.4" r="0.35" />
    </>
  ),
  watch: (
    <>
      <rect x="5" y="5.4" width="10" height="9.2" rx="2.6" />
      <path d="M7.2 5.4 7.8 2h4.4l.6 3.4M7.2 14.6l.6 3.4h4.4l.6-3.4" />
      <path d="M10 8.2v2l1.3 1" />
    </>
  ),
  other: (
    <>
      <path d="M10 1.9 17.2 5.9v8.2L10 18.1 2.8 14.1V5.9z" />
      <path d="M2.8 5.9 10 9.9l7.2-4M10 9.9v8.2" />
    </>
  ),
};

export interface DeviceGlyphProps {
  kind: DeviceKind;
  /** Côté en px ; défaut 20. */
  size?: number;
  /** Nom accessible : rend le pictogramme lisible seul. */
  title?: string;
  className?: string;
}

export function DeviceGlyph({ kind, size = 20, title, className }: DeviceGlyphProps): React.JSX.Element {
  const named = Boolean(title);
  return (
    <svg
      className={[styles.glyph, className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={named ? 'img' : undefined}
      aria-label={named ? title : undefined}
      aria-hidden={named ? undefined : true}
      focusable="false"
      data-kind={kind}
    >
      {PATHS[kind]}
    </svg>
  );
}
