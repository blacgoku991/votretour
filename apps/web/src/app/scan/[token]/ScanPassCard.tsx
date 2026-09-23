'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';
import Link from 'next/link';
import { redeemEventPass } from '@/server/actions/events';
import styles from './scan.module.css';

const noop = () => () => {};
/** true seulement après montage : les heures dépendent du fuseau du navigateur. */
function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

function hhmm(iso: string | null | undefined, mounted: boolean): string {
  if (!iso) return '—';
  if (!mounted) return '--:--';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

type Tone = 'ok' | 'ready' | 'ko';

export function ScanPassCard({
  passId, slot, signature, passStatus, signatureValid,
  clientName, eventName, locationName, validUntil, graceUntil, redeemedAt,
}: {
  passId: string;
  slot: number;
  signature: string;
  passStatus: string;
  signatureValid: boolean;
  clientName: string | null;
  eventName: string;
  locationName: string;
  validUntil: string;
  graceUntil: string;
  redeemedAt: string | null;
}) {
  const [result, setResult] = useState<null | { status: string; clientName?: string | null; redeemedAt?: string | null }>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const mounted = useMounted();

  const effectiveStatus = result?.status ?? passStatus;
  const valid = signatureValid && effectiveStatus === 'issued';
  const justRedeemed = result?.status === 'redeemed';

  // Verdict affiché : jade pour une entrée validée, brique pour tout refus.
  let tone: Tone;
  let title: string;
  let detail: string;
  if (justRedeemed) {
    tone = 'ok';
    title = 'Entrée validée';
    detail = `Enregistrée à ${hhmm(result?.redeemedAt ?? new Date().toISOString(), mounted)}. Vous pouvez laisser passer.`;
  } else if (!signatureValid) {
    tone = 'ko';
    title = 'QR expiré ou invalide';
    detail = 'Demandez au client de rouvrir son laisser-passer.';
  } else if (effectiveStatus === 'redeemed') {
    tone = 'ko';
    title = 'Pass déjà utilisé';
    detail = redeemedAt
      ? `Ce laisser-passer a déjà été validé à ${hhmm(redeemedAt, mounted)}.`
      : 'Ce laisser-passer a déjà été validé.';
  } else if (effectiveStatus === 'expired') {
    tone = 'ko';
    title = 'Pass expiré';
    detail = 'Le délai de ce laisser-passer est dépassé, grâce comprise.';
  } else if (effectiveStatus === 'revoked') {
    tone = 'ko';
    title = 'Pass révoqué';
    detail = 'Ce laisser-passer a été annulé (stock épuisé ou fin de l’événement).';
  } else if (effectiveStatus !== 'issued') {
    tone = 'ko';
    title = 'Pass non valide';
    detail = 'Ce laisser-passer n’est plus valide.';
  } else {
    tone = 'ready';
    title = 'Pass valide';
    detail = 'Vérifiez le prénom, puis validez l’entrée.';
  }

  const name = result?.clientName ?? clientName;

  return (
    <main className={styles.page} data-theme="dark">
      <div className={styles.sheet}>
        <header className={styles.head}>
          <p className={`t-label ${styles.kicker}`}>Rangvia · Contrôle d’accès</p>
          <h1 className="t-title">{eventName}</h1>
          <p className="t-small t-muted">{locationName}</p>
        </header>

        <section className={styles.pass} data-tone={tone} aria-label="Laisser-passer">
          <p className="t-label">Laisser-passer #{passId.slice(-6).toUpperCase()}</p>
          <p className={styles.client}>{name ?? 'Client'}</p>
          <dl className={styles.times}>
            <div>
              <dt className="t-label">Valide jusqu’à</dt>
              <dd className="t-num">{hhmm(validUntil, mounted)}</dd>
            </div>
            <div>
              <dt className="t-label">Grâce jusqu’à</dt>
              <dd className="t-num">{hhmm(graceUntil, mounted)}</dd>
            </div>
          </dl>
        </section>

        <div
          className={styles.verdict}
          data-tone={tone}
          data-fresh={justRedeemed ? '1' : undefined}
          role="status"
          aria-live="polite"
        >
          <span className={styles.verdictIcon} aria-hidden="true">
            {tone === 'ko' ? (
              <svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" /></svg>
            ) : (
              <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            )}
          </span>
          <span className={styles.verdictText}>
            <strong>{title}</strong>
            <span>{detail}</span>
          </span>
        </div>

        {error && <p className="error-text" role="alert">{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn--signal btn--hero"
            disabled={!valid || pending}
            onClick={() => startTransition(async () => {
              setError(null);
              const response = await redeemEventPass({ passId, slot, signature });
              if (!response.ok) {
                setError(response.error);
                return;
              }
              setResult(response.data);
            })}
          >
            {pending
              ? 'Vérification…'
              : valid
                ? 'Valider l’entrée'
                : justRedeemed
                  ? 'Entrée enregistrée'
                  : 'Accès non validable'}
          </button>

          <Link href="/app" className="btn btn--ghost btn--block">
            Retour au tableau de bord
          </Link>
        </div>
      </div>
    </main>
  );
}
