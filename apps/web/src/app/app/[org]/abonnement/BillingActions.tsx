'use client';

import { useState, useTransition } from 'react';
import { startCheckout, openBillingPortal } from '@/server/actions/billing';

export function BillingActions({
  organizationId, planCode, hasSubscription, billingEnabled, variant = 'manage', label,
}: {
  organizationId: string;
  planCode?: string;
  hasSubscription: boolean;
  billingEnabled: boolean;
  variant?: 'manage' | 'choose';
  /** Libellé du bouton « choose » (ex. « Passer à Business »). */
  label?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = (fn: () => Promise<{ ok: boolean; data?: { url: string }; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok || !result.data) { setError(result.error ?? 'Action impossible.'); return; }
      window.location.href = result.data.url;
    });
  };

  if (variant === 'choose' && planCode) {
    return (
      <div className="stack g2">
        <button type="button" className="btn btn--outline-signal" disabled={pending}
          onClick={() => go(() => startCheckout({ organizationId, planCode, interval: 'month' }))}>
          {pending ? 'Ouverture…' : (label ?? 'Choisir cette offre')}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  return (
    <div className="stack g2">
      {hasSubscription ? (
        <button type="button" className="btn btn--solid" disabled={pending || !billingEnabled}
          onClick={() => go(() => openBillingPortal(organizationId))}>
          {pending ? 'Ouverture…' : 'Gérer le paiement et les factures'}
        </button>
      ) : (
        <p className="t-small t-muted">
          {billingEnabled
            ? 'Choisissez une offre ci-dessous pour activer la facturation.'
            : 'La facturation est désactivée sur cette installation.'}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
