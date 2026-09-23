'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import styles from './pass.module.css';

export function EventPassCard({
  passId, status, eventName, eventStatus, locationName, city,
  logoUrl, coverUrl, accentHex, heroTitle, rulesText, qrLabel,
  clientName, validUntil, graceUntil, redeemedAt,
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
}) {
  const [now, setNow] = useState(Date.now());
  const [liveStatus, setLiveStatus] = useState(status);
  const [liveEventStatus, setLiveEventStatus] = useState(eventStatus);
  const [liveRedeemedAt, setLiveRedeemedAt] = useState(redeemedAt);

  useEffect(() => {
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
  const remaining = Math.max(0, Math.ceil((validUntilMs - now) / 1000));
  const runtimeStatus = liveStatus === 'issued' && now > graceUntilMs ? 'expired' : liveStatus;
  const qrTick = Math.floor(now / 20_000);

  const countdown = useMemo(() => {
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }, [remaining]);

  const active = runtimeStatus === 'issued'
    && liveEventStatus !== 'sold_out'
    && liveEventStatus !== 'ended';

  const style = {
    '--event-accent': /^#[0-9A-Fa-f]{6}$/.test(accentHex) ? accentHex : '#FF4B1F',
    ...(coverUrl ? {
      backgroundImage:
        'linear-gradient(160deg, rgba(7,9,13,.93), rgba(7,9,13,.82)), url('
        + JSON.stringify(coverUrl)
        + ')',
    } : {}),
  } as CSSProperties;

  return (
    <main className={styles.screen} style={style}>
      <div className={styles.ambient} />
      <article className={styles.pass} data-state={runtimeStatus}>
        <header className={styles.header}>
          <div className={styles.logo}>
            {logoUrl ? <img src={logoUrl} alt="" /> : <span>R</span>}
          </div>
          <div>
            <p className={styles.kicker}>RANGVIA ACCESS</p>
            <h1>{eventName}</h1>
            <p className={styles.place}>{locationName}{city ? ' · ' + city : ''}</p>
          </div>
        </header>

        {(heroTitle || rulesText) && (
          <section className={styles.eventIntro}>
            {heroTitle && <h2>{heroTitle}</h2>}
            {rulesText && <p>{rulesText}</p>}
          </section>
        )}

        {active ? (
          <>
            <div className={styles.state}>
              <span className={styles.liveDot} />
              <strong>ACCÈS ACTIF</strong>
            </div>

            <div className={styles.ticketNo}>
              <span>Laisser-passer</span>
              <strong>#{passId.slice(-6).toUpperCase()}</strong>
            </div>

            {clientName && <p className={styles.client}>{clientName}</p>}

            <div className={styles.qrWrap}>
              <img
                src={'/api/pass/qr?v=' + qrTick}
                alt="QR de contrôle d'accès"
                className={styles.qr}
              />
              <div className={styles.scanLine} />
            </div>

            {qrLabel && <p className={styles.qrLabel}>{qrLabel}</p>}

            <div className={styles.timer}>
              <span>Présentez-vous dans</span>
              <strong>{countdown}</strong>
              <small>
                grâce jusqu’à {new Date(graceUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </small>
            </div>

            <p className={styles.security}>
              QR dynamique · usage unique · une capture ancienne cesse de fonctionner rapidement.
            </p>
          </>
        ) : runtimeStatus === 'redeemed' ? (
          <div className={styles.finalState}>
            <div className={styles.ok}>✓</div>
            <h2>Accès validé</h2>
            <p>
              Ce laisser-passer a déjà été utilisé
              {liveRedeemedAt ? ' à ' + new Date(liveRedeemedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}.
            </p>
          </div>
        ) : (
          <div className={styles.finalState}>
            <div className={styles.bad}>×</div>
            <h2>{liveEventStatus === 'sold_out' ? 'Stock épuisé' : 'Accès expiré'}</h2>
            <p>Ce laisser-passer n’est plus utilisable. Ne vous déplacez pas jusqu’à l’entrée.</p>
          </div>
        )}

        <footer className={styles.footer}>
          <span>Rangvia</span>
          <span>Pass sécurisé · usage unique</span>
        </footer>
      </article>
    </main>
  );
}
