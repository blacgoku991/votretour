'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminDeleteOrganization,
  adminRevokeOrganizationSessions,
  adminUpdateOrganization,
  reactivateOrganization,
  suspendOrganization,
} from '@/server/actions/admin';
import { ACTIVITY_OPTIONS } from '@/lib/copy';

export function OrganizationControlPanel({
  organization,
  activeEntries,
  subscription,
}: {
  organization: {
    id: string;
    name: string;
    activity: string;
    status: string;
    suspendedReason: string | null;
  };
  activeEntries: number;
  subscription: {
    status: string | null;
    planName: string | null;
    stripeSubscriptionId: string | null;
    periodEnd: string | null;
  };
}) {
  const router = useRouter();
  const [name, setName] = useState(organization.name);
  const [activity, setActivity] = useState(organization.activity);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? 'Action impossible.');
        return;
      }
      setNotice(success);
      router.refresh();
    });
  };

  return (
    <div className="stack g4">
      <div className="field">
        <label>Nom</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field">
        <label>Activité</label>
        <select className="select" value={activity} onChange={(e) => setActivity(e.target.value)}>
          {ACTIVITY_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="btn btn--solid"
        disabled={pending || (!name.trim() || (name === organization.name && activity === organization.activity))}
        onClick={() => run(
          async () => adminUpdateOrganization({
            organizationId: organization.id,
            name: name.trim(),
            activity: activity as never,
          }),
          'Organisation mise à jour.',
        )}
      >
        Enregistrer
      </button>

      <div className="banner">
        <span>
          Offre : <strong>{subscription.planName ?? '—'}</strong>
          {' · '}statut {subscription.status ?? '—'}
          {subscription.periodEnd ? ` · fin ${new Date(subscription.periodEnd).toLocaleDateString('fr-FR')}` : ''}
        </span>
      </div>

      <div className="row g2 wrap">
        {organization.status === 'active' ? (
          <>
            <input
              className="input"
              style={{ maxWidth: 320 }}
              placeholder="Motif de suspension"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              type="button"
              className="btn btn--danger"
              disabled={pending || reason.trim().length < 3}
              onClick={() => run(
                async () => suspendOrganization({
                  organizationId: organization.id,
                  reason: reason.trim(),
                }),
                'Organisation suspendue.',
              )}
            >
              Suspendre
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={pending}
            onClick={() => run(
              async () => reactivateOrganization(organization.id),
              'Organisation réactivée.',
            )}
          >
            Réactiver
          </button>
        )}

        <button
          type="button"
          className="btn btn--ghost"
          disabled={pending}
          onClick={() => {
            if (!window.confirm('Révoquer toutes les sessions client et désactiver leurs notifications ?')) return;
            run(
              async () => adminRevokeOrganizationSessions(organization.id),
              'Sessions et abonnements push révoqués.',
            );
          }}
        >
          Révoquer appareils
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {notice && <div className="banner"><span>{notice}</span></div>}

      <div style={{
        marginTop: 12, paddingTop: 20, borderTop: '1px solid var(--line)',
      }}>
        <p className="t-label" style={{ color: 'var(--brique-500)' }}>ZONE DANGEREUSE</p>
        <p className="t-small t-muted" style={{ margin: '8px 0 12px' }}>
          Suppression définitive. L’organisation doit être suspendue, sans client actif,
          et aucun abonnement Stripe actif ne doit subsister.
        </p>

        <input
          className="input"
          placeholder={`Tapez exactement : ${organization.name}`}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />

        <button
          type="button"
          className="btn btn--danger"
          style={{ marginTop: 10 }}
          disabled={
            pending
            || organization.status !== 'suspended'
            || activeEntries > 0
            || confirmation !== organization.name
          }
          onClick={() => {
            if (!window.confirm('SUPPRESSION DÉFINITIVE : cette action est irréversible. Continuer ?')) return;
            run(
              async () => adminDeleteOrganization({
                organizationId: organization.id,
                confirmationName: confirmation,
              }),
              'Organisation supprimée.',
            );
          }}
        >
          Supprimer définitivement
        </button>
      </div>
    </div>
  );
}
