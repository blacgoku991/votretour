'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ACTIVITY_OPTIONS } from '@/lib/copy';
import { adminCreateOrganizationV2 } from '@/server/actions/admin-v2';
import styles from '../admin-v2.module.css';

export function CreateOrganizationV2() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [activity, setActivity] = useState('barber');
  const [locationName, setLocationName] = useState('');
  const [queueMode, setQueueMode] = useState<'shared' | 'per_staff'>('shared');
  const [planCode, setPlanCode] = useState<'starter' | 'pro' | 'business'>('starter');
  const [logoUrl, setLogoUrl] = useState('');
  const [locationLogoUrl, setLocationLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [googleReviewUrl, setGoogleReviewUrl] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [brandAccent, setBrandAccent] = useState<'signal' | 'copper' | 'jade' | 'cobalt' | 'brique'>('signal');
  const [supportEmail, setSupportEmail] = useState('');

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await adminCreateOrganizationV2({
        name,
        activity: activity as never,
        locationName,
        queueMode,
        planCode,
        logoUrl,
        locationLogoUrl,
        coverUrl,
        addressLine1,
        postalCode,
        city,
        phone,
        googleReviewUrl,
        mapsUrl,
        brandAccent,
        supportEmail,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.push('/admin/etablissements/' + result.data.organizationId);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button className="btn btn--signal" type="button" onClick={() => setOpen(true)}>
        + Nouvel établissement
      </button>
    );
  }

  return (
    <section className={styles.creator}>
      <div className={styles.creatorHead}>
        <div>
          <span className={styles.eyebrow}>PROVISIONING</span>
          <h2>Créer un établissement complet</h2>
          <p>
            La création prépare l’organisation, le premier établissement, sa file,
            sa plaque et l’abonnement de départ.
          </p>
        </div>
        <button className="btn btn--quiet btn--sm" type="button" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </div>

      <div className={styles.formGrid}>
        <label className="field">
          <span>Nom de l’organisation</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ex. ALI’O BARBER" maxLength={120} />
        </label>

        <label className="field">
          <span>Activité</span>
          <select className="select" value={activity} onChange={(e) => setActivity(e.target.value)}>
            {ACTIVITY_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Nom du premier établissement</span>
          <input className="input" value={locationName} onChange={(e) => setLocationName(e.target.value)}
            placeholder="Ex. Asnières centre" maxLength={120} />
        </label>

        <label className="field">
          <span>Offre</span>
          <select className="select" value={planCode}
            onChange={(e) => setPlanCode(e.target.value as 'starter' | 'pro' | 'business')}>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="business">Business</option>
          </select>
        </label>

        <label className="field">
          <span>Mode de file</span>
          <select className="select" value={queueMode}
            onChange={(e) => setQueueMode(e.target.value as 'shared' | 'per_staff')}>
            <option value="shared">File commune</option>
            <option value="per_staff">Une file par professionnel</option>
          </select>
        </label>

        <label className="field">
          <span>Couleur de marque</span>
          <select className="select" value={brandAccent}
            onChange={(e) => setBrandAccent(e.target.value as typeof brandAccent)}>
            <option value="signal">Signal</option>
            <option value="copper">Cuivre</option>
            <option value="jade">Jade</option>
            <option value="cobalt">Cobalt</option>
            <option value="brique">Brique</option>
          </select>
        </label>

        <label className="field">
          <span>Logo organisation · URL HTTPS</span>
          <input className="input" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…" inputMode="url" />
        </label>

        <label className="field">
          <span>Logo établissement · URL HTTPS</span>
          <input className="input" value={locationLogoUrl} onChange={(e) => setLocationLogoUrl(e.target.value)}
            placeholder="https://…" inputMode="url" />
        </label>

        <label className={['field', styles.span2].join(' ')}>
          <span>Image de couverture · URL HTTPS</span>
          <input className="input" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)}
            placeholder="https://…" inputMode="url" />
        </label>

        <label className={['field', styles.span2].join(' ')}>
          <span>Adresse</span>
          <input className="input" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)}
            placeholder="12 rue…" maxLength={160} />
        </label>

        <label className="field">
          <span>Code postal</span>
          <input className="input" value={postalCode} onChange={(e) => setPostalCode(e.target.value)}
            maxLength={20} />
        </label>

        <label className="field">
          <span>Ville</span>
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)}
            maxLength={100} />
        </label>

        <label className="field">
          <span>Téléphone</span>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)}
            inputMode="tel" maxLength={40} />
        </label>

        <label className="field">
          <span>Email support</span>
          <input className="input" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)}
            type="email" />
        </label>

        <label className="field">
          <span>Lien avis Google</span>
          <input className="input" value={googleReviewUrl} onChange={(e) => setGoogleReviewUrl(e.target.value)}
            placeholder="https://…" inputMode="url" />
        </label>

        <label className="field">
          <span>Lien Maps</span>
          <input className="input" value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="https://…" inputMode="url" />
        </label>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className={styles.creatorActions}>
        <span className={styles.creatorHint}>
          Après création, tous les réglages restent modifiables depuis la fiche établissement.
        </span>
        <button className="btn btn--signal" type="button"
          disabled={pending || name.trim().length < 2 || locationName.trim().length < 1}
          onClick={submit}>
          {pending ? 'Création…' : 'Créer & configurer'}
        </button>
      </div>
    </section>
  );
}
