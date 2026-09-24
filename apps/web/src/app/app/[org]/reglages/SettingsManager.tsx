'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Section, SettingRow, Toggle, SaveBar } from '@/components/Page';
import { TimeField } from '@/components/TimeField';
import {
  updateLocation, updateQueueSettings, updateOrganizationSettings,
  updateOpeningHours, upsertService, deleteService, createLocation,
} from '@/server/actions/settings';
import { WEEKDAYS, formatPrice } from '@/lib/format';
import { hasStages, isLegacyProfile, isQueueProfile } from '@/lib/profiles';
import { OPEN_PROFILES, profileAvailable } from '@/lib/profiles/capabilities';
import type { QueueProfile } from '@/lib/profiles/types';
import { ProfileSection, type DeskStaff } from './ProfileSection';
import { TemplatesSection } from './TemplatesSection';
import { mergeTemplates, type StoredTemplateRow } from './templateRows';
import { SettingsTocRail, SettingsTocSelect, type TocEntry } from './SettingsToc';
import { ThresholdRang } from './ThresholdRang';
import styles from './settings.module.css';

/**
 * RÉGLAGES.
 *
 * Regroupés par ce que le professionnel cherche, pas par table de base
 * de données : l'établissement, la file, l'avis Google, les horaires,
 * les prestations, et les données personnelles.
 *
 * Profils métier : la section « Métier de la file » (et « Messages »
 * pour un métier qui en envoie) n'apparaît que si elle a quelque chose à
 * dire : l'organisation a les profils activés (`features.profiles`), la
 * file est déjà dans un autre métier, ou un métier est ouvert à tous
 * (`OPEN_PROFILES`). Un barbier d'aujourd'hui ne voit donc RIEN de
 * nouveau : ses réglages restent identiques au pixel près (captures R0).
 *
 * Mise en page : un sommaire collant en rail à partir de 1200 px, une
 * liste « Aller à la section » en dessous. Les horaires passent par
 * TimeField (24 h, quelle que soit la langue) et gardent le format
 * 'HH:MM' envoyé à updateOpeningHours.
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
  /** Colonnes des profils (0033) : absentes d'une base d'avant, d'où le repli walkin. */
  profile?: string | null; profile_options?: unknown; ticket_prefix?: string | null;
}
interface OrgSettings {
  data_retention_days: number; show_people_ahead: boolean; allow_client_leave: boolean;
  send_completion_review: boolean; brand_accent: string; support_email: string | null;
  features?: Record<string, unknown> | null;
}
interface Service {
  id: string; name: string; duration_minutes: number | null; price_cents: number | null;
}

export function SettingsManager({
  orgSlug, organizationId, canManage, locations, currentLocation, settings,
  queues, selectedQueueId, hours, services,
  canConfigure = canManage, activity = null, staff = [], templateRows = [],
}: {
  orgSlug: string;
  organizationId: string;
  canManage: boolean;
  locations: Location[];
  currentLocation: Location | null;
  settings: OrgSettings | null;
  queues: Queue[];
  selectedQueueId: string | null;
  hours: { weekday: number; opens_at: string | null; closes_at: string | null; is_closed: boolean }[];
  services: Service[];
  /** Permission `queue.configure` (métier de la file, messages, guichets). */
  canConfigure?: boolean;
  /** Activité de l'organisation : elle seule fonde une suggestion de métier. */
  activity?: string | null;
  /** Fiches de l'établissement : une fiche = un guichet. */
  staff?: DeskStaff[];
  /** Surcharges des modèles de messages de l'organisation. */
  templateRows?: StoredTemplateRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // Un établissement peut avoir plusieurs files (comptoir et atelier,
  // par exemple) : on règle celle que l'on regarde, pas la première.
  const queue = queues.find((q) => q.id === selectedQueueId) ?? queues[0] ?? null;

  const features = settings?.features && typeof settings.features === 'object' ? settings.features : null;
  const profile: QueueProfile = queue && isQueueProfile(queue.profile) ? queue.profile : 'walkin';
  const openBeyondToday = [...OPEN_PROFILES].some((p) => !isLegacyProfile(p));
  const showProfile = queue !== null && (features?.profiles === true || !isLegacyProfile(profile) || openBeyondToday);
  const showTemplates = showProfile && !isLegacyProfile(profile) && profileAvailable(profile, features);
  // Une réparation dure plusieurs jours : jusqu'à 30 jours pour une file à
  // étapes. Les autres gardent exactement la liste d'avant.
  const ttlChoices = hasStages(profile)
    ? [1440, 2880, 4320, 10_080, 20_160, 43_200]
    : [60, 120, 180, 240, 360, 480, 720];
  if (queue && hasStages(profile) && !ttlChoices.includes(queue.entry_ttl_minutes)) {
    ttlChoices.push(queue.entry_ttl_minutes);
    ttlChoices.sort((a, b) => a - b);
  }

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

  const initialDays = () => WEEKDAYS.map((_, index) => {
    const existing = hours.find((h) => h.weekday === index);
    return {
      weekday: index,
      isClosed: existing?.is_closed ?? index === 6,
      opensAt: existing?.opens_at?.slice(0, 5) ?? '09:00',
      closesAt: existing?.closes_at?.slice(0, 5) ?? '19:00',
    };
  });
  const [days, setDays] = useState(initialDays);
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

  // « Enregistré » s'efface de lui-même : la barre collante ne reste
  // affichée que tant qu'il y a quelque chose à dire.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 3000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const patchPlace = (field: keyof typeof place, value: string) => {
    setPlace((p) => ({ ...p, [field]: value }));
    setPlaceDirty(true);
  };

  const patchDay = (index: number, patch: Partial<(typeof days)[number]>) => {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
    setHoursDirty(true);
  };

  /** Recopie les heures du lundi sur les autres jours. Changement LOCAL :
   *  la SaveBar des horaires enregistre (même appel qu'avant) ou rien ne
   *  part. Les jours fermés restent fermés ; leurs heures sont prêtes
   *  s'ils rouvrent. */
  const copyMonday = () => {
    setDays((prev) => {
      const monday = prev[0];
      if (!monday) return prev;
      return prev.map((d) => ({ ...d, opensAt: monday.opensAt, closesAt: monday.closesAt }));
    });
    setHoursDirty(true);
  };

  if (!currentLocation) {
    return (
      <div className="shell" style={{ paddingTop: 'var(--sp-5)' }}>
        <PageHeader title="Réglages" description="Créez d’abord un établissement." />
      </div>
    );
  }

  const toc: TocEntry[] = [
    { id: 'etablissement', label: 'Établissement' },
    { id: 'avis-google', label: 'Avis Google' },
    ...(showProfile ? [{ id: 'metier', label: 'Métier de la file' }] : []),
    ...(queue ? [{ id: 'file', label: 'Fonctionnement de la file' }] : []),
    ...(showTemplates ? [{ id: 'messages', label: 'Messages' }] : []),
    { id: 'horaires', label: 'Horaires' },
    { id: 'prestations', label: 'Prestations' },
    { id: 'donnees', label: 'Données personnelles' },
    ...(canManage ? [{ id: 'etablissements', label: 'Établissements' }] : []),
  ];

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

      <div className={styles.layout}>
        <aside className={styles.aside}>
          <SettingsTocRail entries={toc} />
        </aside>

        <div className={styles.content}>
          <SettingsTocSelect entries={toc} />

          {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

          {/* ---------------- Établissement ---------------- */}
          <div id="etablissement" className={styles.anchor}>
            <Section title="Établissement" description="Ce que voient vos clients quand ils scannent.">
              <SettingRow label="Nom" hint="Affiché en haut de l’écran client.">
                <input className="input" value={place.name} disabled={!canManage} aria-label="Nom"
                  onChange={(e) => patchPlace('name', e.target.value)} />
              </SettingRow>
              <SettingRow label="Adresse">
                <input className="input" value={place.addressLine1} disabled={!canManage} aria-label="Adresse"
                  onChange={(e) => patchPlace('addressLine1', e.target.value)} />
              </SettingRow>
              <SettingRow label="Code postal et ville">
                <input className={`input ${styles.postal}`} value={place.postalCode} inputMode="numeric"
                  aria-label="Code postal" disabled={!canManage}
                  onChange={(e) => patchPlace('postalCode', e.target.value)} />
                <input className="input" value={place.city} disabled={!canManage} aria-label="Ville"
                  onChange={(e) => patchPlace('city', e.target.value)} />
              </SettingRow>
              <SettingRow label="Téléphone" hint="Le client peut vous appeler depuis son écran.">
                <input className="input" type="tel" value={place.phone} disabled={!canManage}
                  aria-label="Téléphone"
                  onChange={(e) => patchPlace('phone', e.target.value)} />
              </SettingRow>
              <SettingRow label="Lien d’itinéraire" hint="Facultatif. Sinon l’adresse est utilisée.">
                <input className="input" type="url" placeholder="https://maps.app.goo.gl/…"
                  aria-label="Lien d’itinéraire"
                  value={place.mapsUrl} disabled={!canManage}
                  onChange={(e) => patchPlace('mapsUrl', e.target.value)} />
              </SettingRow>
            </Section>
          </div>

          {/* ---------------- Avis Google ---------------- */}
          <div id="avis-google" className={styles.anchor}>
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
                  aria-label="Lien « Rédiger un avis »"
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
          </div>

          {/* ---------------- Métier de la file ---------------- */}
          {showProfile && queue && (
            <div id="metier" className={styles.anchor}>
              <ProfileSection
                orgSlug={orgSlug}
                queue={{
                  id: queue.id,
                  name: queue.name,
                  profile,
                  profile_options: queue.profile_options ?? {},
                  ticket_prefix: queue.ticket_prefix ?? 'A',
                }}
                activity={activity}
                features={features}
                canConfigure={canConfigure}
                staff={staff}
                run={run}
                pending={pending}
              />
            </div>
          )}

          {/* ---------------- File ---------------- */}
          {queue && (
            <div id="file" className={styles.anchor}>
              <Section
                title="Fonctionnement de la file"
                actions={queues.length > 1 ? (
                  <div className={`seg ${styles.queueTabs}`} role="group" aria-label="File à régler">
                    {queues.map((q) => (
                      <a
                        key={q.id}
                        href={`/app/${orgSlug}/reglages?lieu=${currentLocation.id}&file=${q.id}`}
                        aria-current={q.id === queue.id ? 'page' : undefined}
                      >
                        {q.name}
                      </a>
                    ))}
                  </div>
                ) : undefined}
              >
                <SettingRow label="Mode" hint="File commune, ou une file par professionnel.">
                  <select className="select" value={queue.mode} disabled={!canManage} aria-label="Mode"
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
                    aria-label="Après « Terminer »"
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
                  <ThresholdRang
                    value={queue.notify_ahead_threshold}
                    disabled={!canManage}
                    onChange={(n) => run(() => updateQueueSettings({
                      queueId: queue.id, notifyAheadThreshold: n,
                    }))}
                  />
                </SettingRow>

                <SettingRow
                  label="Client absent"
                  hint="Ce que fait le bouton « Absent » par défaut. Vous pourrez toujours choisir au cas par cas."
                >
                  <select className="select" value={queue.absent_policy} disabled={!canManage}
                    aria-label="Client absent"
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
                      aria-label="Reculer de"
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
                    aria-label="Expiration automatique"
                    onChange={(e) => run(() => updateQueueSettings({
                      queueId: queue.id, entryTtlMinutes: Number(e.target.value),
                    }))}>
                    {ttlChoices.map((n) => (
                      <option key={n} value={n}>{ttlLabel(n)}</option>
                    ))}
                  </select>
                </SettingRow>
              </Section>
            </div>
          )}

          {/* ---------------- Messages ---------------- */}
          {showTemplates && (
            <div id="messages" className={styles.anchor}>
              <TemplatesSection
                orgSlug={orgSlug}
                profile={profile}
                templates={mergeTemplates(profile, templateRows)}
                locationName={currentLocation.name}
                locationPhone={currentLocation.phone}
                canConfigure={canConfigure}
                run={run}
                pending={pending}
              />
            </div>
          )}

          {/* ---------------- Horaires ---------------- */}
          <div id="horaires" className={styles.anchor}>
            <Section
              title="Horaires"
              description="Indicatifs : la file s’ouvre et se ferme d’un geste."
              actions={canManage ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={copyMonday}>
                  Copier lundi sur toute la semaine
                </button>
              ) : undefined}
            >
              <div className={styles.hours}>
                {days.map((day, i) => {
                  const name = WEEKDAYS[day.weekday] ?? '';
                  const lower = name.toLowerCase();
                  return (
                    <div key={day.weekday} className={styles.day} data-closed={day.isClosed ? '1' : undefined}>
                      <span className={styles.dayName}>{name}</span>
                      <span className={styles.dayToggle}>
                        <Toggle
                          checked={!day.isClosed}
                          label={`Ouvert le ${lower}`}
                          disabled={!canManage}
                          onChange={(v) => patchDay(i, { isClosed: !v })}
                        />
                      </span>
                      <span className={styles.dayMain}>
                        {day.isClosed ? (
                          <span className={styles.closedChip}>Fermé</span>
                        ) : (
                          <>
                            <TimeField
                              value={day.opensAt}
                              disabled={!canManage}
                              aria-label={`Ouverture du ${lower}`}
                              onChange={(v) => patchDay(i, { opensAt: v })}
                            />
                            <span className={styles.dash} aria-hidden="true" />
                            <TimeField
                              value={day.closesAt}
                              disabled={!canManage}
                              aria-label={`Fermeture du ${lower}`}
                              onChange={(v) => patchDay(i, { closesAt: v })}
                            />
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              {canManage && (
                <p className={styles.hoursNote}>
                  La copie du lundi ne rouvre aucun jour fermé, et rien n’est enregistré avant
                  « Enregistrer », dans la barre en bas de l’écran.
                </p>
              )}
            </Section>
          </div>

          {/* ---------------- Prestations ---------------- */}
          <div id="prestations" className={styles.anchor}>
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
              {services.length === 0 && (
                <p className={styles.emptyLine}>
                  Aucune prestation. Le client rejoint la file sans rien choisir.
                </p>
              )}
              {canManage && (
                <div className={styles.addRow}>
                  <input className="input" placeholder="Nom de la prestation" value={newService.name}
                    aria-label="Nom de la prestation"
                    onChange={(e) => setNewService({ ...newService, name: e.target.value })} />
                  <input className="input" type="number" min={1} max={600} placeholder="Durée (min)"
                    aria-label="Durée en minutes"
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
          </div>

          {/* ---------------- Données personnelles ---------------- */}
          <div id="donnees" className={styles.anchor}>
            <Section
              title="Données personnelles"
              description="Nous collectons le strict minimum : aucun e-mail, aucun numéro de téléphone client."
            >
              <SettingRow
                label="Durée de conservation"
                hint="Au-delà, les prénoms sont effacés et les sessions supprimées. Seules des statistiques anonymes subsistent."
              >
                <select className="select" value={settings?.data_retention_days ?? 30} disabled={!canManage}
                  aria-label="Durée de conservation"
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
          </div>

          {/* ---------------- Établissements ---------------- */}
          {canManage && (
            <div id="etablissements" className={styles.anchor}>
              <Section title="Établissements" description="Chaque établissement a sa file, ses plaques et son lien d’avis.">
                {locations.map((l) => (
                  <SettingRow key={l.id} label={l.name} hint={l.city ?? undefined}>
                    {l.id === currentLocation.id ? (
                      <span className="chip chip--signal">Affiché</span>
                    ) : (
                      <a className="btn btn--ghost btn--sm" href={`/app/${orgSlug}/reglages?lieu=${l.id}`}>
                        Ouvrir
                      </a>
                    )}
                  </SettingRow>
                ))}
                <div className={styles.addRow}>
                  <NewLocationForm organizationId={organizationId} onDone={() => router.refresh()} />
                </div>
              </Section>
            </div>
          )}

          {/* Une seule barre, collante sur toute la page tant qu'un formulaire
              (établissement, avis Google, horaires) a des modifications. */}
          <div className={styles.saveDock}>
            <SaveBar
              dirty={placeDirty || hoursDirty} pending={pending} saved={saved} error={error}
              onReset={() => {
                if (placeDirty) {
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
                }
                if (hoursDirty) {
                  setDays(initialDays());
                  setHoursDirty(false);
                }
              }}
              onSave={() => run(async () => {
                if (placeDirty) {
                  const result = await updateLocation({
                    organizationId, locationId: currentLocation.id,
                    name: place.name.trim(),
                    addressLine1: place.addressLine1.trim() || null,
                    postalCode: place.postalCode.trim() || null,
                    city: place.city.trim() || null,
                    phone: place.phone.trim() || null,
                    mapsUrl: place.mapsUrl.trim() || null,
                    googleReviewUrl: place.googleReviewUrl.trim() || null,
                  });
                  if (!result.ok) return result;
                  setPlaceDirty(false);
                }
                if (hoursDirty) {
                  const result = await updateOpeningHours({
                    organizationId, locationId: currentLocation.id, days,
                  });
                  if (!result.ok) return result;
                  setHoursDirty(false);
                }
                return { ok: true };
              })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** « 4 h » (la forme d'avant, inchangée), « 7 jours » au-delà de 24 h. */
function ttlLabel(minutes: number): string {
  if (minutes < 1440 || minutes % 1440 !== 0) return `${Math.round((minutes / 60) * 10) / 10} h`.replace('.', ',');
  const days = minutes / 1440;
  return `${days} jour${days > 1 ? 's' : ''}`;
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
        aria-label="Nom du nouvel établissement"
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
