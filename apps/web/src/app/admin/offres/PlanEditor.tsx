'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updatePlan } from '@/server/actions/admin';
import { formatPrice } from '@/lib/format';
import styles from './plans.module.css';

export interface EditablePlan {
  id: string; code: string; name: string; tagline: string | null;
  price_month_cents: number; setup_fee_cents: number;
  stripe_price_id_month: string | null; stripe_price_id_setup: string | null;
  max_locations: number; max_staff: number; max_plates: number; max_queues: number;
  history_days: number; is_active: boolean; is_public: boolean; currency: string;
}

/**
 * « 59,90 » ou « 59.90 » → 5990 ; `null` si ce n'est pas un montant.
 * La virgule est acceptée : c'est elle qu'un super-admin français tape.
 */
export function eurosToCents(value: string): number | null {
  const normalized = value.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function centsToEuros(cents: number): string {
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2).replace('.', ',');
}

/** Un quota : entier ≥ -1 (-1 = illimité) ; `null` sinon. */
function quota(value: string): number | null {
  return /^-?\d+$/.test(value.trim()) && Number(value) >= -1 ? Number(value) : null;
}

/**
 * Éditeur d'une offre. Depuis 0043, une seule offre est vendue : prix
 * mensuel et frais d'installation, chacun avec son prix Stripe (mensuel
 * récurrent, installation PONCTUELLE). Sans prix Stripe d'installation, le
 * paiement est refusé côté serveur : la puce cuivre le signale ici avant
 * qu'un commerçant ne le découvre.
 */
export function PlanEditor({ plan, subscribers }: { plan: EditablePlan; subscribers: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: plan.name,
    tagline: plan.tagline ?? '',
    priceMonth: centsToEuros(plan.price_month_cents),
    setupFee: centsToEuros(plan.setup_fee_cents),
    stripeMonth: plan.stripe_price_id_month ?? '',
    stripeSetup: plan.stripe_price_id_setup ?? '',
    maxLocations: String(plan.max_locations),
    maxStaff: String(plan.max_staff),
    maxPlates: String(plan.max_plates),
    maxQueues: String(plan.max_queues),
    historyDays: String(plan.history_days),
  });

  const retired = !plan.is_active && !plan.is_public;
  const missingMonth = !plan.stripe_price_id_month;
  const missingSetup = plan.setup_fee_cents > 0 && !plan.stripe_price_id_setup;

  const save = () => {
    setError(null);
    const priceMonthCents = eurosToCents(form.priceMonth);
    const setupFeeCents = eurosToCents(form.setupFee);
    const quotas = [form.maxLocations, form.maxStaff, form.maxPlates, form.maxQueues].map(quota);
    const historyDays = Number(form.historyDays);
    if (priceMonthCents === null || setupFeeCents === null) {
      setError('Montant invalide : écrivez par exemple 59,90.');
      return;
    }
    if (quotas.some((q) => q === null) || !Number.isInteger(historyDays) || historyDays < 1) {
      setError('Quotas : un nombre entier, ou -1 pour illimité ; historique d’au moins 1 jour.');
      return;
    }
    startTransition(async () => {
      const result = await updatePlan({
        planId: plan.id,
        name: form.name.trim(),
        tagline: form.tagline.trim() || null,
        priceMonthCents,
        setupFeeCents,
        stripePriceIdMonth: form.stripeMonth.trim() || null,
        stripePriceIdSetup: form.stripeSetup.trim() || null,
        maxLocations: quotas[0]!,
        maxStaff: quotas[1]!,
        maxPlates: quotas[2]!,
        maxQueues: quotas[3]!,
        historyDays,
      });
      if (!result.ok) { setError(result.error); return; }
      setOpen(false);
      router.refresh();
    });
  };

  const q = (n: number) => (n < 0 ? '∞' : String(n));
  const formId = `offre-${plan.code}`;

  return (
    <div className={`${styles.plan} ${retired ? styles.retired : ''}`}>
      <div className={styles.planHead}>
        <div className={styles.planTitle}>
          <p className={styles.planName}>
            {plan.name}
            <span className={styles.planCode}>{plan.code}</span>
          </p>
          <p className={styles.planPrices}>
            <span className="t-num">{formatPrice(plan.price_month_cents, plan.currency)}</span> HT / mois
            {plan.setup_fee_cents > 0 && (
              <> · <span className="t-num">{formatPrice(plan.setup_fee_cents, plan.currency)}</span> HT d’installation, une fois</>
            )}
          </p>
          <p className="t-micro t-faint">
            {q(plan.max_locations)} lieux · {q(plan.max_staff)} pros · {q(plan.max_plates)} plaques ·{' '}
            {q(plan.max_queues)} files · {plan.history_days} j d’historique ·{' '}
            {subscribers} abonnement{subscribers > 1 ? 's' : ''}
          </p>
        </div>
        <div className={`row wrap g2 ${styles.planChips}`}>
          {retired ? (
            <span className="chip">Retirée · conservée pour l’historique</span>
          ) : (
            <span className="chip chip--jade">En vente</span>
          )}
          {!retired && missingMonth && <span className="chip chip--copper">Prix Stripe mensuel manquant</span>}
          {!retired && missingSetup && <span className="chip chip--copper">Prix Stripe d’installation manquant</span>}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            aria-expanded={open}
            aria-controls={formId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Fermer' : 'Modifier'}
          </button>
        </div>
      </div>

      {open && (
        <div id={formId} className={styles.planForm}>
          {error && <p className="error-text" role="alert">{error}</p>}
          <fieldset className={styles.group}>
            <legend className="t-label">Présentation</legend>
            <div className={styles.grid}>
              <Field label="Nom" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Accroche" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} />
            </div>
          </fieldset>
          <fieldset className={styles.group}>
            <legend className="t-label">Prix hors taxes</legend>
            <div className={styles.grid}>
              <Field label="Abonnement (€ HT / mois)" value={form.priceMonth} inputMode="decimal"
                onChange={(v) => setForm({ ...form, priceMonth: v })} placeholder="59,90" />
              <Field label="Stripe · prix mensuel" value={form.stripeMonth} hint="Prix récurrent, mensuel."
                onChange={(v) => setForm({ ...form, stripeMonth: v })} placeholder="price_…" />
              <Field label="Installation (€ HT)" value={form.setupFee} inputMode="decimal"
                onChange={(v) => setForm({ ...form, setupFee: v })} placeholder="149"
                hint="Une fois, au premier abonnement seulement. 0 = aucune." />
              <Field label="Stripe · prix d’installation" value={form.stripeSetup}
                onChange={(v) => setForm({ ...form, stripeSetup: v })} placeholder="price_…"
                hint={'Prix ponctuel. Obligatoire si l’installation n’est pas à 0\u00a0: sans lui, le paiement est refusé.'} />
            </div>
          </fieldset>
          <fieldset className={styles.group}>
            <legend className="t-label">Quotas · -1 = illimité</legend>
            <div className={styles.grid}>
              <Field label="Établissements" value={form.maxLocations} inputMode="numeric"
                onChange={(v) => setForm({ ...form, maxLocations: v })} />
              <Field label="Professionnels" value={form.maxStaff} inputMode="numeric"
                onChange={(v) => setForm({ ...form, maxStaff: v })} />
              <Field label="Plaques" value={form.maxPlates} inputMode="numeric"
                onChange={(v) => setForm({ ...form, maxPlates: v })} />
              <Field label="Files" value={form.maxQueues} inputMode="numeric"
                onChange={(v) => setForm({ ...form, maxQueues: v })} />
              <Field label="Historique (jours)" value={form.historyDays} inputMode="numeric"
                onChange={(v) => setForm({ ...form, historyDays: v })} />
            </div>
          </fieldset>
          <div className="row g2">
            <button type="button" className="btn btn--signal btn--sm" disabled={pending} onClick={save}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setOpen(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, hint, inputMode,
}: {
  label: string; value: string; onChange: (value: string) => void;
  placeholder?: string; hint?: string; inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" type="text" value={value} placeholder={placeholder} inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
