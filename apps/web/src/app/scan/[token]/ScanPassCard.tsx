'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { redeemEventPass } from '@/server/actions/events';

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

  const effectiveStatus = result?.status ?? passStatus;
  const valid = signatureValid && effectiveStatus === 'issued';

  return (
    <main
      data-theme="dark"
      style={{
        minHeight: '100dvh', background: '#07090d', color: '#faf9f6',
        display: 'grid', placeItems: 'center', padding: 24,
      }}
    >
      <section
        style={{
          width: 'min(100%, 520px)', border: '1px solid rgba(255,255,255,.1)',
          borderRadius: 26, background: '#11151b', padding: 28,
          boxShadow: '0 30px 90px rgba(0,0,0,.45)',
        }}
      >
        <p className="t-label" style={{ color: '#ff6b45' }}>RANGVIA · CONTRÔLE D’ACCÈS</p>
        <h1 className="t-title" style={{ marginTop: 10 }}>{eventName}</h1>
        <p className="t-small t-muted" style={{ marginTop: 6 }}>{locationName}</p>

        <div style={{ margin: '26px 0', padding: 22, borderRadius: 18, background: '#181d25' }}>
          <p className="t-micro t-faint">Laisser-passer #{passId.slice(-6).toUpperCase()}</p>
          <p style={{ fontSize: 28, fontWeight: 780, marginTop: 8 }}>{clientName ?? 'Client'}</p>
          <p className="t-small t-muted" style={{ marginTop: 8 }}>
            Valide jusqu’à {new Date(validUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            {' · '}grâce jusqu’à {new Date(graceUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>

        {!signatureValid ? (
          <div className="banner banner--error">
            <span>QR expiré ou invalide. Demandez au client de rouvrir son laisser-passer.</span>
          </div>
        ) : effectiveStatus === 'redeemed' ? (
          <div className="banner" style={{ borderColor: 'rgba(31,169,122,.4)', color: '#49d7a5' }}>
            <span>
              ✓ Déjà validé
              {(result?.redeemedAt ?? redeemedAt)
                ? ` à ${new Date((result?.redeemedAt ?? redeemedAt) as string).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </span>
          </div>
        ) : effectiveStatus !== 'issued' ? (
          <div className="banner banner--error">
            <span>Ce laisser-passer n’est plus valide ({effectiveStatus}).</span>
          </div>
        ) : null}

        {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}

        <button
          type="button"
          className="btn btn--signal btn--hero"
          disabled={!valid || pending}
          style={{ marginTop: 20 }}
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
          {pending ? 'Vérification…' : valid ? 'Valider l’entrée' : 'Accès non validable'}
        </button>

        <Link href="/app" className="btn btn--ghost btn--block" style={{ marginTop: 12 }}>
          Retour au tableau de bord
        </Link>
      </section>
    </main>
  );
}
