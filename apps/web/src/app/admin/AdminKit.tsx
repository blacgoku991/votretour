import styles from './admin.module.css';

/**
 * Briques communes des pages super-admin : un seul en-tête (la carte du
 * tableau de bord) et une seule tuile de chiffre. Toutes les pages de
 * /admin les réutilisent, pour qu'on passe de l'une à l'autre sans
 * changer de vocabulaire visuel.
 */

export function AdminHero({
  kicker, title, description, children, stacked = false,
}: {
  /** Surtitre en capitales (« Salle de contrôle », « Parc d’écrans »…). */
  kicker: string;
  title: string;
  description?: React.ReactNode;
  /** Outils : recherche, filtres, boutons. */
  children?: React.ReactNode;
  /** Outils sous le titre, sur toute la largeur (filtres nombreux). */
  stacked?: boolean;
}) {
  return (
    <header className={`${styles.controlHero} ${stacked ? styles.controlHeroStacked : ''}`}>
      <div className={styles.heroText}>
        <span className={styles.cardKicker}>{kicker}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className={styles.heroTools}>{children}</div>}
    </header>
  );
}

export type StatTone = 'default' | 'live' | 'signal' | 'warn' | 'danger';

export function AdminStats({ children }: { children: React.ReactNode }) {
  return <div className={styles.commandStats}>{children}</div>;
}

export function AdminStat({
  label, value, hint, tone = 'default',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: StatTone;
}) {
  return (
    <div className={styles.commandStat} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
