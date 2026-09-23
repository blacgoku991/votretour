'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminCreateDisplayPairCode,
  adminRevokeDisplayDevice,
  adminUpdateDisplayDevice,
} from '@/server/actions/admin-v2';
import styles from '../../admin-v2.module.css';

type QueueOption = {
  id: string;
  name: string;
  locationId: string;
};

type LocationOption = {
  id: string;
  name: string;
  queues: QueueOption[];
};

type EventOption = {
  id: string;
  name: string;
  status: string;
  locationId: string;
  queueId: string;
};

type DeviceRow = {
  id: string;
  name: string;
  status: string;
  locationId: string;
  locationName: string;
  queueId: string;
  queueName: string;
  eventId: string | null;
  eventName: string | null;
  pairedAt: string;
  lastSeenAt: string | null;
};

export function OrganizationDisplayManager({
  organizationId,
  locations,
  events,
  devices,
}: {
  organizationId: string;
  locations: LocationOption[];
  events: EventOption[];
  devices: DeviceRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const location = useMemo(
    () => locations.find((item) => item.id === locationId) ?? locations[0] ?? null,
    [locationId, locations],
  );
  const [queueId, setQueueId] = useState(location?.queues[0]?.id ?? '');
  const [eventId, setEventId] = useState('');
  const [displayName, setDisplayName] = useState('Écran accueil');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const availableEvents = events.filter((event) => (
    event.locationId === location?.id
    && event.queueId === queueId
    && !['sold_out', 'ended'].includes(event.status)
  ));

  const chooseLocation = (id: string) => {
    setLocationId(id);
    const next = locations.find((item) => item.id === id);
    setQueueId(next?.queues[0]?.id ?? '');
    setEventId('');
    setPairing(null);
  };

  const generate = () => {
    if (!locationId || !queueId) return;
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
    });
  };

  const revoke = (deviceId: string) => {
    if (!window.confirm('Révoquer cet écran ? Il devra être appairé à nouveau.')) return;

    setError(null);
    startTransition(async () => {
      const result = await adminRevokeDisplayDevice(deviceId);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setNotice('Écran révoqué.');
      router.refresh();
    });
  };

  return (
    <div className={styles.configShell}>
      <section className={styles.configSection}>
        <div className={styles.configSectionHeader}>
          <div>
            <h3>Appairer une TV ou un écran</h3>
            <p>
              Ouvre rangvia.com/tv sur l’écran, puis saisis le code à six chiffres.
              Une fois associé, l’écran se reconnecte automatiquement.
            </p>
          </div>
        </div>

        <div className={styles.formGrid}>
          <label className="field">
            <span>Établissement</span>
            <select className="select" value={location?.id ?? ''}
              onChange={(e) => chooseLocation(e.target.value)}>
              {locations.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>File affichée</span>
            <select className="select" value={queueId}
              onChange={(e) => {
                setQueueId(e.target.value);
                setEventId('');
                setPairing(null);
              }}>
              {(location?.queues ?? []).map((queue) => (
                <option key={queue.id} value={queue.id}>{queue.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Événement lié</span>
            <select className="select" value={eventId}
              onChange={(e) => setEventId(e.target.value)}>
              <option value="">Aucun · écran file classique</option>
              {availableEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} · {event.status}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Nom de l’écran</span>
            <input className="input" value={displayName}
              onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
          </label>
        </div>

        <div className={styles.creatorActions}>
          <span className={styles.creatorHint}>
            Le code expire après 10 minutes et n’est utilisable qu’une fois.
          </span>
          <button className="btn btn--signal" type="button"
            disabled={pending || !locationId || !queueId || !displayName.trim()}
            onClick={generate}>
            {pending ? 'Génération…' : 'Générer un code'}
          </button>
        </div>

        {pairing && (
          <div className={styles.pairingBox}>
            <div className="row between g4 wrap">
              <div>
                <span className={styles.eyebrow}>CODE D’APPAIRAGE</span>
                <div className={styles.pairingCode}>{pairing.code}</div>
                <div className={styles.pairingMeta}>
                  Valable jusqu’à {new Date(pairing.expiresAt).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              <img
                src={'/api/admin/tv/pair-qr?code=' + pairing.code}
                alt="QR d’appairage de l’écran"
                style={{ width: 150, height: 150, background: '#fff', padding: 8, borderRadius: 18 }}
              />
            </div>
            <p className={styles.pairingMeta}>
              Sur une TV : ouvre <strong>rangvia.com/tv</strong> et saisis le code.
              Sur un appareil avec caméra, le QR ouvre directement la page avec le code prérempli.
            </p>
          </div>
        )}
      </section>

      <section className={styles.configSection}>
        <div className={styles.configSectionHeader}>
          <div>
            <h3>Écrans déjà appairés</h3>
            <p>{devices.filter((device) => device.status === 'active').length} écran(s) actif(s).</p>
          </div>
        </div>

        <div className={styles.deviceGrid}>
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              queues={locations.find((item) => item.id === device.locationId)?.queues ?? []}
              events={events}
              disabled={pending}
              onSaved={() => {
                setNotice('Écran mis à jour.');
                router.refresh();
              }}
              onError={setError}
              onRevoke={() => revoke(device.id)}
            />
          ))}

          {devices.length === 0 && (
            <div className="banner"><span>Aucun écran n’est encore appairé.</span></div>
          )}
        </div>
      </section>

      {error && <p className="error-text">{error}</p>}
      {notice && <div className="banner"><span>{notice}</span></div>}
    </div>
  );
}

function DeviceCard({
  device,
  queues,
  events,
  disabled,
  onSaved,
  onError,
  onRevoke,
}: {
  device: DeviceRow;
  queues: QueueOption[];
  events: EventOption[];
  disabled: boolean;
  onSaved: () => void;
  onError: (message: string | null) => void;
  onRevoke: () => void;
}) {
  const [name, setName] = useState(device.name);
  const [queueId, setQueueId] = useState(device.queueId);
  const [eventId, setEventId] = useState(device.eventId ?? '');
  const [pending, startTransition] = useTransition();

  const eventOptions = events.filter((event) => (
    event.locationId === device.locationId
    && event.queueId === queueId
    && !['sold_out', 'ended'].includes(event.status)
  ));

  const save = () => {
    onError(null);
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

      onSaved();
    });
  };

  const online = device.status === 'active'
    && Boolean(device.lastSeenAt)
    && Date.now() - new Date(device.lastSeenAt ?? 0).getTime() < 2 * 60_000;

  return (
    <article className={styles.deviceCard}>
      <div className={styles.deviceCardHead}>
        <div>
          <strong>{device.name}</strong>
          <span>{device.locationName} · {device.queueName}</span>
          <span>
            Appairé {new Date(device.pairedAt).toLocaleDateString('fr-FR')}
            {device.lastSeenAt
              ? ' · vu ' + new Date(device.lastSeenAt).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
          </span>
        </div>
        <span className={online ? styles.deviceLive : ''}>
          {device.status === 'revoked' ? 'RÉVOQUÉ' : online ? '● LIVE' : 'HORS LIGNE'}
        </span>
      </div>

      {device.status === 'active' && (
        <>
          <label className="field">
            <span>Nom</span>
            <input className="input" value={name}
              onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>

          <label className="field">
            <span>File</span>
            <select className="select" value={queueId}
              onChange={(e) => {
                setQueueId(e.target.value);
                setEventId('');
              }}>
              {queues.map((queue) => (
                <option key={queue.id} value={queue.id}>{queue.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Mode Event</span>
            <select className="select" value={eventId}
              onChange={(e) => setEventId(e.target.value)}>
              <option value="">File classique</option>
              {eventOptions.map((event) => (
                <option key={event.id} value={event.id}>{event.name}</option>
              ))}
            </select>
          </label>

          <div className="row g2 wrap">
            <button className="btn btn--solid btn--sm" type="button"
              disabled={disabled || pending || !name.trim()} onClick={save}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button className="btn btn--danger btn--sm" type="button"
              disabled={disabled || pending} onClick={onRevoke}>
              Révoquer
            </button>
          </div>
        </>
      )}
    </article>
  );
}
