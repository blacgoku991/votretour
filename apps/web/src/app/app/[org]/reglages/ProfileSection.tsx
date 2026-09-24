'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Section, SettingRow, Toggle } from '@/components/Page';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { getProfile, isActivityType, isLegacyProfile } from '@/lib/profiles';
import { PARTY_MAX_LIMIT, resolveProfileOptions } from '@/lib/profiles/options';
import { asMaskedRegistration } from '@/lib/profiles/registration';
import { formatTicketNo, TICKET_PREFIX_RE } from '@/lib/profiles/ticket';
import type { ProfileOptions, QueueProfile, TvRegistrationMode } from '@/lib/profiles/types';
import { setDeskLabel, updateProfileOptions } from '@/server/actions/profiles';
import { MetierApercu, ProfileGlyph } from './MetierApercu';
import styles from './metier.module.css';

/**
 * RÉGLAGES — « MÉTIER DE LA FILE ».
 *
 * Décision du propriétaire : le métier est ATTRIBUÉ par l'équipe Rangvia,
 * à l'installation (espace super-admin). Le commerçant ne le choisit pas
 * et ne le change pas : cette section le MONTRE, en lecture seule, puis
 * lui laisse les options de ce métier.
 *
 *   1. la scène : le métier de la file, montré par ses propres objets
 *      (plaque, rail d'étapes, chevalet, numéro) et ses deux touches ;
 *   2. le sceau « Activé par l'équipe Rangvia · Un autre métier ?
 *      Écrivez-nous », sans sélecteur ni bouton (le nom du métier est
 *      déjà le titre de la scène : il n'est pas répété) ;
 *   3. les options du métier, enregistrées au geste : devis en ligne,
 *      immatriculation obligatoire, couverts, préfixe, guichets.
 *
 * Une file au passage (un barbier) ne voit RIEN de nouveau : la section ne
 * rend rien, sauf dans une organisation où l'équipe a installé un métier
 * sur une autre file (elle dit alors, sans rien proposer, que celle-ci
 * fonctionne au passage).
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

/** Activités « au fauteuil » : le mot n'a de sens que pour elles. */
const CHAIR_ACTIVITIES: ReadonlySet<string> = new Set(['barber', 'hair_salon', 'nail_bar', 'beauty']);

/**
 * Le nom d'un métier tel que le pro le lit. Le passage au fauteuil garde
 * son nom chez un coiffeur, et quand l'activité est inconnue (c'est le
 * produit d'aujourd'hui : captures R0 inchangées). Ailleurs (une file
 * « Pneus minute » de garage, un commerce « autre »), il devient
 * « Passage sans rendez-vous » : il n'y a pas de fauteuil.
 */
export function metierLabel(profile: QueueProfile, activity: string | null): string {
  if (profile === 'walkin' && isActivityType(activity) && !CHAIR_ACTIVITIES.has(activity)) {
    return 'Passage sans rendez-vous';
  }
  return getProfile(profile).label;
}

/**
 * La section a-t-elle quelque chose à dire ? Toujours pour une file dans
 * un métier. Pour une file au passage, seulement si l'équipe Rangvia a
 * installé des métiers dans l'organisation (`features.profiles`, ou une
 * autre file déjà dans un métier) : un barbier ne voit rien de nouveau.
 */
export function showsMetier({
  current, features, orgHasProfiledQueue,
}: {
  current: QueueProfile;
  features: Readonly<Record<string, unknown>> | null;
  orgHasProfiledQueue: boolean;
}): boolean {
  if (!isLegacyProfile(current)) return true;
  return features?.profiles === true || orgHasProfiledQueue;
}

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
  orgHasProfiledQueue = false, showQueueName = false, reviewLink = true,
}: {
  orgSlug: string;
  queue: ProfileQueue;
  activity: string | null;
  features: Record<string, unknown> | null;
  canConfigure: boolean;
  staff: DeskStaff[];
  run: Runner;
  pending: boolean;
  /** Une autre file de l'organisation est déjà dans un métier (hors passage). */
  orgHasProfiledQueue?: boolean;
  /** Plusieurs files dans l'établissement : le titre nomme celle qu'on règle. */
  showQueueName?: boolean;
  /** Le lien « Rédiger un avis » est renseigné (section Avis Google). */
  reviewLink?: boolean;
}) {
  const current = queue.profile;
  if (!showsMetier({ current, features, orgHasProfiledQueue })) return null;

  const options = resolveProfileOptions(current, queue.profile_options, activity);
  const def = getProfile(current);
  const label = metierLabel(current, activity);

  const setOption = (patch: ProfileOptions) =>
    run(() => updateProfileOptions(orgSlug, { queueId: queue.id, options: patch as Record<string, unknown> }));

  return (
    <Section
      title={showQueueName ? `Métier de « ${queue.name} »` : 'Métier de la file'}
      description="Ce qui avance dans la file, les mots de vos touches, et ce que voient vos clients et votre écran."
    >
      {/* ------------------------------------------------ La scène */}
      <div className={styles.stage}>
        <div className={styles.stageGrid}>
          <div className={styles.stageScene}>
            <MetierApercu
              profile={current}
              options={options}
              ticketPrefix={queue.ticket_prefix}
              chair={metierLabel('walkin', activity) === getProfile('walkin').label}
            />
          </div>
          <div className={styles.stageText}>
            <p className={styles.stageEyebrow}>
              <span className={styles.stageNotch} aria-hidden="true" />
              Votre métier
            </p>
            <h3 className={styles.stageTitle}>{label}</h3>
            <p className={styles.stageTagline}>{def.tagline}</p>
            <dl className={styles.vocab}>
              <div><dt>On suit</dt><dd>des {def.vocab.subjectPlural}</dd></div>
              <div><dt>La touche qui prévient</dt><dd>{def.vocab.call}</dd></div>
              <div><dt>La touche de fin</dt><dd>{def.vocab.complete}</dd></div>
              <div><dt>Le compteur</dt><dd>{def.vocab.todayCounter}</dd></div>
            </dl>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ Le sceau : lecture seule */}
      <div className={styles.assigned}>
        <span className={styles.assignedGlyph} aria-hidden="true"><ProfileGlyph profile={current} /></span>
        {/* Le nom du métier est déjà le titre de la scène : le sceau dit
            seulement qui l'a posé, et comment en changer. */}
        <p className={styles.assignedText}>
          <strong>Activé par l’équipe Rangvia</strong>
          <span className="sr-only">{`\u00a0: ${label}`}</span>
        </p>
        <p className={styles.assignedHint}>
          Un autre métier pour «&nbsp;{queue.name}&nbsp;»&nbsp;?{' '}
          <Link href={`/app/${orgSlug}/support`} className={styles.assignedLink}>Écrivez-nous</Link>
          , l’équipe s’en charge.
        </p>
      </div>

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
        reviewLink={reviewLink}
      />
    </Section>
  );
}

/* --------------------------------------------------------------------
   Options du métier courant
   -------------------------------------------------------------------- */

function ProfileOptionsRows({
  orgSlug, queue, profile, options, canConfigure, pending, setOption, run, staff, reviewLink,
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
  reviewLink: boolean;
}) {
  const disabled = !canConfigure || pending;
  const review = (
    <ReviewRows
      profile={profile}
      options={options}
      disabled={disabled}
      setOption={setOption}
      reviewLink={reviewLink}
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

/**
 * Demande d'avis : oui/non, puis quand (restaurant, guichet). Ce réglage
 * décide, POUR CETTE FILE, de la notification de fin de passage et du
 * bouton d'avis de l'écran client ; le lien est celui de la section
 * « Avis Google ». Les textes suivent le métier : au restaurant, la fin
 * du passage est « Installer » (le groupe s'assoit), d'où le délai.
 */
function ReviewRows({
  profile, options, disabled, setOption, reviewLink,
}: {
  profile: QueueProfile;
  options: ProfileOptions;
  disabled: boolean;
  setOption: (patch: ProfileOptions) => void;
  reviewLink: boolean;
}) {
  const on = options.review !== false;
  const withDelay = profile === 'table' || profile === 'desk';
  const lead = profile === 'table'
    ? 'Envoyée après le repas, pas quand le groupe s’assoit : réglez le délai ci-dessous.'
    : options.sensitive
      ? 'Coupée en santé ; à vous de décider.'
      : 'Proposée à la fin du passage, à tous, sans filtrage sur la satisfaction.';
  const hint = reviewLink
    ? `${lead} Le lien est celui de « Avis Google ».`
    : `${lead} Sans lien dans « Avis Google », seul le merci part.`;
  const delay = options.reviewDelayMinutes === undefined ? 0 : options.reviewDelayMinutes;
  const delayHint = profile === 'table'
    ? 'Compté depuis « Installer », quand le groupe s’assoit : comptez la durée d’un repas.'
    : 'Compté depuis « Terminer », à la fin du passage au guichet.';
  // Rallumer l'avis sur une file réglée à « jamais » (la santé) : il
  // repart au délai du métier, sinon l'interrupteur s'allumerait sans
  // qu'aucune demande ne parte jamais.
  const turn = (v: boolean) => {
    if (v && withDelay && options.reviewDelayMinutes === null) {
      setOption({ review: true, reviewDelayMinutes: profile === 'table' ? 75 : 0 });
    } else {
      setOption({ review: v });
    }
  };
  return (
    <>
      <SettingRow label="Demande d’avis Google" hint={hint}>
        <Toggle checked={on} label="Demande d’avis Google" disabled={disabled} onChange={turn} />
      </SettingRow>
      {on && withDelay && (
        <SettingRow label="Envoyée" hint={delayHint}>
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
        placeholder={member.display_name}
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
