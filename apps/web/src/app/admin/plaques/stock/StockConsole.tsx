'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminAssignStockPlate,
  adminCreatePlateBatch,
  adminFindStockPlate,
  adminReleaseStockPlate,
  adminSetStockPlateVoid,
  type StockLookup,
} from '@/server/actions/plate-stock';
import { formatSerial, formatStockCode } from '@/lib/plate-stock';
import adminStyles from '../../admin.module.css';
import styles from './stock.module.css';

export interface AssignTargets {
  organizations: { id: string; name: string; suspended: boolean }[];
  locations: { id: string; name: string; city: string | null; organizationId: string; active: boolean }[];
  queues: { id: string; name: string; locationId: string; isDefault: boolean }[];
  staff: { id: string; name: string; locationId: string }[];
}

const STATUS_LABEL: Record<StockLookup['status'], string> = {
  available: 'Disponible',
  assigned: 'Attribuée',
  void: 'Au rebut',
};
const STATUS_CHIP: Record<StockLookup['status'], string> = {
  available: 'chip chip--jade',
  assigned: 'chip chip--signal',
  void: 'chip',
};

export function StockConsole({ targets, initialQuery }: { targets: AssignTargets; initialQuery: string }) {
  return (
    <div className={styles.consoleGrid}>
      <AssignPanel targets={targets} initialQuery={initialQuery} />
      <BatchPanel />
    </div>
  );
}

/* ================================================================== */
/*  Retrouver et attribuer une plaque                                  */
/* ================================================================== */

function AssignPanel({ targets, initialQuery }: { targets: AssignTargets; initialQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [plate, setPlate] = useState<StockLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [pending, startTransition] = useTransition();

  const find = (value: string) => {
    setError(null);
    setNotice(null);
    setReassigning(false);
    startTransition(async () => {
      const result = await adminFindStockPlate({ query: value });
      if (!result.ok) { setPlate(null); setError(result.error); return; }
      setPlate(result.data);
    });
  };

  // Arrivée depuis le scan d'une plaque non attribuée : on l'ouvre directement.
  useEffect(() => {
    if (initialQuery) find(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const afterAction = (message: string, code: string) => {
    setNotice(message);
    // Une réattribution réussie referme son formulaire : on revient à la
    // fiche de la plaque, qui montre sa nouvelle société.
    setReassigning(false);
    router.refresh();
    startTransition(async () => {
      const result = await adminFindStockPlate({ query: code });
      if (result.ok) setPlate(result.data);
    });
  };

  const release = () => {
    if (!plate) return;
    if (!window.confirm(
      `Libérer la plaque ${formatStockCode(plate.code)} ? Elle quitte « ${plate.assignment?.organizationName ?? ''} » avec son historique de scans et retourne au stock. Son lien gravé ne change pas.`,
    )) return;
    setError(null);
    startTransition(async () => {
      const result = await adminReleaseStockPlate({ code: plate.code });
      if (!result.ok) { setError(result.error); return; }
      afterAction('Plaque libérée : elle est de nouveau disponible.', plate.code);
    });
  };

  const toggleVoid = (value: boolean) => {
    if (!plate) return;
    setError(null);
    startTransition(async () => {
      const result = await adminSetStockPlateVoid({ code: plate.code, void: value });
      if (!result.ok) { setError(result.error); return; }
      afterAction(value ? 'Plaque mise au rebut.' : 'Plaque remise en stock.', plate.code);
    });
  };

  return (
    <section className={adminStyles.adminCard}>
      <div className={adminStyles.adminCardHead}>
        <div>
          <span className={adminStyles.cardKicker}>ATTRIBUTION</span>
          <h2>Attribuer une plaque livrée</h2>
        </div>
      </div>

      <form
        className={styles.searchRow}
        onSubmit={(event) => { event.preventDefault(); if (query.trim()) find(query); }}
      >
        <label htmlFor="stock-query" className="sr-only">Code ou numéro de plaque</label>
        <input
          id="stock-query"
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="RV-XXXXX-XXXXX, n° 42, ou lien scanné"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
        />
        <button type="submit" className="btn btn--solid btn--sm" disabled={pending || !query.trim()}>
          Chercher
        </button>
      </form>
      <p className="t-micro t-faint">
        Astuce : connecté au super-admin, scannez une plaque livrée avec votre téléphone —
        elle s&apos;ouvre directement ici.
      </p>

      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}
      {notice && <div className="banner" role="status"><span>{notice}</span></div>}

      {plate && (
        <div className={styles.plateCard}>
          <div className={styles.plateIdentity}>
            <span className={styles.plateCode}>{formatStockCode(plate.code)}</span>
            <span className="t-micro t-faint">
              N° {formatSerial(plate.serial)} · lot « {plate.batchLabel} »
            </span>
          </div>
          <span className={STATUS_CHIP[plate.status]}>{STATUS_LABEL[plate.status]}</span>

          {plate.assignment && (
            <p className={styles.assignedTo}>
              En service chez <strong>{plate.assignment.organizationName}</strong>
              {' — '}{plate.assignment.locationName}
              <span className="t-micro t-faint"> · « {plate.assignment.label} »</span>
            </p>
          )}

          {plate.status === 'available' && (
            <AssignForm
              key={`assign-${plate.code}`}
              targets={targets}
              plate={plate}
              reassign={false}
              pending={pending}
              onDone={(message) => afterAction(message, plate.code)}
              onError={setError}
              runTransition={startTransition}
            />
          )}

          {plate.status === 'assigned' && !reassigning && (
            <div className={styles.cardActions}>
              <button type="button" className="btn btn--signal btn--sm" onClick={() => setReassigning(true)} disabled={pending}>
                Réattribuer à une autre société
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={release} disabled={pending}>
                Libérer (retour au stock)
              </button>
            </div>
          )}

          {plate.status === 'assigned' && reassigning && (
            <>
              <p className="t-small t-muted">
                La plaque quittera « {plate.assignment?.organizationName} » avec son historique de scans.
                Le lien gravé reste le même : il ouvrira la file de la nouvelle société.
              </p>
              <AssignForm
                key={`reassign-${plate.code}`}
                targets={targets}
                plate={plate}
                reassign
                pending={pending}
                onDone={(message) => afterAction(message, plate.code)}
                onError={setError}
                runTransition={startTransition}
                onCancel={() => setReassigning(false)}
              />
            </>
          )}

          {plate.status === 'available' && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => toggleVoid(true)} disabled={pending}>
              Mettre au rebut (perdue ou défectueuse)
            </button>
          )}
          {plate.status === 'void' && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => toggleVoid(false)} disabled={pending}>
              Remettre en stock
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AssignForm({
  targets, plate, reassign, pending, onDone, onError, runTransition, onCancel,
}: {
  targets: AssignTargets;
  plate: StockLookup;
  reassign: boolean;
  pending: boolean;
  onDone: (message: string) => void;
  onError: (message: string | null) => void;
  runTransition: (callback: () => Promise<void>) => void;
  onCancel?: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [queueId, setQueueId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [label, setLabel] = useState('');

  const organizations = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    // La société déjà choisie reste dans la liste : sinon le select
    // afficherait « Choisir » alors qu'un établissement est sélectionné.
    return targets.organizations.filter(
      (o) => !needle || o.id === organizationId || o.name.toLowerCase().includes(needle),
    );
  }, [filter, organizationId, targets.organizations]);
  const locations = targets.locations.filter((l) => l.organizationId === organizationId);
  const queues = targets.queues.filter((q) => q.locationId === locationId);
  const staff = targets.staff.filter((s) => s.locationId === locationId);

  // Un seul établissement : on le choisit pour l'administrateur.
  useEffect(() => {
    const only = targets.locations.filter((l) => l.organizationId === organizationId);
    setLocationId(only.length === 1 ? only[0]!.id : '');
    setQueueId('');
    setStaffId('');
  }, [organizationId, targets.locations]);

  const submit = () => {
    onError(null);
    runTransition(async () => {
      const result = await adminAssignStockPlate({
        code: plate.code,
        locationId,
        queueId: queueId || null,
        staffId: staffId || null,
        label: label || undefined,
        reassign,
      });
      if (!result.ok) { onError(result.error); return; }
      const org = targets.organizations.find((o) => o.id === result.data.organizationId);
      onDone(`${formatStockCode(plate.code)} ${reassign ? 'réattribuée' : 'attribuée'} à ${org?.name ?? 'la société'}. Le lien gravé ouvre maintenant sa file.`);
    });
  };

  return (
    <form
      className={styles.assignForm}
      onSubmit={(event) => { event.preventDefault(); if (locationId) submit(); }}
    >
      <div className="field">
        <label htmlFor={`org-filter-${plate.code}`}>Société</label>
        <input
          id={`org-filter-${plate.code}`}
          className="input"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filtrer par nom…"
          autoComplete="off"
        />
        <select
          className="select"
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
          aria-label="Société"
          required
        >
          <option value="">— Choisir une société ({organizations.length}) —</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}{o.suspended ? ' (suspendue)' : ''}</option>
          ))}
        </select>
      </div>

      {organizationId && (
        <div className="field">
          <label htmlFor={`loc-${plate.code}`}>Établissement</label>
          <select
            id={`loc-${plate.code}`}
            className="select"
            value={locationId}
            onChange={(event) => { setLocationId(event.target.value); setQueueId(''); setStaffId(''); }}
            required
          >
            <option value="">— Choisir —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}{l.city ? ` · ${l.city}` : ''}{l.active ? '' : ' (inactif)'}</option>
            ))}
          </select>
          {locations.length === 0 && <p className="hint">Cette société n&apos;a encore aucun établissement.</p>}
        </div>
      )}

      {locationId && (
        <div className={styles.twoCols}>
          <div className="field">
            <label htmlFor={`queue-${plate.code}`}>File</label>
            <select id={`queue-${plate.code}`} className="select" value={queueId} onChange={(event) => setQueueId(event.target.value)}>
              <option value="">File par défaut</option>
              {queues.map((q) => <option key={q.id} value={q.id}>{q.name}{q.isDefault ? ' (par défaut)' : ''}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`staff-${plate.code}`}>Professionnel dédié</label>
            <select id={`staff-${plate.code}`} className="select" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
              <option value="">Aucun</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {locationId && (
        <div className="field">
          <label htmlFor={`label-${plate.code}`}>Nom de la plaque</label>
          <input
            id={`label-${plate.code}`}
            className="input"
            value={label}
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={`Plaque n° ${plate.serial} — ex. « Comptoir », « Vitrine »`}
          />
        </div>
      )}

      <div className={styles.cardActions}>
        <button type="submit" className="btn btn--signal btn--sm" disabled={pending || !locationId}>
          {reassign ? 'Réattribuer à cette société' : 'Attribuer'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel} disabled={pending}>
            Annuler
          </button>
        )}
      </div>
    </form>
  );
}

/* ================================================================== */
/*  Générer un lot                                                     */
/* ================================================================== */

function BatchPanel() {
  const router = useRouter();
  const [label, setLabel] = useState('');
  // Gardé tel que tapé : un champ number contrôlé par un nombre ne peut
  // pas être vidé (React y réécrit « 0 », puis « 025 »).
  const [quantityInput, setQuantityInput] = useState('100');
  const quantity = /^\d{1,4}$/.test(quantityInput.trim()) ? Number(quantityInput.trim()) : NaN;
  const quantityValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000;
  const [kind, setKind] = useState<'both' | 'nfc' | 'qr'>('both');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (!quantityValid) { setError('Entre 1 et 1000 plaques par lot.'); return; }
    startTransition(async () => {
      const result = await adminCreatePlateBatch({ label, quantity, kind, note: note || undefined });
      if (!result.ok) { setError(result.error); return; }
      router.push(`/admin/plaques/stock/${result.data.batchId}`);
    });
  };

  return (
    <section className={adminStyles.adminCard}>
      <div className={adminStyles.adminCardHead}>
        <div>
          <span className={adminStyles.cardKicker}>FABRICANT</span>
          <h2>Générer un lot de liens</h2>
        </div>
      </div>

      <form className={styles.batchForm} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <div className="field">
          <label htmlFor="batch-label">Nom du lot</label>
          <input
            id="batch-label"
            className="input"
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="ex. Commande fabricant n° 1"
            required
          />
        </div>

        <div className={styles.twoCols}>
          <div className="field">
            <label htmlFor="batch-quantity">Nombre de plaques</label>
            <input
              id="batch-quantity"
              className="input"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              step={1}
              value={quantityInput}
              onChange={(event) => setQuantityInput(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="batch-kind">Support</label>
            <select id="batch-kind" className="select" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              <option value="both">NFC + QR</option>
              <option value="nfc">NFC seul</option>
              <option value="qr">QR seul</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="batch-note">Note pour vous (facultatif)</label>
          <input
            id="batch-note"
            className="input"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="ex. Fabricant X, gravure laser, livraison fin octobre"
          />
        </div>

        {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

        <button type="submit" className="btn btn--signal" disabled={pending || !label.trim() || !quantityValid}>
          {pending ? 'Génération…' : quantityValid ? `Générer ${quantity} ${quantity > 1 ? 'liens' : 'lien'}` : 'Générer les liens'}
        </button>

        <ol className={styles.steps}>
          <li>Téléchargez le <strong>CSV</strong> (ou la liste d&apos;URL) et envoyez-le au fabricant.</li>
          <li>Il grave chaque URL dans une puce NFC et imprime le QR correspondant, avec le code <strong>RV-…</strong> en petit.</li>
          <li>À la livraison, attribuez chaque plaque à une société — ici, ou en la scannant.</li>
        </ol>
      </form>
    </section>
  );
}
