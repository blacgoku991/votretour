'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updatePlan } from '@/server/actions/admin';
import { formatPrice } from '@/lib/format';
import styles from './plans.module.css';

interface Plan {
  id: string; code: string; name: string; tagline: string | null;
  price_month_cents: number; price_year_cents: number;
  stripe_price_id_month: string | null; stripe_price_id_year: string | null;
  max_locations: number; max_staff: number; max_plates: number; max_queues: number;
  history_days: number; is_active: boolean; is_public: boolean; currency: string;
}

export function PlanEditor({ plan }: { plan: Plan }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: plan.name,
    tagline: plan.tagline ?? '',
    priceMonth: String(plan.price_month_cents / 100),
    priceYear: String(plan.price_year_cents / 100),
    stripeMonth: plan.stripe_price_id_month ?? '',
    stripeYear: plan.stripe_price_id_year ?? '',
    maxLocations: String(plan.max_locations),
    maxStaff: String(plan.max_staff),
    maxPlates: String(plan.max_plates),
    maxQueues: String(plan.max_queues),
    historyDays: String(plan.history_days),
  });

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updatePlan({
        planId: plan.id,
        name: form.name.trim(),
        tagline: form.tagline.trim() || null,
        priceMonthCents: Math.round(Number(form.priceMonth) * 100),
        priceYearCents: Math.round(Number(form.priceYear) * 100),
        stripePriceIdMonth: form.stripeMonth.trim() || null,
        stripePriceIdYear: form.stripeYear.trim() || null,
        maxLocations: Number(form.maxLocations),
        maxStaff: Number(form.maxStaff),
        maxPlates: Number(form.maxPlates),
        maxQueues: Number(form.maxQueues),
        historyDays: Number(form.historyDays),
      });
      if (!result.ok) { setError(result.error); return; }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className={styles.plan}>
      <div className={styles.planHead}>
        <div className={styles.planTitle}>
          <p className={styles.planName}>{plan.name}</p>
          <p className="t-micro t-faint">
            {formatPrice(plan.price_month_cents, plan.currency)} / mois ·{' '}
            {plan.max_locations < 0 ? '∞' : plan.max_locations} lieux ·{' '}
            {plan.max_staff < 0 ? '∞' : plan.max_staff} pros ·{' '}
            {plan.max_plates < 0 ? '∞' : plan.max_plates} plaques
          </p>
        </div>
        <div className="row g2">
          {!plan.stripe_price_id_month && (
            <span className="chip chip--copper">Tarif Stripe manquant</span>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Fermer' : 'Modifier'}
          </button>
        </div>
      </div>

      {open && (
        <div className={styles.planForm}>
          {error && <p className="error-text">{error}</p>}
          <div className={styles.grid}>
            <Field label="Nom" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Accroche" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} />
            <Field label="Prix mensuel (€)" value={form.priceMonth} type="number"
              onChange={(v) => setForm({ ...form, priceMonth: v })} />
            <Field label="Prix annuel (€)" value={form.priceYear} type="number"
              onChange={(v) => setForm({ ...form, priceYear: v })} />
            <Field label="Stripe price (mois)" value={form.stripeMonth}
              onChange={(v) => setForm({ ...form, stripeMonth: v })} placeholder="price_…" />
            <Field label="Stripe price (an)" value={form.stripeYear}
              onChange={(v) => setForm({ ...form, stripeYear: v })} placeholder="price_…" />
            <Field label="Établissements" value={form.maxLocations} type="number"
              onChange={(v) => setForm({ ...form, maxLocations: v })} />
            <Field label="Professionnels" value={form.maxStaff} type="number"
              onChange={(v) => setForm({ ...form, maxStaff: v })} />
            <Field label="Plaques" value={form.maxPlates} type="number"
              onChange={(v) => setForm({ ...form, maxPlates: v })} />
            <Field label="Files" value={form.maxQueues} type="number"
              onChange={(v) => setForm({ ...form, maxQueues: v })} />
            <Field label="Historique (jours)" value={form.historyDays} type="number"
              onChange={(v) => setForm({ ...form, historyDays: v })} />
          </div>
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
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string; value: string; onChange: (value: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
