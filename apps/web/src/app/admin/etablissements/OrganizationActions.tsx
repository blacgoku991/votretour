'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { suspendOrganization, reactivateOrganization } from '@/server/actions/admin';

export function OrganizationActions({
  organizationId, name, suspended,
}: { organizationId: string; name: string; suspended: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (suspended) {
    return (
      <div className="row g2 wrap">
        <Link href={`/admin/etablissements/${organizationId}`} className="btn btn--solid btn--sm">
          Gérer
        </Link>
        <button type="button" className="btn btn--ghost btn--sm" disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await reactivateOrganization(organizationId);
            if (!result.ok) { setError(result.error); return; }
            router.refresh();
          })}>
          {pending ? '…' : 'Réactiver'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  if (!asking) {
    // Une seule ligne : « Gérer » et « Suspendre » côte à côte, jamais
    // l'un sous l'autre (le tableau défile déjà en largeur).
    return (
      <div className="row g2" style={{ flexWrap: 'nowrap' }}>
        <Link href={`/admin/etablissements/${organizationId}`} className="btn btn--solid btn--sm">
          Gérer
        </Link>
        <button type="button" className="btn btn--danger btn--sm" onClick={() => setAsking(true)}>
          Suspendre
        </button>
      </div>
    );
  }

  return (
    <div className="row g2 wrap">
      <input
        className="input" style={{ minWidth: 180 }} autoFocus
        placeholder={`Motif de suspension de ${name}`}
        value={reason} onChange={(e) => setReason(e.target.value)}
        aria-label="Motif"
      />
      <button type="button" className="btn btn--danger btn--sm"
        disabled={pending || reason.trim().length < 3}
        onClick={() => startTransition(async () => {
          setError(null);
          const result = await suspendOrganization({ organizationId, reason: reason.trim() });
          if (!result.ok) { setError(result.error); return; }
          setAsking(false);
          router.refresh();
        })}>
        {pending ? '…' : 'Confirmer'}
      </button>
      <button type="button" className="btn btn--quiet btn--sm" onClick={() => setAsking(false)}>
        Annuler
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
