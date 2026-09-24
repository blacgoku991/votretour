import { defaultTemplates } from '@/lib/profiles/templates';
import type { QueueProfile } from '@/lib/profiles/types';

/**
 * Modèles de messages tels que le professionnel les voit dans Réglages :
 * ceux du code, dans leur ordre, chacun éventuellement retouché ou masqué,
 * puis ceux qu'il a ajoutés. Pur : lu par la page (serveur) et par la
 * section (client).
 *
 * Seules les surcharges de l'ORGANISATION (`location_id` nul) sont
 * gérées ici : c'est ce que Réglages écrit. Une surcharge propre à un
 * établissement, si elle existe, l'emporte à l'envoi
 * (`sendTemplateMessage`), comme partout ailleurs.
 */

export interface StoredTemplateRow {
  profile: string;
  key: string;
  label: string;
  body: string;
  is_active: boolean;
  location_id: string | null;
  sort_order: number;
}

export interface TemplateView {
  key: string;
  label: string;
  body: string;
  isActive: boolean;
  /** 'default' : texte du code ; 'edited' : texte du code retouché ; 'custom' : ajouté par le pro. */
  origin: 'default' | 'edited' | 'custom';
  /** Texte d'origine d'un modèle du code (pour « Rétablir »). */
  original: { label: string; body: string } | null;
}

export function mergeTemplates(profile: QueueProfile, rows: readonly StoredTemplateRow[]): TemplateView[] {
  const own = rows.filter((r) => r.profile === profile && r.location_id === null);
  const byKey = new Map(own.map((r) => [r.key, r]));
  const defaults = defaultTemplates(profile);
  const defaultKeys = new Set(defaults.map((t) => t.key));

  const fromCode: TemplateView[] = defaults.map((t) => {
    const row = byKey.get(t.key);
    if (!row) {
      return { key: t.key, label: t.label, body: t.body, isActive: true, origin: 'default', original: { label: t.label, body: t.body } };
    }
    const changed = row.label !== t.label || row.body !== t.body;
    return {
      key: t.key,
      label: row.label,
      body: row.body,
      isActive: row.is_active,
      origin: changed ? 'edited' : 'default',
      original: { label: t.label, body: t.body },
    };
  });

  const added: TemplateView[] = own
    .filter((r) => !defaultKeys.has(r.key))
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'fr'))
    .map((r) => ({ key: r.key, label: r.label, body: r.body, isActive: r.is_active, origin: 'custom', original: null }));

  return [...fromCode, ...added];
}
