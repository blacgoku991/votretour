import type { CSSProperties } from 'react';
import QRCode from 'qrcode';
import { WalletOffer } from '@/components/wallet/WalletOffer';
import { walletPreviewStates, type ApplePreview, type GooglePreview, type PreviewField } from './wallet-preview';
import styles from './wallet-preview.module.css';

/**
 * Section « Passes Wallet » de la planche : APERÇU, sans aucun bouton
 * d'ajout actif. Les deux passes d'un billet d'événement, dans ses états
 * clés, dessinés à partir des champs que produit le vrai rendu
 * (wallet-preview.ts). Composant serveur : les QR sont tracés au rendu.
 */

async function qrSvg(value: string): Promise<string> {
  return QRCode.toString(value, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B0E13', light: '#0000' },
  });
}

export async function WalletPreview() {
  const states = walletPreviewStates();
  const qrs = new Map<string, string>();
  for (const state of states) {
    for (const value of [state.apple.qr?.message, state.google.qr?.value]) {
      if (value && !qrs.has(value)) qrs.set(value, await qrSvg(value));
    }
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.disclaimer}>
        <span className={styles.chip}>Aperçu</span>
        Champs, couleurs et QR sortent du rendu réel (buildWalletView, renderApplePassJson,
        renderGoogleObject). Données fictives et QR sans valeur : aucun ne passe le contrôle.
      </p>

      <ol className={styles.states}>
        {states.map((state, i) => (
          <li key={state.key} className={styles.state} data-phase={state.phase}>
            <div className={styles.stateText}>
              <p className={styles.stateNum}>{String(i + 1).padStart(2, '0')}</p>
              <h3 className={styles.stateTitle}>{state.label}</h3>
              <p className={styles.stateNote}>{state.note}</p>
              <code className={styles.phase}>{state.phase}</code>
            </div>
            <figure className={styles.fig}>
              <ApplePass pass={state.apple} qr={state.apple.qr ? qrs.get(state.apple.qr.message) ?? null : null} />
              <figcaption className={styles.caption}>Apple Wallet · billet</figcaption>
            </figure>
            <figure className={styles.fig}>
              <GooglePass pass={state.google} qr={state.google.qr ? qrs.get(state.google.qr.value) ?? null : null} />
              <figcaption className={styles.caption}>Google Wallet · billet</figcaption>
            </figure>
          </li>
        ))}
      </ol>

      <div className={styles.onPage}>
        <div className={styles.onPageText}>
          <h3 className={styles.stateTitle}>Sur la page du billet</h3>
          <p className={styles.stateNote}>
            Sous l’accueil de l’événement (après l’inscription) et sous le QR tournant de /pass.
            Le badge officiel est affiché tel quel, depuis public/wallet/ ; sans lui, sans Wallet
            configuré ou hors billet d’événement, rien n’est rendu.
          </p>
        </div>
        <div className={styles.offers}>
          <figure className={styles.offerFig}>
            <div className={styles.offerFrame}>
              <WalletOffer offer={{ apple: { href: '#', badgeSrc: '' } }} context="event" appleSaved />
            </div>
            <figcaption className={styles.caption}>Ajouté : après l’inscription réelle d’un iPhone</figcaption>
          </figure>
          <figure className={styles.offerFig}>
            <div className={styles.offerFrame}>
              <WalletOffer offer={{ qrNotAccepted: true }} context="event" />
            </div>
            <figcaption className={styles.caption}>QR Wallet refusé par l’événement</figcaption>
          </figure>
          <figure className={styles.offerFig}>
            <div className={styles.offerFrame}>
              <WalletOffer offer={{ safariHint: true }} context="pass" />
            </div>
            <figcaption className={styles.caption}>Navigateur intégré (Instagram…)</figcaption>
          </figure>
        </div>
      </div>
    </div>
  );
}

/* ==================================================================
   Apple Wallet : billet (eventTicket)
   ================================================================== */

function Field({ field, big = false }: { field: PreviewField; big?: boolean }) {
  return (
    <div className={styles.field} data-align={field.align}>
      {field.label && <span className={styles.fieldLabel}>{field.label}</span>}
      <span className={big ? styles.fieldBig : styles.fieldValue}>{field.value}</span>
    </div>
  );
}

function ApplePass({ pass, qr }: { pass: ApplePreview; qr: string | null }) {
  const style = {
    '--pass-bg': pass.background,
    '--pass-fg': pass.foreground,
    '--pass-label': pass.label,
  } as CSSProperties;
  return (
    <article className={styles.apple} style={style} data-voided={pass.voided || undefined} aria-label="Aperçu du pass Apple Wallet">
      <header className={styles.appleHead}>
        <span className={styles.mark} aria-hidden="true">R</span>
        {pass.logoText && <span className={styles.logoText}>{pass.logoText}</span>}
        <span className={styles.headFields}>
          {pass.header.map((f) => <Field key={f.key} field={f} />)}
        </span>
      </header>
      <div className={styles.primary}>
        {pass.primary.map((f) => <Field key={f.key} field={f} big />)}
      </div>
      {pass.secondary.length > 0 && (
        <div className={styles.row}>{pass.secondary.map((f) => <Field key={f.key} field={f} />)}</div>
      )}
      {pass.auxiliary.length > 0 && (
        <div className={styles.row}>{pass.auxiliary.map((f) => <Field key={f.key} field={f} />)}</div>
      )}
      {qr && pass.qr && (
        <div className={styles.qrBlock}>
          <span className={styles.qr} dangerouslySetInnerHTML={{ __html: qr }} />
          <span className={styles.qrAlt}>{pass.qr.altText}</span>
        </div>
      )}
      {pass.backNote && <p className={styles.back}><span>Au dos</span>{pass.backNote}</p>}
      {pass.voided && <p className={styles.voided}>Pass annulé par Wallet</p>}
    </article>
  );
}

/* ==================================================================
   Google Wallet : billet (eventTicketObject + eventTicketClass)
   ================================================================== */

const GOOGLE_STATE: Record<string, string> = { EXPIRED: 'Expiré', COMPLETED: 'Terminé' };

function GooglePass({ pass, qr }: { pass: GooglePreview; qr: string | null }) {
  const style = { '--pass-bg': pass.background, '--pass-fg': pass.foreground } as CSSProperties;
  const ended = GOOGLE_STATE[pass.state];
  return (
    <article className={styles.google} style={style} data-ended={ended ? true : undefined} aria-label="Aperçu du pass Google Wallet">
      <header className={styles.googleHead}>
        <span className={`${styles.mark} ${styles.markRound}`} aria-hidden="true">R</span>
        <span className={styles.issuer}>{pass.issuerName}</span>
      </header>
      <p className={styles.eventName}>{pass.eventName}</p>
      <div className={styles.googleMeta}>
        <span>{pass.ticketType}</span>
        {pass.ticketNumber && <span className={styles.ticketNo}>{pass.ticketNumber}</span>}
      </div>
      {pass.modules.length > 0 && (
        <dl className={styles.modules}>
          {pass.modules.map((m) => (
            <div key={m.id} className={styles.module} data-wide={m.body.length > 26 || undefined}>
              <dt>{m.header}</dt>
              <dd>{m.body}</dd>
            </div>
          ))}
        </dl>
      )}
      {qr && pass.qr && (
        <div className={styles.qrBlock}>
          <span className={styles.qr} dangerouslySetInnerHTML={{ __html: qr }} />
          <span className={styles.qrAlt}>{pass.qr.altText}</span>
        </div>
      )}
      {ended && <p className={styles.voided}>{ended} · rangé dans les passes expirés</p>}
    </article>
  );
}
