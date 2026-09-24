import type { MetierPage } from '@/lib/metiers/types';
import { Chairs } from './signatures/Chairs';
import { RECEPTION_FRAMING, SALON_FRAMING, type ReceptionFraming } from './signatures/Props';
import { Guichets } from './signatures/Guichets';
import { Reception } from './signatures/Reception';
import { Tables } from './signatures/Tables';
import { Waves } from './signatures/Waves';
import { Workshop } from './signatures/Workshop';
import { asSentence } from './model';
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
  // La version « Réception » d'un métier porte son objet (clés, ardoise…),
  // pour ne pas répéter la scène du héros.
  const framing = receptionFraming(page);
  switch (signature.kind) {
    case 'chairs':
      return <Chairs signature={signature} />;
    case 'workshop':
      return page.profile === 'vehicle' || page.profile === 'device' ? (
        <Workshop signature={signature} profile={page.profile} open={profileOpen} framing={framing} />
      ) : (
        <Reception signature={signature} framing={framing} />
      );
    case 'tables':
      return <Tables signature={signature} open={profileOpen && page.profile === 'table'} framing={framing} />;
    case 'guichets':
      return <Guichets signature={signature} open={profileOpen && page.profile === 'desk'} framing={framing} />;
    case 'waves':
      return <Waves />;
    case 'counter':
    default:
      return <Reception signature={signature} framing={framing} />;
  }
}

/**
 * L'objet et le cadrage de la file du comptoir : celui du profil du métier
 * (garages, réparation, restaurants, guichets), ou, pour un métier de
 * passage au fauteuil dont la signature est une file de comptoir (salons),
 * la pile de magazines. Aucun pour les autres.
 */
export function receptionFraming(page: MetierPage): ReceptionFraming | null {
  const byProfile = RECEPTION_FRAMING[page.profile];
  if (byProfile) return byProfile;
  if (page.profile === 'walkin' && page.signature.kind === 'counter') return SALON_FRAMING;
  return null;
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
            {asSentence(signature.title)}
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
