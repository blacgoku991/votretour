import Link from 'next/link';
import {
  LONG_NAME,
  foundersLayout,
  openPlaceLabel,
  placeNumber,
  restPlacesLabel,
  type FounderPlace,
  type FounderTicket,
} from './places';
import styles from './FoundersQueue.module.css';

/** Où mène la place à prendre : l'inscription, comme « Ouvrir ma file ». */
const OPEN_HREF = '/inscription';

/**
 * LES DIX PREMIERS COMMERCES — la file du pied de page, en tickets.
 *
 * On ne dessine que ce qui existe : les tickets pris (NOM et VILLE du
 * commerce, rien d'autre : ni logo, ni prénom, ni adresse), puis UNE
 * place fantôme vermillon, la prochaine libre, qui mène à l'inscription.
 * C'est la place fantôme du produit : une seule par file, jamais dix.
 * Les autres places libres tiennent en une latte neutre (« 05 à 10 :
 * libres »), sur ordinateur seulement : au téléphone, la pile s'arrête à
 * la place à prendre, et la phrase d'en-tête dit combien il en reste.
 *
 * Sans aucun commerce, pas de grille : la place n° 1 et l'invitation,
 * côte à côte. Une vitrine vide ne doit pas s'afficher comme telle.
 *
 * Composant serveur, sans JavaScript. Le seul mouvement est CSS : les
 * tickets se balancent jusqu'à leur place en entrant à l'écran
 * (transform et opacité, mouvement permis seulement).
 */
export function FoundersQueue({ founders }: { founders: readonly FounderTicket[] }): React.JSX.Element {
  const { places, rest, taken, free, compact } = foundersLayout(founders);

  let lead: string;
  if (compact) {
    lead = 'Les dix premiers commerces inscrits sur Rangvia y apparaissent s’ils le souhaitent : leur nom et leur ville, rien d’autre.';
  } else if (free === 0) {
    lead = 'Les dix premiers commerces inscrits sur Rangvia, avec leur accord : leur nom et leur ville, rien d’autre.';
  } else {
    lead = `Les premiers commerces inscrits sur Rangvia, avec leur accord : leur nom et leur ville, rien d’autre. ${
      free > 1 ? `Encore ${free} places libres.` : 'Encore une place libre.'
    }`;
  }

  const invitation = (
    <p className={styles.foot}>
      Votre commerce ici&nbsp;?{' '}
      <Link href={OPEN_HREF} className={styles.footLink}>Ouvrez votre file</Link>, puis activez
      «&nbsp;Apparaître parmi les premiers commerces sur Rangvia&nbsp;» dans vos réglages. Vous pouvez
      vous retirer à tout moment.
    </p>
  );

  // Sur ordinateur, la latte des places libres finit la rangée de cinq
  // où elle tombe (ou en occupe une entière si la rangée est pleine).
  const restSpan = 5 - (places.length % 5);

  return (
    <section className={styles.founders} aria-labelledby="premiers-commerces" data-compact={compact || undefined}>
      <div className={styles.head}>
        <p className="t-label">Les dix premiers</p>
        <h2 id="premiers-commerces" className={styles.title}>
          Les premiers commerces de la file.
        </h2>
        <p className={styles.lead}>{lead}</p>
      </div>

      <div className={styles.row}>
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
          {!compact && rest.length > 0 && (
            <li
              className={`${styles.ticket} ${styles.rest}`}
              data-kind="rest"
              style={{ ['--i' as string]: places.length % 5, ['--span' as string]: restSpan } as React.CSSProperties}
            >
              <span className={styles.restCard}>{restPlacesLabel(rest)}</span>
            </li>
          )}
        </ol>
        {compact && invitation}
      </div>

      {!compact && free > 0 && invitation}
    </section>
  );
}

/** Le ticket lui-même : talon numéroté, perforation, commerce (ou place à prendre). */
function TicketCard({ place: p, unranked = false }: { place: FounderPlace; unranked?: boolean }): React.JSX.Element {
  const stub = (
    <span className={`flap-row flap-row--tile ${styles.num}`} aria-hidden="true">
      {Array.from(unranked ? '––' : placeNumber(p.place)).map((ch, k) => (
        <span key={k} className="flap flap--tile">
          <span className="flap__face flap__rest">{ch}</span>
        </span>
      ))}
    </span>
  );

  if (p.kind === 'open') {
    return (
      <Link href={OPEN_HREF} className={`${styles.card} ${styles.openCard}`}>
        {stub}
        <span className={styles.body}>
          <span className={styles.openLabel}>{openPlaceLabel(p.place)}</span>
          <span className={styles.openCta} aria-hidden="true">
            Ouvrir ma file
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={styles.openArrow}>
              <path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="sr-only">, ouvrir votre file</span>
        </span>
      </Link>
    );
  }

  const long = p.name.length > LONG_NAME;
  return (
    <span className={styles.card}>
      {stub}
      <span className={styles.body}>
        <span className="sr-only">{`Place n° ${p.place} : `}</span>
        {/* Le nom peut être coupé à deux lignes : l'infobulle le donne en entier. */}
        <span className={styles.name} data-long={long || undefined} title={p.name}>{p.name}</span>
        {p.city && (
          <>
            <span className="sr-only">, </span>
            <span className={styles.city} title={p.city}>{p.city}</span>
          </>
        )}
      </span>
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
  place: Extract<FounderPlace, { kind: 'taken' }>;
  unranked?: boolean;
}): React.JSX.Element {
  return (
    <div className={`${styles.ticket} ${styles.preview}`} data-kind={place.kind} aria-hidden="true">
      <TicketCard place={place} unranked={unranked} />
    </div>
  );
}
