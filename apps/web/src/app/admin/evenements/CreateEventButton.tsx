'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adminCreateEventCampaign } from '@/server/actions/admin-v2';
import { ImageUploadField } from '../ImageUploadField';
import styles from '../admin-v2.module.css';

type QueueOption = {
  id: string;
  name: string;
  locationId: string;
};

type LocationOption = {
  id: string;
  name: string;
  city: string | null;
  queues: QueueOption[];
};

type OrganizationOption = {
  id: string;
  name: string;
  logoUrl: string | null;
  locations: LocationOption[];
};

export function CreateEventButton({ organizations }: { organizations: OrganizationOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const activeOrg = useMemo(
    () => organizations.find((item) => item.id === organizationId) ?? organizations[0] ?? null,
    [organizationId, organizations],
  );
  const [locationId, setLocationId] = useState(activeOrg?.locations[0]?.id ?? '');
  const activeLocation = useMemo(
    () => activeOrg?.locations.find((item) => item.id === locationId)
      ?? activeOrg?.locations[0]
      ?? null,
    [activeOrg, locationId],
  );
  const [queueId, setQueueId] = useState(activeLocation?.queues[0]?.id ?? '');

  const [name, setName] = useState('');
  const [heroTitle, setHeroTitle] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [accentHex, setAccentHex] = useState('#FF4B1F');
  const [rulesText, setRulesText] = useState('');
  const [qrLabel, setQrLabel] = useState('Scannez pour rejoindre la file');
  const [waveSize, setWaveSize] = useState(10);
  const [passValidMinutes, setPassValidMinutes] = useState(10);
  const [graceMinutes, setGraceMinutes] = useState(5);
  const [publicNote, setPublicNote] = useState('');
  const [startNow, setStartNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chooseOrganization = (id: string) => {
    setOrganizationId(id);
    const org = organizations.find((item) => item.id === id);
    const location = org?.locations[0] ?? null;
    setLocationId(location?.id ?? '');
    setQueueId(location?.queues[0]?.id ?? '');
  };

  const chooseLocation = (id: string) => {
    setLocationId(id);
    const location = activeOrg?.locations.find((item) => item.id === id);
    setQueueId(location?.queues[0]?.id ?? '');
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await adminCreateEventCampaign({
        organizationId,
        locationId,
        queueId,
        name,
        heroTitle,
        logoUrl,
        coverUrl,
        accentHex,
        rulesText,
        qrLabel,
        waveSize,
        passValidMinutes,
        graceMinutes,
        publicNote,
        startNow,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setName('');
      setHeroTitle('');
      setLogoUrl('');
      setCoverUrl('');
      setAccentHex('#FF4B1F');
      setRulesText('');
      setQrLabel('Scannez pour rejoindre la file');
      setPublicNote('');
      setStartNow(false);
      setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button className="btn btn--signal" type="button" onClick={() => setOpen(true)}>
        + Créer un événement
      </button>
    );
  }

  return (
    <section className={styles.creator}>
      <div className={styles.creatorHead}>
        <div>
          <span className={styles.eyebrow}>EVENT STUDIO</span>
          <h2>Créer et habiller le drop</h2>
          <p>
            Règles de file, identité visuelle, QR public et écran TV sont configurés au même endroit.
          </p>
        </div>
        <button className="btn btn--quiet btn--sm" type="button" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </div>

      {organizations.length === 0 ? (
        <div className="banner banner--error">
          <span>Crée d’abord un établissement avant de lancer un événement.</span>
        </div>
      ) : (
        <>
          <div className={styles.formGrid}>
            <label className="field">
              <span>Organisation</span>
              <select className="select" value={organizationId}
                onChange={(event) => chooseOrganization(event.target.value)}>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>{organization.name}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Établissement</span>
              <select className="select" value={activeLocation?.id ?? ''}
                onChange={(event) => chooseLocation(event.target.value)}>
                {(activeOrg?.locations ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}{location.city ? ' · ' + location.city : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>File utilisée</span>
              <select className="select" value={queueId}
                onChange={(event) => setQueueId(event.target.value)}>
                {(activeLocation?.queues ?? []).map((queue) => (
                  <option key={queue.id} value={queue.id}>{queue.name}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Nom de l’événement</span>
              <input className="input" value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex. Drop Air Max · Paris" maxLength={120} />
            </label>

            <label className={['field', styles.span2].join(' ')}>
              <span>Titre d’accueil / écran</span>
              <input className="input" value={heroTitle}
                onChange={(event) => setHeroTitle(event.target.value)}
                placeholder="Ex. Aujourd’hui, vous entrez par vagues de 10"
                maxLength={140} />
            </label>

            <div className={styles.span2}>
              <ImageUploadField
                label="Logo de l’événement"
                value={logoUrl}
                purpose="event-logo"
                onChange={setLogoUrl}
                helper="Affiché sur le pass et l’écran TV. JPG, PNG ou WebP."
              />
            </div>

            <div className={styles.span2}>
              <ImageUploadField
                label="Affiche / couverture"
                value={coverUrl}
                purpose="event-cover"
                onChange={setCoverUrl}
                helper="Utilisée comme fond de l’écran événement."
              />
            </div>

            <label className="field">
              <span>Couleur de l’événement</span>
              <div className="row g2">
                <input
                  type="color"
                  value={accentHex}
                  onChange={(event) => setAccentHex(event.target.value.toUpperCase())}
                  style={{ width: 58, minHeight: 44, padding: 4, borderRadius: 10 }}
                />
                <input
                  className="input"
                  value={accentHex}
                  onChange={(event) => setAccentHex(event.target.value.toUpperCase())}
                  maxLength={7}
                  placeholder="#FF4B1F"
                />
              </div>
            </label>

            <label className="field">
              <span>Texte sous le QR</span>
              <input className="input" value={qrLabel}
                onChange={(event) => setQrLabel(event.target.value)}
                maxLength={120} />
            </label>

            <label className={['field', styles.span2].join(' ')}>
              <span>Règles / consignes</span>
              <textarea className="input" style={{ minHeight: 110, resize: 'vertical' }}
                value={rulesText}
                onChange={(event) => setRulesText(event.target.value)}
                placeholder="Ex. Présentez-vous uniquement quand votre pass devient actif…"
                maxLength={2400} />
            </label>

            <label className="field">
              <span>Taille d’une vague</span>
              <input className="input" type="number" min={1} max={200}
                value={waveSize}
                onChange={(event) => setWaveSize(Number(event.target.value))} />
            </label>

            <label className="field">
              <span>Validité du pass (min)</span>
              <input className="input" type="number" min={1} max={120}
                value={passValidMinutes}
                onChange={(event) => setPassValidMinutes(Number(event.target.value))} />
            </label>

            <label className="field">
              <span>Grâce supplémentaire (min)</span>
              <input className="input" type="number" min={0} max={60}
                value={graceMinutes}
                onChange={(event) => setGraceMinutes(Number(event.target.value))} />
            </label>

            <label className={[styles.switchCard, styles.span2].join(' ')}>
              <input type="checkbox" checked={startNow}
                onChange={(event) => setStartNow(event.target.checked)} />
              <span>
                <strong>Démarrer immédiatement</strong>
                <small>Sinon l’événement reste en brouillon jusqu’au lancement manuel.</small>
              </span>
            </label>

            <label className={['field', styles.span2].join(' ')}>
              <span>Message public</span>
              <textarea className="input" style={{ minHeight: 96, resize: 'vertical' }}
                value={publicNote}
                onChange={(event) => setPublicNote(event.target.value)}
                placeholder="Message complémentaire visible par les participants…"
                maxLength={500} />
            </label>
          </div>

          {(name || coverUrl || logoUrl) && (
            <div className={styles.eventPreview}
              style={{
                borderColor: accentHex,
                backgroundImage: coverUrl
                  ? `linear-gradient(120deg, rgba(7,9,13,.92), rgba(7,9,13,.72)), url(${JSON.stringify(coverUrl)})`
                  : undefined,
              }}>
              <div className={styles.eventPreviewLogo}>
                {logoUrl
                  ? <img src={logoUrl} alt="" />
                  : activeOrg?.logoUrl
                    ? <img src={activeOrg.logoUrl} alt="" />
                    : <span>R</span>}
              </div>
              <div>
                <span style={{ color: accentHex }}>APERÇU ÉCRAN</span>
                <h3>{heroTitle || name || 'Votre événement'}</h3>
                <p>{rulesText || qrLabel || 'Vos consignes apparaîtront ici.'}</p>
              </div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}

          <div className={styles.creatorActions}>
            <div className={styles.creatorHint}>
              {activeLocation?.queues.length
                ? activeLocation.queues.length + ' file(s) disponible(s)'
                : 'Aucune file disponible sur cet établissement'}
            </div>
            <button className="btn btn--signal" type="button"
              disabled={pending || !name.trim() || !organizationId || !locationId || !queueId}
              onClick={submit}>
              {pending ? 'Création…' : startNow ? 'Créer & lancer' : 'Créer le brouillon'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
