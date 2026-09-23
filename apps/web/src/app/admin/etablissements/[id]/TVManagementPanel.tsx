'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  adminCreateDisplayPairCode,
  adminRevokeDisplayDevice,
  adminUpdateDisplayDevice,
} from '@/server/actions/admin-v2';
import styles from '../../admin-v2.module.css';

type Location = {
  id: string;
  name: string;
  city: string | null;
};

type Queue = {
  id: string;
  name: string;
  locationId: string;
  status: string;
};

type EventOption = {
  id: string;
  name: string;
  status: string;
  locationId: string;
  queueId: string;
  accentHex: string;
};

type Device = {
  id: string;
  name: string;
  status: string;
  locationId: string;
  queueId: string;
  eventId: string | null;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export function TVManagementPanel({
  organizationId,
  organizationSlug,
  locations,
  queues,
  events,
  devices,
}: {
  organizationId: string;
  organizationSlug: string;
  locations: Location[];
  queues: Queue[];
  events: EventOption[];
  devices: Device[];
}) {
  const activeLocations = locations.filter((location) =>
    queues.some((queue) => queue.locationId === location.id),
  );
  const [locationId, setLocationId] = useState(activeLocations[0]?.id ?? '');
  const availableQueues = useMemo(
    () => queues.filter((queue) => queue.locationId === locationId),
    [queues, locationId],
  );
  const [queueId, setQueueId] = useState(availableQueues[0]?.id ?? '');
  const availableEvents = useMemo(
    () => events.filter((event) => event.queueId === queueId && !['ended', 'sold_out'].includes(event.status)),
    [events, queueId],
  );
  const [eventId, setEventId] = useState('');
  const [displayName, setDisplayName] = useState('Écran TV');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changeLocation = (id: string) => {
    setLocationId(id);
    const first = queues.find((queue) => queue.locationId === id);
    setQueueId(first?.id ?? '');
    setEventId('');
    setPairing(null);
  };

  const changeQueue = (id: string) => {
    setQueueId(id);
    setEventId('');
    setPairing(null);
  };

  const generate = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await adminCreateDisplayPairCode({
        organizationId,
        locationId,
        queueId,
        eventId: eventId || null,
        displayName,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setPairing(result.data);
      setNotice('Code généré. Il est valable 10 minutes et une seule fois.');
    });
  };

  return (
    <div className={styles.configShell}>
      <div className={styles.configSectionHeader}>
        <div>
          <h3>Écrans TV / Kiosques</h3>
          <p>
            Appaire une TV une seule fois. Elle restera connectée après redémarrage,
            sans compte administrateur ni menu du dashboard.
          </p>
        </div>
        <a className="btn btn--ghost btn--sm" href={'/ecran/' + organizationSlug} target="_blank">
          Aperçu admin
        </a>
      </div>

      <div className={styles.pairingBox}>
        <div className={styles.formGrid}>
          <label className="field">
            <span>Nom de l’écran</span>
            <input
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="TV accueil"
              maxLength={80}
            />
          </label>

          <label className="field">
            <span>Établissement</span>
            <select className="select" value={locationId} onChange={(event) => changeLocation(event.target.value)}>
              {activeLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}{location.city ? ' · ' + location.city : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>File affichée</span>
            <select className="select" value={queueId} onChange={(event) => changeQueue(event.target.value)}>
              {availableQueues.map((queue) => (
                <option key={queue.id} value={queue.id}>{queue.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Habillage Event</span>
            <select className="select" value={eventId} onChange={(event) => setEventId(event.target.value)}>
              <option value="">Aucun · écran classique</option>
              {availableEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} · {event.status}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.creatorActions}>
          <span className={styles.creatorHint}>
            Sur la TV, ouvre simplement <strong>rangvia.com/tv</strong>.
          </span>
          <button
            type="button"
            className="btn btn--signal"
            disabled={pending || !locationId || !queueId || !displayName.trim()}
            onClick={generate}
          >
            {pending ? 'Génération…' : 'Générer un code TV'}
          </button>
        </div>

        {pairing && (
          <div className={styles.pairingResult}>
            <div>
              <span className={styles.eyebrow}>CODE À SAISIR SUR LA TV</span>
              <div className={styles.pairingCode}>{pairing.code}</div>
              <div className={styles.pairingMeta}>
                Expire à {new Date(pairing.expiresAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <a
                className="btn btn--ghost btn--sm"
                href={'/tv?code=' + pairing.code}
                target="_blank"
                style={{ marginTop: 12 }}
              >
                Ouvrir le lien d’appairage
              </a>
            </div>
            <div className={styles.pairingQr}>
              <img
                src={'/api/tv/pairing-qr?code=' + encodeURIComponent(pairing.code)}
                alt="QR d’appairage TV"
              />
              <span>Scannez directement sur l’appareil à connecter</span>
            </div>
          </div>
        )}
      </div>

      {notice && <div className="banner"><span>{notice}</span></div>}
      {error && <p className="error-text">{error}</p>}

      <div className={styles.deviceGrid}>
        {devices.length === 0 ? (
          <div className={styles.deviceCard}>
            <div className={styles.deviceCardHead}>
              <div>
                <strong>Aucun écran appairé</strong>
                <span>Génère un code ci-dessus pour connecter la première TV.</span>
              </div>
            </div>
          </div>
        ) : devices.map((device) => (
          <DeviceCard
            key={device.id}
            device={device}
            queues={queues.filter((queue) => queue.locationId === device.locationId)}
            events={events}
            onError={setError}
            onNotice={setNotice}
          />
        ))}
      </div>
    </div>
  );
}

function DeviceCard({
  device,
  queues,
  events,
  onError,
  onNotice,
}: {
  device: Device;
  queues: Queue[];
  events: EventOption[];
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const [name, setName] = useState(device.name);
  const [queueId, setQueueId] = useState(device.queueId);
  const [eventId, setEventId] = useState(device.eventId ?? '');
  const [pending, startTransition] = useTransition();

  const compatibleEvents = events.filter((event) =>
    event.queueId === queueId && !['ended', 'sold_out'].includes(event.status),
  );

  const online = device.lastSeenAt
    ? Date.now() - new Date(device.lastSeenAt).getTime() < 2 * 60_000
    : false;

  const save = () => {
    onError(null);
    onNotice(null);
    startTransition(async () => {
      const result = await adminUpdateDisplayDevice({
        deviceId: device.id,
        name,
        queueId,
        eventId: eventId || null,
      });

      if (!result.ok) {
        onError(result.error);
        return;
      }

      onNotice('Configuration de l’écran enregistrée. La TV la récupérera automatiquement.');
    });
  };

  const revoke = () => {
    if (!window.confirm('Révoquer cet écran ? Il devra être appairé à nouveau.')) return;
    onError(null);
    onNotice(null);
    startTransition(async () => {
      const result = await adminRevokeDisplayDevice(device.id);
      if (!result.ok) {
        onError(result.error);
        return;
      }
      onNotice('Écran révoqué.');
      window.location.reload();
    });
  };

  return (
    <article className={styles.deviceCard} data-status={device.status}>
      <div className={styles.deviceCardHead}>
        <div>
          <strong>{device.name}</strong>
          <span>
            Appairé {new Date(device.pairedAt).toLocaleDateString('fr-FR')}
            {device.lastSeenAt
              ? ' · vu ' + new Date(device.lastSeenAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
              : ' · jamais connecté'}
          </span>
        </div>
        <span className={online ? styles.deviceLive : styles.deviceOffline}>
          {device.status === 'revoked' ? 'RÉVOQUÉ' : online ? '● EN LIGNE' : 'HORS LIGNE'}
        </span>
      </div>

      <label className="field">
        <span>Nom</span>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
      </label>

      <label className="field">
        <span>File</span>
        <select
          className="select"
          value={queueId}
          onChange={(event) => {
            setQueueId(event.target.value);
            setEventId('');
          }}
        >
          {queues.map((queue) => (
            <option key={queue.id} value={queue.id}>{queue.name}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Événement affiché</span>
        <select className="select" value={eventId} onChange={(event) => setEventId(event.target.value)}>
          <option value="">Aucun</option>
          {compatibleEvents.map((event) => (
            <option key={event.id} value={event.id}>{event.name}</option>
          ))}
        </select>
      </label>

      <div className="row g2 wrap">
        <button type="button" className="btn btn--solid btn--sm" disabled={pending || device.status === 'revoked'} onClick={save}>
          Enregistrer
        </button>
        <button type="button" className="btn btn--danger btn--sm" disabled={pending || device.status === 'revoked'} onClick={revoke}>
          Révoquer
        </button>
      </div>
    </article>
  );
}
