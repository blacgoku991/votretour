import type { MetierPage } from '@/lib/metiers/types';
import { Chairs } from './signatures/Chairs';
import { Guichets } from './signatures/Guichets';
import { Reception } from './signatures/Reception';
import { Tables } from './signatures/Tables';
import { Waves } from './signatures/Waves';
import { Workshop } from './signatures/Workshop';
import styles from './metiers.module.css';

/**
 * 3. LA SIGNATURE — le visuel propre au métier, composant serveur sans
 * JavaScript (sauf les vagues, qui reprennent l'îlot de l'accueil).
 *
 * Le genre vient de la page rendue (`signature.kind`) : c'est déjà la
 * version « vraie aujourd'hui » quand le profil n'est pas ouvert. Les
 * visuels de profil (atelier, tables, guichets) vérifient EN PLUS
 * `profileOpen` : sans lui, ils retombent sur la file du comptoir.
 */
export function SignatureVisual({ page, profileOpen }: { page: MetierPage; profileOpen: boolean }): React.JSX.Element {
  const { signature } = page;
  switch (signature.kind) {
    case 'chairs':
      return <Chairs signature={signature} />;
    case 'workshop':
      return page.profile === 'vehicle' || page.profile === 'device' ? (
        <Workshop signature={signature} profile={page.profile} open={profileOpen} />
      ) : (
        <Reception signature={signature} />
      );
    case 'tables':
      return <Tables signature={signature} open={profileOpen && page.profile === 'table'} />;
    case 'guichets':
      return <Guichets signature={signature} open={profileOpen && page.profile === 'desk'} />;
    case 'waves':
      return <Waves />;
    case 'counter':
    default:
      return <Reception signature={signature} />;
  }
}

export function SignatureSection({
  page,
  profileOpen,
  anchorId,
}: {
  page: MetierPage;
  profileOpen: boolean;
  anchorId?: string;
}): React.JSX.Element {
  const { signature } = page;
  // Les vagues s'étalent sur toute la largeur ; les autres visuels se
  // posent à côté du texte, comme la scène de l'accueil.
  const wide = signature.kind === 'waves';
  return (
    <section
      id={anchorId ?? 'signature'}
      className={`${styles.section} ${styles.signature}`}
      aria-labelledby="signature-titre"
      tabIndex={anchorId ? -1 : undefined}
      data-kind={signature.kind}
    >
      <div className={`shell ${styles.sigGrid}`} data-wide={wide ? '1' : undefined}>
        <div className={styles.sigText}>
          <p className="t-label">
            {page.nav.label}
            <span className={styles.sigSeuil}>{signature.seuil}</span>
          </p>
          <h2 id="signature-titre" className={`t-display ${styles.h2}`}>
            {signature.title}
          </h2>
          <p className={`t-lead ${styles.headLead}`}>{signature.caption}</p>
        </div>
        <div className={styles.sigStage}>
          <SignatureVisual page={page} profileOpen={profileOpen} />
        </div>
      </div>
    </section>
  );
}
