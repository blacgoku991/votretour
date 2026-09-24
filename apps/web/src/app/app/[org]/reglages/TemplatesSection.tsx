'use client';

import { useId, useRef, useState } from 'react';
import { Section } from '@/components/Page';
import { getProfile } from '@/lib/profiles';
import { profileNotificationCopy } from '@/lib/profiles/copy';
import {
  renderTemplate,
  TEMPLATE_LABEL_MAX,
  TEMPLATE_MAX_LENGTH,
  validateTemplateBody,
  TEMPLATE_VARIABLES,
  variablesFor,
} from '@/lib/profiles/templates';
import type { QueueProfile } from '@/lib/profiles/types';
import { deleteMessageTemplate, upsertMessageTemplate } from '@/server/actions/profiles';
import type { TemplateView } from './templateRows';
import styles from './metier.module.css';

/**
 * RÉGLAGES — « MESSAGES ».
 *
 * Les messages que le poste envoie en un geste (« Vos clés sont
 * disponibles à l'accueil »). Chaque modèle se lit comme il arrivera :
 * une notification d'écran verrouillé, au nom de l'établissement, avec
 * les variables remplacées par des valeurs d'exemple. Les contrôles sont
 * CEUX de l'envoi (`lib/profiles/templates.ts`) : 180 caractères, des
 * variables sur liste blanche, aucune adresse web. Ce que Réglages
 * accepte, le poste pourra l'envoyer.
 */

type ActionOutcome = { ok: true } | { ok: false; error: string; code?: string };
type Runner = (fn: () => Promise<ActionOutcome>, after?: () => void) => void;

interface Draft { key: string | null; label: string; body: string }

const VARIABLE_SPLIT = /(\{[^{}]*\})/g;
/** Le nom lisible d'une variable (« Téléphone »), pas sa clé technique. */
const VARIABLE_LABEL = new Map(TEMPLATE_VARIABLES.map((v) => [v.name, v.label]));

/** Le texte d'un modèle, les variables en jetons. */
function BodyTokens({ text }: { text: string }) {
  return (
    <>
      {text.split(VARIABLE_SPLIT).map((part, i) =>
        /^\{[^{}]*\}$/.test(part)
          ? <span key={i} className={styles.token}>{VARIABLE_LABEL.get(part.slice(1, -1).trim()) ?? part.slice(1, -1)}</span>
          // À l'affichage seulement : « ? » ne part jamais seul en début de ligne.
          : <span key={i}>{part.replace(/ ([:;?!])/g, ' $1')}</span>,
      )}
    </>
  );
}

export function TemplatesSection({
  orgSlug, profile, templates, locationName, locationPhone, canConfigure, run, pending,
}: {
  orgSlug: string;
  profile: QueueProfile;
  templates: TemplateView[];
  locationName: string;
  locationPhone: string | null;
  canConfigure: boolean;
  run: Runner;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const def = getProfile(profile);
  const disabled = !canConfigure || pending;

  const save = (d: Draft) =>
    run(
      () => upsertMessageTemplate(orgSlug, {
        profile, ...(d.key ? { key: d.key } : {}), label: d.label, body: d.body,
      }),
      () => setDraft(null),
    );

  return (
    <Section
      title="Messages"
      description={`Envoyés en un geste depuis le poste, au nom de ${locationName}. Modèles du métier « ${def.label} », communs à tous vos établissements.`}
      actions={canConfigure && !draft ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft({ key: null, label: '', body: '' })}>
          Ajouter un message
        </button>
      ) : undefined}
    >
      {draft && draft.key === null && (
        <TemplateEditor
          profile={profile}
          draft={draft}
          locationName={locationName}
          locationPhone={locationPhone}
          pending={pending}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => save(draft)}
        />
      )}
      <ol className={styles.tplList}>
        {templates.map((t) => {
          const editing = draft?.key === t.key;
          return (
            <li key={t.key} className={styles.tpl} data-editing={editing ? '1' : undefined}>
              {editing && draft ? (
                <TemplateEditor
                  profile={profile}
                  draft={draft}
                  original={t.original}
                  locationName={locationName}
                  locationPhone={locationPhone}
                  pending={pending}
                  onChange={setDraft}
                  onCancel={() => setDraft(null)}
                  onSave={() => save(draft)}
                />
              ) : (
                <>
                  <div className={styles.tplMain}>
                    <p className={styles.tplHead}>
                      <span className={styles.tplLabel}>{t.label}</span>
                      {t.origin === 'edited' && <span className={`chip ${styles.tplChip}`}>Retouché</span>}
                      {t.origin === 'custom' && <span className={`chip chip--copper ${styles.tplChip}`}>Ajouté</span>}
                    </p>
                    <p className={styles.tplBody}><BodyTokens text={t.body} /></p>
                  </div>
                  <div className={styles.tplActions}>
                    {canConfigure && (
                      <button type="button" className="btn btn--quiet btn--sm" disabled={disabled}
                        onClick={() => setDraft({ key: t.key, label: t.label, body: t.body })}>
                        Modifier
                      </button>
                    )}
                    {canConfigure && t.origin === 'edited' && (
                      <button type="button" className="btn btn--quiet btn--sm" disabled={disabled}
                        onClick={() => run(() => deleteMessageTemplate(orgSlug, { profile, key: t.key }))}>
                        Rétablir
                      </button>
                    )}
                    {canConfigure && t.origin === 'custom' && (
                      <button type="button" className={`btn btn--quiet btn--sm ${styles.danger}`} disabled={disabled}
                        onClick={() => run(() => deleteMessageTemplate(orgSlug, { profile, key: t.key }))}>
                        Supprimer
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>
      {templates.length === 0 && !draft && (
        <p className={styles.tplEmpty}>Aucun message pour l’instant : ajoutez le premier.</p>
      )}
    </Section>
  );
}

/* --------------------------------------------------------------------
   Éditeur : texte, variables, et l'écran verrouillé en regard
   -------------------------------------------------------------------- */

function TemplateEditor({
  profile, draft, original, locationName, locationPhone, pending, onChange, onCancel, onSave,
}: {
  profile: QueueProfile;
  draft: Draft;
  original?: { label: string; body: string } | null;
  locationName: string;
  locationPhone: string | null;
  pending: boolean;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const labelId = useId();
  const bodyId = useId();
  const helpId = useId();
  const variables = variablesFor(profile);

  const check = validateTemplateBody(draft.body, profile);
  const length = Array.from(draft.body.trim()).length;
  const over = length > TEMPLATE_MAX_LENGTH;
  const labelOk = draft.label.trim().length > 0 && draft.label.trim().length <= TEMPLATE_LABEL_MAX;
  // Valeurs d'exemple ; le nom et le téléphone sont les vrais.
  const values = Object.fromEntries(variables.map((v) => [v.name, v.sample]));
  values.etablissement = locationName;
  if (locationPhone) values.telephone_etablissement = locationPhone;
  const rendered = renderTemplate(draft.body, values);
  const copy = profileNotificationCopy('custom', { profile, locationName, body: rendered.text || '…' });
  const errors = draft.body.trim() ? check.errors : [];

  const insert = (name: string) => {
    const el = bodyRef.current;
    const token = `{${name}}`;
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? draft.body.length;
    const next = `${draft.body.slice(0, start)}${token}${draft.body.slice(end)}`;
    onChange({ ...draft, body: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className={styles.editorWrap}>
      <div className={styles.editor}>
        <div className={styles.editorForm}>
          <label className={styles.editorField} htmlFor={labelId}>
            <span className="t-label">Nom du bouton</span>
            <input
              id={labelId}
              className="input"
              value={draft.label}
              maxLength={TEMPLATE_LABEL_MAX}
              placeholder="Clés à l’accueil"
              onChange={(e) => onChange({ ...draft, label: e.target.value })}
            />
          </label>
          <div className={styles.editorField}>
            <span className={styles.editorBodyHead}>
              <label className="t-label" htmlFor={bodyId}>Message</label>
              <span className={styles.counter} data-over={over ? '1' : undefined} aria-live="polite">
                {length} / {TEMPLATE_MAX_LENGTH}
              </span>
            </span>
            <textarea
              id={bodyId}
              ref={bodyRef}
              className={`textarea ${styles.editorBody}`}
              value={draft.body}
              rows={3}
              placeholder="Vos clés sont disponibles à l’accueil."
              aria-describedby={helpId}
              aria-invalid={errors.length > 0}
              onChange={(e) => onChange({ ...draft, body: e.target.value })}
            />
            <div className={styles.vars} role="group" aria-label="Insérer une variable">
              {variables.map((v) => (
                <button key={v.name} type="button" className={styles.varChip} onClick={() => insert(v.name)}>
                  <span aria-hidden="true">+</span> {v.label}
                </button>
              ))}
            </div>
            <div id={helpId} className={styles.editorHelp}>
              {errors.length > 0 ? (
                <ul className={styles.editorErrors} role="alert">
                  {errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              ) : (
                <p>Pas d’adresse web : le client ouvre son suivi en touchant la notification. Jamais de prénom sur l’écran verrouillé.</p>
              )}
            </div>
          </div>
          <div className={styles.editorActions}>
            <button type="button" className="btn btn--signal btn--sm" disabled={pending || !check.ok || !labelOk} onClick={onSave}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>Annuler</button>
            {original && (draft.body !== original.body || draft.label !== original.label) && (
              <button type="button" className="btn btn--quiet btn--sm"
                onClick={() => onChange({ ...draft, label: original.label, body: original.body })}>
                Texte d’origine
              </button>
            )}
          </div>
        </div>

        <figure className={styles.lock} aria-label="Aperçu sur l’écran verrouillé du client">
          <span className={styles.lockTime} aria-hidden="true">
            <span className={styles.lockClock}>14:32</span>
          </span>
          <div className={styles.lockNotif}>
            <p className={styles.lockApp}>
              <span className={styles.lockIcon} aria-hidden="true"><i /><i /><i /></span>
              <span>Rangvia</span>
              <span className={styles.lockWhen}>maintenant</span>
            </p>
            <p className={styles.lockTitle}>{copy.title}</p>
            <p className={styles.lockBody}>{copy.body}</p>
          </div>
          <figcaption className={styles.lockCaption}>Aperçu · valeurs d’exemple, remplacées à l’envoi</figcaption>
        </figure>
      </div>
    </div>
  );
}
