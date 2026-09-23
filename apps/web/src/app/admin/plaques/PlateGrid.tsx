'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminUpdatePlate,
  adminRecordPlateProgrammed,
  adminCreatePlate,
  adminDeletePlate,
} from '@/server/actions/admin';
import { PlateWriter, type ProgrammedResult } from '@/components/PlateWriter';
import { Plaque } from '@/components/objects/Plaque';
import { useMounted } from '@/hooks/useMounted';
import { formatNumber, relativeTime } from '@/lib/format';
import styles from './plate-grid.module.css';

/**
 * Toutes les plaques de la plateforme, en vue visuelle.
 *
 * Une carte par plaque : son QR tel qu'il sera imprimé, à qui elle est,
 * ce qu'elle a déjà fait, et les gestes qu'on peut poser dessus. Le QR
 * est la vraie image servie par /api/p/{code} — pas une vignette
 * décorative : ce qu'on voit ici est ce que le client scanne.
 */

export interface AdminPlate {
  id: string; code: string; label: string; kind: 'nfc' | 'qr' | 'both';
  is_active: boolean; scan_count: number; last_scanned_at: string | null;
  programmed_at: string | null; programmed_count: number;
  nfc_serial: string | null; nfc_locked_at: string | null;
  order_status: string; order_reference: string | null; created_at: string;
  organization_id: string; location_id: string; queue_id: string | null;
}
interface Organization { id: string; name: string; slug: string; status: string }
interface Location { id: string; name: string; city: string | null; organization_id: string }
interface Queue { id: string; name: string; location_id: string }

interface Props {
  plates: AdminPlate[];
  siteUrl: string;
  organizations: Organization[];
  locations: Location[];
  queues: Queue[];
}

export function PlateGrid({ plates, siteUrl, organizations, locations, queues }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createOrg, setCreateOrg] = useState(organizations[0]?.id ?? '');
  const [createLocation, setCreateLocation] = useState('');
  const [createLabel, setCreateLabel] = useState('Plaque comptoir');
  const [createKind, setCreateKind] = useState<'nfc' | 'qr' | 'both'>('both');
  const [, startTransition] = useTransition();

  const createLocations = locations.filter((l) => l.organization_id === createOrg);
  const createQueues = queues.filter((q) => q.location_id === createLocation);

  const patch = (plateId: string, value: Record<string, unknown>) => {
    setError(null);
    setBusy(plateId);
    startTransition(async () => {
      const result = await adminUpdatePlate({ plateId, ...value });
      setBusy(null);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  };

  return (
    <>
      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

      <div className={styles.createCard}>
        <div>
          <p className={`t-label ${styles.createKicker}`}>NOUVELLE PLAQUE</p>
          <h2 className="t-section">Créer une plaque</h2>
          <p className="t-small t-muted">
            Le commerçant ne voit aucun réglage NFC/QR. Toute la création et la programmation restent ici.
          </p>
        </div>

        <form
          className={styles.createForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!createOrg || !createLocation || !createLabel.trim()) return;
            setError(null);
            setCreating(true);
            startTransition(async () => {
              const queueId = createQueues[0]?.id ?? null;
              const result = await adminCreatePlate({
                organizationId: createOrg,
                locationId: createLocation,
                label: createLabel.trim(),
                kind: createKind,
                queueId,
              });
              setCreating(false);
              if (!result.ok) { setError(result.error); return; }
              setCreateLabel('Plaque comptoir');
              router.refresh();
            });
          }}
        >
          <select
            className="select"
            value={createOrg}
            onChange={(e) => {
              setCreateOrg(e.target.value);
              setCreateLocation('');
            }}
            aria-label="Organisation"
          >
            <option value="">Organisation</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>

          <select
            className="select"
            value={createLocation}
            onChange={(e) => setCreateLocation(e.target.value)}
            aria-label="Établissement"
          >
            <option value="">Établissement</option>
            {createLocations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}{l.city ? ` · ${l.city}` : ''}</option>
            ))}
          </select>

          <input
            className="input"
            value={createLabel}
            onChange={(e) => setCreateLabel(e.target.value)}
            maxLength={60}
            placeholder="Nom de la plaque"
            aria-label="Nom de la plaque"
          />

          <select
            className="select"
            value={createKind}
            onChange={(e) => setCreateKind(e.target.value as 'nfc' | 'qr' | 'both')}
            aria-label="Type de support"
          >
            <option value="both">NFC + QR</option>
            <option value="nfc">NFC</option>
            <option value="qr">QR</option>
          </select>

          <button
            className="btn btn--signal"
            type="submit"
            disabled={creating || !createOrg || !createLocation || !createLabel.trim()}
          >
            {creating ? 'Création…' : 'Créer la plaque'}
          </button>
        </form>
      </div>

      <div className={styles.grid}>
        {plates.map((plate) => (
          <PlateCard
            key={plate.id}
            plate={plate}
            siteUrl={siteUrl}
            organization={organizations.find((o) => o.id === plate.organization_id) ?? null}
            location={locations.find((l) => l.id === plate.location_id) ?? null}
            queues={queues.filter((q) => q.location_id === plate.location_id)}
            busy={busy === plate.id}
            onPatch={patch}
            onDelete={(plateId) => {
              if (!window.confirm('Supprimer définitivement cette plaque ?')) return;
              setBusy(plateId);
              startTransition(async () => {
                const result = await adminDeletePlate({ plateId });
                setBusy(null);
                if (!result.ok) { setError(result.error); return; }
                router.refresh();
              });
            }}
            onRefresh={() => router.refresh()}
          />
        ))}
      </div>
    </>
  );
}

/* ================================================================== */

function PlateCard({
  plate, siteUrl, organization, location, queues, busy, onPatch, onDelete, onRefresh,
}: {
  plate: AdminPlate;
  siteUrl: string;
  organization: Organization | null;
  location: Location | null;
  queues: Queue[];
  busy: boolean;
  onPatch: (id: string, value: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}) {
  const mounted = useMounted();
  const url = `${siteUrl}/e/${plate.code}`;
  const [label, setLabel] = useState(plate.label);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  return (
    <article className={`${styles.card} ${plate.is_active ? '' : styles.cardOff}`}>
      <div className={styles.cardTop}>
        {/* La plaque telle qu'elle sera posée sur le comptoir : le QR est
            la vraie image servie par /api/p/{code}, celle que l'on scanne. */}
        <div className={styles.plaqueStage}>
          <Plaque
            pose="rest"
            interactive
            width={180}
            qr={
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/p/${plate.code}?format=svg`}
                alt={`QR code de la plaque ${plate.label}`}
                className={styles.qr}
                loading="lazy"
              />
            }
          />
        </div>

        <div className={styles.cardIdentity}>
          <input
            className={styles.labelInput}
            value={label}
            maxLength={60}
            disabled={busy}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              const next = label.trim();
              if (next && next !== plate.label) onPatch(plate.id, { label: next });
              else setLabel(plate.label);
            }}
            aria-label={`Nom de la plaque ${plate.label}`}
          />
          <p className={styles.owner}>
            {organization?.name ?? 'Organisation inconnue'}
            {organization?.status === 'suspended' && (
              <span className="chip chip--brique" style={{ marginLeft: 6 }}>Suspendue</span>
            )}
          </p>
          <p className="t-micro t-faint">
            {location?.name ?? '—'}{location?.city ? ` · ${location.city}` : ''}
          </p>
        </div>
      </div>

      {/* ---------------- État ---------------- */}
      <div className={styles.chips}>
        {plate.is_active
          ? <span className="chip chip--jade">Active</span>
          : <span className="chip chip--brique">Désactivée</span>}
        <span className="chip">{plate.kind === 'both' ? 'NFC + QR' : plate.kind.toUpperCase()}</span>
        {plate.nfc_locked_at
          ? <span className="chip chip--copper">Tag verrouillé</span>
          : plate.programmed_at
            ? <span className="chip chip--jade">Tag programmé</span>
            : <span className="chip chip--copper">Jamais programmée</span>}
        {plate.order_status !== 'none' && plate.order_reference && (
          <span className="chip chip--copper">Commande {plate.order_reference}</span>
        )}
      </div>

      {/* ---------------- Usage réel ---------------- */}
      <dl className={styles.stats}>
        <div>
          <dt className="t-micro t-faint">Scans</dt>
          <dd className="t-num">{formatNumber(plate.scan_count)}</dd>
        </div>
        <div>
          <dt className="t-micro t-faint">Dernier scan</dt>
          <dd>{mounted && plate.last_scanned_at ? relativeTime(plate.last_scanned_at) : 'jamais'}</dd>
        </div>
        <div>
          <dt className="t-micro t-faint">Écritures</dt>
          <dd className="t-num">{plate.programmed_count}</dd>
        </div>
      </dl>

      {plate.nfc_serial && (
        <p className="t-micro t-faint">
          Tag physique n° <code className={styles.serial}>{plate.nfc_serial}</code>
        </p>
      )}

      {/* ---------------- Lien ---------------- */}
      <div className={styles.urlRow}>
        <code className={styles.url} title={url}>/e/{plate.code}</code>
        <button type="button" className="btn btn--quiet btn--sm" onClick={copy}>
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>

      {/* ---------------- Gestes ---------------- */}
      <div className={styles.actions}>
        <PlateWriter
          compact
          url={url}
          plateLabel={plate.label}
          lockedAt={plate.nfc_locked_at}
          disabled={busy}
          onProgrammed={async (result: ProgrammedResult) => {
            await adminRecordPlateProgrammed({
              plateId: plate.id,
              writtenUrl: url,
              serialNumber: result.serialNumber,
              locked: result.locked,
              verified: result.verified,
            });
            onRefresh();
          }}
        />
        <button
          type="button"
          // Réversible : un contour neutre. Le rouge est réservé à « Supprimer ».
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => onPatch(plate.id, { isActive: !plate.is_active })}
        >
          {plate.is_active ? 'Désactiver' : 'Réactiver'}
        </button>
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Replier' : 'Modifier'}
        </button>
        <button
          type="button"
          className="btn btn--danger btn--sm"
          disabled={busy}
          onClick={() => onDelete(plate.id)}
        >
          Supprimer
        </button>
      </div>

      {open && (
        <div className={styles.editor}>
          <div className="field">
            <label htmlFor={`kind-${plate.id}`}>Support</label>
            <select
              id={`kind-${plate.id}`} className="select" value={plate.kind} disabled={busy}
              onChange={(e) => onPatch(plate.id, { kind: e.target.value })}
            >
              <option value="both">NFC + QR</option>
              <option value="nfc">NFC seul</option>
              <option value="qr">QR seul</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor={`queue-${plate.id}`}>File rattachée</label>
            <select
              id={`queue-${plate.id}`} className="select" value={plate.queue_id ?? ''} disabled={busy}
              onChange={(e) => onPatch(plate.id, { queueId: e.target.value || null })}
            >
              <option value="">File par défaut de l’établissement</option>
              {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
            <p className="hint">
              Seules les files de cet établissement sont proposées, et le serveur le
              revérifie avant d’enregistrer.
            </p>
          </div>

          <div className={styles.links}>
            <a className="btn btn--ghost btn--sm" href={url} target="_blank" rel="noreferrer">
              Ouvrir comme un client
            </a>
            <a className="btn btn--ghost btn--sm" href={`/api/p/${plate.code}?format=affiche`} target="_blank" rel="noreferrer">
              Affiche A5
            </a>
            <a className="btn btn--ghost btn--sm" href={`/api/p/${plate.code}?format=png&size=1200`} download>
              QR en PNG
            </a>
            {organization && (
              <a className="btn btn--quiet btn--sm" href={`/app/${organization.slug}/file`}>
                Ouvrir le tableau de bord
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
