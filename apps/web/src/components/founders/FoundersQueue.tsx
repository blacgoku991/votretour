import Link from 'next/link';
import {
  FOUNDERS_PLACES,
  foundersPlaces,
  freePlaceLabel,
  placeNumber,
  type FounderPlace,
  type FounderTicket,
} from './places';
import styles from './FoundersQueue.module.css';

/**
 * LES DIX PREMIERS COMMERCES — la file du pied de page, en tickets.
 *
 * Dix tickets numérotés 01 à 10, pendus au rail comme les places du pied :
 * deux rangées de cinq sur ordinateur, une pile au téléphone. Un ticket
 * pris porte le NOM du commerce et sa VILLE, rien d'autre (ni logo, ni
 * prénom, ni adresse) ; une place sans volontaire le dit : « Place n° 7 :
 * libre », en pointillé vermillon, comme la place fantôme du produit.
 *
 * Composant serveur, sans JavaScript. Le seul mouvement est CSS : les
 * tickets se balancent jusqu'à leur place en entrant à l'écran
 * (transform et opacité, mouvement permis seulement).
 */
export function FoundersQueue({ founders }: { founders: readonly FounderTicket[] }): React.JSX.Element {
  const places = foundersPlaces(founders);
  const free = places.filter((p) => p.kind === 'free').length;
  const taken = FOUNDERS_PLACES - free;

  let lead: string;
  if (taken === 0) {
    lead = 'Les dix premières places attendent leurs commerces. Chacun y apparaît s’il le demande : son nom et sa ville, rien d’autre.';
  } else if (free === 0) {
    lead = 'Les dix premiers commerces inscrits sur Rangvia, avec leur accord : leur nom et leur ville, rien d’autre.';
  } else {
    lead = `Les premiers commerces inscrits sur Rangvia, avec leur accord : leur nom et leur ville, rien d’autre. ${
      free > 1 ? `Encore ${free} places libres.` : 'Encore une place libre.'
    }`;
  }

  return (
    <section className={styles.founders} aria-labelledby="premiers-commerces">
      <div className={styles.head}>
        <p className="t-label">Les dix premiers</p>
        <h2 id="premiers-commerces" className={styles.title}>
          Les premiers commerces de la file.
        </h2>
        <p className={styles.lead}>{lead}</p>
      </div>

      <ol className={styles.tickets}>
        {places.map((p, i) => (
          <li
            key={p.place}
            className={styles.ticket}
            data-kind={p.kind}
            style={{ ['--i' as string]: i % 5 } as React.CSSProperties}
          >
            <TicketCard place={p} />
          </li>
        ))}
      </ol>

      {free > 0 && (
        <p className={styles.foot}>
          Votre commerce ici&nbsp;?{' '}
          <Link href="/inscription" className={styles.footLink}>Ouvrez votre file</Link>, puis activez
          «&nbsp;Apparaître parmi les premiers commerces sur Rangvia&nbsp;» dans vos réglages. Vous pouvez
          vous retirer à tout moment.
        </p>
      )}
    </section>
  );
}

/** Le ticket lui-même : talon numéroté, perforation, commerce (ou « libre »). */
function TicketCard({ place: p, unranked = false }: { place: FounderPlace; unranked?: boolean }): React.JSX.Element {
  return (
    <span className={styles.card}>
      <span className={`flap-row flap-row--tile ${styles.num}`} aria-hidden="true">
        {Array.from(unranked ? '––' : placeNumber(p.place)).map((ch, k) => (
          <span key={k} className="flap flap--tile">
            <span className="flap__face flap__rest">{ch}</span>
          </span>
        ))}
      </span>
      {p.kind === 'taken' ? (
        <span className={styles.body}>
          <span className="sr-only">{`Place n° ${p.place} : `}</span>
          <span className={styles.name}>{p.name}</span>
          {p.city && (
            <>
              <span className="sr-only">, </span>
              <span className={styles.city}>{p.city}</span>
            </>
          )}
        </span>
      ) : (
        <span className={styles.body}>
          <span className={styles.freeLabel}>{freePlaceLabel(p.place)}</span>
        </span>
      )}
    </span>
  );
}

/**
 * Un ticket seul, hors de la file : l'aperçu des réglages (« voici ce qui
 * s'affiche »). Même dessin que dans le pied de page, sans rail ni encoche.
 * Décoratif pour les lecteurs d'écran : la phrase voisine dit la même chose.
 * `unranked` : le commerce n'a pas (encore) de place parmi les dix ; le
 * talon montre « –– » plutôt qu'un numéro qu'il n'a pas.
 */
export function FounderTicketPreview({
  place,
  unranked = false,
}: {
  place: FounderPlace;
  unranked?: boolean;
}): React.JSX.Element {
  return (
    <div className={`${styles.ticket} ${styles.preview}`} data-kind={place.kind} aria-hidden="true">
      <TicketCard place={place} unranked={unranked} />
    </div>
  );
}
