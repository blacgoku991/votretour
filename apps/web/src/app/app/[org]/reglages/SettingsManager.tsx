'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Section, SettingRow, Toggle, SaveBar } from '@/components/Page';
import {
  updateLocation, updateQueueSettings, updateOrganizationSettings,
  updateOpeningHours, upsertService, deleteService, createLocation,
} from '@/server/actions/settings';
import { WEEKDAYS, formatPrice } from '@/lib/format';
import styles from './settings.module.css';

/**
 * RÉGLAGES.
 *
 * Regroupés par ce que le professionnel cherche, pas par table de base
 * de données : l'établissement, la file, l'avis Google, les horaires,
 * les prestations, et les données personnelles.
 */

interface Location {
  id: string; name: string; address_line1: string | null; postal_code: string | null;
  city: string | null; phone: string | null; timezone: string; maps_url: string | null;
  google_review_url: string | null; latitude: number | null; longitude: number | null;
  is_active: boolean;
}
interface Queue {
  id: string; name: string; mode: string; advance_mode: string;
  ask_client_name: boolean; client_name_required: boolean;
  allow_staff_choice: boolean; allow_service_choice: boolean;
  notify_ahead_threshold: number; absent_policy: string; absent_move_back_by: number;
  max_active_entries: number | null; entry_ttl_minutes: number;
}
interface OrgSettings {
  data_retention_days: number; show_people_ahead: boolean; allow_client_leave: boolean;
  send_completion_review: boolean; brand_accent: string; support_email: string | null;
}
interface Service {
  id: string; name: string; duration_minutes: number | null; price_cents: number | null;
}

export function SettingsManager({
  orgSlug, organizationId, canManage, locations, currentLocation, settings, queues, hours, services,
}: {
  orgSlug: string;
  organizationId: string;
  canManage: boolean;
  locations: Location[];
  currentLocation: Location | null;
  settings: OrgSettings | null;
  queues: Queue[];
  hours: { weekday: number; opens_at: string | null; closes_at: string | null; is_closed: boolean }[];
  services: Service[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const queue = queues[0] ?? null;

  const [place, setPlace] = useState({
    name: currentLocation?.name ?? '',
    addressLine1: currentLocation?.address_line1 ?? '',
    postalCode: currentLocation?.postal_code ?? '',
    city: currentLocation?.city ?? '',
    phone: currentLocation?.phone ?? '',
    mapsUrl: currentLocation?.maps_url ?? '',
    googleReviewUrl: currentLocation?.google_review_url ?? '',
  });
  const [placeDirty, setPlaceDirty] = useState(false);

  const [days, setDays] = useState(
    WEEKDAYS.map((_, index) => {
      const existing = hours.find((h) => h.weekday === index);
      return {
        weekday: index,
        isClosed: existing?.is_closed ?? index === 6,
        opensAt: existing?.opens_at?.slice(0, 5) ?? '09:00',
        closesAt: existing?.closes_at?.slice(0, 5) ?? '19:00',
      };
    }),
  );
  const [hoursDirty, setHoursDirty] = useState(false);
  const [newService, setNewService] = useState({ name: '', duration: '' });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) { setError(result.error ?? 'Enregistrement impossible.'); return; }
      setSaved(true);
      after?.();
      router.refresh();
    });
  };

  const patchPlace = (field: keyof typeof place, value: string) => {
    setPlace((p) => ({ ...p, [field]: value }));
    setPlaceDirty(true);
  };

  if (!currentLocation) {
    return (
      <div className="shell" style={{ paddingTop: 'var(--sp-5)' }}>
        <PageHeader title="Réglages" description="Créez d’abord un établissement." />
      </div>
    );
  }

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Réglages"
        description="Le fonctionnement de votre file, vos horaires, votre lien d’avis et vos données."
        actions={locations.length > 1 ? (
          <select className="select" defaultValue={currentLocation.id}
            onChange={(e) => { window.location.href = `/app/${orgSlug}/reglages?lieu=${e.target.value}`; }}
            aria-label="Établissement">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        ) : undefined}
      />

      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

      {/* ---------------- Établissement ---------------- */}
      <Section title="Établissement" description="Ce que voient vos clients quand ils scannent.">
        <SettingRow label="Nom" hint="Affiché en haut de l’écran client.">
          <input className="input" value={place.name} disabled={!canManage}
            onChange={(e) => patchPlace('name', e.target.value)} />
        </SettingRow>
        <SettingRow label="Adresse">
          <input className="input" value={place.addressLine1} disabled={!canManage}
            onChange={(e) => patchPlace('addressLine1', e.target.value)} />
        </SettingRow>
        <SettingRow label="Code postal et ville">
          <input className="input" style={{ maxWidth: 110 }} value={place.postalCode}
            disabled={!canManage} onChange={(e) => patchPlace('postalCode', e.target.value)} />
          <input className="input" value={place.city} disabled={!canManage}
            onChange={(e) => patchPlace('city', e.target.value)} />
        </SettingRow>
        <SettingRow label="Téléphone" hint="Le client peut vous appeler depuis son écran.">
          <input className="input" type="tel" value={place.phone} disabled={!canManage}
            onChange={(e) => patchPlace('phone', e.target.value)} />
        </SettingRow>
        <SettingRow label="Lien d’itinéraire" hint="Facultatif. Sinon l’adresse est utilisée.">
          <input className="input" type="url" placeholder="https://maps.app.goo.gl/…"
            value={place.mapsUrl} disabled={!canManage}
            onChange={(e) => patchPlace('mapsUrl', e.target.value)} />
        </SettingRow>
      </Section>

      {/* ---------------- Avis Google ---------------- */}
      <Section
        title="Avis Google"
        description="Proposé à la fin de chaque passage, à tous les clients, sans filtrage sur la satisfaction."
      >
        <SettingRow
          label="Lien « Rédiger un avis »"
          hint="Fiche Google de votre établissement → Demander des avis → copiez le lien court."
          stacked
        >
          <input className="input" type="url" placeholder="https://g.page/r/…"
            value={place.googleReviewUrl} disabled={!canManage}
            onChange={(e) => patchPlace('googleReviewUrl', e.target.value)} />
        </SettingRow>
        {place.googleReviewUrl && (
          <SettingRow label="Vérifier le lien" hint="Ouvrez-le pour confirmer qu’il pointe bien chez vous.">
            <a className="btn btn--ghost btn--sm" href={place.googleReviewUrl}
              target="_blank" rel="noreferrer">Ouvrir</a>
          </SettingRow>
        )}
      </Section>

      <SaveBar
        dirty={placeDirty} pending={pending} saved={saved} error={error}
        onReset={() => {
          setPlace({
            name: currentLocation.name,
            addressLine1: currentLocation.address_line1 ?? '',
            postalCode: currentLocation.postal_code ?? '',
            city: currentLocation.city ?? '',
            phone: currentLocation.phone ?? '',
            mapsUrl: currentLocation.maps_url ?? '',
            googleReviewUrl: currentLocation.google_review_url ?? '',
          });
          setPlaceDirty(false);
        }}
        onSave={() => run(() => updateLocation({
          organizationId, locationId: currentLocation.id,
          name: place.name.trim(),
          addressLine1: place.addressLine1.trim() || null,
          postalCode: place.postalCode.trim() || null,
          city: place.city.trim() || null,
          phone: place.phone.trim() || null,
          mapsUrl: place.mapsUrl.trim() || null,
          googleReviewUrl: place.googleReviewUrl.trim() || null,
        }), () => setPlaceDirty(false))}
      />

      {/* ---------------- File ---------------- */}
      {queue && (
        <Section title="Fonctionnement de la file">
          <SettingRow label="Mode" hint="File commune, ou une file par professionnel.">
            <select className="select" value={queue.mode} disabled={!canManage}
              onChange={(e) => run(() => updateQueueSettings({
                queueId: queue.id, mode: e.target.value as never,
              }))}>
              <option value="shared">File commune</option>
              <option value="per_staff">Une file par professionnel</option>
            </select>
          </SettingRow>

          <SettingRow
            label="Après « Terminer »"
            hint="Le suivant démarre tout seul, ou vous le lancez à la main."
          >
            <select className="select" value={queue.advance_mode} disabled={!canManage}
              onChange={(e) => run(() => updateQueueSettings({
                queueId: queue.id, advanceMode: e.target.value as never,
              }))}>
              <option value="auto_serve">Le suivant passe en cours</option>
              <option value="call_next">Le suivant est seulement appelé</option>
            </select>
          </SettingRow>

          <SettingRow label="Demander le prénom" hint="Sinon, rejoindre ne demande rien du tout.">
            <Toggle checked={queue.ask_client_name} label="Demander le prénom" disabled={!canManage}
              onChange={(v) => run(() => updateQueueSettings({ queueId: queue.id, askClientName: v }))} />
          </SettingRow>

          {queue.ask_client_name && (
            <SettingRow label="Prénom obligatoire">
              <Toggle checked={queue.client_name_required} label="Prénom obligatoire" disabled={!canManage}
                onChange={(v) => run(() => updateQueueSettings({
                  queueId: queue.id, clientNameRequired: v,
                }))} />
            </SettingRow>
          )}

          <SettingRow label="Choix du professionnel" hint="Le client peut demander quelqu’un en particulier.">
            <Toggle checked={queue.allow_staff_choice} label="Choix du professionnel" disabled={!canManage}
              onChange={(v) => run(() => updateQueueSettings({
                queueId: queue.id, allowStaffChoice: v,
              }))} />
          </SettingRow>

          <SettingRow label="Choix de la prestation">
            <Toggle checked={queue.allow_service_choice} label="Choix de la prestation" disabled={!canManage}
              onChange={(v) => run(() => updateQueueSettings({
                queueId: queue.id, allowServiceChoice: v,
              }))} />
          </SettingRow>

          <SettingRow
            label="Prévenir à partir de"
            hint="Nombre de personnes devant à partir duquel on envoie la première notification."
          >
            <select className="select" value={queue.notify_ahead_threshold} disabled={!canManage}
              onChange={(e) => run(() => updateQueueSettings({
                queueId: queue.id, notifyAheadThreshold: Number(e.target.value),
              }))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n} personne{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </SettingRow>

          <SettingRow
            label="Client absent"
            hint="Ce que fait le bouton « Absent » par défaut. Vous pourrez toujours choisir au cas par cas."
          >
            <select className="select" value={queue.absent_policy} disabled={!canManage}
              onChange={(e) => run(() => updateQueueSettings({
                queueId: queue.id, absentPolicy: e.target.value as never,
              }))}>
              <option value="move_back">Le reculer dans la file</option>
              <option value="hold">Le mettre de côté</option>
              <option value="remove">Le sortir de la file</option>
            </select>
          </SettingRow>

          {queue.absent_policy === 'move_back' && (
            <SettingRow label="Reculer de">
              <select className="select" value={queue.absent_move_back_by} disabled={!canManage}
                onChange={(e) => run(() => updateQueueSettings({
                  queueId: queue.id, absentMoveBackBy: Number(e.target.value),
                }))}>
                {[1, 2, 3, 4, 5, 8, 10].map((n) => (
                  <option key={n} value={n}>{n} place{n > 1 ? 's' : ''}</option>
                ))}
              </select>
            </SettingRow>
          )}

          <SettingRow
            label="Expiration automatique"
            hint="Un ticket oublié libère sa place au bout de ce délai."
          >
            <select className="select" value={queue.entry_ttl_minutes} disabled={!canManage}
              onChange={(e) => run(() => updateQueueSettings({
                queueId: queue.id, entryTtlMinutes: Number(e.target.value),
              }))}>
              {[60, 120, 180, 240, 360, 480, 720].map((n) => (
                <option key={n} value={n}>{n / 60} h</option>
              ))}
            </select>
          </SettingRow>
        </Section>
      )}

      {/* ---------------- Horaires ---------------- */}
      <Section title="Horaires" description="Indicatifs : la file s’ouvre et se ferme d’un geste.">
        <div className={styles.hours}>
          {days.map((day, i) => (
            <div key={day.weekday} className={styles.hoursRow}>
              <span className={styles.dayName}>{WEEKDAYS[day.weekday]}</span>
              <Toggle
                checked={!day.isClosed}
                label={`Ouvert le ${WEEKDAYS[day.weekday]}`}
                disabled={!canManage}
                onChange={(v) => {
                  const next = [...days];
                  next[i] = { ...day, isClosed: !v };
                  setDays(next); setHoursDirty(true);
                }}
              />
              {day.isClosed ? (
                <span className="t-small t-faint">Fermé</span>
              ) : (
                <>
                  <input type="time" className="input" value={day.opensAt} disabled={!canManage}
                    onChange={(e) => {
                      const next = [...days];
                      next[i] = { ...day, opensAt: e.target.value };
                      setDays(next); setHoursDirty(true);
                    }} />
                  <input type="time" className="input" value={day.closesAt} disabled={!canManage}
                    onChange={(e) => {
                      const next = [...days];
                      next[i] = { ...day, closesAt: e.target.value };
                      setDays(next); setHoursDirty(true);
                    }} />
                </>
              )}
            </div>
          ))}
        </div>
      </Section>

      <SaveBar
        dirty={hoursDirty} pending={pending} saved={saved}
        onSave={() => run(
          () => updateOpeningHours({ organizationId, locationId: currentLocation.id, days }),
          () => setHoursDirty(false),
        )}
      />

      {/* ---------------- Prestations ---------------- */}
      <Section
        title="Prestations"
        description="Proposées au client si vous avez activé le choix de la prestation."
      >
        {services.map((service) => (
          <SettingRow
            key={service.id}
            label={service.name}
            hint={[
              service.duration_minutes ? `${service.duration_minutes} min` : null,
              service.price_cents != null ? formatPrice(service.price_cents) : null,
            ].filter(Boolean).join(' · ') || undefined}
          >
            {canManage && (
              <button type="button" className="btn btn--quiet btn--sm"
                onClick={() => run(() => deleteService(organizationId, service.id))}>
                Retirer
              </button>
            )}
          </SettingRow>
        ))}
        {canManage && (
          <div className={styles.addRow}>
            <input className="input" placeholder="Nom de la prestation" value={newService.name}
              onChange={(e) => setNewService({ ...newService, name: e.target.value })} />
            <input className="input" type="number" min={1} max={600} placeholder="Durée (min)"
              value={newService.duration}
              onChange={(e) => setNewService({ ...newService, duration: e.target.value })} />
            <button type="button" className="btn btn--solid"
              disabled={pending || !newService.name.trim()}
              onClick={() => run(
                () => upsertService({
                  organizationId, locationId: currentLocation.id,
                  name: newService.name.trim(),
                  durationMinutes: newService.duration ? Number(newService.duration) : null,
                }),
                () => setNewService({ name: '', duration: '' }),
              )}>
              Ajouter
            </button>
          </div>
        )}
      </Section>

      {/* ---------------- Données personnelles ---------------- */}
      <Section
        title="Données personnelles"
        description="Nous collectons le strict minimum : aucun e-mail, aucun numéro de téléphone client."
      >
        <SettingRow
          label="Durée de conservation"
          hint="Au-delà, les prénoms sont effacés et les sessions supprimées. Seules des statistiques anonymes subsistent."
        >
          <select className="select" value={settings?.data_retention_days ?? 30} disabled={!canManage}
            onChange={(e) => run(() => updateOrganizationSettings({
              organizationId, dataRetentionDays: Number(e.target.value),
            }))}>
            {[7, 14, 30, 60, 90, 180, 365].map((n) => (
              <option key={n} value={n}>{n} jours</option>
            ))}
          </select>
        </SettingRow>

        <SettingRow label="Le client peut quitter la file lui-même">
          <Toggle checked={settings?.allow_client_leave ?? true} label="Quitter la file"
            disabled={!canManage}
            onChange={(v) => run(() => updateOrganizationSettings({
              organizationId, allowClientLeave: v,
            }))} />
        </SettingRow>

        <SettingRow
          label="Proposer l’avis Google en fin de passage"
          hint="Nécessite un lien d’avis renseigné ci-dessus."
        >
          <Toggle checked={settings?.send_completion_review ?? true} label="Avis Google"
            disabled={!canManage}
            onChange={(v) => run(() => updateOrganizationSettings({
              organizationId, sendCompletionReview: v,
            }))} />
        </SettingRow>
      </Section>

      {/* ---------------- Établissements ---------------- */}
      {canManage && (
        <Section title="Établissements" description="Chaque établissement a sa file, ses plaques et son lien d’avis.">
          {locations.map((l) => (
            <SettingRow key={l.id} label={l.name} hint={l.city ?? undefined}>
              <a className="btn btn--ghost btn--sm" href={`/app/${orgSlug}/reglages?lieu=${l.id}`}>
                Ouvrir
              </a>
            </SettingRow>
          ))}
          <div className={styles.addRow}>
            <NewLocationForm organizationId={organizationId} onDone={() => router.refresh()} />
          </div>
        </Section>
      )}
    </div>
  );
}

function NewLocationForm({
  organizationId, onDone,
}: { organizationId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <input className="input" placeholder="Nom du nouvel établissement" value={name}
        onChange={(e) => setName(e.target.value)} />
      <button type="button" className="btn btn--solid" disabled={pending || !name.trim()}
        onClick={() => startTransition(async () => {
          setError(null);
          const result = await createLocation({ organizationId, name: name.trim() });
          if (!result.ok) { setError(result.error); return; }
          setName('');
          onDone();
        })}>
        {pending ? '…' : 'Créer'}
      </button>
      {error && <p className="error-text" style={{ flexBasis: '100%' }}>{error}</p>}
    </>
  );
}
