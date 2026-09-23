'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adminEventAction } from '@/server/actions/admin';
import { adminUpdateEventCampaign } from '@/server/actions/admin-v2';
import { ImageUploadField } from '../ImageUploadField';
import styles from '../admin.module.css';
import v2 from '../admin-v2.module.css';

type Row = {
  id: string;
  name: string;
  status: string;
  waveSize: number;
  passValidMinutes: number;
  graceMinutes: number;
  publicNote: string | null;
  heroTitle: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  accentHex: string;
  rulesText: string | null;
  qrLabel: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  organizationId: string;
  locationId: string;
  queueId: string;
  organizationName: string;
  organizationSlug: string;
  locationName: string;
  city: string | null;
  issued: number;
  redeemed: number;
  expired: number;
  revoked: number;
};

export function AdminEventsTable({ events }: { events: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const act = (
    eventId: string,
    action: 'start' | 'pause' | 'resume' | 'wave' | 'sold_out' | 'end',
    count?: number,
  ) => {
    if ((action === 'sold_out' || action === 'end') && !window.confirm(
      action === 'sold_out'
        ? 'Confirmer STOCK ÉPUISÉ ? Tous les accès non utilisés seront révoqués.'
        : 'Confirmer la fin définitive de cet événement ?',
    )) return;

    setBusy(eventId);
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await adminEventAction({ eventId, action, count });
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const bits = [];
      if (result.data.issued != null) bits.push(result.data.issued + ' accès');
      if (result.data.notifications != null) bits.push(result.data.notifications + ' notifications');
      setNotice(bits.length ? bits.join(' · ') : 'Action effectuée.');
      router.refresh();
    });
  };

  return (
    <>
      {error && <div className="banner banner--error"><span>{error}</span></div>}
      {notice && <div className="banner"><span>{notice}</span></div>}

      <div className={styles.eventAdminGrid}>
        {events.map((event) => (
          <article
            className={styles.eventAdminCard}
            key={event.id}
            style={{ borderColor: event.accentHex || undefined }}
          >
            {event.coverUrl && (
              <div
                className={v2.eventCardCover}
                style={{ backgroundImage: 'url(' + JSON.stringify(event.coverUrl) + ')' }}
              />
            )}

            <div className={styles.eventAdminTop}>
              <div className={v2.eventCardIdentity}>
                <div className={v2.eventCardLogo}>
                  {event.logoUrl
                    ? <img src={event.logoUrl} alt="" />
                    : <span style={{ color: event.accentHex }}>R</span>}
                </div>
                <div>
                  <span className={[styles.statusDot, styles['event_' + event.status] ?? ''].join(' ')} />
                  <span className={styles.eventState}>{event.status.replace('_', ' ')}</span>
                  <h2>{event.name}</h2>
                  <p>
                    {event.organizationName} · {event.locationName}
                    {event.city ? ' · ' + event.city : ''}
                  </p>
                </div>
              </div>

              <div className={v2.detailToolbar}>
                {!['sold_out', 'ended'].includes(event.status) && (
                  <button type="button" className="btn btn--ghost btn--sm"
                    onClick={() => setEditing((current) => current === event.id ? null : event.id)}>
                    {editing === event.id ? 'Fermer' : 'Configurer'}
                  </button>
                )}
                <Link className="btn btn--ghost btn--sm"
                  href={'/ecran/' + event.organizationSlug + '?file=' + encodeURIComponent(event.queueId)}
                  target="_blank">
                  Écran
                </Link>
                <Link className="btn btn--ghost btn--sm"
                  href={'/admin/etablissements/' + event.organizationId}>
                  Organisation
                </Link>
              </div>
            </div>

            <div className={styles.eventAdminMetrics}>
              <div><strong>{event.issued}</strong><span>accès actifs</span></div>
              <div><strong>{event.redeemed}</strong><span>entrés</span></div>
              <div><strong>{event.expired}</strong><span>expirés</span></div>
              <div><strong>{event.revoked}</strong><span>révoqués</span></div>
            </div>

            <div className={styles.eventAdminRules}>
              <span>Vague {event.waveSize}</span>
              <span>Pass {event.passValidMinutes} min</span>
              <span>Grâce {event.graceMinutes} min</span>
              {event.heroTitle && <span>Hero personnalisé</span>}
              {event.logoUrl && <span>Logo Event</span>}
              {event.publicNote && <span>Message public</span>}
            </div>

            {editing === event.id && (
              <EventConfig
                event={event}
                onSaved={(message) => {
                  setEditing(null);
                  setNotice(message);
                  router.refresh();
                }}
                onError={setError}
              />
            )}

            <div className={styles.eventAdminActions}>
              {event.status === 'draft' && (
                <button className="btn btn--signal btn--sm" disabled={busy === event.id}
                  onClick={() => act(event.id, 'start')}>Démarrer</button>
              )}

              {event.status === 'live' && (
                <>
                  <button className="btn btn--signal btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'wave', event.waveSize)}>Appeler {event.waveSize}</button>
                  <button className="btn btn--ghost btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'wave', 20)}>+20</button>
                  <button className="btn btn--ghost btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'pause')}>Pause</button>
                </>
              )}

              {event.status === 'paused' && (
                <button className="btn btn--signal btn--sm" disabled={busy === event.id}
                  onClick={() => act(event.id, 'resume')}>Reprendre</button>
              )}

              {['live', 'paused'].includes(event.status) && (
                <>
                  <button className="btn btn--danger btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'sold_out')}>Stock épuisé</button>
                  <button className="btn btn--quiet btn--sm" disabled={busy === event.id}
                    onClick={() => act(event.id, 'end')}>Terminer</button>
                </>
              )}
            </div>
          </article>
        ))}

        {events.length === 0 && (
          <div className={styles.adminCard}>
            <p className="t-muted">Aucun événement ne correspond aux filtres.</p>
          </div>
        )}
      </div>
    </>
  );
}

function EventConfig({
  event,
  onSaved,
  onError,
}: {
  event: Row;
  onSaved: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState(event.name);
  const [heroTitle, setHeroTitle] = useState(event.heroTitle ?? '');
  const [logoUrl, setLogoUrl] = useState(event.logoUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(event.coverUrl ?? '');
  const [accentHex, setAccentHex] = useState(event.accentHex || '#FF4B1F');
  const [rulesText, setRulesText] = useState(event.rulesText ?? '');
  const [qrLabel, setQrLabel] = useState(event.qrLabel ?? 'Scannez pour rejoindre la file');
  const [waveSize, setWaveSize] = useState(event.waveSize);
  const [passValidMinutes, setPassValidMinutes] = useState(event.passValidMinutes);
  const [graceMinutes, setGraceMinutes] = useState(event.graceMinutes);
  const [publicNote, setPublicNote] = useState(event.publicNote ?? '');
  const [pending, startTransition] = useTransition();

  const save = () => {
    onError(null);
    startTransition(async () => {
      const result = await adminUpdateEventCampaign({
        eventId: event.id,
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
      });

      if (!result.ok) {
        onError(result.error);
        return;
      }

      onSaved('Configuration et identité visuelle enregistrées.');
    });
  };

  return (
    <div className={v2.eventEdit}>
      <div className={v2.eventEditGrid}>
        <label className={['field', v2.eventEditWide].join(' ')}>
          <span>Nom</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>

        <label className={['field', v2.eventEditWide].join(' ')}>
          <span>Titre d’accueil / écran</span>
          <input className="input" value={heroTitle}
            onChange={(e) => setHeroTitle(e.target.value)} maxLength={140} />
        </label>

        <div className={v2.eventEditWide}>
          <ImageUploadField label="Logo de l’événement" value={logoUrl}
            purpose="event-logo" onChange={setLogoUrl} compact />
        </div>

        <div className={v2.eventEditWide}>
          <ImageUploadField label="Affiche / couverture" value={coverUrl}
            purpose="event-cover" onChange={setCoverUrl} compact />
        </div>

        <label className="field">
          <span>Couleur</span>
          <div className="row g2">
            <input type="color" value={accentHex}
              onChange={(e) => setAccentHex(e.target.value.toUpperCase())}
              style={{ width: 52, minHeight: 42, padding: 4, borderRadius: 10 }} />
            <input className="input" value={accentHex}
              onChange={(e) => setAccentHex(e.target.value.toUpperCase())} maxLength={7} />
          </div>
        </label>

        <label className="field">
          <span>Taille de vague</span>
          <input className="input" type="number" min={1} max={200}
            value={waveSize} onChange={(e) => setWaveSize(Number(e.target.value))} />
        </label>

        <label className="field">
          <span>Validité pass</span>
          <input className="input" type="number" min={1} max={120}
            value={passValidMinutes} onChange={(e) => setPassValidMinutes(Number(e.target.value))} />
        </label>

        <label className="field">
          <span>Grâce</span>
          <input className="input" type="number" min={0} max={60}
            value={graceMinutes} onChange={(e) => setGraceMinutes(Number(e.target.value))} />
        </label>

        <label className={['field', v2.eventEditWide].join(' ')}>
          <span>Texte QR</span>
          <input className="input" value={qrLabel}
            onChange={(e) => setQrLabel(e.target.value)} maxLength={120} />
        </label>

        <label className={['field', v2.eventEditWide].join(' ')}>
          <span>Règles / consignes</span>
          <textarea className="input" style={{ minHeight: 100, resize: 'vertical' }}
            value={rulesText} onChange={(e) => setRulesText(e.target.value)} maxLength={2400} />
        </label>

        <label className={['field', v2.eventEditWide].join(' ')}>
          <span>Message public</span>
          <textarea className="input" style={{ minHeight: 80, resize: 'vertical' }}
            value={publicNote} onChange={(e) => setPublicNote(e.target.value)} maxLength={500} />
        </label>
      </div>

      <div className={v2.eventPreview}
        style={{
          borderColor: accentHex,
          backgroundImage: coverUrl
            ? `linear-gradient(120deg, rgba(7,9,13,.92), rgba(7,9,13,.72)), url(${JSON.stringify(coverUrl)})`
            : undefined,
        }}>
        <div className={v2.eventPreviewLogo}>
          {logoUrl ? <img src={logoUrl} alt="" /> : <span>R</span>}
        </div>
        <div>
          <span style={{ color: accentHex }}>APERÇU</span>
          <h3>{heroTitle || name}</h3>
          <p>{rulesText || qrLabel}</p>
        </div>
      </div>

      <div className={v2.eventEditActions}>
        <img
          src={'/api/event/qr?event=' + encodeURIComponent(event.id)}
          alt="QR événement"
          style={{ width: 74, height: 74, borderRadius: 10, background: '#fff', padding: 5, marginRight: 'auto' }}
        />
        <button className="btn btn--solid btn--sm" type="button"
          disabled={pending || name.trim().length < 2 || !/^#[0-9A-Fa-f]{6}$/.test(accentHex)}
          onClick={save}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
