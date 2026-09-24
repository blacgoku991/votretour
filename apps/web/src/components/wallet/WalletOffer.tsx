import { useId } from 'react';
import { WALLET_OFFER_COPY as COPY } from '@/lib/wallet-copy';
import type { WalletOffer as Offer } from '@/server/wallet/providers';
import styles from './WalletOffer.module.css';

/**
 * L'OFFRE WALLET D'UN BILLET D'ÉVÉNEMENT.
 *
 * Une découpe de plus sur le billet : sous une ligne pointillée, le
 * billet « glisse » dans le téléphone. Élément secondaire, jamais à la
 * place du QR ni du compteur.
 *
 * Règles (§ 11 du plan Wallet, et décision du propriétaire : événements
 * et drops seulement) :
 *  - `offer` null → RIEN n'est rendu : pas de bouton grisé, pas de
 *    mention. C'est le cas tant que le Wallet n'est pas configuré, sans
 *    badge officiel déposé dans public/wallet/, hors billet d'événement,
 *    sur un appareil qui n'a pas Wallet ;
 *  - badges officiels NON modifiés (ni recolorés, ni recadrés, ni
 *    redessinés), marge de protection autour, `alt` en français ; un lien
 *    GET simple, qui garde le geste de l'utilisateur ;
 *  - le contrôle refuse le QR Wallet (`wallet_qr_enabled = false`) : pas
 *    de badge, une phrase ;
 *  - navigateur intégré sur iPhone (Instagram, Facebook…) : une phrase
 *    qui dit ce qui reste valable, sans badge et SANS consigne d'ouvrir
 *    Safari (ni cookie du laisser-passer ni session du client là-bas :
 *    impasse, voire seconde inscription à un drop) ;
 *  - « Dans votre Apple Wallet » seulement après l'inscription RÉELLE
 *    d'un appareil (service web Apple), jamais au toucher du badge.
 *    Google n'a pas cette preuve (rappels : lot W8) : texte honnête.
 *
 * Composant sans état ni effet : rendu tel quel côté serveur (/pass) et
 * dans l'écran client (EventWelcome).
 *
 * `badgePreview` (planche /design seulement) : à la place du badge, un
 * cadre en pointillés de sa taille exacte (44 px de haut). Aucun faux
 * badge n'est jamais dessiné ; la composition réelle reste jugeable
 * sans les fichiers officiels.
 */

export interface WalletOfferProps {
  offer: Offer | null;
  /** Accueil de l'événement après l'inscription, ou laisser-passer. */
  context: 'event' | 'pass';
  /** TicketState.wallet.appleSaved : un appareil a inscrit le pass Apple. */
  appleSaved?: boolean;
  /** Planche /design : cadre du badge à sa taille, jamais un faux badge. */
  badgePreview?: boolean;
  className?: string;
}

export function WalletOffer({ offer, context, appleSaved = false, badgePreview = false, className }: WalletOfferProps) {
  if (!offer) return null;
  const cls = (base: string | undefined) => [base, className].filter(Boolean).join(' ');

  if (offer.qrNotAccepted) {
    return (
      <p className={cls(styles.note)} data-wallet="qr-refuse">
        <QrRefusedGlyph />
        <span>{COPY.qrNotAccepted}</span>
      </p>
    );
  }

  const provider = offer.apple ? 'apple' : offer.google ? 'google' : null;
  if (!provider) {
    if (!offer.safariHint) return null;
    return (
      <p className={cls(styles.note)} data-wallet="safari">
        <CompassGlyph />
        <span>{context === 'pass' ? COPY.passSafariHint : COPY.eventSafariHint}</span>
      </p>
    );
  }

  const saved = provider === 'apple' && appleSaved;
  const link = provider === 'apple' ? offer.apple : offer.google;
  const title = saved
    ? COPY.eventAppleSavedTitle
    : context === 'pass' ? COPY.passTitle : COPY.eventTitle;
  const body = context === 'pass'
    ? saved ? COPY.passAppleSaved : provider === 'google' ? COPY.passGoogleAfter : COPY.passCard
    : saved ? COPY.eventAppleSaved : provider === 'google' ? COPY.eventGoogleAfter : COPY.eventCard;
  const titleId = `wallet-${context}-titre`;

  return (
    <section className={cls(styles.offer)} data-wallet={saved ? 'ajoute' : provider} aria-labelledby={titleId}>
      <PassGlyph saved={saved} />
      <div className={styles.text}>
        <p id={titleId} className={styles.title}>{title}</p>
        <p className={styles.body}>{body}</p>
      </div>
      {!saved && link && badgePreview && (
        <span className={styles.badgeSlot} data-provider={provider}>
          Badge officiel {provider === 'apple' ? 'Apple' : 'Google'} — déposé tel quel
        </span>
      )}
      {!saved && link && !badgePreview && (
        <a className={styles.badge} href={link.href} rel="nofollow">
          {/* Badge officiel, affiché tel quel : ni filtre, ni masque, ni recadrage. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={link.badgeSrc}
            alt={provider === 'apple' ? COPY.appleBadgeAlt : COPY.googleBadgeAlt}
            height={44}
            decoding="async"
          />
        </a>
      )}
    </section>
  );
}

/* ==================================================================
   Pictogrammes, dessinés dans la géométrie du billet
   ================================================================== */

/**
 * Le billet en miniature : encoches de découpe, tranche en relief, QR
 * (ou la coche une fois dans Wallet). Couleur : l'accent de l'événement.
 */
function PassGlyph({ saved }: { saved: boolean }) {
  return (
    <span className={styles.glyph} data-saved={saved || undefined} aria-hidden="true">
      <svg viewBox="0 0 40 54" width="40" height="54" fill="none">
        {/* Tranche : le même billet, 3 px plus bas, assombri. */}
        <path className={styles.glyphEdge} d={TICKET} transform="translate(0 3)" />
        <path className={styles.glyphFace} d={TICKET} />
        <path className={styles.glyphTear} d="M8 20.5h24" />
        <rect className={styles.glyphSlat} x="7" y="7" width="17" height="3.2" rx="1.6" />
        <rect className={styles.glyphSlat} x="7" y="12.4" width="10" height="3.2" rx="1.6" opacity="0.6" />
        {saved ? (
          <g>
            <circle className={styles.glyphPlate} cx="20" cy="35" r="10" />
            <path className={styles.glyphCheck} d="m15.4 35.2 3.2 3.2 6.2-6.6" />
          </g>
        ) : (
          <g>
            <rect className={styles.glyphPlate} x="10" y="25" width="20" height="20" rx="3" />
            {QR.map(([x, y]) => (
              <rect key={`${x}-${y}`} className={styles.glyphModule} x={12 + x * 3.2} y={27 + y * 3.2} width="3" height="3" rx="0.6" />
            ))}
          </g>
        )}
      </svg>
    </span>
  );
}

/** Billet de 40 × 51 : coins de 7, encoches de découpe à 20,5. */
const TICKET =
  'M7 0h26a7 7 0 0 1 7 7v10a3.5 3.5 0 0 0 0 7v20a7 7 0 0 1-7 7H7a7 7 0 0 1-7-7V24a3.5 3.5 0 0 0 0-7V7a7 7 0 0 1 7-7Z';

/** Motif fixe de 5 × 5 modules : un QR se reconnaît, il ne se lit pas. */
const QR: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [3, 0], [4, 0],
  [0, 1], [2, 1], [4, 1],
  [1, 2], [2, 2], [3, 2],
  [0, 3], [2, 3], [4, 3],
  [0, 4], [1, 4], [3, 4], [4, 4],
];

/**
 * QR refusé au contrôle : un QR (cadre et trois repères) barré d'une
 * diagonale. Le trait est détouré (masque) pour rester net à 20 px.
 */
function QrRefusedGlyph() {
  // Identifiant du masque propre à chaque rendu ; les caractères de
  // useId ne sont pas tous admis dans url(#…).
  const mask = `qr-barre-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className={styles.noteIcon} viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
        <rect width="20" height="20" fill="#fff" />
        <path d="M2.6 2.6l14.8 14.8" stroke="#000" strokeWidth="3.8" strokeLinecap="round" />
      </mask>
      <g mask={`url(#${mask})`}>
        <rect x="2.8" y="2.8" width="14.4" height="14.4" rx="2.8" stroke="currentColor" strokeWidth="1.5" />
        <rect x="5.4" y="5.4" width="3.4" height="3.4" rx="0.8" fill="currentColor" />
        <rect x="11.2" y="5.4" width="3.4" height="3.4" rx="0.8" fill="currentColor" />
        <rect x="5.4" y="11.2" width="3.4" height="3.4" rx="0.8" fill="currentColor" />
      </g>
      <path d="M3.4 3.4l13.2 13.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Ce navigateur n'a pas Wallet : une boussole (on est ailleurs qu'on croit). */
function CompassGlyph() {
  return (
    <svg className={styles.noteIcon} viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="m12.8 7.2-1.6 4-4 1.6 1.6-4 4-1.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
