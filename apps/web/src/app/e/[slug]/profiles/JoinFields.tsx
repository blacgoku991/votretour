'use client';

import { useId, useRef, useState } from 'react';
import { DeviceGlyph, DEVICE_LABEL } from '@/components/objects/DeviceGlyph';
import { PartySize } from '@/components/objects/PartySize';
import { DEVICE_KINDS, TEXT_LIMITS, detailsSchemaFor } from '@/lib/profiles/details';
import { formatRegistrationInput, parseRegistration } from '@/lib/profiles/registration';
import type {
  DeviceKind,
  EntryDetails,
  PublicProfileOptions,
  QueueProfile,
  RegistrationCountry,
  StayChoice,
  TableNeed,
  TableSeating,
} from '@/lib/profiles/types';
import type { ServiceItem } from '@/lib/types';
import { CheckIcon, ShieldIcon } from './shared';
import styles from './profiles.module.css';

/**
 * CHAMPS D'INSCRIPTION, SELON LE PROFIL.
 *
 * Ce que le client dit de lui, et rien de plus (conception, § 3.4) :
 * l'immatriculation, le modèle et le motif d'un véhicule ; le type, le
 * modèle et la panne d'un appareil ; les couverts d'un groupe ; le motif
 * d'un guichet ; le numéro d'une commande. Jamais de téléphone, d'e-mail,
 * de code de déverrouillage ni d'allergie.
 *
 * Les informations sont validées ICI avec le schéma même du serveur
 * (`detailsSchemaFor`, zod strict) : le client lit son erreur sous le
 * champ, en français, avant tout envoi. Le serveur, puis la base,
 * revérifient : ce contrôle-ci n'est qu'une politesse.
 */

export interface JoinValues {
  registration: string;
  country: RegistrationCountry;
  model: string;
  reasonText: string;
  stay: StayChoice;
  deviceKind: DeviceKind | null;
  partySize: number;
  seating: TableSeating;
  needs: TableNeed[];
  orderRef: string;
}

export type JoinField = 'registration' | 'model' | 'reasonText' | 'deviceKind' | 'partySize' | 'orderRef' | 'form';

export const INITIAL_JOIN_VALUES: JoinValues = {
  registration: '',
  country: 'FR',
  model: '',
  reasonText: '',
  stay: 'away',
  deviceKind: null,
  partySize: 2,
  seating: 'any',
  needs: [],
  orderRef: '',
};

/** Options publiques d'une file, plus la clé que 0035 y expose sans que le type la décrive. */
export type JoinOptions = PublicProfileOptions & { registrationRequired?: boolean };

/** Plafond des couverts en ligne (12 par défaut) ; au-delà, l'accueil. */
export function partyMaxOf(options: JoinOptions): number {
  const max = options.partyMax;
  return typeof max === 'number' && max >= 2 && max <= 20 ? max : 12;
}

/**
 * Un motif de boutique qui annonce un retrait : on propose alors le
 * numéro de commande. Sans motif configuré, le champ est toujours là
 * (facultatif).
 */
export function isPickupService(name: string | null | undefined): boolean {
  return Boolean(name && /retir|retrait|commande|click/i.test(name));
}

export type BuildResult =
  | { ok: true; details: EntryDetails }
  | { ok: false; field: JoinField; message: string };

const FIELD_FALLBACK: Record<string, string> = {
  registration: 'Immatriculation invalide.',
  model: 'Modèle trop long ou vide.',
  reasonText: 'Précision trop longue.',
  deviceKind: 'Choisissez le type d’appareil.',
  partySize: 'Nombre de couverts invalide.',
  orderRef: 'Numéro de commande invalide : lettres et chiffres.',
};

/**
 * Les informations à envoyer, validées par le schéma du serveur. Seules
 * les clés du profil partent, et seulement si le client les a remplies.
 */
export function buildDetails(
  profile: QueueProfile,
  values: JoinValues,
  options: JoinOptions,
  serviceName: string | null,
): BuildResult {
  const raw: Record<string, unknown> = {};
  const text = (s: string) => s.trim();
  const sensitive = options.sensitive === true;
  switch (profile) {
    case 'vehicle':
      if (text(values.registration)) {
        raw.registration = values.registration;
        raw.country = values.country;
      }
      if (text(values.model)) raw.model = values.model;
      if (text(values.reasonText)) raw.reasonText = values.reasonText;
      if (options.stayChoice !== false) raw.stay = values.stay;
      break;
    case 'device':
      if (!values.deviceKind) return { ok: false, field: 'deviceKind', message: 'Choisissez le type d’appareil.' };
      raw.deviceKind = values.deviceKind;
      if (text(values.model)) raw.model = values.model;
      if (text(values.reasonText)) raw.reasonText = values.reasonText;
      break;
    case 'table':
      raw.partySize = values.partySize;
      raw.seating = values.seating;
      if (values.needs.length) raw.needs = values.needs;
      break;
    case 'retail':
      if (!sensitive && text(values.orderRef) && (isPickupService(serviceName) || serviceName === null)) {
        raw.orderRef = values.orderRef;
      }
      break;
    default:
      break;
  }
  const parsed = detailsSchemaFor(profile, { actor: 'client', options }).safeParse(raw);
  if (parsed.success) return { ok: true, details: parsed.data };
  const issue = parsed.error.issues[0];
  const key = typeof issue?.path[0] === 'string' ? issue.path[0] : 'form';
  const field = (key in FIELD_FALLBACK ? key : 'form') as JoinField;
  const message = issue?.code === 'custom' ? issue.message : FIELD_FALLBACK[key] ?? 'Vérifiez les informations saisies.';
  return { ok: false, field, message };
}

/* ================================================================== */
/* Le composant                                                         */
/* ================================================================== */

interface Props {
  profile: QueueProfile;
  values: JoinValues;
  onChange: (patch: Partial<JoinValues>) => void;
  options: JoinOptions;
  services: ServiceItem[];
  serviceId: string | null;
  onService: (id: string | null) => void;
  /** Champ en faute après un essai d'envoi (et son message). */
  fieldError: { field: JoinField; message: string } | null;
  onSubmit: () => void;
}

export function JoinFields(props: Props) {
  const { profile } = props;
  switch (profile) {
    case 'vehicle':
      return <VehicleFields {...props} />;
    case 'device':
      return <DeviceFields {...props} />;
    case 'table':
      return <TableFields {...props} />;
    case 'desk':
      return <MotifChips {...props} label="Motif de votre visite" optional />;
    case 'retail':
      return <RetailFields {...props} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Atelier véhicule                                                     */
/* ------------------------------------------------------------------ */

function VehicleFields(props: Props) {
  const { values, onChange, options, fieldError } = props;
  const sensitive = options.sensitive === true;
  return (
    <>
      <RegistrationField
        value={values.registration}
        country={values.country}
        required={options.registrationRequired !== false}
        onChange={(registration, country) => onChange({ registration, country })}
        error={fieldError?.field === 'registration' ? fieldError.message : null}
        onSubmit={props.onSubmit}
      />
      {!sensitive && (
        <TextField
          id="modele"
          label="Modèle"
          optional
          placeholder="Peugeot 208"
          value={values.model}
          max={TEXT_LIMITS.model}
          onChange={(model) => onChange({ model })}
          error={fieldError?.field === 'model' ? fieldError.message : null}
          autoCapitalize="words"
        />
      )}
      <MotifChips {...props} label="Motif" optional withText={!sensitive} />
      {options.stayChoice !== false && (
        <Segmented<StayChoice>
          label="Pendant l’intervention"
          value={values.stay}
          onChange={(stay) => onChange({ stay })}
          items={[
            { value: 'away', label: 'Je laisse le véhicule' },
            { value: 'onsite', label: 'J’attends sur place' },
          ]}
        />
      )}
    </>
  );
}

/**
 * L'immatriculation : mise en forme PENDANT la frappe (`ab123cd` →
 * `AB-123-CD`), le curseur restant après le même caractère ; validation
 * SIV/FNI à la sortie du champ ; plaque étrangère en un geste.
 */
function RegistrationField({
  value, country, required, onChange, error, onSubmit,
}: {
  value: string;
  country: RegistrationCountry;
  required: boolean;
  onChange: (value: string, country: RegistrationCountry) => void;
  error: string | null;
  onSubmit: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const parsed = value.trim() ? parseRegistration(value, country) : null;
  const shownError = error ?? (touched && parsed && !parsed.ok ? parsed.reason : null);
  const warnings = parsed?.ok ? parsed.warnings : [];
  const valid = Boolean(parsed?.ok);

  const handle = (raw: string, caret: number | null) => {
    if (country === 'other') {
      onChange(raw.toUpperCase().slice(0, TEXT_LIMITS.registration), country);
      return;
    }
    // Le curseur suit le caractère tapé, pas la fin du champ : on compte
    // les caractères utiles avant lui, puis on le replace après autant de
    // caractères dans la forme mise en page.
    const before = raw.slice(0, caret ?? raw.length).replace(/[^A-Za-z0-9]/g, '').length;
    const next = formatRegistrationInput(raw);
    onChange(next, country);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el || document.activeElement !== el) return;
      let pos = 0;
      let seen = 0;
      while (pos < next.length && seen < before) {
        if (/[A-Z0-9]/.test(next.charAt(pos))) seen += 1;
        pos += 1;
      }
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="field">
      <label htmlFor="immatriculation">
        Immatriculation{required ? '' : ' (facultatif)'}
      </label>
      <div className={styles.regRow}>
        <input
          ref={inputRef}
          id="immatriculation"
          className={`input ${styles.regInput}`}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={country === 'other' ? TEXT_LIMITS.registration : 12}
          placeholder={country === 'other' ? 'Plaque étrangère' : 'AB-123-CD'}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={hintId}
          value={value}
          onChange={(e) => handle(e.target.value, e.target.selectionStart)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          required={required}
          data-valid={valid ? 'true' : undefined}
        />
        {valid && (
          <span className={styles.regOk} aria-hidden="true">
            <CheckIcon />
          </span>
        )}
      </div>
      <div id={hintId} className={styles.regFoot}>
        {shownError ? (
          <p className="error-text" role="alert">{shownError}</p>
        ) : warnings.length > 0 ? (
          <p className="hint">{warnings[0]} Vérifiez la carte grise.</p>
        ) : (
          <p className="hint">
            {country === 'other' ? 'Saisie libre, sans contrôle de format.' : 'AB-123-CD, ou 1234 AB 75 (ancien format).'}
          </p>
        )}
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => {
            setTouched(false);
            onChange(country === 'other' ? formatRegistrationInput(value) : value, country === 'other' ? 'FR' : 'other');
          }}
        >
          {country === 'other' ? 'Plaque française' : 'Plaque étrangère ?'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Atelier appareil                                                     */
/* ------------------------------------------------------------------ */

function DeviceFields(props: Props) {
  const { values, onChange, options, fieldError } = props;
  const sensitive = options.sensitive === true;
  return (
    <>
      <div className="field">
        <label id="appareil-label">Votre appareil</label>
        <div className={styles.deviceGrid} role="radiogroup" aria-labelledby="appareil-label">
          {DEVICE_KINDS.map((kind) => {
            const on = values.deviceKind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={on}
                className={styles.deviceKind}
                data-on={on ? 'true' : undefined}
                onClick={() => onChange({ deviceKind: kind })}
              >
                <DeviceGlyph kind={kind} size={28} />
                <span>{DEVICE_LABEL[kind]}</span>
              </button>
            );
          })}
        </div>
        {fieldError?.field === 'deviceKind' && <p className="error-text" role="alert">{fieldError.message}</p>}
      </div>
      {!sensitive && (
        <TextField
          id="modele"
          label="Marque et modèle"
          optional
          placeholder={values.deviceKind === 'computer' ? 'MacBook Air 13' : values.deviceKind === 'console' ? 'Switch OLED' : 'iPhone 13'}
          value={values.model}
          max={TEXT_LIMITS.model}
          onChange={(model) => onChange({ model })}
          error={fieldError?.field === 'model' ? fieldError.message : null}
        />
      )}
      <MotifChips {...props} label="Panne" optional withText={!sensitive} />
      {/* Permanent, pas une info-bulle : un code saisi ici serait une
          fuite. La base refuse d'ailleurs toute clé « code ». */}
      <p className={styles.guard}>
        <ShieldIcon />
        <span>Ne saisissez jamais votre code de déverrouillage ici. Le technicien vous le demandera s’il en a besoin.</span>
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                                */
/* ------------------------------------------------------------------ */

function TableFields({ values, onChange, options, fieldError }: Props) {
  const max = partyMaxOf(options);
  const n = Math.min(Math.max(1, values.partySize), max);
  const atMax = n >= max;
  return (
    <>
      <div className="field">
        <label id="couverts-label">Couverts</label>
        <div className={styles.stepper} role="group" aria-labelledby="couverts-label">
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => onChange({ partySize: n - 1 })}
            disabled={n <= 1}
            aria-label="Un couvert de moins"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" /></svg>
          </button>
          <span className={styles.stepTent}>
            {/* La clé relance la petite pose du chevalet à chaque changement. */}
            <span key={n} className={styles.stepSettle}>
              <PartySize count={n} size="lg" />
            </span>
            <span className="sr-only" role="status" aria-live="polite">{n} {n > 1 ? 'couverts' : 'couvert'}</span>
          </span>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => onChange({ partySize: n + 1 })}
            disabled={atMax}
            aria-label="Un couvert de plus"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10" /></svg>
          </button>
        </div>
        <p className="hint" aria-live="polite">
          {atMax ? `Plus de ${max} : présentez-vous directement à l’accueil.` : `De 1 à ${max} en ligne.`}
        </p>
        {fieldError?.field === 'partySize' && <p className="error-text" role="alert">{fieldError.message}</p>}
      </div>
      <Segmented<TableSeating>
        label="Préférence"
        value={values.seating}
        onChange={(seating) => onChange({ seating })}
        items={[
          { value: 'any', label: 'Peu importe' },
          { value: 'indoor', label: 'Salle' },
          { value: 'terrace', label: 'Terrasse' },
        ]}
      />
      <div className="field">
        <label id="besoins-label">Besoins (facultatif)</label>
        <div className={styles.toggles} role="group" aria-labelledby="besoins-label">
          {([['highchair', 'Chaise haute'], ['accessible', 'Accès PMR']] as const).map(([need, label]) => {
            const on = values.needs.includes(need);
            return (
              <button
                key={need}
                type="button"
                className={styles.chip}
                data-on={on ? 'true' : undefined}
                aria-pressed={on}
                onClick={() => onChange({ needs: on ? values.needs.filter((x) => x !== need) : [...values.needs, need] })}
              >
                <span className={styles.chipBox} aria-hidden="true">{on && <CheckIcon size={14} />}</span>
                {label}
              </button>
            );
          })}
        </div>
        {/* Une allergie est une donnée de santé : elle se dit au serveur. */}
        <p className="hint">Une allergie ? Dites-le au serveur à table.</p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Boutique                                                             */
/* ------------------------------------------------------------------ */

function RetailFields(props: Props) {
  const { values, onChange, services, serviceId, fieldError, options } = props;
  const chosen = services.find((s) => s.id === serviceId)?.name ?? null;
  const showOrder = options.sensitive !== true && (services.length === 0 || isPickupService(chosen));
  return (
    <>
      <MotifChips {...props} label="Vous venez pour" optional />
      {showOrder && (
        <TextField
          id="commande"
          label="Numéro de commande"
          optional
          placeholder="1234"
          value={values.orderRef}
          max={TEXT_LIMITS.orderRef}
          onChange={(orderRef) => onChange({ orderRef: orderRef.toUpperCase() })}
          error={fieldError?.field === 'orderRef' ? fieldError.message : null}
          hint="Celui de votre e-mail de confirmation : la caisse prépare la bonne commande."
          autoCapitalize="characters"
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Briques                                                              */
/* ------------------------------------------------------------------ */

/** Motif choisi dans la liste du pro (prestations) ; + une précision libre si permise. */
function MotifChips({
  services, serviceId, onService, label, optional, withText = false, values, onChange, fieldError,
}: Props & { label: string; optional?: boolean; withText?: boolean }) {
  if (services.length === 0 && !withText) return null;
  return (
    <div className="field">
      {services.length > 0 && (
        <>
          <label id="motif-label">{label}{optional ? ' (facultatif)' : ''}</label>
          <div className={styles.chips} role="radiogroup" aria-labelledby="motif-label">
            {services.map((s) => {
              const on = serviceId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={styles.chip}
                  data-on={on ? 'true' : undefined}
                  // Toucher le motif choisi le retire : le motif reste facultatif.
                  onClick={() => onService(on ? null : s.id)}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </>
      )}
      {withText && (
        <input
          id="precision"
          className={`input ${services.length > 0 ? styles.afterChips : ''}`}
          type="text"
          aria-label={services.length > 0 ? 'Précision (facultatif)' : `${label} (facultatif)`}
          placeholder={services.length > 0 ? 'Une précision ? (facultatif)' : 'Décrivez en quelques mots'}
          maxLength={TEXT_LIMITS.reasonText}
          value={values.reasonText}
          onChange={(e) => onChange({ reasonText: e.target.value })}
          enterKeyHint="next"
        />
      )}
      {fieldError?.field === 'reasonText' && <p className="error-text" role="alert">{fieldError.message}</p>}
    </div>
  );
}

function TextField({
  id, label, optional, placeholder, value, max, onChange, error, hint, autoCapitalize = 'sentences',
}: {
  id: string;
  label: string;
  optional?: boolean;
  placeholder: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
  error: string | null;
  hint?: string;
  autoCapitalize?: 'sentences' | 'words' | 'characters';
}) {
  const hintId = `${id}-aide`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}{optional ? ' (facultatif)' : ''}</label>
      <input
        id={id}
        className="input"
        type="text"
        autoComplete="off"
        autoCapitalize={autoCapitalize}
        enterKeyHint="next"
        maxLength={max}
        placeholder={placeholder}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p id={hintId} className="error-text" role="alert">{error}</p>
      ) : hint ? (
        <p id={hintId} className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

function Segmented<T extends string>({
  label, value, onChange, items,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
}) {
  const labelId = useId();
  return (
    <div className="field">
      <label id={labelId}>{label}</label>
      <div
        className={styles.segmented}
        role="radiogroup"
        aria-labelledby={labelId}
        style={{ ['--seg-n' as string]: items.length, ['--seg-i' as string]: Math.max(0, items.findIndex((i) => i.value === value)) }}
      >
        {/* Le curseur glisse sous l'option choisie (transform seulement). */}
        <span className={styles.segThumb} aria-hidden="true" />
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={item.value === value}
            className={styles.segItem}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
