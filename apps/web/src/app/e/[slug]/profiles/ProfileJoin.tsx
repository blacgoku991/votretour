'use client';

import { FlapNumber } from '@/components/FlapNumber';
import { Rang } from '@/components/Rang';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { getProfile } from '@/lib/profiles';
import type { ProfileEntryPoint, QueueProfile } from '@/lib/profiles/types';
import type { StaffGate } from '../ClientExperience';
import { JoinFields, type JoinField, type JoinOptions, type JoinValues } from './JoinFields';
import { ContactRow } from './shared';
import clientStyles from '../client.module.css';
import styles from './profiles.module.css';

/**
 * ÉCRAN 1 DES PROFILS — s'inscrire, dans le mot du métier.
 *
 * Même ossature que chez les barbiers : l'information en haut, le geste
 * en bas, à portée de pouce, collé au bas de l'écran quand le formulaire
 * dépasse. Ce qui change, c'est l'objet en tête :
 *
 *  - atelier véhicule : la plaque, dessinée, qui s'écrit PENDANT la frappe ;
 *  - atelier appareil : le choix de l'appareil, en grosses puces ;
 *  - table : le chevalet et ses couverts (dans les champs) ;
 *  - guichet, boutique : le volet du nombre de personnes, comme au fauteuil.
 */

const COUNT_SIZE = 'clamp(4.5rem, 3rem + 12vw, 6.5rem)';

interface Props {
  profile: QueueProfile;
  entryPoint: ProfileEntryPoint;
  waitingCount: number;
  options: JoinOptions;
  staffGate: StaffGate | null;
  name: string;
  onName: (v: string) => void;
  values: JoinValues;
  onValues: (patch: Partial<JoinValues>) => void;
  serviceId: string | null;
  onService: (id: string | null) => void;
  fieldError: { field: JoinField; message: string } | null;
  error: string | null;
  busy: boolean;
  onJoin: () => void;
}

/** Le geste principal, dans le mot du métier. */
export function joinLabel(profile: QueueProfile): string {
  switch (profile) {
    case 'vehicle': return 'Déposer mon véhicule';
    case 'device': return 'Déposer mon appareil';
    case 'table': return 'M’inscrire sur la liste';
    case 'desk': return 'Prendre un numéro';
    default: return 'Rejoindre la file';
  }
}

function closedTitle(profile: QueueProfile, paused: boolean): string {
  if (paused) {
    switch (profile) {
      case 'vehicle':
      case 'device': return 'Dépôts en pause';
      case 'table': return 'Liste en pause';
      case 'desk': return 'Guichets en pause';
      default: return 'File en pause';
    }
  }
  switch (profile) {
    case 'vehicle':
    case 'device': return 'Dépôts fermés';
    case 'table': return 'Liste fermée';
    case 'desk': return 'Guichets fermés';
    default: return 'File fermée';
  }
}

function closedMessage(profile: QueueProfile, paused: boolean, reason: string | null): string {
  // Le titre dit déjà « en pause » : la raison du pro suffit dessous.
  if (paused) return reason ? reason : 'Momentanément en pause. Réessayez dans quelques minutes.';
  switch (profile) {
    case 'vehicle':
    case 'device': return 'Les dépôts en ligne sont fermés pour le moment. Présentez-vous à l’accueil de l’atelier.';
    case 'table': return 'La liste d’attente est fermée pour le moment. Présentez-vous à l’accueil.';
    case 'desk': return 'Les guichets sont fermés pour le moment.';
    default: return 'La file est fermée pour le moment. Présentez-vous à la caisse.';
  }
}

export function ProfileJoin(props: Props) {
  const { profile, entryPoint, waitingCount, options, staffGate, name, onName, values, busy, error } = props;
  const queue = entryPoint.queue;
  const paused = queue?.status === 'paused';
  const nobody = Boolean(staffGate && !staffGate.autoAssign);
  const closed = !queue || queue.status !== 'open' || nobody;
  const vocab = getProfile(profile).vocab;
  const sensitive = options.sensitive === true;
  // Santé : jamais de prénom, quel que soit le réglage de la file.
  const askName = !sensitive && (queue?.askClientName ?? false);
  const nameRequired = askName && (queue?.clientNameRequired ?? false);
  const workshop = profile === 'vehicle' || profile === 'device';

  if (closed) {
    return (
      <div className={clientStyles.panel}>
        <section className={clientStyles.count} aria-label="État">
          <h2 className={clientStyles.closedHead}>
            {nobody && !paused && queue?.status === 'open' ? 'Personne de disponible' : closedTitle(profile, paused)}
          </h2>
          <p className={clientStyles.closedMsg}>
            {nobody && queue?.status === 'open'
              ? 'Personne ne peut vous recevoir pour le moment. Présentez-vous directement à l’accueil.'
              : closedMessage(profile, paused, queue?.pauseReason ?? null)}
          </p>
        </section>
        <div className={`${clientStyles.preview} ${clientStyles.previewOff} ${clientStyles.previewFill}`} aria-hidden="true">
          <div className={clientStyles.previewPlane}>
            <div className={clientStyles.counter}><span className={clientStyles.counterLabel}>{vocab.counter}</span></div>
            <span className={clientStyles.railOnly} />
          </div>
        </div>
        <div className={`${clientStyles.closedDock}`}>
          <ContactRow location={entryPoint.location} />
        </div>
      </div>
    );
  }

  const disabled = busy || (nameRequired && !name.trim());

  return (
    <div className={clientStyles.panel}>
      <JoinHero profile={profile} waitingCount={waitingCount} values={values} />
      {profile === 'desk' && <TicketToCome />}
      {profile === 'retail' && <RangPreview waitingCount={waitingCount} name={name.trim()} counter={vocab.counter} />}

      <form
        className={`${clientStyles.form} ${profile === 'desk' || profile === 'retail' ? '' : styles.joinForm}`}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) props.onJoin();
        }}
      >
        <div className="field-rail">
          <JoinFields
            profile={profile}
            values={values}
            onChange={props.onValues}
            options={options}
            services={entryPoint.services}
            serviceId={props.serviceId}
            onService={props.onService}
            fieldError={props.fieldError}
            onSubmit={() => {
              if (!disabled) props.onJoin();
            }}
          />
          {askName && (
            <div className="field">
              <label htmlFor="prenom">Prénom{nameRequired ? '' : ' (facultatif)'}</label>
              <input
                id="prenom"
                className="input"
                type="text"
                inputMode="text"
                autoComplete="given-name"
                autoCapitalize="words"
                enterKeyHint="go"
                maxLength={40}
                placeholder="Votre prénom"
                aria-describedby="prenom-aide"
                value={name}
                onChange={(e) => onName(e.target.value)}
                required={nameRequired}
              />
              <p id="prenom-aide" className="hint">
                {profile === 'table'
                  ? 'L’accueil appelle les groupes par leur prénom.'
                  : workshop
                    ? 'Pour vous reconnaître à l’accueil. Jamais affiché à l’écran de la salle.'
                    : 'Pour vous appeler.'}
              </p>
            </div>
          )}
        </div>

        <div className={clientStyles.dock}>
          {(error || props.fieldError?.field === 'form') && (
            <div className={`banner banner--error ${clientStyles.joinError}`} role="alert">
              <span>{error ?? props.fieldError?.message}</span>
            </div>
          )}
          <button type="submit" className="btn btn--signal btn--hero" disabled={disabled}>
            {busy ? 'Un instant…' : joinLabel(profile)}
          </button>
        </div>

        <p className={clientStyles.reassure}>
          {workshop
            ? 'Pas de compte, pas d’application. Vous suivez chaque étape d’ici.'
            : profile === 'desk'
              ? 'Pas de compte. À l’écran de la salle, un numéro, jamais un nom.'
              : 'Pas de compte, pas d’application, pas de SMS.'}
        </p>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* L'objet en tête                                                      */
/* ------------------------------------------------------------------ */

function JoinHero({ profile, waitingCount, values }: { profile: QueueProfile; waitingCount: number; values: JoinValues }) {
  if (profile === 'vehicle') {
    const typed = values.registration.trim();
    return (
      <section className={styles.hero} aria-label="Dépôt du véhicule">
        <p className={styles.kicker}>Dépôt au garage</p>
        <h2 className={styles.heroTitle}>Suivez votre véhicule, étape par étape.</h2>
        {/* La plaque se dessine pendant que le client la tape : il vérifie
            d'un coup d'œil ce qu'il a saisi. Vide, une plaque vierge, qui
            attend ses caractères. */}
        <div className={styles.platePreview} data-empty={typed ? undefined : 'true'} aria-hidden="true">
          <Immatriculation value={values.registration} country={values.country} size="lg" width={340} />
        </div>
      </section>
    );
  }
  if (profile === 'device') {
    return (
      <section className={styles.hero} aria-label="Dépôt de l’appareil">
        <p className={styles.kicker}>Dépôt en atelier</p>
        <h2 className={styles.heroTitle}>Suivez la réparation, étape par étape.</h2>
      </section>
    );
  }
  const unit = profile === 'table'
    ? { first: waitingCount <= 1 ? 'groupe' : 'groupes', rest: 'en attente' }
    : { first: waitingCount <= 1 ? 'personne' : 'personnes', rest: 'dans la file' };
  return (
    <section className={clientStyles.count} aria-label="État de la file">
      <div className={clientStyles.countRow}>
        <FlapNumber value={waitingCount} size={COUNT_SIZE} label={`${waitingCount} ${unit.first} ${unit.rest}`} />
        <p className={clientStyles.countUnit} aria-hidden="true">
          <span>{unit.first}</span>
          <span>{unit.rest}</span>
        </p>
      </div>
      {profile === 'desk' && (
        <p className={styles.heroNote}>Vous recevez un numéro. On vous appelle au guichet, sans jamais afficher votre nom.</p>
      )}
      {profile === 'table' && waitingCount === 0 && (
        <p className={clientStyles.countNote}>Vous serez les prochains.</p>
      )}
    </section>
  );
}

/**
 * Guichet : le numéro qu'on va recevoir, pas encore tiré. Des tuiles
 * vides là où tombera « A-042 » : on ne l'invente pas avant
 * l'inscription, c'est la base qui le tire.
 */
function TicketToCome() {
  return (
    <div className={styles.ticketToCome} aria-hidden="true">
      <p className={styles.ticketToComeLabel}>Votre numéro</p>
      <div className={styles.ticketToComeTiles}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={styles.blankTile} data-dash={i === 1 ? 'true' : undefined} />
        ))}
      </div>
    </div>
  );
}

/** Boutique : l'aperçu du Rang des barbiers, « Caisse » en tête, votre place au bout. */
function RangPreview({ waitingCount, name, counter }: { waitingCount: number; name: string; counter: string }) {
  return (
    <div className={clientStyles.preview} aria-hidden="true">
      <div className={clientStyles.previewPlane}>
        <div className={clientStyles.counter}><span className={clientStyles.counterLabel}>{counter}</span></div>
        <Rang
          ahead={waitingCount}
          ghostSelf
          relief
          maxSlats={4}
          selfLabel={name || 'Votre place'}
          selfHint={name ? 'Votre place' : null}
        />
      </div>
    </div>
  );
}
