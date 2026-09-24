'use client';

import { useRef } from 'react';
import { DeviceGlyph, DEVICE_LABEL } from '@/components/objects/DeviceGlyph';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { StageRail } from '@/components/objects/StageRail';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { getProfile } from '@/lib/profiles';
import { clientAheadLabel } from '@/lib/profiles/copy';
import type { ProfileTicketState, QueueProfile } from '@/lib/profiles/types';
import { hoursLine, intakeAhead, promiseLabel, quoteOf, type PublicEntryLite } from './phase';
import { QuoteCard } from './QuoteCard';
import { ReadyCurtain, ReadyNote, ReadyObject } from './ReadyCurtain';
import {
  ClockIcon, ConfirmAction, ContactRow, CurtainOrigin, StageNotify, StarIcon, WalkIcon,
  type ContactLocation, type TicketViewProps,
} from './shared';
import clientStyles from '../client.module.css';
import styles from './workshop.module.css';

/**
 * LA FICHE D'ATELIER, CÔTÉ CLIENT — véhicule ou appareil.
 *
 * Ce qui avance ici, c'est une ÉTAPE, pas une place : le véhicule est prêt
 * quand il est prêt, dans le désordre. Pas de position (sauf à l'étape
 * « Reçu » : « 2 véhicules avant le vôtre », seul décompte honnête), pas
 * de temps estimé. La seule heure affichée est la PROMESSE DU GARAGE, s'il
 * l'a donnée, et dite comme telle : « annoncé par le garage » (conception,
 * § 3.2). Rangvia n'invente jamais un « prêt vers 17 h ».
 *
 * L'objet central est l'étiquette de clé du lien de suivi (`/s/[jeton]`),
 * accrochée à son anneau : le client qui a scanné l'étiquette retrouve ici
 * le même objet, et sa plaque en entier (c'est la sienne, sur son
 * téléphone). Dessous, le Rang vertical des étapes.
 */

/** « le garage », « l'atelier » : qui parle, dans les phrases du client. */
function who(profile: QueueProfile): string {
  return profile === 'vehicle' ? 'le garage' : 'l’atelier';
}

export function WorkshopTicket({
  ticket, organizationId, phase, timeZone, busy, error, vapidPublicKey, walletSlot, fresh, animateReady, onAction,
  publicEntries, onSwitch,
}: TicketViewProps & {
  publicEntries: PublicEntryLite[] | null;
  onSwitch: (entryId: string) => void;
}) {
  const profile = ticket.queue.profile;
  const vocab = getProfile(profile).vocab;
  const { entry } = ticket;
  const isReady = phase === 'ready';
  const tagRef = useRef<HTMLDivElement>(null);
  const quote = ticket.queue.publicOptions?.quotes === false ? null : quoteOf(entry.details);
  const awaiting = Boolean(quote && quote.decision === null && entry.stage === 'quote_pending');
  const ahead = entry.stage === 'received' ? intakeAhead(publicEntries, entry.id) : null;
  const promise = promiseLabel(entry.readyEta ?? entry.details.readyEta, timeZone);
  const hours = hoursLine(ticket.location.todayHours, timeZone);
  const present = entry.status === 'present';
  const subjectWord = profile === 'vehicle' ? 'ce véhicule' : 'cet appareil';

  return (
    <div className={clientStyles.panel}>
      <div className={clientStyles.queued} inert={isReady}>
        <WorkshopTag ticket={ticket} swing={fresh} originRef={tagRef} />

        {/* Un devis qui attend passe devant tout : c'est la seule chose que
            le client a à faire. Décidé, il rejoint le récit, sous le rail. */}
        {quote && awaiting && (
          <QuoteCard quote={quote} awaiting timeZone={timeZone} busy={busy} onAction={onAction} who={who(profile)} />
        )}

        <section className={styles.progress} aria-labelledby="etapes-titre">
          <p id="etapes-titre" className="t-label">Où en est {profile === 'vehicle' ? 'votre véhicule' : 'votre appareil'}</p>
          <StageRail
            profile={profile}
            current={entry.stage}
            history={ticket.stages}
            orientation="vertical"
            timeZone={timeZone}
          />
          {entry.stage === 'received' && (
            <p className={styles.intake}>
              Pris en charge dans l’ordre d’arrivée
              {ahead !== null && (
                <>
                  {' · '}
                  <strong>{clientAheadLabel(profile, ahead)}</strong>
                </>
              )}
            </p>
          )}
          {promise && (
            <p className={styles.promise}>
              <ClockIcon />
              <span>
                Prévu {promise}, <span className={styles.promiseWho}>annoncé par {who(profile)}</span>
              </span>
            </p>
          )}
        </section>

        {quote && !awaiting && (
          <QuoteCard quote={quote} awaiting={false} timeZone={timeZone} busy={busy} onAction={onAction} who={who(profile)} />
        )}

        <StageNotify
          organizationId={organizationId}
          entryId={entry.id}
          vapidPublicKey={vapidPublicKey}
          promise="Nous vous prévenons à chaque étape, même demain : devis, pièce, « prêt »."
        />

        {walletSlot}

        {ticket.otherTickets.length > 0 && (
          <nav className={styles.others} aria-label={`Vos autres ${vocab.subjectPlural}`}>
            <p className="t-label">Vous suivez aussi</p>
            <div className={styles.otherList}>
              {ticket.otherTickets.map((o) => (
                <button key={o.id} type="button" className={styles.other} onClick={() => onSwitch(o.id)}>
                  <span className={styles.otherName}>{o.model ?? `Autre ${vocab.subject}`}</span>
                  <span className={styles.otherStage}>{getProfile(profile).stages.find((s) => s.key === o.stage)?.short ?? 'En cours'}</span>
                </button>
              ))}
            </div>
          </nav>
        )}

        <div className={clientStyles.actions}>
          {error && !isReady && (
            <div className="banner banner--error" role="alert"><span>{error}</span></div>
          )}
          <ContactRow location={ticket.location} callLabel="Appeler" />
          <ConfirmAction
            label={`Ne plus suivre ${subjectWord}`}
            question={`Ne plus suivre ${subjectWord} sur ce téléphone ? Il reste à l’atelier, mais vous ne serez plus prévenu ici.`}
            confirmLabel="Ne plus suivre"
            onConfirm={() => void onAction('unfollow')}
            busy={busy}
          />
        </div>
      </div>

      {isReady && (
        <ReadyCurtain
          originRef={tagRef}
          animate={animateReady}
          locationName={ticket.location.name}
          clientName={entry.name}
          title={vocab.clientTurn}
          subtitle={readySubtitle(hours)}
          long
        >
          <ReadyObject>
            <SubjectObject ticket={ticket} size="curtain" />
          </ReadyObject>
          {present ? (
            <ReadyNote>{profile === 'vehicle' ? 'Le garage sait que vous arrivez.' : 'L’atelier sait que vous arrivez.'}</ReadyNote>
          ) : (
            <button type="button" className="btn btn--solid btn--hero" onClick={() => void onAction('present')} disabled={busy}>
              <WalkIcon />
              J’arrive
            </button>
          )}
          <ContactRow location={ticket.location} tone="ink" callLabel="Appeler" />
          {error && <p className={styles.curtainError} role="alert">{error}</p>}
        </ReadyCurtain>
      )}
    </div>
  );
}

/**
 * Sous « Votre véhicule est prêt » : les vrais horaires du jour
 * (« Ouvert jusqu'à 19 h 00 »), ou, établissement fermé, une consigne
 * qui ne promet rien.
 */
function readySubtitle(hours: string | null): string {
  if (!hours) return 'Présentez-vous à l’accueil';
  return hours.startsWith('Fermé') ? 'À récupérer aux heures d’ouverture' : hours;
}

/* ------------------------------------------------------------------ */
/* L'étiquette de clé                                                   */
/* ------------------------------------------------------------------ */

function WorkshopTag({
  ticket, swing, originRef,
}: {
  ticket: ProfileTicketState;
  swing: boolean;
  originRef: React.RefObject<HTMLDivElement | null>;
}) {
  const profile = ticket.queue.profile;
  const kicker = profile === 'vehicle' ? 'Fiche atelier' : 'Dossier de réparation';
  return (
    <figure className={styles.hang} data-swing={swing ? 'true' : undefined} aria-label={`${kicker}, ${ticket.location.name}`}>
      <svg className={styles.ring} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <circle cx="32" cy="30" r="21" />
        <path d="M32 9.5c7 0 12.5 4.2 14.6 10.2" />
      </svg>
      <div ref={originRef} className={styles.tag} data-profile={profile}>
        <span className={styles.eyelet} aria-hidden="true" />
        <p className={styles.tagKicker}>{kicker}</p>
        <SubjectObject ticket={ticket} size="tag" />
        <CurtainOrigin />
      </div>
    </figure>
  );
}

/**
 * Le sujet suivi : la plaque (véhicule) ou l'appareil et son numéro de
 * dossier. Sur l'écran de SON téléphone, le client voit sa plaque en
 * entier ; c'est à la TV qu'elle est masquée.
 */
function SubjectObject({ ticket, size }: { ticket: ProfileTicketState; size: 'tag' | 'curtain' }) {
  const { entry } = ticket;
  const d = entry.details;
  // Sur le rideau, le prénom est déjà écrit au-dessus du titre : on ne
  // le répète pas sous la plaque.
  const who = [d.model, size === 'tag' ? entry.name : null].filter(Boolean).join(' · ');
  if (ticket.queue.profile === 'vehicle') {
    return (
      <div className={styles.subject}>
        {d.registration
          ? <Immatriculation value={d.registration} country={d.country ?? 'FR'} size="lg" width={size === 'tag' ? 300 : 280} className={styles.plate} />
          : <p className={styles.subjectModel}>{d.model ?? 'Votre véhicule'}</p>}
        {d.registration && who && <p className={styles.subjectWho}>{who}</p>}
        {d.stay === 'onsite' && size === 'tag' && <p className={styles.subjectStay}>Vous attendez sur place</p>}
      </div>
    );
  }
  const kind = d.deviceKind ?? 'other';
  return (
    <div className={styles.subject}>
      <div className={styles.device}>
        <span className={styles.deviceIcon}><DeviceGlyph kind={kind} size={30} /></span>
        <span className={styles.deviceText}>
          <span className={styles.deviceKind}>{DEVICE_LABEL[kind]}</span>
          <span className={styles.deviceModel}>{d.model ?? DEVICE_LABEL[kind]}</span>
        </span>
      </div>
      {entry.ticketNo && (
        <TicketNumber value={entry.ticketNo} kind="dossier" size="clamp(2rem, 1.5rem + 2.4vw, 2.5rem)" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fin : rendu, clos, plus suivi                                        */
/* ------------------------------------------------------------------ */

export function WorkshopDone({ ticket, onAgain }: { ticket: ProfileTicketState; onAgain: () => void }) {
  const reviewUrl = ticket.location.googleReviewUrl;
  const profile = ticket.queue.profile;
  return (
    <div className={clientStyles.panel}>
      <div className={clientStyles.doneGroup}>
        <figure className={styles.hang} data-state="done" aria-hidden="true">
          <svg className={styles.ring} viewBox="0 0 64 64" focusable="false">
            <circle cx="32" cy="30" r="21" />
            <path d="M32 9.5c7 0 12.5 4.2 14.6 10.2" />
          </svg>
          <div className={styles.tag} data-profile={profile}>
            <span className={styles.eyelet} />
            <p className={styles.tagKicker}>{profile === 'vehicle' ? 'Fiche atelier' : 'Dossier de réparation'}</p>
            <SubjectObject ticket={ticket} size="curtain" />
            <span className={styles.stamp}>Rendu</span>
          </div>
        </figure>
        <section className={clientStyles.doneText}>
          <h2 className="t-display">Merci pour votre confiance</h2>
          <p className={clientStyles.doneName}>{ticket.location.name}</p>
        </section>
      </div>
      <div className={clientStyles.bottom}>
        {reviewUrl && (
          <a className="btn btn--signal btn--hero" href={reviewUrl} target="_blank" rel="noreferrer noopener">
            <StarIcon />
            Laisser un avis Google
          </a>
        )}
        <button type="button" className={reviewUrl ? 'btn btn--quiet btn--block' : 'btn btn--ghost btn--hero'} onClick={onAgain}>
          {profile === 'vehicle' ? 'Déposer un autre véhicule' : 'Déposer un autre appareil'}
        </button>
      </div>
    </div>
  );
}

export function WorkshopClosed({ ticket, onAgain }: { ticket: ProfileTicketState; onAgain: () => void }) {
  const status = ticket.entry.status;
  const vehicle = ticket.queue.profile === 'vehicle';
  const kicker = status === 'expired' ? 'Suivi expiré' : status === 'cancelled' ? 'Dépôt annulé' : 'Fiche close';
  const message =
    status === 'expired'
      ? 'Ce suivi a expiré. Pour toute question, appelez l’accueil de l’atelier.'
      : status === 'cancelled'
        ? 'Ce dépôt a été annulé.'
        : vehicle
          ? 'Le garage a clos cette fiche. Pour toute question, appelez l’accueil.'
          : 'L’atelier a clos ce dossier. Pour toute question, appelez l’accueil.';
  return (
    <div className={clientStyles.panel}>
      <section className={clientStyles.closed}>
        <p className="t-label">{kicker}</p>
        <h2 className={clientStyles.closedTitle}>{message}</h2>
        <p className={clientStyles.doneName}>{ticket.location.name}</p>
      </section>
      <div className={clientStyles.bottom}>
        <ContactRow location={ticket.location} callLabel="Appeler" />
        <button type="button" className="btn btn--quiet btn--block" onClick={onAgain}>
          {vehicle ? 'Déposer un autre véhicule' : 'Déposer un autre appareil'}
        </button>
      </div>
    </div>
  );
}

/**
 * Après « Ne plus suivre » : la fiche reste à l'atelier, ce téléphone n'en
 * sait plus rien (la réponse ne porte que son identifiant). On le dit
 * simplement, avec la seule façon de reprendre le suivi.
 */
export function Unfollowed({
  profile, location, onAgain,
}: {
  profile: QueueProfile;
  location: ContactLocation;
  onAgain: () => void;
}) {
  const vehicle = profile === 'vehicle';
  return (
    <div className={clientStyles.panel}>
      <div className={clientStyles.doneGroup}>
        <div className={styles.hang} data-state="empty" aria-hidden="true">
          <svg className={styles.ring} viewBox="0 0 64 64" focusable="false">
            <circle cx="32" cy="30" r="21" />
          </svg>
          <div className={`${styles.tag} ${styles.tagGhost}`}>
            <span className={styles.eyelet} />
            <span className={styles.ghostLine} />
            <span className={`${styles.ghostLine} ${styles.ghostLineShort}`} />
          </div>
        </div>
        <section className={clientStyles.doneText}>
          <p className="t-label">Suivi arrêté</p>
          <h2 className={clientStyles.closedTitle}>
            {vehicle ? 'Ce téléphone ne suit plus votre véhicule.' : 'Ce téléphone ne suit plus votre appareil.'}
          </h2>
          <p className={clientStyles.closedMsg}>
            {vehicle ? 'Il reste pris en charge par le garage.' : 'Il reste pris en charge par l’atelier.'}{' '}
            Pour reprendre le suivi, demandez un QR de suivi à l’accueil.
          </p>
        </section>
      </div>
      <div className={clientStyles.bottom}>
        <ContactRow location={location} callLabel="Appeler" />
        <button type="button" className="btn btn--quiet btn--block" onClick={onAgain}>
          {vehicle ? 'Déposer un autre véhicule' : 'Déposer un autre appareil'}
        </button>
      </div>
    </div>
  );
}
