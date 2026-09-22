'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adminCreateOrganization } from '@/server/actions/admin';
import { ACTIVITY_OPTIONS } from '@/lib/copy';

export function CreateOrganizationButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [locationName, setLocationName] = useState('');
  const [activity, setActivity] = useState('barber');
  const [queueMode, setQueueMode] = useState<'shared' | 'per_staff'>('shared');
  const [planCode, setPlanCode] = useState<'starter' | 'pro' | 'business'>('starter');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button className="btn btn--signal" type="button" onClick={() => setOpen(true)}>
        + Nouvel établissement
      </button>
    );
  }

  return (
    <div style={{
      width: 'min(100%, 620px)',
      padding: 18,
      border: '1px solid var(--line)',
      borderRadius: 18,
      background: 'var(--surface-raised)',
      boxShadow: 'var(--shadow-2)',
    }}>
      <div className="row between g3 wrap">
        <div>
          <p className="t-label">CRÉATION PLATEFORME</p>
          <h2 className="t-section" style={{ marginTop: 6 }}>Nouvelle organisation</h2>
        </div>
        <button className="btn btn--quiet btn--sm" type="button" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </div>

      <div className="stack g3" style={{ marginTop: 16 }}>
        <label className="field">
          <span>Nom de l’organisation</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Ex. ALI’O BARBER"
          />
        </label>

        <label className="field">
          <span>Nom du premier établissement</span>
          <input
            className="input"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            maxLength={120}
            placeholder="Ex. ALI’O BARBER Asnières"
          />
        </label>

        <div className="row g3 wrap">
          <label className="field" style={{ flex: '1 1 180px' }}>
            <span>Activité</span>
            <select className="select" value={activity} onChange={(e) => setActivity(e.target.value)}>
              {ACTIVITY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="field" style={{ flex: '1 1 160px' }}>
            <span>Mode de file</span>
            <select
              className="select"
              value={queueMode}
              onChange={(e) => setQueueMode(e.target.value as 'shared' | 'per_staff')}
            >
              <option value="shared">File commune</option>
              <option value="per_staff">Par professionnel</option>
            </select>
          </label>

          <label className="field" style={{ flex: '1 1 160px' }}>
            <span>Offre</span>
            <select
              className="select"
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value as 'starter' | 'pro' | 'business')}
            >
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="business">Business</option>
            </select>
          </label>
        </div>

        {error && <p className="error-text">{error}</p>}

        <button
          className="btn btn--solid btn--lg"
          type="button"
          disabled={pending || name.trim().length < 2 || !locationName.trim()}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await adminCreateOrganization({
                name: name.trim(),
                locationName: locationName.trim(),
                activity: activity as never,
                queueMode,
                planCode,
              });

              if (!result.ok) {
                setError(result.error);
                return;
              }

              router.push(`/admin/etablissements/${result.data.organizationId}`);
              router.refresh();
            });
          }}
        >
          {pending ? 'Création…' : 'Créer et ouvrir la fiche'}
        </button>
      </div>
    </div>
  );
}
