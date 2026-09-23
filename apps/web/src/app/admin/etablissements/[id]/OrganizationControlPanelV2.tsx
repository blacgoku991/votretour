'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ACTIVITY_OPTIONS } from '@/lib/copy';
import {
  adminDeleteOrganization,
  adminRevokeOrganizationSessions,
  reactivateOrganization,
  suspendOrganization,
} from '@/server/actions/admin';
import { adminUpdateOrganizationV2 } from '@/server/actions/admin-v2';
import { ImageUploadField } from '../../ImageUploadField';
import styles from '../../admin-v2.module.css';

type LocationConfig = {
  id: string;
  name: string;
  slug: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string;
  phone: string | null;
  timezone: string;
  googleReviewUrl: string | null;
  mapsUrl: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  isActive: boolean;
};

type SettingsConfig = {
  defaultLocale: string;
  dataRetentionDays: number;
  askClientName: boolean;
  clientNameRequired: boolean;
  allowClientLeave: boolean;
  showPeopleAhead: boolean;
  showEstimatedWait: boolean;
  notifyAheadThreshold: number;
  sendCompletionReview: boolean;
  brandAccent: 'signal' | 'copper' | 'jade' | 'cobalt' | 'brique';
  supportEmail: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
};

export function OrganizationControlPanelV2({
  organization,
  settings,
  locations,
  activeEntries,
  subscription,
}: {
  organization: {
    id: string;
    name: string;
    activity: string;
    status: string;
    logoUrl: string | null;
    suspendedReason: string | null;
  };
  settings: SettingsConfig;
  locations: LocationConfig[];
  activeEntries: number;
  subscription: {
    status: string | null;
    planName: string | null;
    stripeSubscriptionId: string | null;
    periodEnd: string | null;
  };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'identity' | 'experience' | 'location' | 'security'>('identity');
  const [name, setName] = useState(organization.name);
  const [activity, setActivity] = useState(organization.activity);
  const [logoUrl, setLogoUrl] = useState(organization.logoUrl ?? '');
  const [experience, setExperience] = useState({
    defaultLocale: settings.defaultLocale,
    dataRetentionDays: settings.dataRetentionDays,
    askClientName: settings.askClientName,
    clientNameRequired: settings.clientNameRequired,
    allowClientLeave: settings.allowClientLeave,
    showPeopleAhead: settings.showPeopleAhead,
    showEstimatedWait: settings.showEstimatedWait,
    notifyAheadThreshold: settings.notifyAheadThreshold,
    sendCompletionReview: settings.sendCompletionReview,
    brandAccent: settings.brandAccent,
    supportEmail: settings.supportEmail ?? '',
    privacyUrl: settings.privacyUrl ?? '',
    termsUrl: settings.termsUrl ?? '',
  });
  const [locationDrafts, setLocationDrafts] = useState(
    locations.map((location) => ({
      ...location,
      addressLine1: location.addressLine1 ?? '',
      addressLine2: location.addressLine2 ?? '',
      postalCode: location.postalCode ?? '',
      city: location.city ?? '',
      phone: location.phone ?? '',
      googleReviewUrl: location.googleReviewUrl ?? '',
      mapsUrl: location.mapsUrl ?? '',
      logoUrl: location.logoUrl ?? '',
      coverUrl: location.coverUrl ?? '',
    })),
  );
  const [selectedLocationId, setSelectedLocationId] = useState(locations[0]?.id ?? '');
  const selectedLocation = locationDrafts.find((location) => location.id === selectedLocationId)
    ?? locationDrafts[0]
    ?? null;

  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const patchLocation = <K extends keyof NonNullable<typeof selectedLocation>>(
    key: K,
    value: NonNullable<typeof selectedLocation>[K],
  ) => {
    if (!selectedLocation) return;
    setLocationDrafts((current) => current.map((location) =>
      location.id === selectedLocation.id ? { ...location, [key]: value } : location
    ));
  };

  const save = () => {
    if (!selectedLocation) {
      setError('Aucun établissement à configurer.');
      return;
    }
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await adminUpdateOrganizationV2({
        organizationId: organization.id,
        name,
        activity: activity as never,
        logoUrl,
        defaultLocale: experience.defaultLocale,
        dataRetentionDays: Number(experience.dataRetentionDays),
        askClientName: experience.askClientName,
        clientNameRequired: experience.clientNameRequired,
        allowClientLeave: experience.allowClientLeave,
        showPeopleAhead: experience.showPeopleAhead,
        showEstimatedWait: experience.showEstimatedWait,
        notifyAheadThreshold: Number(experience.notifyAheadThreshold),
        sendCompletionReview: experience.sendCompletionReview,
        brandAccent: experience.brandAccent,
        supportEmail: experience.supportEmail,
        privacyUrl: experience.privacyUrl,
        termsUrl: experience.termsUrl,
        location: {
          id: selectedLocation.id,
          name: selectedLocation.name,
          addressLine1: selectedLocation.addressLine1,
          addressLine2: selectedLocation.addressLine2,
          postalCode: selectedLocation.postalCode,
          city: selectedLocation.city,
          countryCode: selectedLocation.countryCode,
          phone: selectedLocation.phone,
          timezone: selectedLocation.timezone,
          googleReviewUrl: selectedLocation.googleReviewUrl,
          mapsUrl: selectedLocation.mapsUrl,
          logoUrl: selectedLocation.logoUrl,
          coverUrl: selectedLocation.coverUrl,
          isActive: selectedLocation.isActive,
        },
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setNotice('Configuration enregistrée.');
      router.refresh();
    });
  };

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

  const tabs = [
    ['identity', 'Identité & marque'],
    ['experience', 'Expérience client'],
    ['location', 'Établissements'],
    ['security', 'Accès & sécurité'],
  ] as const;

  return (
    <div className={styles.configShell}>
      <div className={styles.configTabs}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={[styles.configTab, tab === key ? styles.configTabActive : ''].join(' ')}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'identity' && (
        <section className={styles.configSection}>
          <div className={styles.configSectionHeader}>
            <div>
              <h3>Identité de l’organisation</h3>
              <p>Nom, activité, logo et identité visuelle vus dans le panel et les écrans clients.</p>
            </div>
          </div>

          <div className={styles.previewCard}>
            <div className={styles.previewLogo}>
              {logoUrl ? <img src={logoUrl} alt="" /> : name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>{name || 'Organisation'}</strong>
              <span>{ACTIVITY_OPTIONS.find((item) => item.value === activity)?.label ?? activity}</span>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label className="field">
              <span>Nom</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </label>

            <label className="field">
              <span>Activité</span>
              <select className="select" value={activity} onChange={(e) => setActivity(e.target.value)}>
                {ACTIVITY_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>

            <div className={styles.span2}>
              <ImageUploadField
                label="Logo de l’organisation"
                value={logoUrl}
                purpose="logo"
                onChange={setLogoUrl}
                helper="Téléverse une image depuis iPhone/PC ou colle une URL HTTPS."
              />
            </div>

            <label className="field">
              <span>Couleur de marque</span>
              <select className="select" value={experience.brandAccent}
                onChange={(e) => setExperience((v) => ({ ...v, brandAccent: e.target.value as SettingsConfig['brandAccent'] }))}>
                <option value="signal">Signal</option>
                <option value="copper">Cuivre</option>
                <option value="jade">Jade</option>
                <option value="cobalt">Cobalt</option>
                <option value="brique">Brique</option>
              </select>
            </label>

            <label className="field">
              <span>Email support</span>
              <input className="input" type="email" value={experience.supportEmail}
                onChange={(e) => setExperience((v) => ({ ...v, supportEmail: e.target.value }))} />
            </label>
          </div>
        </section>
      )}

      {tab === 'experience' && (
        <section className={styles.configSection}>
          <div className={styles.configSectionHeader}>
            <div>
              <h3>Expérience client</h3>
              <p>Réglages de file, affichage, notifications, conservation et liens légaux.</p>
            </div>
          </div>

          <div className={styles.toggleGrid}>
            <Toggle label="Demander le nom" checked={experience.askClientName}
              onChange={(value) => setExperience((v) => ({ ...v, askClientName: value }))} />
            <Toggle label="Nom obligatoire" checked={experience.clientNameRequired}
              onChange={(value) => setExperience((v) => ({ ...v, clientNameRequired: value }))} />
            <Toggle label="Autoriser à quitter la file" checked={experience.allowClientLeave}
              onChange={(value) => setExperience((v) => ({ ...v, allowClientLeave: value }))} />
            <Toggle label="Afficher personnes devant" checked={experience.showPeopleAhead}
              onChange={(value) => setExperience((v) => ({ ...v, showPeopleAhead: value }))} />
            <Toggle label="Afficher attente estimée" checked={experience.showEstimatedWait}
              onChange={(value) => setExperience((v) => ({ ...v, showEstimatedWait: value }))} />
            <Toggle label="Demander un avis en fin de passage" checked={experience.sendCompletionReview}
              onChange={(value) => setExperience((v) => ({ ...v, sendCompletionReview: value }))} />
          </div>

          <div className={styles.formGrid}>
            <label className="field">
              <span>Prévenir quand il reste X personnes</span>
              <input className="input" type="number" min={1} max={10}
                value={experience.notifyAheadThreshold}
                onChange={(e) => setExperience((v) => ({ ...v, notifyAheadThreshold: Number(e.target.value) }))} />
            </label>

            <label className="field">
              <span>Conservation données (jours)</span>
              <input className="input" type="number" min={1} max={730}
                value={experience.dataRetentionDays}
                onChange={(e) => setExperience((v) => ({ ...v, dataRetentionDays: Number(e.target.value) }))} />
            </label>

            <label className="field">
              <span>Langue par défaut</span>
              <input className="input" value={experience.defaultLocale}
                onChange={(e) => setExperience((v) => ({ ...v, defaultLocale: e.target.value }))} maxLength={10} />
            </label>

            <label className="field">
              <span>Politique de confidentialité</span>
              <input className="input" value={experience.privacyUrl}
                onChange={(e) => setExperience((v) => ({ ...v, privacyUrl: e.target.value }))}
                placeholder="https://…" inputMode="url" />
            </label>

            <label className={['field', styles.span2].join(' ')}>
              <span>Conditions d’utilisation</span>
              <input className="input" value={experience.termsUrl}
                onChange={(e) => setExperience((v) => ({ ...v, termsUrl: e.target.value }))}
                placeholder="https://…" inputMode="url" />
            </label>
          </div>
        </section>
      )}

      {tab === 'location' && (
        <section className={styles.configSection}>
          <div className={styles.configSectionHeader}>
            <div>
              <h3>Établissements physiques</h3>
              <p>Adresse, identité locale, avis Google et présentation de chaque site.</p>
            </div>
          </div>

          <div className={styles.locationSwitcher}>
            {locationDrafts.map((location) => (
              <button key={location.id} type="button"
                className={[styles.locationChip, selectedLocation?.id === location.id ? styles.locationChipActive : ''].join(' ')}
                onClick={() => setSelectedLocationId(location.id)}>
                {location.name}{location.city ? ' · ' + location.city : ''}
              </button>
            ))}
          </div>

          {selectedLocation && (
            <>
              <div className={styles.previewCard}>
                <div className={styles.previewLogo}>
                  {selectedLocation.logoUrl
                    ? <img src={selectedLocation.logoUrl} alt="" />
                    : selectedLocation.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <strong>{selectedLocation.name}</strong>
                  <span>/{selectedLocation.slug}{selectedLocation.city ? ' · ' + selectedLocation.city : ''}</span>
                </div>
              </div>

              <div className={styles.formGrid}>
                <label className="field">
                  <span>Nom du site</span>
                  <input className="input" value={selectedLocation.name}
                    onChange={(e) => patchLocation('name', e.target.value)} />
                </label>

                <label className="field">
                  <span>Téléphone</span>
                  <input className="input" value={selectedLocation.phone}
                    onChange={(e) => patchLocation('phone', e.target.value)} inputMode="tel" />
                </label>

                <label className={['field', styles.span2].join(' ')}>
                  <span>Adresse</span>
                  <input className="input" value={selectedLocation.addressLine1}
                    onChange={(e) => patchLocation('addressLine1', e.target.value)} />
                </label>

                <label className={['field', styles.span2].join(' ')}>
                  <span>Complément d’adresse</span>
                  <input className="input" value={selectedLocation.addressLine2}
                    onChange={(e) => patchLocation('addressLine2', e.target.value)} />
                </label>

                <label className="field">
                  <span>Code postal</span>
                  <input className="input" value={selectedLocation.postalCode}
                    onChange={(e) => patchLocation('postalCode', e.target.value)} />
                </label>

                <label className="field">
                  <span>Ville</span>
                  <input className="input" value={selectedLocation.city}
                    onChange={(e) => patchLocation('city', e.target.value)} />
                </label>

                <label className="field">
                  <span>Pays</span>
                  <input className="input" value={selectedLocation.countryCode}
                    onChange={(e) => patchLocation('countryCode', e.target.value.toUpperCase())} maxLength={2} />
                </label>

                <label className="field">
                  <span>Fuseau horaire</span>
                  <input className="input" value={selectedLocation.timezone}
                    onChange={(e) => patchLocation('timezone', e.target.value)} />
                </label>

                <div className={styles.span2}>
                  <ImageUploadField
                    label="Logo de cet établissement"
                    value={selectedLocation.logoUrl}
                    purpose="logo"
                    onChange={(value) => patchLocation('logoUrl', value)}
                    compact
                  />
                </div>

                <div className={styles.span2}>
                  <ImageUploadField
                    label="Couverture de cet établissement"
                    value={selectedLocation.coverUrl}
                    purpose="cover"
                    onChange={(value) => patchLocation('coverUrl', value)}
                    compact
                  />
                </div>

                <label className="field">
                  <span>Lien avis Google</span>
                  <input className="input" value={selectedLocation.googleReviewUrl}
                    onChange={(e) => patchLocation('googleReviewUrl', e.target.value)} inputMode="url" />
                </label>

                <label className="field">
                  <span>Lien Maps</span>
                  <input className="input" value={selectedLocation.mapsUrl}
                    onChange={(e) => patchLocation('mapsUrl', e.target.value)} inputMode="url" />
                </label>

                <label className={[styles.switchCard, styles.span2].join(' ')}>
                  <input type="checkbox" checked={selectedLocation.isActive}
                    onChange={(e) => patchLocation('isActive', e.target.checked)} />
                  <span>
                    <strong>Établissement actif</strong>
                    <small>Désactiver masque ce site sans supprimer son historique.</small>
                  </span>
                </label>
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'security' && (
        <section className={styles.configSection}>
          <div className={styles.configSectionHeader}>
            <div>
              <h3>Accès, abonnement & sécurité</h3>
              <p>Actions sensibles réservées au super-admin.</p>
            </div>
          </div>

          <div className="banner">
            <span>
              Offre : <strong>{subscription.planName ?? '—'}</strong>
              {' · '}statut {subscription.status ?? '—'}
              {subscription.periodEnd
                ? ' · fin ' + new Date(subscription.periodEnd).toLocaleDateString('fr-FR')
                : ''}
            </span>
          </div>

          <div className="row g2 wrap">
            {organization.status === 'active' ? (
              <>
                <input className="input" style={{ maxWidth: 360 }} placeholder="Motif de suspension"
                  value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className="btn btn--danger"
                  disabled={pending || reason.trim().length < 3}
                  onClick={() => run(
                    async () => suspendOrganization({ organizationId: organization.id, reason: reason.trim() }),
                    'Organisation suspendue.',
                  )}>
                  Suspendre
                </button>
              </>
            ) : (
              <button type="button" className="btn btn--ghost" disabled={pending}
                onClick={() => run(
                  async () => reactivateOrganization(organization.id),
                  'Organisation réactivée.',
                )}>
                Réactiver
              </button>
            )}

            <button type="button" className="btn btn--ghost" disabled={pending}
              onClick={() => {
                if (!window.confirm('Révoquer toutes les sessions client et les notifications ?')) return;
                run(
                  async () => adminRevokeOrganizationSessions(organization.id),
                  'Sessions et abonnements push révoqués.',
                );
              }}>
              Révoquer appareils
            </button>
          </div>

          <div className={styles.dangerZone}>
            <h4>Zone dangereuse</h4>
            <p>
              Suppression définitive. L’organisation doit être suspendue, sans client actif,
              et sans abonnement Stripe actif.
            </p>
            <input className="input" placeholder={'Tapez exactement : ' + organization.name}
              value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            <button type="button" className="btn btn--danger" style={{ marginTop: 10 }}
              disabled={
                pending
                || organization.status !== 'suspended'
                || activeEntries > 0
                || confirmation !== organization.name
              }
              onClick={() => {
                if (!window.confirm('SUPPRESSION DÉFINITIVE : cette action est irréversible. Continuer ?')) return;
                setError(null);
                startTransition(async () => {
                  const result = await adminDeleteOrganization({
                    organizationId: organization.id,
                    confirmationName: confirmation,
                  });
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  router.push('/admin/etablissements');
                  router.refresh();
                });
              }}>
              Supprimer définitivement
            </button>
          </div>
        </section>
      )}

      {error && <p className="error-text">{error}</p>}
      {notice && <div className="banner"><span>{notice}</span></div>}

      {tab !== 'security' && (
        <div className={styles.saveBar}>
          <span>Les modifications sont appliquées immédiatement à l’organisation et au site sélectionné.</span>
          <button className="btn btn--signal" type="button" disabled={pending || !selectedLocation}
            onClick={save}>
            {pending ? 'Enregistrement…' : 'Enregistrer la configuration'}
          </button>
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={styles.switchCard}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <strong>{label}</strong>
      </span>
    </label>
  );
}
