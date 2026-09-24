import styles from './WalletOffer.module.css';

/**
 * Encart « Wallet indisponible » : l'ajout a échoué (fournisseur tombé
 * entre l'affichage et le toucher, session expirée…) et la route de
 * distribution est revenue avec ?wallet=indisponible.
 *
 * Un seul dessin pour la page de l'événement (/e) et le laisser-passer
 * (/pass) : la notice neutre de la page du billet, pas une alerte. Le
 * texte, déjà rédigé (walletUnavailableNotice), dit ce qui reste valable.
 */
export function WalletNotice({ text, className }: { text: string; className?: string }) {
  return (
    <div className={[styles.notice, className].filter(Boolean).join(' ')} role="status" data-wallet="indisponible">
      <span className={styles.noticeIcon}><WalletGlyph /></span>
      <div className={styles.noticeText}>
        <p className={styles.noticeTitle}>Wallet indisponible</p>
        <p className={styles.noticeBody}>{text}</p>
      </div>
    </div>
  );
}

/** Wallet : un billet qui dépasse de la poche (20 px, trait courant). */
export function WalletGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 7.5V4.2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3.3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="2.8" y="7.5" width="14.4" height="9.3" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13 12.1h1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
