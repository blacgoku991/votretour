'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPlate, updatePlate, requestPhysicalPlates, recordPlateProgrammed } from '@/server/actions/plates';
import { PlateWriter, type ProgrammedResult } from '@/components/PlateWriter';
import { relativeTime, formatNumber } from '@/lib/format';
import { useMounted } from '@/hooks/useMounted';
import styles from './plates.module.css';

/**
 * PLAQUES & QR.
 *
 * Chaque plaque porte une URL unique /e/{code}. Le tag NFC et le QR code
 * encodent EXACTEMENT cette URL : approcher son téléphone ou scanner
 * ouvre la même expérience, au même endroit, pour le même établissement.
 *
 * Sur iPhone, cette même URL est aussi l'URL d'invocation de l'App Clip.
 * C'est elle qu'on déclare comme expérience App Clip avancée dans App
 * Store Connect, et elle qu'on renvoie dans target-content-id à chaque
 * notification : un seul App Clip, N commerces, sans mélange possible.
 */

interface Plate {
  id: string; code: string; label: string; kind: 'nfc' | 'qr' | 'both';
  is_active: boolean; queue_id: string | null; staff_id: string | null;
  location_id: string; scan_count: number; last_scanned_at: string | null;
  order_status: string; order_reference: string | null; created_at: string;
  programmed_at: string | null; programmed_count: number;
  nfc_serial: string | null; nfc_locked_at: string | null;
}
interface Location { id: string; name: string; city: string | null }
interface Queue { id: string; name: string; location_id: string }
interface Staff { id: string; display_name: string; location_id: string }

interface Props {
  orgSlug: string;
  organizationId: string;
  siteUrl: string;
  canManage: boolean;
  plates: Plate[];
  locations: Location[];
  queues: Queue[];
  staff: Staff[];
  quota: { used: number; limit: number; allowed: boolean } | null;
}

export function PlatesManager({
  orgSlug, organizationId, siteUrl, canManage, plates, locations, queues, staff, quota,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(plates[0]?.code ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = plates.find((p) => p.code === selected) ?? plates[0] ?? null;

  const create = (locationId: string, label: string) => {
    setError(null);
    startTransition(async () => {
      const result = await createPlate({ organizationId, locationId, label });
      if (!result.ok) { setError(result.error); return; }
      setSelected(result.data.code);
      router.refresh();
    });
  };

  const patch = (plateId: string, patchValue: Record<string, unknown>) => {
    setError(null);
    startTransition(async () => {
      const result = await updatePlate({ organizationId, plateId, ...patchValue });
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  };

  return (
    <div className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <div>
          <h1 className="t-title">Plaques &amp; QR</h1>
          <p className="t-small t-muted">
            Une plaque = un tag NFC + un QR code + une URL unique. Les deux ouvrent
            exactement la même page, pour le même établissement.
          </p>
        </div>
        {quota && quota.limit >= 0 && (
          <span className="chip">
            {quota.used} / {quota.limit} plaque{quota.limit > 1 ? 's' : ''}
          </span>
        )}
      </header>

      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

      <div className={styles.split}>
        {/* ---------------- Liste ---------------- */}
        <aside className={styles.list}>
          {plates.length === 0 && (
            <p className="t-small t-muted">Aucune plaque pour l&apos;instant.</p>
          )}
          {plates.map((plate) => {
            const location = locations.find((l) => l.id === plate.location_id);
            return (
              <button
                key={plate.id}
                type="button"
                className={`${styles.listItem} ${current?.id === plate.id ? styles.listItemActive : ''} ${plate.is_active ? '' : styles.listItemOff}`}
                onClick={() => setSelected(plate.code)}
              >
                <span className={styles.listMark} aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                    <rect x="2" y="2" width="6" height="6" rx="1.4" />
                    <rect x="12" y="2" width="6" height="6" rx="1.4" />
                    <rect x="2" y="12" width="6" height="6" rx="1.4" />
                    <rect x="12" y="12" width="2.6" height="2.6" rx="0.8" />
                    <rect x="15.4" y="15.4" width="2.6" height="2.6" rx="0.8" />
                  </svg>
                </span>
                <span className={styles.listText}>
                  <span className={styles.listLabel}>{plate.label}</span>
                  <span className="t-micro t-faint">
                    {location?.name ?? '—'} · {formatNumber(plate.scan_count)} scan{plate.scan_count > 1 ? 's' : ''}
                  </span>
                </span>
                {!plate.is_active
                  ? <span className="chip chip--brique">Inactive</span>
                  : !plate.programmed_at
                    ? <span className="chip chip--copper" title="Le tag NFC n'a pas encore été écrit.">À programmer</span>
                    : null}
              </button>
            );
          })}

          {canManage && <CreatePlate locations={locations} onCreate={create} pending={pending} />}
        </aside>

        {/* ---------------- Détail ---------------- */}
        {current ? (
          <PlateDetail
            key={current.id}
            plate={current}
            siteUrl={siteUrl}
            organizationId={organizationId}
            canManage={canManage}
            queues={queues.filter((q) => q.location_id === current.location_id)}
            staff={staff.filter((s) => s.location_id === current.location_id)}
            onPatch={patch}
            onRefresh={() => router.refresh()}
            pending={pending}
          />
        ) : (
          <div className={styles.detail}>
            <p className="t-body t-muted">
              Créez une première plaque pour obtenir son QR code et son URL NFC.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */

function PlateDetail({
  plate, siteUrl, organizationId, canManage, queues, staff, onPatch, onRefresh, pending,
}: {
  plate: Plate;
  siteUrl: string;
  organizationId: string;
  canManage: boolean;
  queues: Queue[];
  staff: Staff[];
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onRefresh: () => void;
  pending: boolean;
}) {
  const url = `${siteUrl}/e/${plate.code}`;
  const mounted = useMounted();
  const [copied, setCopied] = useState<'url' | 'nfc' | null>(null);
  const [label, setLabel] = useState(plate.label);
  const [showOrder, setShowOrder] = useState(false);

  const qrSrc = useMemo(() => `/api/p/${plate.code}?format=svg`, [plate.code]);

  const copy = async (value: string, key: 'url' | 'nfc') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className={styles.detail}>
      <div className={styles.detailHead}>
        {canManage ? (
          <input
            className={styles.labelInput}
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label.trim() && label !== plate.label && onPatch(plate.id, { label: label.trim() })}
            aria-label="Nom de la plaque"
          />
        ) : (
          <h2 className="t-section">{plate.label}</h2>
        )}
        <div className="row g2">
          <span className="chip">{plate.kind === 'both' ? 'NFC + QR' : plate.kind.toUpperCase()}</span>
          {plate.is_active
            ? <span className="chip chip--jade">Active</span>
            : <span className="chip chip--brique">Inactive</span>}
        </div>
      </div>

      {/* ---------------- Le QR ---------------- */}
      <div className={styles.qrBlock}>
        <div className={styles.qrFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc} alt={`QR code de la plaque ${plate.label}`} className={styles.qr} />
        </div>
        <div className={styles.qrSide}>
          <p className="t-label">URL de la plaque</p>
          <code className={styles.url}>{url}</code>
          <div className={styles.qrActions}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => copy(url, 'url')}>
              {copied === 'url' ? 'Copié' : 'Copier le lien'}
            </button>
            <a className="btn btn--ghost btn--sm" href={`/api/p/${plate.code}?format=png&size=1200`} download>
              QR en PNG
            </a>
            <a className="btn btn--ghost btn--sm" href={`/api/p/${plate.code}?format=svg`} download={`qr-${plate.code}.svg`}>
              QR en SVG
            </a>
            <a className="btn btn--solid btn--sm" href={`/api/p/${plate.code}?format=affiche`} target="_blank" rel="noreferrer">
              Affiche à imprimer
            </a>
            <a className="btn btn--signal btn--sm" href={url} target="_blank" rel="noreferrer">
              Tester comme un client
            </a>
          </div>
        </div>
      </div>

      {/* ---------------- Programmation NFC ---------------- */}
      <div className={styles.nfcCard}>
        <div className={styles.nfcHead}>
          <div>
            <p className="t-label">Programmer le tag NFC</p>
            <p className="t-small t-muted">
              Écrivez l&apos;adresse de la plaque directement depuis ce téléphone, puis
              relisez le tag pour vérifier. Un NTAG213 suffit.
            </p>
          </div>
          <PlateProgrammedBadge plate={plate} />
        </div>

        {canManage && (
          <PlateWriter
            url={url}
            plateLabel={plate.label}
            lockedAt={plate.nfc_locked_at}
            onProgrammed={async (result: ProgrammedResult) => {
              await recordPlateProgrammed({
                organizationId,
                plateId: plate.id,
                writtenUrl: url,
                serialNumber: result.serialNumber,
                locked: result.locked,
                verified: result.verified,
              });
              onRefresh();
            }}
          />
        )}

        <div className={styles.nfcUrl}>
          <code>{url}</code>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => copy(url, 'nfc')}>
            {copied === 'nfc' ? 'Copié' : 'Copier'}
          </button>
        </div>
        <p className="hint">
          L&apos;enregistrement écrit est de type <strong>URI</strong> : iPhone et Android
          ouvrent la page directement, sans application.
        </p>
      </div>

      {/* ---------------- Rattachement ---------------- */}
      {canManage && (
        <div className={styles.settings}>
          <div className="field">
            <label htmlFor={`queue-${plate.id}`}>File rattachée</label>
            <select
              id={`queue-${plate.id}`} className="select"
              value={plate.queue_id ?? ''}
              onChange={(e) => onPatch(plate.id, { queueId: e.target.value || null })}
              disabled={pending}
            >
              <option value="">File par défaut de l&apos;établissement</option>
              {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor={`staff-${plate.id}`}>Professionnel dédié</label>
            <select
              id={`staff-${plate.id}`} className="select"
              value={plate.staff_id ?? ''}
              onChange={(e) => onPatch(plate.id, { staffId: e.target.value || null })}
              disabled={pending}
            >
              <option value="">Aucun — le client choisit ou prend le suivant</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
            </select>
            <p className="hint">
              Utile pour une plaque posée au poste d&apos;un coiffeur précis : le client
              rejoint directement sa file.
            </p>
          </div>

          <div className="field">
            <label htmlFor={`kind-${plate.id}`}>Support</label>
            <select
              id={`kind-${plate.id}`} className="select" value={plate.kind}
              onChange={(e) => onPatch(plate.id, { kind: e.target.value })}
              disabled={pending}
            >
              <option value="both">NFC + QR</option>
              <option value="nfc">NFC seul</option>
              <option value="qr">QR seul</option>
            </select>
          </div>

          <div className={styles.dangerRow}>
            <div>
              <p className="t-small" style={{ fontVariationSettings: "'wght' 650" }}>
                {plate.is_active ? 'Désactiver cette plaque' : 'Réactiver cette plaque'}
              </p>
              <p className="t-micro t-faint">
                Une plaque désactivée n&apos;ouvre plus rien : le QR imprimé affiche un
                message d&apos;indisponibilité.
              </p>
            </div>
            <button
              type="button"
              className={plate.is_active ? 'btn btn--danger btn--sm' : 'btn btn--ghost btn--sm'}
              disabled={pending}
              onClick={() => onPatch(plate.id, { isActive: !plate.is_active })}
            >
              {plate.is_active ? 'Désactiver' : 'Réactiver'}
            </button>
          </div>
        </div>
      )}

      {/* ---------------- Statistiques et commande ---------------- */}
      <div className={styles.metaRow}>
        <span className="t-micro t-faint">
          {formatNumber(plate.scan_count)} scan{plate.scan_count > 1 ? 's' : ''}
          {mounted && plate.last_scanned_at ? ` · dernier ${relativeTime(plate.last_scanned_at)}` : ''}
        </span>
        {plate.order_status !== 'none' && plate.order_reference && (
          <span className="chip chip--copper">Commande {plate.order_reference}</span>
        )}
      </div>

      {canManage && (
        showOrder ? (
          <OrderForm
            organizationId={organizationId}
            plateId={plate.id}
            onDone={() => setShowOrder(false)}
          />
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => setShowOrder(true)}>
            Demander des plaques gravées
          </button>
        )
      )}
    </section>
  );
}

/* ================================================================== */

function CreatePlate({
  locations, onCreate, pending,
}: {
  locations: Location[];
  onCreate: (locationId: string, label: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');

  if (locations.length === 0) return null;

  if (!open) {
    return (
      <button type="button" className={`btn btn--ghost ${styles.addBtn}`} onClick={() => setOpen(true)}>
        + Nouvelle plaque
      </button>
    );
  }

  return (
    <form
      className={styles.createForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim() || !locationId) return;
        onCreate(locationId, label.trim());
        setLabel('');
        setOpen(false);
      }}
    >
      <input
        className="input" placeholder="Ex. Vitrine, Poste 2, Accueil"
        value={label} maxLength={60} autoFocus
        onChange={(e) => setLabel(e.target.value)}
        aria-label="Nom de la plaque"
      />
      {locations.length > 1 && (
        <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}
          aria-label="Établissement">
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      <div className="row g2">
        <button type="submit" className="btn btn--signal btn--sm" disabled={pending || !label.trim()}>
          Créer
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function OrderForm({
  organizationId, plateId, onDone,
}: { organizationId: string; plateId: string; onDone: () => void }) {
  const [form, setForm] = useState({
    name: '', line1: '', postalCode: '', city: '', quantity: 2,
  });
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (reference) {
    return (
      <div className="banner">
        <span>
          Demande enregistrée sous la référence <strong>{reference}</strong>.
          Nous revenons vers vous par e-mail avec un devis avant toute production.
        </span>
      </div>
    );
  }

  return (
    <form
      className={styles.orderForm}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await requestPhysicalPlates({
            organizationId, plateId, quantity: form.quantity,
            address: {
              name: form.name, line1: form.line1,
              postalCode: form.postalCode, city: form.city, country: 'FR',
            },
          });
          if (!result.ok) { setError(result.error); return; }
          setReference(result.data.reference);
        });
      }}
    >
      <p className="t-label">Plaques gravées</p>
      <p className="t-micro t-faint">
        Nous n&apos;expédions rien automatiquement : votre demande est transmise et
        vous recevez un devis avant toute production.
      </p>
      <div className={styles.orderGrid}>
        <input className="input" placeholder="Nom du destinataire" required
          value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" placeholder="Adresse" required
          value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} />
        <input className="input" placeholder="Code postal" required
          value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
        <input className="input" placeholder="Ville" required
          value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        <input className="input" type="number" min={1} max={500} placeholder="Quantité"
          value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="row g2">
        <button type="submit" className="btn btn--signal btn--sm" disabled={pending}>
          {pending ? 'Envoi…' : 'Envoyer la demande'}
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onDone}>Annuler</button>
      </div>
    </form>
  );
}

/* ================================================================== */

/** L'état de programmation du tag, dit sans détour. */
function PlateProgrammedBadge({ plate }: { plate: Plate }) {
  if (plate.nfc_locked_at) {
    return <span className="chip chip--copper">Tag verrouillé</span>;
  }
  if (!plate.programmed_at) {
    return <span className="chip chip--copper">Jamais programmée</span>;
  }
  return (
    <span className="chip chip--jade" title={plate.nfc_serial ? `Tag n° ${plate.nfc_serial}` : undefined}>
      Programmée{plate.programmed_count > 1 ? ` ×${plate.programmed_count}` : ''}
    </span>
  );
}
