'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './pass.module.css';

export function EventPassCard({
  passId, status, eventName, eventStatus, locationName, city,
  logoUrl, clientName, validUntil, graceUntil, redeemedAt,
}: {
  passId: string;
  status: string;
  eventName: string;
  eventStatus: string;
  locationName: string;
  city: string | null;
  logoUrl: string | null;
  clientName: string | null;
  validUntil: string;
  graceUntil: string;
  redeemedAt: string | null;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const validUntilMs = new Date(validUntil).getTime();
  const graceUntilMs = new Date(graceUntil).getTime();
  const remaining = Math.max(0, Math.ceil((validUntilMs - now) / 1000));
  const runtimeStatus = status === 'issued' && now > graceUntilMs ? 'expired' : status;
  const qrTick = Math.floor(now / 20_000);

  const countdown = useMemo(() => {
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }, [remaining]);

  const active = runtimeStatus === 'issued' && eventStatus !== 'sold_out' && eventStatus !== 'ended';

  return (
    <main className={styles.screen}>
      <div className={styles.ambient} />
      <article className={styles.pass} data-state={runtimeStatus}>
        <header className={styles.header}>
          <div className={styles.logo}>
            {logoUrl ? <img src={logoUrl} alt="" /> : <span>R</span>}
          </div>
          <div>
            <p className={styles.kicker}>RANGVIA ACCESS</p>
            <h1>{eventName}</h1>
            <p className={styles.place}>{locationName}{city ? ` · ${city}` : ''}</p>
          </div>
        </header>

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
                src={`/api/pass/qr?v=${qrTick}`}
                alt="QR de contrôle d'accès"
                className={styles.qr}
              />
              <div className={styles.scanLine} />
            </div>

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
              {redeemedAt ? ` à ${new Date(redeemedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}.
            </p>
          </div>
        ) : (
          <div className={styles.finalState}>
            <div className={styles.bad}>×</div>
            <h2>{eventStatus === 'sold_out' ? 'Stock épuisé' : 'Accès expiré'}</h2>
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
