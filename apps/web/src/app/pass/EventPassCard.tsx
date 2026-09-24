'use client';

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { FlapText } from '@/components/FlapNumber';
import { WalletOffer } from '@/components/wallet/WalletOffer';
import type { WalletOffer as WalletOfferData } from '@/components/wallet/offer';
import styles from './pass.module.css';

/**
 * LE LAISSER-PASSER — un billet, pas une carte.
 *
 * Un objet de 340 px : deux encoches en demi-cercle (masque statique) le
 * découpent en talon et en coupon. Le talon porte l'événement, la vague et
 * le nom ; le coupon porte le QR, sur fond os, et le temps restant. Le
 * liseré dit l'état : jade (valide), cuivre (délai de grâce), brique
 * (expiré ou stock épuisé).
 *
 * Il entre une seule fois (rotateX 18° → 0, 620 ms). La barre de sécurité
 * est la seule boucle justifiée du site : une latte os qui traverse le
 * billet toutes les 3 s prouve au contrôle que l'écran est vivant (une
 * capture d'écran ne bouge pas). En mouvement réduit, elle est remplacée
 * par l'heure à la seconde.
 *
 * Tout ce qui dépend de l'heure (compte à rebours, heures affichées,
 * secondes) n'est calculé qu'après montage : aucun écart d'hydratation.
 *
 * Wallet (lot W4) : sous le QR tournant, une découpe de plus propose
 * d'emporter le billet dans Apple Wallet ou Google Wallet, seulement si
 * l'offre existe (Wallet configuré, badge déposé, bon appareil) et tant
 * que l'accès est ouvert. Sinon, rien.
 */

const hm = (value: string | number) =>
  new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function EventPassCard({
  status, eventName, eventStatus, locationName, city,
  logoUrl, coverUrl, accentHex, heroTitle, rulesText, qrLabel,
  clientName, validUntil, graceUntil, redeemedAt, wave = null,
  walletOffer = null, appleSaved = false, walletNotice = null,
}: {
  passId: string;
  status: string;
  eventName: string;
  eventStatus: string;
  locationName: string;
  city: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  accentHex: string;
  heroTitle: string | null;
  rulesText: string | null;
  qrLabel: string | null;
  clientName: string | null;
  validUntil: string;
  graceUntil: string;
  redeemedAt: string | null;
  /** Numéro de vague (1, 2…), s'il est connu. */
  wave?: number | null;
  /** Offre Wallet calculée par la page ; null = rien à montrer. */
  walletOffer?: WalletOfferData | null;
  appleSaved?: boolean;
  /** Encart ?wallet=indisponible, déjà rédigé. */
  walletNotice?: string | null;
}) {
  const [now, setNow] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState(status);
  const [liveEventStatus, setLiveEventStatus] = useState(eventStatus);
  const [liveRedeemedAt, setLiveRedeemedAt] = useState(redeemedAt);

  // L'encart reste à l'écran, l'adresse est nettoyée : un rechargement ne le rejoue pas.
  useEffect(() => {
    if (!walletNotice) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('wallet');
      url.searchParams.delete('wp');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch {
      /* adresse illisible : on la laisse */
    }
  }, [walletNotice]);

  useEffect(() => {
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const sync = window.setInterval(async () => {
      try {
        const response = await fetch('/api/pass/session', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as {
          ok: boolean;
          data?: { status?: string; eventStatus?: string; redeemedAt?: string | null };
        };
        if (!payload.ok || !payload.data) return;
        if (payload.data.status) setLiveStatus(payload.data.status);
        if (payload.data.eventStatus) setLiveEventStatus(payload.data.eventStatus);
        if ('redeemedAt' in payload.data) setLiveRedeemedAt(payload.data.redeemedAt ?? null);
      } catch {
        // Le QR continue de fonctionner localement ; le prochain poll retentera.
      }
    }, 3000);

    return () => {
      window.clearInterval(clock);
      window.clearInterval(sync);
    };
  }, []);

  const validUntilMs = new Date(validUntil).getTime();
  const graceUntilMs = new Date(graceUntil).getTime();
  const runtimeStatus = now !== null && liveStatus === 'issued' && now > graceUntilMs ? 'expired' : liveStatus;
  const qrTick = now === null ? 0 : Math.floor(now / 20_000);

  const active = runtimeStatus === 'issued'
    && liveEventStatus !== 'sold_out'
    && liveEventStatus !== 'ended';
  const inGrace = active && now !== null && now > validUntilMs;
  const target = inGrace ? graceUntilMs : validUntilMs;
  const remaining = now === null ? null : Math.max(0, Math.ceil((target - now) / 1000));
  const countdown = remaining === null
    ? '--:--'
    : String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0');

  const tone = active
    ? (inGrace ? 'grace' : 'valid')
    : runtimeStatus === 'redeemed' ? 'redeemed' : 'expired';

  const style = {
    '--event-accent': /^#[0-9A-Fa-f]{6}$/.test(accentHex) ? accentHex : '#FF4B1F',
  } as CSSProperties;

  const seconds = now === null
    ? '--:--:--'
    : new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <main className={styles.screen} style={style}>
      <div className={styles.stage}>
        {walletNotice && (
          <p className={styles.walletNotice} role="status">
            <span className={styles.walletNoticeTitle}>Wallet indisponible</span>
            {walletNotice}
          </p>
        )}
        <div className={styles.tilt}>
          <article className={styles.ticket} data-tone={tone} aria-label={`Laisser-passer — ${eventName}`}>
            {/* ------------------------------------------------ Talon */}
            <header className={styles.stub}>
              {coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.cover} src={coverUrl} alt="" />
              )}

              <div className={styles.identity}>
                <span className={styles.logo}>
                  {logoUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={logoUrl} alt="" />
                    : <span>R</span>}
                </span>
                <span className={styles.identityText}>
                  <span className={`t-label ${styles.kicker}`}>Laisser-passer</span>
                  <span className={styles.place}>{locationName}{city ? ' · ' + city : ''}</span>
                </span>
              </div>

              <h1 className={styles.eventName}>{eventName}</h1>

              {(heroTitle || rulesText) && (
                <div className={styles.rules}>
                  {heroTitle && <p className={styles.rulesTitle}>{heroTitle}</p>}
                  {rulesText && <p className={styles.rulesText}>{rulesText}</p>}
                </div>
              )}

              <dl className={styles.facts}>
                {wave !== null && (
                  <div className={styles.fact}>
                    <dt className="t-label">Vague</dt>
                    <dd className={styles.wave}>
                      <FlapText static fixed tile text={String(wave).padStart(2, '0')} label={`Vague ${wave}`} size="2.25rem" />
                    </dd>
                  </div>
                )}
                {clientName && (
                  <div className={styles.fact}>
                    <dt className="t-label">Au nom de</dt>
                    <dd className={styles.holder}>{clientName}</dd>
                  </div>
                )}
              </dl>
            </header>

            <div className={styles.tear} aria-hidden="true" />

            {/* ----------------------------------------------- Coupon */}
            {active ? (
              <section className={styles.coupon} aria-label="Contrôle d’accès">
                <p className={styles.state}>
                  <i className={inGrace ? 'pip pip--warn' : 'pip pip--live'} aria-hidden="true" />
                  {inGrace ? 'Délai de grâce' : 'Accès actif'}
                </p>

                <div className={styles.qrPanel}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={'/api/pass/qr?v=' + qrTick}
                    alt="QR de contrôle d'accès"
                    className={styles.qr}
                  />
                </div>
                {qrLabel && <p className={styles.qrLabel}>{qrLabel}</p>}

                {/* Preuve de vie : la latte qui traverse (ou les secondes). */}
                <div className={styles.security}>
                  <span className={styles.securityTrack} aria-hidden="true">
                    <span className={styles.securitySlat} />
                  </span>
                  <span className={styles.securityClock}>
                    <span className="sr-only">Heure du contrôle : </span>
                    <span className="t-num">{seconds}</span>
                  </span>
                </div>

                <div className={styles.timer}>
                  <div className={styles.timerMain}>
                    <span className="t-label">{inGrace ? 'Dernier délai' : 'Présentez-vous dans'}</span>
                    <span className={styles.countdown}>
                      <FlapText static fixed tile text={countdown} label={remaining === null ? 'Calcul du temps restant' : `${countdown} restantes`} size="3rem" />
                    </span>
                  </div>
                  <p className={styles.until}>
                    {now === null ? ' ' : inGrace
                      ? <>Entrée possible jusqu’à <strong>{hm(graceUntil)}</strong></>
                      : <>Valable jusqu’à <strong>{hm(validUntil)}</strong><br />puis grâce jusqu’à {hm(graceUntil)}</>}
                  </p>
                </div>

                {/* Sous le QR tournant : rien sans offre, jamais de bouton grisé. */}
                <WalletOffer offer={walletOffer} context="pass" appleSaved={appleSaved} className={styles.wallet} />
              </section>
            ) : runtimeStatus === 'redeemed' ? (
              <section className={styles.final}>
                <span className={styles.finalMark} data-tone="ok" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <h2 className={styles.finalTitle}>Accès validé</h2>
                <p className={styles.finalText}>
                  Ce laisser-passer a déjà été utilisé
                  {liveRedeemedAt && now !== null ? ' à ' + hm(liveRedeemedAt) : ''}.
                </p>
              </section>
            ) : (
              <section className={styles.final}>
                <span className={styles.finalMark} data-tone="bad" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
                </span>
                <h2 className={styles.finalTitle}>{liveEventStatus === 'sold_out' ? 'Stock épuisé' : 'Accès expiré'}</h2>
                <p className={styles.finalText}>Ce laisser-passer n’est plus utilisable. Ne vous déplacez pas jusqu’à l’entrée.</p>
              </section>
            )}

            <footer className={styles.foot}>
              <span className={styles.brand}>Rangvia</span>
              <span>Pass sécurisé · usage unique</span>
            </footer>
          </article>
        </div>

        {active && (
          <p className={styles.note}>
            QR dynamique à usage unique : une capture d’écran ancienne cesse vite de fonctionner.
          </p>
        )}
      </div>
    </main>
  );
}
