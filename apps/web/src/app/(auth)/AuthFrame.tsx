import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import { FloorScene, type FloorSlat } from '@/components/objects/FloorScene';
import styles from './auth.module.css';

/**
 * LE GABARIT DES ÉCRANS D'ACCÈS (connexion, inscription, invitation).
 *
 * Plus de carte centrée dans le vide : le formulaire est posé SUR la page.
 *
 * - Ordinateur (≥ 1024 px) : grille 5/7. À gauche, sur --surface, la
 *   marque puis le formulaire, calé à 18svh du haut, 400 px au plus. À
 *   droite, un panneau --floor pleine hauteur (collant) : le sol en relief.
 * - Mobile : barre de 56 px (marque, lien de bascule), la file en relief
 *   en bandeau de 140 px, puis le formulaire. Aucun centrage vertical : le
 *   clavier ne masque jamais les champs.
 *
 * Rendu serveur pur : les scènes sont statiques (CSS seulement).
 */
export function AuthFrame({
  band,
  aside,
  switchHref,
  switchLabel,
  children,
}: {
  /** Lattes du bandeau mobile (FloorScene size="sm"). */
  band: FloorSlat[];
  /** Contenu du panneau --floor à partir de 1024 px. */
  aside: React.ReactNode;
  /** Lien de bascule de la barre mobile (« Créer un compte », « Connexion »). */
  switchHref?: string;
  switchLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.frame}>
      <div className={styles.side}>
        <header className={styles.bar}>
          <Link href="/" className={styles.brand} aria-label="Rangvia, accueil">
            <Wordmark />
          </Link>
          {switchHref && switchLabel && (
            <Link href={switchHref} className={styles.switch}>
              {switchLabel}
            </Link>
          )}
        </header>

        <div className={styles.band}>
          <FloorScene size="sm" slats={band} intro positions={false} />
        </div>

        <div className={styles.content}>{children}</div>
      </div>

      <aside className={styles.panel}>{aside}</aside>
    </main>
  );
}
