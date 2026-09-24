'use client';

import { TicketNumber } from '@/components/objects/TicketNumber';
import { getProfile } from '@/lib/profiles';
import type { ProfileTicketState } from '@/lib/profiles/types';
import { hoursLine, isRetailOrder } from './phase';
import { CheckIcon, ClockIcon, PinIcon, StarIcon, Threshold } from './shared';
import clientStyles from '../client.module.css';
import styles from './profiles.module.css';

/**
 * ÉCRANS DE FIN DU GUICHET, DE LA BOUTIQUE ET DE LA TABLE — dans le mot du
 * métier.
 *
 * `DonePanel` et `ClosedPanel` des barbiers restent tels quels pour eux :
 * leur repère dit « Comptoir », leur bouton « Revenir dans la file », leur
 * message d'absence « présentez-vous au comptoir ». Faux au guichet (on y
 * reprend un NUMÉRO, et le repère est le guichet), en boutique (la caisse)
 * ou au restaurant (l'accueil, la liste). Mêmes classes, même mise en
 * page, même récit (la latte passe le repère) ; seuls les mots changent,
 * et le guichet montre son numéro plutôt qu'un prénom qu'il n'a pas.
 */

/**
 * Une ligne d'information ancrée sous le récit de fin : l'adresse et les
 * horaires du jour. Ce qu'on vient chercher en quittant un lieu, et ce
 * qui tient l'écran au lieu d'un grand vide.
 */
export function VisitInfo({ ticket, timeZone }: { ticket: ProfileTicketState; timeZone: string }) {
  const { location } = ticket;
  const address = [location.addressLine1, [location.postalCode, location.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const hours = hoursLine(location.todayHours, timeZone);
  if (!address && !hours) return null;
  return (
    <ul className={styles.visitInfo}>
      {address && (
        <li>
          <PinIcon />
          <span>{address}</span>
        </li>
      )}
      {hours && (
        <li>
          <ClockIcon />
          <span>{hours}</span>
        </li>
      )}
    </ul>
  );
}

/** Guichet et boutique : la latte (ou le numéro) passe le guichet, la caisse. */
export function QueueDone({
  ticket, timeZone, onAgain,
}: {
  ticket: ProfileTicketState;
  timeZone: string;
  onAgain: () => void;
}) {
  const profile = ticket.queue.profile;
  const { entry } = ticket;
  const vocab = getProfile(profile).vocab;
  const desk = profile === 'desk';
  const order = isRetailOrder(profile, entry.stage) || Boolean(entry.details.orderRef && profile === 'retail');
  const reviewUrl = ticket.location.googleReviewUrl;
  // Au guichet, jamais de prénom : le numéro, tel que la salle l'a appelé.
  const self = desk ? null : entry.name || 'Vous';

  return (
    <div className={clientStyles.panel}>
      <div className={clientStyles.doneGroup}>
        <div className={clientStyles.doneRail} aria-hidden="true">
          <Threshold label={vocab.counter} />
          <div className={clientStyles.doneTrack}>
            <span className={clientStyles.doneSlot}>
              <CheckIcon />
              <span>{order ? 'Commande remise' : desk ? 'Passage au guichet terminé' : 'Passage terminé'}</span>
            </span>
            <span className={clientStyles.doneSlat}>
              <span className={clientStyles.doneDot} />
              {self ?? (entry.ticketNo
                ? <TicketNumber value={entry.ticketNo} size="1.5rem" className={styles.doneTicket} />
                : 'Vous')}
            </span>
          </div>
        </div>

        <section className={clientStyles.doneText}>
          <h2 className="t-display">{order ? 'Bonne journée' : 'Merci de votre visite'}</h2>
          <p className={clientStyles.doneName}>{ticket.location.name}</p>
          <VisitInfo ticket={ticket} timeZone={timeZone} />
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
          {desk ? 'Reprendre un numéro' : 'Revenir dans la file'}
        </button>
      </div>
    </div>
  );
}

/**
 * Absent, retiré, expiré, parti : le même bloc sobre que chez les
 * barbiers, dans le mot du métier (« Présentez-vous à l'accueil », « au
 * guichet », « à la caisse » ; « la liste », « votre numéro »).
 */
export function QueueClosed({ ticket, onAgain }: { ticket: ProfileTicketState; onAgain: () => void }) {
  const profile = ticket.queue.profile;
  const status = ticket.entry.status;
  const table = profile === 'table';
  const desk = profile === 'desk';
  const where = table ? 'à l’accueil' : desk ? 'à l’accueil du guichet' : 'à la caisse';
  const line = table ? 'la liste' : 'la file';

  const kicker =
    status === 'absent' ? 'Absent'
    : status === 'skipped' ? (table ? 'Retiré de la liste' : 'Retiré de la file')
    : status === 'expired' ? (desk ? 'Numéro expiré' : 'Place expirée')
    : desk ? 'Numéro rendu' : table ? 'Liste quittée' : 'File quittée';
  const message =
    status === 'absent'
      ? desk
        ? 'Votre numéro est passé sans réponse. Présentez-vous à l’accueil, ou reprenez un numéro.'
        : `${table ? 'Votre groupe a été noté absent' : 'Vous avez été noté absent'}. Présentez-vous ${where} pour reprendre votre place.`
    : status === 'skipped'
      ? `Vous avez été retiré de ${line}.`
    : status === 'expired'
      ? desk ? 'Votre numéro a expiré.' : 'Votre place a expiré.'
    : desk
      ? 'Vous avez rendu votre numéro.'
      : `Vous avez quitté ${line}.`;

  return (
    <div className={clientStyles.panel}>
      <section className={clientStyles.closed}>
        <p className="t-label">{kicker}</p>
        <h2 className={clientStyles.closedTitle}>{message}</h2>
        <p className={clientStyles.doneName}>{ticket.location.name}</p>
      </section>
      <div className={clientStyles.bottom}>
        <button type="button" className="btn btn--signal btn--hero" onClick={onAgain}>
          {desk ? 'Reprendre un numéro' : table ? 'Se réinscrire sur la liste' : 'Rejoindre à nouveau'}
        </button>
      </div>
    </div>
  );
}
