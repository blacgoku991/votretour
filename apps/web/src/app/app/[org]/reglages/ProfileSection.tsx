'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section, SettingRow, Toggle } from '@/components/Page';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { getProfile, profileForActivity } from '@/lib/profiles';
import { profileAvailable } from '@/lib/profiles/capabilities';
import { PARTY_MAX_LIMIT, resolveProfileOptions } from '@/lib/profiles/options';
import { asMaskedRegistration } from '@/lib/profiles/registration';
import { formatTicketNo, TICKET_PREFIX_RE } from '@/lib/profiles/ticket';
import type { ProfileOptions, QueueProfile, TvRegistrationMode } from '@/lib/profiles/types';
import { setDeskLabel, switchQueueProfile, updateProfileOptions } from '@/server/actions/profiles';
import { MetierApercu, ProfileGlyph } from './MetierApercu';
import styles from './metier.module.css';

/**
 * RÉGLAGES — « MÉTIER DE LA FILE ».
 *
 * Trois temps, dans l'ordre où le professionnel se pose les questions :
 *   1. la scène : le métier de la file, montré par ses propres objets
 *      (plaque, rail d'étapes, chevalet, numéro) et ses deux touches ;
 *   2. le choix : les métiers disponibles, en lattes. Survoler ou choisir
 *      une latte change l'aperçu (aperçu vivant) ; rien ne change dans la
 *      file avant « Changer de métier », qui dit d'abord ce qui va changer ;
 *   3. les options du métier courant, enregistrées au geste.
 *
 * Un barbier n'est jamais poussé vers un autre métier : sa file reste
 * « Passage au fauteuil », et les autres métiers sont derrière « Voir les
 * autres métiers ». Seule une activité qui a son propre métier (garage,
 * restaurant, guichet…) voit une suggestion, en opt-in.
 */

export interface ProfileQueue {
  id: string;
  name: string;
  profile: QueueProfile;
  profile_options: unknown;
  ticket_prefix: string;
}

export interface DeskStaff {
  id: string;
  display_name: string;
  desk_label: string | null;
  is_active: boolean;
}

type ActionOutcome = { ok: true } | { ok: false; error: string; code?: string };
type Runner = (fn: () => Promise<ActionOutcome>) => void;

/** Les métiers qu'une file peut prendre ici. `event` a son propre module. */
const PICKABLE: readonly QueueProfile[] = ['walkin', 'vehicle', 'device', 'table', 'desk', 'retail'];

const REVIEW_DELAYS: readonly (number | null)[] = [0, 30, 45, 60, 75, 90, 120, 180, 240, null];

function delayLabel(value: number | null): string {
  if (value === null) return 'Jamais';
  if (value === 0) return 'Tout de suite';
  if (value < 60) return `${value} min après`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''} après`;
}

export function ProfileSection({
  orgSlug, queue, activity, features, canConfigure, staff, run, pending,
}: {
  orgSlug: string;
  queue: ProfileQueue;
  activity: string | null;
  features: Record<string, unknown> | null;
  canConfigure: boolean;
  staff: DeskStaff[];
  run: Runner;
  pending: boolean;
}) {
  const router = useRouter();
  const current = queue.profile;
  const options = resolveProfileOptions(current, queue.profile_options, activity);

  const available = PICKABLE.filter((p) => p === current || profileAvailable(p, features));
  const suggestedRaw = profileForActivity(activity);
  const suggested = suggestedRaw !== 'walkin' && suggestedRaw !== current && available.includes(suggestedRaw)
    ? suggestedRaw
    : null;

  const [pickerOpen, setPickerOpen] = useState(current === 'walkin' && suggested !== null);
  const [candidate, setCandidate] = useState<QueueProfile | null>(null);
  const [hovered, setHovered] = useState<QueueProfile | null>(null);
  const [switchError, setSwitchError] = useState<{ message: string; busy: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [switching, startSwitch] = useTransition();
  const pickerId = useId();

  // Une autre file, ou le métier vient de changer : on repart d'un choix vide.
  useEffect(() => {
    setCandidate(null);
    setHovered(null);
    setSwitchError(null);
  }, [queue.id, current]);

  const shown = hovered ?? candidate ?? current;
  const shownDef = getProfile(shown);
  const shownOptions = shown === current ? options : resolveProfileOptions(shown, null, activity);
  const isPreview = shown !== current;

  const setOption = (patch: ProfileOptions) =>
    run(() => updateProfileOptions(orgSlug, { queueId: queue.id, options: patch as Record<string, unknown> }));

  const confirmSwitch = (target: QueueProfile) => {
    setSwitchError(null);
    setNote(null);
    startSwitch(async () => {
      const result = await switchQueueProfile(orgSlug, { queueId: queue.id, profile: target });
      if (!result.ok) {
        setSwitchError({ message: result.error, busy: result.code === 'queue_not_empty' });
        return;
      }
      const parts = [`« ${queue.name} » est passée en ${getProfile(result.data.profile).label}.`];
      if (result.data.settingsRestored) parts.push('Vos réglages d’avant ont été rétablis.');
      if (result.data.servicesRetired > 0) {
        const n = result.data.servicesRetired;
        parts.push(`${n} motif${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} par l’ancien métier ${n > 1 ? 'ont été retirés' : 'a été retiré'}.`);
      }
      if (result.data.servicesCreated > 0) {
        const n = result.data.servicesCreated;
        parts.push(`${n} motif${n > 1 ? 's' : ''} proposé${n > 1 ? 's' : ''} par défaut : à retoucher dans Prestations.`);
      }
      setNote(parts.join(' '));
      setCandidate(null);
      setHovered(null);
      setPickerOpen(false);
      router.refresh();
    });
  };

  return (
    <Section
      title="Métier de la file"
      description="Ce qui avance dans la file, les mots de vos touches, et ce que voient vos clients et votre écran."
    >
      {/* ------------------------------------------------ La scène */}
      <div className={styles.stage}>
        <div className={styles.stageGrid}>
          <div className={styles.stageScene} key={shown} data-preview={isPreview ? '1' : undefined}>
            <MetierApercu profile={shown} options={shownOptions} ticketPrefix={queue.ticket_prefix} />
          </div>
          <div className={styles.stageText} aria-live="polite">
            <p className={styles.stageEyebrow}>
              <span className={styles.stageNotch} aria-hidden="true" />
              {isPreview ? 'Aperçu' : 'Métier actuel'}
            </p>
            <h3 className={styles.stageTitle}>{shownDef.label}</h3>
            <p className={styles.stageTagline}>{shownDef.tagline}</p>
            <dl className={styles.vocab}>
              <div><dt>On suit</dt><dd>des {shownDef.vocab.subjectPlural}</dd></div>
              <div><dt>La touche qui prévient</dt><dd>{shownDef.vocab.call}</dd></div>
              <div><dt>La touche de fin</dt><dd>{shownDef.vocab.complete}</dd></div>
              <div><dt>Le compteur</dt><dd>{shownDef.vocab.todayCounter}</dd></div>
            </dl>
          </div>
        </div>
      </div>

      {note && (
        <p className={styles.note} role="status">
          <span className={styles.noteMark} aria-hidden="true" />
          {note}
        </p>
      )}

      {/* ------------------------------------------------ Le choix */}
      {available.length > 1 && (
        <div className={styles.picker}>
          {!pickerOpen ? (
            <div className={styles.pickerClosed}>
              <p className={styles.pickerClosedText}>
                {current === 'walkin'
                  ? 'Votre file fonctionne au passage : la personne avance, dans l’ordre d’arrivée.'
                  : `Ce métier se règle par file : « ${queue.name} » seulement.`}
              </p>
              {canConfigure && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-expanded={false}
                  aria-controls={pickerId}
                  onClick={() => setPickerOpen(true)}
                >
                  {current === 'walkin' ? 'Voir les autres métiers' : 'Changer de métier'}
                </button>
              )}
            </div>
          ) : (
            <fieldset className={styles.choices} id={pickerId} disabled={!canConfigure || switching}>
              <legend className={styles.choicesLegend}>
                Choisissez le métier de « {queue.name} »
                <span className={styles.choicesHint}> · l’aperçu suit votre choix, rien ne change avant de confirmer</span>
              </legend>
              <div className={styles.choiceList} onMouseLeave={() => setHovered(null)}>
                {available.map((p) => {
                  const def = getProfile(p);
                  const isCurrent = p === current;
                  const isChosen = (candidate ?? current) === p;
                  return (
                    <label
                      key={p}
                      className={styles.choice}
                      data-chosen={isChosen ? '1' : undefined}
                      data-current={isCurrent ? '1' : undefined}
                      onMouseEnter={() => setHovered(p)}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`metier-${queue.id}`}
                        value={p}
                        checked={isChosen}
                        onChange={() => { setCandidate(isCurrent ? null : p); setSwitchError(null); }}
                        onFocus={() => setHovered(null)}
                      />
                      <span className={styles.choiceGlyph}><ProfileGlyph profile={p} /></span>
                      <span className={styles.choiceText}>
                        <span className={styles.choiceLabel}>{def.label}</span>
                        <span className={styles.choiceTagline}>{def.tagline}</span>
                      </span>
                      {isCurrent ? (
                        <span className={`chip ${styles.choiceChip}`}>Actuel</span>
                      ) : p === suggested ? (
                        <span className={`chip chip--signal ${styles.choiceChip}`}>Fait pour vous</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>

              {candidate && candidate !== current ? (
                <SwitchTicket
                  queueName={queue.name}
                  from={current}
                  to={candidate}
                  switching={switching}
                  error={switchError}
                  fileHref={`/app/${orgSlug}/file?file=${queue.id}`}
                  onConfirm={() => confirmSwitch(candidate)}
                  onCancel={() => { setCandidate(null); setSwitchError(null); }}
                />
              ) : (
                <div className={styles.pickerFoot}>
                  <button type="button" className="btn btn--quiet btn--sm" onClick={() => { setPickerOpen(false); setCandidate(null); }}>
                    Fermer
                  </button>
                </div>
              )}
            </fieldset>
          )}
        </div>
      )}

      {/* ------------------------------------------------ Les options */}
      <ProfileOptionsRows
        orgSlug={orgSlug}
        queue={queue}
        profile={current}
        options={options}
        canConfigure={canConfigure}
        pending={pending}
        setOption={setOption}
        run={run}
        staff={staff}
      />
    </Section>
  );
}

/* --------------------------------------------------------------------
   Confirmation du changement : ce qui change, dit AVANT
   -------------------------------------------------------------------- */

function SwitchTicket({
  queueName, from, to, switching, error, fileHref, onConfirm, onCancel,
}: {
  queueName: string;
  from: QueueProfile;
  to: QueueProfile;
  switching: boolean;
  error: { message: string; busy: boolean } | null;
  fileHref: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const def = getProfile(to);
  const fromDef = getProfile(from);
  const ttl = def.queueDefaults.entryTtlMinutes;
  const lines: string[] = [
    `Le poste, l’écran client et la TV parlent de ${def.vocab.subjectPlural} : « ${def.vocab.call} », « ${def.vocab.complete} ».`,
  ];
  if (def.defaultServices.length > 0) {
    lines.push(`S’il n’y a aucune prestation, les motifs du métier sont proposés : ${def.defaultServices.slice(0, 4).join(', ')}${def.defaultServices.length > 4 ? '…' : ''}`);
  }
  if (ttl && ttl > 1440) lines.push(`Une fiche reste suivie ${Math.round(ttl / 1440)} jours, même d’un jour sur l’autre.`);
  lines.push(`Les réglages de « ${fromDef.label} » sont gardés de côté : y revenir les rétablit.`);

  return (
    <div className={styles.ticket} data-state={error ? 'error' : undefined}>
      <p className={styles.ticketTitle}>
        Passer « {queueName} » en <strong>{def.label}</strong> ?
      </p>
      <ul className={styles.ticketList}>
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      {error && (
        <p className={styles.ticketError} role="alert">
          {error.message}
          {error.busy && (
            <>
              {' '}
              <a href={fileHref} className={styles.ticketLink}>Ouvrir le poste</a>
            </>
          )}
        </p>
      )}
      <div className={styles.ticketActions}>
        <button type="button" className="btn btn--signal" onClick={onConfirm} disabled={switching}>
          {switching ? 'Changement…' : 'Changer de métier'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel} disabled={switching}>
          Annuler
        </button>
        <span className={styles.ticketHint}>Seulement quand la file est vide.</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------
   Options du métier courant
   -------------------------------------------------------------------- */

function ProfileOptionsRows({
  orgSlug, queue, profile, options, canConfigure, pending, setOption, run, staff,
}: {
  orgSlug: string;
  queue: ProfileQueue;
  profile: QueueProfile;
  options: ProfileOptions;
  canConfigure: boolean;
  pending: boolean;
  setOption: (patch: ProfileOptions) => void;
  run: Runner;
  staff: DeskStaff[];
}) {
  const disabled = !canConfigure || pending;
  const review = (
    <ReviewRows
      profile={profile}
      options={options}
      disabled={disabled}
      setOption={setOption}
    />
  );

  switch (profile) {
    case 'vehicle':
      return (
        <>
          <SettingRow label="Devis en ligne" hint="Le client accepte ou refuse le devis depuis son téléphone ; son accord vous parvient avec l’heure.">
            <Toggle checked={options.quotes !== false} label="Devis en ligne" disabled={disabled}
              onChange={(v) => setOption({ quotes: v })} />
          </SettingRow>
          <SettingRow label="Immatriculation obligatoire" hint="Demandée au client qui s’inscrit lui-même en scannant la plaque.">
            <Toggle checked={options.registrationRequired !== false} label="Immatriculation obligatoire" disabled={disabled}
              onChange={(v) => setOption({ registrationRequired: v })} />
          </SettingRow>
          <SettingRow label="« J’attends sur place » ou « Je laisse le véhicule »" hint="Le client le dit en déposant : vous savez qui patiente à l’accueil.">
            <Toggle checked={options.stayChoice !== false} label="Attente sur place" disabled={disabled}
              onChange={(v) => setOption({ stayChoice: v })} />
          </SettingRow>
          <TvRegistrationRow value={options.tvRegistration ?? 'masked'} disabled={disabled}
            onChange={(v) => setOption({ tvRegistration: v })} />
          {review}
        </>
      );
    case 'device':
      return (
        <>
          <SettingRow label="Devis en ligne" hint="Le client accepte ou refuse le devis depuis son téléphone ; son accord vous parvient avec l’heure.">
            <Toggle checked={options.quotes !== false} label="Devis en ligne" disabled={disabled}
              onChange={(v) => setOption({ quotes: v })} />
          </SettingRow>
          <SettingRow label="Numéro de dossier" hint="0042, 0043… Continu, jamais remis à zéro : il relie l’appareil, le client et le technicien.">
            <Toggle checked={options.numbering !== false} label="Numéro de dossier" disabled={disabled}
              onChange={(v) => setOption({ numbering: v })} />
          </SettingRow>
          {review}
        </>
      );
    case 'table':
      return (
        <>
          <SettingRow label="Couverts en ligne, au plus" hint="Au-delà, le client lit « présentez-vous à l’accueil ».">
            <select className="select" value={options.partyMax ?? 12} disabled={disabled} aria-label="Couverts en ligne, au plus"
              onChange={(e) => setOption({ partyMax: Number(e.target.value) })}>
              {Array.from({ length: PARTY_MAX_LIMIT - 1 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>{n} couverts</option>
              ))}
            </select>
          </SettingRow>
          <TableSizesRow sizes={options.tableSizes ?? [2, 4, 6, 8]} disabled={disabled}
            onChange={(sizes) => setOption({ tableSizes: sizes })} />
          {review}
        </>
      );
    case 'desk':
      return (
        <>
          <SettingRow label="Numéro de ticket" hint="Remis à zéro chaque matin. La salle entend un numéro, jamais un nom.">
            <Toggle checked={options.numbering !== false} label="Numéro de ticket" disabled={disabled}
              onChange={(v) => setOption({ numbering: v })} />
          </SettingRow>
          {options.numbering !== false && (
            <PrefixRow orgSlug={orgSlug} queue={queue} profile="desk" disabled={disabled} run={run} />
          )}
          <SettingRow
            label="Données de santé"
            hint="Aucun prénom demandé, aucun texte libre, jamais de nom à l’écran. Les motifs ne s’affichent qu’au patient, jamais en salle."
          >
            <Toggle checked={options.sensitive === true} label="Données de santé" disabled={disabled}
              onChange={(v) => setOption({ sensitive: v })} />
          </SettingRow>
          {review}
          <DeskRows
            orgSlug={orgSlug}
            staff={staff}
            sample={options.numbering !== false ? formatTicketNo('desk', 42, queue.ticket_prefix) : null}
            disabled={disabled}
            run={run}
          />
        </>
      );
    case 'retail':
      return (
        <>
          <SettingRow label="Numéro de ticket" hint="Remis à zéro chaque matin, affiché au client et à l’écran de la caisse.">
            <Toggle checked={options.numbering === true} label="Numéro de ticket" disabled={disabled}
              onChange={(v) => setOption({ numbering: v })} />
          </SettingRow>
          {options.numbering === true && (
            <PrefixRow orgSlug={orgSlug} queue={queue} profile="retail" disabled={disabled} run={run} />
          )}
          {review}
        </>
      );
    default:
      return null;
  }
}

/** Demande d'avis : oui/non, puis quand (restaurant, guichet). */
function ReviewRows({
  profile, options, disabled, setOption,
}: {
  profile: QueueProfile;
  options: ProfileOptions;
  disabled: boolean;
  setOption: (patch: ProfileOptions) => void;
}) {
  const on = options.review !== false;
  const withDelay = profile === 'table' || profile === 'desk';
  const hint = profile === 'table'
    ? 'Envoyée après le repas, pas quand on s’assoit : le délai part de « Installer ».'
    : options.sensitive
      ? 'En santé, solliciter des avis pose des questions de déontologie : coupée par défaut.'
      : 'Proposée à la fin du passage, à tous, sans filtrage sur la satisfaction.';
  const delay = options.reviewDelayMinutes === undefined ? 0 : options.reviewDelayMinutes;
  return (
    <>
      <SettingRow label="Demande d’avis Google" hint={hint}>
        <Toggle checked={on} label="Demande d’avis Google" disabled={disabled}
          onChange={(v) => setOption({ review: v })} />
      </SettingRow>
      {on && withDelay && (
        <SettingRow label="Envoyée" hint="Délai compté depuis la fin du passage.">
          <select className="select" value={delay === null ? 'jamais' : String(delay)} disabled={disabled} aria-label="Délai de la demande d’avis"
            onChange={(e) => setOption({ reviewDelayMinutes: e.target.value === 'jamais' ? null : Number(e.target.value) })}>
            {REVIEW_DELAYS.map((d) => (
              <option key={d ?? 'jamais'} value={d === null ? 'jamais' : String(d)}>{delayLabel(d)}</option>
            ))}
          </select>
        </SettingRow>
      )}
    </>
  );
}

const TV_MODES: { value: TvRegistrationMode; label: string; hint: string }[] = [
  { value: 'masked', label: 'Fin de plaque', hint: 'Les 3 derniers caractères' },
  { value: 'model_only', label: 'Modèle seul', hint: 'Sans aucune plaque' },
  { value: 'none', label: 'Compteurs', hint: 'Aucune ligne de véhicule' },
];

/** Ce que montre la TV d'un véhicule prêt : la plaque n'est JAMAIS entière. */
function TvRegistrationRow({
  value, disabled, onChange,
}: { value: TvRegistrationMode; disabled: boolean; onChange: (v: TvRegistrationMode) => void }) {
  const masked = asMaskedRegistration('••-••2-KL');
  return (
    <SettingRow label="À l’écran de la salle" hint="Un véhicule prêt s’affiche ainsi. L’immatriculation complète ne quitte jamais votre poste." stacked>
      <fieldset className={styles.tvModes} disabled={disabled}>
        <legend className="sr-only">Affichage d’un véhicule prêt à l’écran de la salle</legend>
        {TV_MODES.map((mode) => (
          <label key={mode.value} className={styles.tvMode} data-on={value === mode.value ? '1' : undefined}>
            <input type="radio" className="sr-only" name="tv-registration" value={mode.value}
              checked={value === mode.value} onChange={() => onChange(mode.value)} />
            <span className={styles.tvScreen} aria-hidden="true">
              <span className={styles.tvReady}>Prêt</span>
              {mode.value === 'masked' && masked && <Immatriculation maskedValue={masked} width={132} />}
              {mode.value === 'model_only' && <span className={styles.tvModel}>Peugeot 208</span>}
              {mode.value === 'none' && <span className={styles.tvCount}><strong>3</strong> prêts</span>}
            </span>
            <span className={styles.tvLabel}>{mode.label}</span>
            <span className={styles.tvHint}>{mode.hint}</span>
          </label>
        ))}
      </fieldset>
    </SettingRow>
  );
}

const SIZE_CHOICES = Array.from({ length: 12 }, (_, i) => i + 1);

/** « Table libre pour : 2 · 4 · 6 · 8+ » : les touches de l'hôte. */
function TableSizesRow({
  sizes, disabled, onChange,
}: { sizes: number[]; disabled: boolean; onChange: (sizes: number[]) => void }) {
  const set = new Set(sizes);
  const toggle = (n: number) => {
    const next = set.has(n) ? sizes.filter((s) => s !== n) : [...sizes, n];
    if (next.length === 0 || next.length > 6) return;
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <SettingRow
      label="Touches « Table libre pour »"
      hint={`Une à six tailles de table ; la plus grande vaut « et plus ». Aujourd’hui : ${sizes.map((n, i) => (i === sizes.length - 1 ? `${n}+` : n)).join(' · ')}.`}
      stacked
    >
      <div className={styles.sizes} role="group" aria-label="Tailles de table">
        {SIZE_CHOICES.map((n) => {
          const on = set.has(n);
          return (
            <button
              key={n}
              type="button"
              className={styles.size}
              aria-pressed={on}
              disabled={disabled || (!on && sizes.length >= 6) || (on && sizes.length <= 1)}
              onClick={() => toggle(n)}
            >
              {n}
            </button>
          );
        })}
      </div>
    </SettingRow>
  );
}

/** Préfixe du numéro : « A » → A-042. */
function PrefixRow({
  orgSlug, queue, profile, disabled, run,
}: { orgSlug: string; queue: ProfileQueue; profile: 'desk' | 'retail'; disabled: boolean; run: Runner }) {
  const [value, setValue] = useState(queue.ticket_prefix);
  useEffect(() => { setValue(queue.ticket_prefix); }, [queue.ticket_prefix]);
  const clean = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  const valid = TICKET_PREFIX_RE.test(clean);
  const dirty = clean !== queue.ticket_prefix;
  const save = () => {
    if (!valid || !dirty) return;
    run(() => updateProfileOptions(orgSlug, { queueId: queue.id, ticketPrefix: clean }));
  };
  return (
    <SettingRow label="Préfixe du numéro" hint="Une ou deux lettres. Utile quand deux files se partagent la même salle.">
      <span className={styles.prefix}>
        <input
          className={`input ${styles.prefixInput}`}
          value={clean}
          maxLength={2}
          disabled={disabled}
          aria-label="Préfixe du numéro"
          aria-invalid={!valid}
          autoCapitalize="characters"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
        />
        <span className={styles.prefixPreview} aria-hidden="true">
          <TicketNumber value={formatTicketNo(profile, 42, valid ? clean : 'A') ?? 'A-042'} size="1.5rem" />
        </span>
        {dirty && (
          <button type="button" className="btn btn--solid btn--sm" disabled={!valid || disabled} onClick={save}>
            Appliquer
          </button>
        )}
      </span>
    </SettingRow>
  );
}

/** Une fiche de l'équipe = un guichet ; son libellé est ce qu'appelle la salle. */
function DeskRows({
  orgSlug, staff, sample, disabled, run,
}: { orgSlug: string; staff: DeskStaff[]; sample: string | null; disabled: boolean; run: Runner }) {
  const active = staff.filter((s) => s.is_active);
  return (
    <div className={styles.desks}>
      <div className={styles.desksHead}>
        <p className={styles.desksTitle}>Guichets</p>
        <p className={styles.desksHint}>
          Une fiche de l’équipe par guichet. Le libellé est ce que la salle lit à l’appel
          {sample ? <> : <span className={styles.nowrap}>« {sample} → Guichet 3 »</span></> : null}.
          Sans libellé, le prénom de la fiche est affiché.
        </p>
      </div>
      {active.length === 0 ? (
        <p className={styles.desksEmpty}>
          Aucun guichet pour l’instant. <a href={`/app/${orgSlug}/equipe`}>Ajoutez une fiche dans Équipe</a>.
        </p>
      ) : (
        <ol className={styles.deskList}>
          {active.map((s, i) => <DeskRow key={s.id} index={i} member={s} orgSlug={orgSlug} disabled={disabled} run={run} />)}
        </ol>
      )}
    </div>
  );
}

function DeskRow({
  index, member, orgSlug, disabled, run,
}: { index: number; member: DeskStaff; orgSlug: string; disabled: boolean; run: Runner }) {
  const [value, setValue] = useState(member.desk_label ?? '');
  useEffect(() => { setValue(member.desk_label ?? ''); }, [member.desk_label]);
  const trimmed = value.trim();
  const dirty = trimmed !== (member.desk_label ?? '');
  const save = () => {
    if (!dirty) return;
    run(() => setDeskLabel(orgSlug, { staffId: member.id, label: trimmed || null }));
  };
  return (
    <li className={styles.deskRow}>
      <span className={styles.deskNum} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <span className={styles.deskName}>{member.display_name}</span>
      <input
        className={`input ${styles.deskInput}`}
        value={value}
        maxLength={24}
        placeholder={`Guichet ${index + 1}`}
        disabled={disabled}
        aria-label={`Libellé du guichet de ${member.display_name}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
      />
      <span className={styles.deskShown} aria-hidden="true">
        → {trimmed || member.desk_label || member.display_name}
      </span>
    </li>
  );
}
