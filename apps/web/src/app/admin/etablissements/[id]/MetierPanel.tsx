'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ACTIVITY_PROFILE, getProfile, isActivityType, QUEUE_PROFILES } from '@/lib/profiles';
import { resolveProfileOptions } from '@/lib/profiles/options';
import type { QueueProfile } from '@/lib/profiles/types';
import { assignQueueProfile } from '@/server/actions/admin-profiles';
import { MetierApercu, ProfileGlyph } from '@/app/app/[org]/reglages/MetierApercu';
import { metierLabel } from '@/app/app/[org]/reglages/ProfileSection';
import metier from '@/app/app/[org]/reglages/metier.module.css';
import styles from './metier-admin.module.css';

/**
 * SUPER-ADMIN — « MÉTIER », FILE PAR FILE.
 *
 * Décision du propriétaire : le métier d'une file (passage, atelier
 * véhicule, atelier appareils, table, guichet, boutique, événement) est
 * attribué ICI, par l'équipe Rangvia, à l'installation. Le commerçant a
 * déclaré son activité à l'inscription ; il voit ensuite son métier en
 * lecture seule et en règle les options dans ses Réglages.
 *
 * Pour chaque file : le métier actuel, les tickets en cours (un
 * changement exige une file vide), puis, à la demande, l'établi :
 *   - les sept métiers en lattes, avec celui de l'activité déclarée
 *     signalé ; survoler ou choisir une latte change l'aperçu à côté
 *     (les VRAIS objets du produit, `MetierApercu`) ;
 *   - rien ne change avant la confirmation, qui dit d'abord ce qui va
 *     changer pour le commerce et ses clients ;
 *   - le refus VT017 est dit en clair : « La file doit être vide avant de
 *     changer de métier. »
 * Aucune garde d'ouverture (`OPEN_PROFILES`) : l'équipe attribue n'importe
 * lequel des sept métiers.
 */

export interface MetierQueue {
  id: string;
  name: string;
  locationName: string;
  status: string;
  profile: QueueProfile;
  profileOptions: unknown;
  ticketPrefix: string;
  /** Tickets actifs (en attente, appelés, servis) au chargement de la page. */
  activeCount: number;
}

const ALL: readonly QueueProfile[] = QUEUE_PROFILES;

export function MetierPanel({
  organizationId,
  activity,
  activityLabel,
  queues,
}: {
  organizationId: string;
  activity: string | null;
  activityLabel: string;
  queues: MetierQueue[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const declared: QueueProfile | null = isActivityType(activity) ? ACTIVITY_PROFILE[activity] : null;

  return (
    <div className={styles.panel}>
      <p className={styles.lead}>
        Activité déclarée à l’inscription&nbsp;: <strong>{activityLabel}</strong>
        {declared && declared !== 'walkin' ? (
          <> · métier correspondant&nbsp;: <strong>{getProfile(declared).label}</strong></>
        ) : null}
        . Le commerçant ne choisit pas son métier&nbsp;: il s’active ici, file par file, et le
        commerce en règle ensuite les options dans ses Réglages.
      </p>

      {queues.length === 0 ? (
        <p className={styles.empty}>Aucune file pour l’instant.</p>
      ) : (
        <ul className={styles.queues}>
          {queues.map((queue) => (
            <QueueMetier
              key={queue.id}
              organizationId={organizationId}
              queue={queue}
              activity={activity}
              declared={declared}
              open={openId === queue.id}
              onToggle={() => setOpenId(openId === queue.id ? null : queue.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueMetier({
  organizationId, queue, activity, declared, open, onToggle,
}: {
  organizationId: string;
  queue: MetierQueue;
  activity: string | null;
  declared: QueueProfile | null;
  open: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const benchId = useId();
  const current = queue.profile;
  const [candidate, setCandidate] = useState<QueueProfile | null>(null);
  const [hovered, setHovered] = useState<QueueProfile | null>(null);
  const [error, setError] = useState<{ message: string; busy: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Refermé : on repart d'un choix vide.
  useEffect(() => {
    if (!open) { setCandidate(null); setHovered(null); setError(null); }
  }, [open]);

  const label = (p: QueueProfile) => metierLabel(p, activity);
  const shown = hovered ?? candidate ?? current;
  const shownOptions = shown === current
    ? resolveProfileOptions(current, queue.profileOptions, activity)
    : resolveProfileOptions(shown, null, activity);
  const busy = queue.activeCount;

  const confirm = (target: QueueProfile) => {
    setError(null);
    setNote(null);
    // L'aperçu revient au métier confirmé, pas à la dernière latte survolée.
    setHovered(null);
    startTransition(async () => {
      const result = await assignQueueProfile({ organizationId, queueId: queue.id, profile: target });
      if (!result.ok) {
        setError({ message: result.error, busy: result.code === 'queue_not_empty' });
        return;
      }
      const parts = [`« ${queue.name} » passe en ${label(result.data.profile)}.`];
      if (result.data.settingsRestored) parts.push('Ses réglages d’avant sont rétablis.');
      if (result.data.servicesRetired > 0) {
        const n = result.data.servicesRetired;
        parts.push(`${n} motif${n > 1 ? 's' : ''} de l’ancien métier retiré${n > 1 ? 's' : ''}.`);
      }
      if (result.data.servicesCreated > 0) {
        const n = result.data.servicesCreated;
        parts.push(`${n} motif${n > 1 ? 's' : ''} du métier créé${n > 1 ? 's' : ''}.`);
      }
      setNote(parts.join(' '));
      setCandidate(null);
      setHovered(null);
      onToggle();
      router.refresh();
    });
  };

  return (
    <li className={styles.queue} data-open={open ? '1' : undefined}>
      <div className={styles.row}>
        <span className={styles.glyph} aria-hidden="true"><ProfileGlyph profile={current} /></span>
        <div className={styles.identity}>
          <p className={styles.queueName}>{queue.name}</p>
          <p className={styles.queuePlace}>{queue.locationName}</p>
        </div>
        <div className={styles.current}>
          <span className={styles.currentKicker}>Métier</span>
          <span className={styles.currentLabel}>{label(current)}</span>
        </div>
        <span className={styles.busy} data-busy={busy > 0 ? '1' : undefined}>
          {busy > 0 ? `${busy} en cours` : 'File vide'}
        </span>
        <button
          type="button"
          className={`btn btn--sm ${open ? 'btn--quiet' : 'btn--ghost'} ${styles.toggle}`}
          aria-expanded={open}
          aria-controls={benchId}
          onClick={onToggle}
        >
          {open ? 'Fermer' : 'Changer le métier'}
        </button>
      </div>

      {note && !open && (
        <p className={styles.note} role="status">
          <span className={styles.noteMark} aria-hidden="true" />
          {note}
        </p>
      )}

      {open && (
        <div className={styles.bench} id={benchId}>
          <fieldset className={styles.choicesCol} disabled={pending}>
            <legend className={metier.choicesLegend}>
              Métier de « {queue.name} »
              <span className={metier.choicesHint}> · l’aperçu suit votre choix, rien ne change avant de confirmer</span>
            </legend>
            <div className={metier.choiceList} onMouseLeave={() => setHovered(null)}>
              {ALL.map((p) => {
                const d = getProfile(p);
                const isCurrent = p === current;
                const isChosen = (candidate ?? current) === p;
                return (
                  <label
                    key={p}
                    className={metier.choice}
                    data-chosen={isChosen ? '1' : undefined}
                    onMouseEnter={() => setHovered(p)}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name={`metier-admin-${queue.id}`}
                      value={p}
                      checked={isChosen}
                      onChange={() => { setCandidate(isCurrent ? null : p); setError(null); }}
                      onFocus={() => setHovered(null)}
                    />
                    <span className={metier.choiceGlyph}><ProfileGlyph profile={p} /></span>
                    <span className={metier.choiceText}>
                      <span className={metier.choiceLabel}>{label(p)}</span>
                      <span className={metier.choiceTagline}>{d.tagline}</span>
                    </span>
                    {isCurrent ? (
                      <span className={`chip ${metier.choiceChip}`}>Actuel</span>
                    ) : p === declared ? (
                      <span className={`chip chip--signal ${metier.choiceChip}`}>Activité déclarée</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className={styles.previewCol}>
            <div className={styles.preview} key={shown} data-preview={shown !== current ? '1' : undefined}>
              <MetierApercu
                profile={shown}
                options={shownOptions}
                ticketPrefix={queue.ticketPrefix}
                chair={label('walkin') === getProfile('walkin').label}
              />
            </div>
            <p className={styles.previewCaption} aria-live="polite">
              <span className={styles.previewTag}>{shown === current ? 'Actuel' : 'Aperçu'}</span>
              {label(shown)}
            </p>
          </div>

          <div className={styles.confirmRow}>
            {candidate && candidate !== current ? (
              <AssignTicket
                queueName={queue.name}
                from={current}
                to={candidate}
                activity={activity}
                labelOf={label}
                busy={busy}
                pending={pending}
                error={error}
                onConfirm={() => confirm(candidate)}
                onCancel={() => { setCandidate(null); setError(null); }}
              />
            ) : (
              <p className={styles.idle}>
                Choisissez un autre métier&nbsp;: ce qui changera pour le commerce s’affiche ici, avant toute confirmation.
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** La confirmation : ce qui change pour le commerce, dit AVANT. */
function AssignTicket({
  queueName, from, to, activity, labelOf, busy, pending, error, onConfirm, onCancel,
}: {
  queueName: string;
  from: QueueProfile;
  to: QueueProfile;
  activity: string | null;
  labelOf: (p: QueueProfile) => string;
  busy: number;
  pending: boolean;
  error: { message: string; busy: boolean } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const def = getProfile(to);
  const ttl = def.queueDefaults.entryTtlMinutes;
  const lines: string[] = [
    `Le poste, l’écran client et la TV parlent de ${def.vocab.subjectPlural} : « ${def.vocab.call} », « ${def.vocab.complete} ».`,
  ];
  if (def.defaultServices.length > 0) {
    lines.push(`S’il n’a aucune prestation active, l’établissement reçoit les motifs du métier : ${def.defaultServices.slice(0, 4).join(', ')}${def.defaultServices.length > 4 ? '…' : ''}`);
  }
  if (ttl && ttl > 1440) lines.push(`Une fiche reste suivie ${Math.round(ttl / 1440)} jours, même d’un jour sur l’autre.`);
  if (to === 'desk' && activity === 'health') lines.push('Santé : ni prénom demandé, ni nom à l’écran, ni demande d’avis Google par défaut.');
  lines.push(`Les réglages de « ${labelOf(from)} » sont gardés de côté : y revenir les rétablit.`);
  lines.push('Le commerce voit ce métier dans ses Réglages, en lecture seule, et en règle les options.');

  return (
    <div className={metier.ticket} data-state={error ? 'error' : undefined}>
      <p className={metier.ticketTitle}>
        Passer « {queueName} » en <strong>{labelOf(to)}</strong>&nbsp;?
      </p>
      <ul className={metier.ticketList}>
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      {busy > 0 && !error && (
        <p className={styles.warn}>
          {busy} ticket{busy > 1 ? 's' : ''} en cours au chargement de la page&nbsp;: la file doit être vide avant de changer de métier.
        </p>
      )}
      {error && (
        <p className={metier.ticketError} role="alert">
          {error.message}
          {error.busy && ' Le commerce termine ou retire les tickets en cours depuis son poste, puis vous réessayez.'}
        </p>
      )}
      <div className={metier.ticketActions}>
        <button type="button" className="btn btn--signal" onClick={onConfirm} disabled={pending}>
          {pending ? 'Attribution…' : 'Attribuer ce métier'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel} disabled={pending}>
          Annuler
        </button>
      </div>
    </div>
  );
}
