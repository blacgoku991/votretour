import Link from 'next/link';
import { Plaque } from '@/components/objects/Plaque';
import styles from './metiers.module.css';

/**
 * 10. L'APPEL FINAL — la plaque, avec un VRAI QR code vers l'inscription
 * du métier (`/inscription?activite=…`), calculé au rendu serveur : la
 * page reste statique et le code est scannable depuis un écran
 * d'ordinateur, pour continuer sur son téléphone.
 */
export function FinalCta({
  title,
  lead,
  label,
  href,
  qrSvg,
  anchorId,
}: {
  title: string;
  lead: string;
  label: string;
  href: string;
  /** SVG du QR (chaîne produite par `qrcode`, sans script). */
  qrSvg: string | null;
  anchorId?: string;
}): React.JSX.Element {
  return (
    <section
      id={anchorId ?? 'ouvrir'}
      className={styles.cta}
      aria-labelledby="ouvrir-titre"
      tabIndex={anchorId ? -1 : undefined}
    >
      <div className={`shell ${styles.ctaInner}`}>
        <div className={styles.ctaText}>
          <h2 id="ouvrir-titre" className={`t-hero ${styles.ctaTitle}`}>
            {title}
          </h2>
          <p className={`t-lead ${styles.ctaLead}`}>{lead}</p>
          <Link href={href} className={`btn btn--signal btn--lg ${styles.ctaBtn}`}>
            {label}
          </Link>
        </div>
        <div className={styles.ctaVisual}>
          <span className={`floor-marks ${styles.ctaFloor}`} aria-hidden="true" />
          <div className={styles.ctaPlaque}>
            <Plaque
              width={260}
              pose="none"
              className={styles.ctaPlaqueObj}
              qr={qrSvg ? <span dangerouslySetInnerHTML={{ __html: qrSvg }} /> : undefined}
              // Une seule légende, sur la plaque elle-même : le QR mène à
              // l'inscription, pour continuer sur son téléphone. Sans QR, la
              // plaque garde sa légende d'objet NFC.
              caption={qrSvg ? 'Scannez pour continuer sur mobile' : undefined}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
