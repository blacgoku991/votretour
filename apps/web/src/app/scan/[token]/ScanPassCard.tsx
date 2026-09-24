'use client';

import { useState, useSyncExternalStore, useTransition } from 'react';
import Link from 'next/link';
import { redeemEventPass } from '@/server/actions/events';
import { FlapText } from '@/components/FlapNumber';
import type { ScanProof } from '@/lib/event-pass';
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

/**
 * Résultat de la vérification faite côté serveur, avant l'affichage.
 * `source` : d'où vient le QR. Pour un code Wallet statique refusé, on ne
 * sait pas de quel fournisseur il se réclame : « wallet ».
 */
export type ScanCheck = {
  state: 'valid' | 'invalid' | 'wallet_disabled';
  source: 'web' | 'apple' | 'google' | 'wallet';
};

const SOURCE_LABEL: Record<ScanCheck['source'], string> = {
  web: 'Page web',
  apple: 'Apple Wallet',
  google: 'Google Wallet',
  wallet: 'Billet Wallet',
};

type Tone = 'ok' | 'ready' | 'ko';

export function ScanPassCard({
  passId, proof, check, passStatus,
  clientName, ticketNumber, wave, eventName, locationName, validUntil, graceUntil, redeemedAt,
}: {
  passId: string;
  proof: ScanProof;
  check: ScanCheck;
  passStatus: string;
  clientName: string | null;
  /** « A-042 » : le même numéro que sur le billet Wallet et la page /pass. */
  ticketNumber: string | null;
  wave: number | null;
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

  // `already_redeemed` : un autre agent (ou un autre QR du même client) a
  // validé l'entrée entre l'affichage et le geste. On le dit comme tel.
  const effectiveStatus = result?.status === 'already_redeemed' ? 'redeemed' : (result?.status ?? passStatus);
  const usedAt = result?.redeemedAt ?? redeemedAt;
  const proofOk = check.state === 'valid';
  const valid = proofOk && effectiveStatus === 'issued';
  const justRedeemed = result?.status === 'redeemed';
  const fromWallet = check.source !== 'web';

  // Verdict affiché : jade pour une entrée validée, brique pour tout refus.
  let tone: Tone;
  let title: string;
  let detail: string;
  if (justRedeemed) {
    tone = 'ok';
    title = 'Entrée validée';
    detail = `Enregistrée à ${hhmm(result?.redeemedAt ?? new Date().toISOString(), mounted)}. Vous pouvez laisser passer.`;
  } else if (check.state === 'wallet_disabled') {
    tone = 'ko';
    title = 'Billet Wallet non accepté';
    detail = 'Cet événement n’accepte que le laisser-passer web. Demandez au client de l’ouvrir sur son téléphone.';
  } else if (!proofOk) {
    tone = 'ko';
    title = 'QR expiré ou invalide';
    detail = fromWallet
      ? 'Ce billet Wallet ne vaut plus pour cet accès. Demandez au client d’ouvrir son laisser-passer web.'
      : 'Demandez au client de rouvrir son laisser-passer.';
  } else if (effectiveStatus === 'redeemed') {
    tone = 'ko';
    title = 'Pass déjà utilisé';
    detail = usedAt
      ? `Ce laisser-passer a déjà été validé à ${hhmm(usedAt, mounted)}.`
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
    detail = ticketNumber && fromWallet
      ? `Vérifiez le prénom et le numéro ${ticketNumber} sur le billet, puis validez l’entrée.`
      : 'Vérifiez le prénom, puis validez l’entrée.';
  }

  const name = result?.clientName ?? clientName;
  const waveText = wave !== null ? String(wave).padStart(2, '0') : null;

  return (
    <main className={styles.page} data-theme="dark">
      <div className={styles.sheet}>
        <header className={styles.head}>
          <p className={`t-label ${styles.kicker}`}>Rangvia · Contrôle d’accès</p>
          <h1 className="t-title">{eventName}</h1>
          <p className="t-small t-muted">{locationName}</p>
        </header>

        <section className={styles.pass} data-tone={tone} aria-label="Laisser-passer">
          <div className={styles.passTop}>
            <p className="t-label">Laisser-passer #{passId.slice(-6).toUpperCase()}</p>
            <p className={styles.source} data-source={check.source}>
              <span className="sr-only">QR présenté : </span>
              <SourceIcon source={check.source} />
              {SOURCE_LABEL[check.source]}
            </p>
          </div>

          <p className={styles.client}>{name ?? 'Client'}</p>

          {(ticketNumber || waveText) && (
            <dl className={styles.ticket}>
              {ticketNumber && (
                <div>
                  <dt className="t-label">Billet</dt>
                  <dd>
                    <FlapText static fixed tile text={ticketNumber} label={`Billet ${ticketNumber}`} size="1.5rem" />
                  </dd>
                </div>
              )}
              {waveText && (
                <div>
                  <dt className="t-label">Vague</dt>
                  <dd>
                    <FlapText static fixed tile text={waveText} label={`Vague ${wave}`} size="1.5rem" />
                  </dd>
                </div>
              )}
            </dl>
          )}

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
            ) : tone === 'ready' ? (
              // Prêt : un QR neutre ; la coche est réservée à l'entrée validée.
              <svg viewBox="0 0 24 24">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
              </svg>
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
              const response = await redeemEventPass({ passId, ...proof });
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

/** Pictogrammes neutres (aucun logo de marque) : QR tournant ou carte Wallet. */
function SourceIcon({ source }: { source: ScanCheck['source'] }) {
  if (source === 'web') {
    return (
      <svg className={styles.sourceIcon} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5M11.8 1.8v2.9H8.9M4.2 14.2v-2.9h2.9" />
      </svg>
    );
  }
  return (
    <svg className={styles.sourceIcon} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="2" />
      <path d="M2 7h12M4.5 10h3" />
    </svg>
  );
}
