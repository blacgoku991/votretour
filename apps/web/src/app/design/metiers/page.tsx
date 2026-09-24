import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DeviceGlyph, DEVICE_LABEL } from '@/components/objects/DeviceGlyph';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { PartySize } from '@/components/objects/PartySize';
import { StageRail } from '@/components/objects/StageRail';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { PROFILES, QUEUE_PROFILES } from '@/lib/profiles';
import { profileNotificationCopy, type ProfileCopyContext } from '@/lib/profiles/copy';
import { DEVICE_KINDS } from '@/lib/profiles/details';
import { formatRegistrationInput, maskRegistration, parseRegistration } from '@/lib/profiles/registration';
import type { ProfileNotificationKind, ProfileStage, QueueProfile } from '@/lib/profiles/types';
import { TicketFlapDemo } from './Demos';
import styles from './metiers.module.css';

/**
 * PLANCHE DES PROFILS MÉTIER — page de développement.
 *
 * Les objets visuels des métiers (immatriculation, rail d'étapes, numéro
 * de ticket, chevalet, pictogrammes), chacun dans ses états, en thème
 * clair ET sombre côte à côte. C'est la référence visuelle des lots
 * « postes », « écran client », « TV » et des pages métier.
 *
 * Tout est rendu côté serveur, sauf l'îlot du volet (`Demos.tsx`) : si un
 * objet cessait d'être un composant pur, cette page ne compilerait plus.
 * Introuvable en production, jamais indexée.
 */

export const metadata: Metadata = {
  title: 'Planche des profils métier',
  robots: { index: false, follow: false },
};

const TZ = 'Europe/Paris';

const SECTIONS = [
  ['immatriculation', 'L’immatriculation'],
  ['etapes', 'Le rail d’étapes'],
  ['ticket', 'Le numéro de ticket'],
  ['chevalet', 'Le chevalet'],
  ['appareils', 'Les appareils'],
  ['touches', 'Les touches du métier'],
  ['notifications', 'L’écran verrouillé'],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

/* Historique d'exemple : reçu, diagnostic, devis accordé, réparation. */
const HISTORY: { stage: ProfileStage; at: string }[] = [
  { stage: 'received', at: '2026-09-24T06:42:00Z' },
  { stage: 'diagnosis', at: '2026-09-24T07:10:00Z' },
  { stage: 'quote_pending', at: '2026-09-24T08:05:00Z' },
  { stage: 'in_repair', at: '2026-09-24T10:15:00Z' },
];
/* Un devis qui n'a pas eu lieu : la pièce est passée, le devis est sauté. */
const HISTORY_NO_QUOTE: { stage: ProfileStage; at: string }[] = [
  { stage: 'received', at: '2026-09-24T06:42:00Z' },
  { stage: 'diagnosis', at: '2026-09-24T07:10:00Z' },
  { stage: 'waiting_parts', at: '2026-09-24T07:55:00Z' },
];

const REGISTRATION_INPUTS = ['ab123cd', 'fx 482 kl', '1234ab75', '56 xz 2a', 'ho-123-ab'] as const;

const NOTIFICATIONS: { profile: QueueProfile; kind: ProfileNotificationKind; ctx: ProfileCopyContext }[] = [
  { profile: 'walkin', kind: 'your_turn', ctx: { profile: 'walkin', locationName: 'Barber House' } },
  {
    profile: 'vehicle',
    kind: 'quote_ready',
    ctx: {
      profile: 'vehicle',
      locationName: 'Garage des Tilleuls',
      quote: { amountCents: 18400, label: 'Plaquettes + disques AV' },
    },
  },
  {
    profile: 'vehicle',
    kind: 'your_turn',
    ctx: {
      profile: 'vehicle',
      locationName: 'Garage des Tilleuls',
      details: { registration: 'AB-123-CD', model: 'Peugeot 208' },
      hours: { status: 'open', closesAt: '19:00' },
    },
  },
  {
    profile: 'device',
    kind: 'your_turn',
    ctx: {
      profile: 'device',
      locationName: 'Répar’Express',
      details: { deviceKind: 'phone', model: 'iPhone 13' },
      ticketNo: '0042',
      hours: { status: 'open', closesAt: '19:00' },
    },
  },
  { profile: 'table', kind: 'your_turn', ctx: { profile: 'table', locationName: 'Chez Margaux', graceMinutes: 5 } },
  {
    profile: 'desk',
    kind: 'your_turn',
    ctx: { profile: 'desk', locationName: 'Maison des services', ticketNo: 'A-042', deskLabel: 'Guichet 3' },
  },
  {
    profile: 'retail',
    kind: 'your_turn',
    ctx: { profile: 'retail', locationName: 'La Mercerie', stage: 'ready', details: { orderRef: '1234' } },
  },
];

/* ------------------------------------------------------------------ */
/* Mise en page                                                         */
/* ------------------------------------------------------------------ */

function Sec({
  n,
  id,
  title,
  note,
  children,
}: {
  n: number;
  id: SectionId;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-titre`}>
      <header className={styles.sectionHead}>
        <p className="t-kicker">
          <span className="t-kicker__num">{String(n).padStart(2, '0')}</span>
          {SECTIONS.find(([k]) => k === id)?.[1]}
        </p>
        <h2 id={`${id}-titre`} className={`t-title ${styles.sectionTitle}`}>
          {title}
        </h2>
        <p className={`t-small t-muted ${styles.sectionNote}`}>{note}</p>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** Le même contenu, posé côte à côte sur une surface claire et une sombre. */
function ThemePair({ children, flush = false }: { children: React.ReactNode; flush?: boolean }) {
  return (
    <div className={styles.pair}>
      {(['light', 'dark'] as const).map((theme) => (
        <div key={theme} className={styles.panel} data-theme={theme} data-flush={flush ? 'true' : undefined}>
          <span className={`t-label ${styles.panelTag}`}>{theme === 'light' ? 'Clair' : 'Sombre'}</span>
          {children}
        </div>
      ))}
    </div>
  );
}

function Fig({ caption, children, wide = false }: { caption: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <figure className={styles.fig} data-wide={wide ? 'true' : undefined}>
      <div className={styles.figStage}>{children}</div>
      <figcaption className="t-label">{caption}</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Compositions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Saisie → mise en forme → validation → forme masquée. Un tableau quand la
 * place le permet ; sous 600 px, une carte par saisie, dans le même ordre
 * de lecture (le tableau serait sinon rogné, colonne « Masqué » comprise,
 * qui est justement celle qui démontre la règle). Les deux sont rendus, le
 * CSS n'en montre qu'un : `display: none` retire aussi l'autre de
 * l'arbre d'accessibilité.
 */
function RegistrationRules() {
  const rows = REGISTRATION_INPUTS.map((input) => ({ input, typed: formatRegistrationInput(input), parsed: parseRegistration(input) }));
  const title = 'Saisie → mise en forme pendant la frappe → forme masquée';
  return (
    <div className={styles.regDemo}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="t-label">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Saisi</th>
              <th scope="col">Pendant la frappe</th>
              <th scope="col">Validé</th>
              <th scope="col">Masqué</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ input, typed, parsed }) => (
              <tr key={input}>
                <td><code className={styles.code}>{input}</code></td>
                <td><code className={styles.code}>{typed}</code></td>
                <td>
                  {parsed.ok ? (
                    <span className="chip chip--jade">{parsed.format.toUpperCase()}</span>
                  ) : (
                    <span className={`t-small ${styles.refusal}`}>{parsed.reason}</span>
                  )}
                </td>
                <td>
                  {parsed.ok ? (
                    <Immatriculation maskedValue={maskRegistration(parsed.display)} size="sm" />
                  ) : (
                    <span className="t-muted" aria-label="Aucune forme masquée">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.regCards}>
        <p className={`t-label ${styles.regTitle}`}>{title}</p>
        <ol className={styles.regList}>
          {rows.map(({ input, typed, parsed }) => (
            <li key={input} className={styles.regCard} data-ok={parsed.ok ? 'true' : 'false'}>
              <p className={styles.regFlow}>
                <span className={styles.regStep}>
                  <span className={styles.regKey}>Saisi</span>
                  <code className={styles.code}>{input}</code>
                </span>
                <span className={styles.regArrow} aria-hidden="true">→</span>
                <span className={styles.regStep}>
                  <span className={styles.regKey}>Pendant la frappe</span>
                  <code className={styles.code}>{typed}</code>
                </span>
              </p>
              {parsed.ok ? (
                <div className={styles.regResult}>
                  <span className="chip chip--jade">{parsed.format.toUpperCase()}</span>
                  <span className={styles.regArrow} aria-hidden="true">→</span>
                  <span className={styles.regStep}>
                    <span className={styles.regKey}>Masqué</span>
                    <Immatriculation maskedValue={maskRegistration(parsed.display)} size="sm" />
                  </span>
                </div>
              ) : (
                <p className={`t-small ${styles.refusal}`}>{parsed.reason}</p>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** La fiche d'atelier du pro : une latte dont l'encoche devient l'œillet d'une étiquette de clé. */
function WorkshopCard() {
  return (
    <article className={styles.workCard} aria-label="Fiche d’atelier, exemple">
      <span className={styles.eyelet} aria-hidden="true" />
      <div className={styles.workTop}>
        <Immatriculation value="AB-123-CD" size="md" />
        <span className="chip chip--jade">Accordé 10:14</span>
      </div>
      <p className={styles.workMeta}>
        <strong>Peugeot 208</strong>
        <span className="t-muted">· Camille</span>
        <span className="chip">Freins</span>
      </p>
      <p className="t-small t-muted">Déposé il y a 3 h 40 · Prévenu 10:02 ✓</p>
      <StageRail profile="vehicle" current="in_repair" history={HISTORY} timeZone={TZ} />
      <button type="button" className="btn btn--signal btn--key btn--block">
        {PROFILES.vehicle.vocab.call}
      </button>
    </article>
  );
}

/** Le ticket de dépôt d'un atelier appareil : latte à souche dentelée. */
function DeviceTicket() {
  return (
    <article className={styles.depot} aria-label="Ticket de dépôt, exemple">
      <div className={styles.depotMain}>
        <p className="t-label">Dossier</p>
        <TicketNumber value="0042" kind="dossier" size="2.25rem" />
        <p className={styles.depotDevice}>
          <DeviceGlyph kind="phone" size={18} />
          iPhone 13 · Écran
        </p>
      </div>
      <div className={styles.depotStub} aria-hidden="true">
        <DeviceGlyph kind="phone" size={28} />
        <span className={styles.depotStubNo}>0042</span>
      </div>
    </article>
  );
}

/** L'écran du client, en vertical : l'immatriculation au centre, puis le Rang des étapes. */
function ClientPhone({ current, history }: { current: ProfileStage; history: { stage: ProfileStage; at: string }[] }) {
  return (
    <div className={styles.phone}>
      <p className="t-label">Garage des Tilleuls</p>
      <div className={styles.phonePlate}>
        <Immatriculation value="AB-123-CD" size="lg" />
        <p className={styles.phoneModel}>Peugeot 208 · Camille</p>
      </div>
      <StageRail profile="vehicle" current={current} history={history} orientation="vertical" timeZone={TZ} />
      <p className={`t-small ${styles.promise}`}>
        Prévu jeudi 17 h, <span className="t-muted">annoncé par le garage</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function MetiersDesignPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className={styles.page}>
      {/* ------------------------------------------------------ En-tête */}
      <header className={styles.hero}>
        <span className="floor-marks" aria-hidden="true" />
        <div className={`shell ${styles.heroInner}`}>
          <div className={styles.heroText}>
            <p className="t-label">Rangvia · planche des profils métier · développement</p>
            <h1 className="t-hero">Chaque métier a son objet.</h1>
            <p className="t-lead">
              Une plaque d’immatriculation, un rail d’étapes, un numéro de guichet, un chevalet de
              table. Des composants purs, rendus ici côté serveur, dans les deux thèmes.
            </p>
            <nav aria-label="Sections de la planche" className={styles.toc}>
              <ol className="rail-list">
                {SECTIONS.map(([id, label], i) => (
                  <li key={id}>
                    <a href={`#${id}`} className={styles.tocLink}>
                      <span className={styles.tocNum}>{String(i + 1).padStart(2, '0')}</span>
                      {label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
          <div className={styles.still} aria-label="Nature morte : les objets des métiers posés sur le comptoir">
            <div className={styles.stillPlate}>
              <Immatriculation value="AB-123-CD" width={440} />
            </div>
            <div className={styles.stillTicket}>
              <TicketNumber value="A-042" destination="Guichet 3" size="clamp(2.25rem, 1.6rem + 2.4vw, 3.5rem)" />
            </div>
            <div className={styles.stillTent}>
              <PartySize count={4} name="Karim" state="called" size="lg" />
            </div>
            <div className={styles.stillRail}>
              <StageRail profile="vehicle" current="ready" history={[...HISTORY, { stage: 'ready', at: '2026-09-24T12:32:00Z' }]} timeZone={TZ} />
            </div>
          </div>
        </div>
      </header>

      <main className={`shell ${styles.main}`}>
        {/* ---------------------------------------- 01 Immatriculation */}
        <Sec
          n={1}
          id="immatriculation"
          title="Une vraie plaque, jamais en clair hors du poste"
          note="Rapport 520 × 110, fond blanc qui reste blanc en sombre, eurobande et bande droite vide (ni département ni logo régional). Masquée, elle ne garde que ses trois derniers caractères : les autres deviennent des pastilles creusées, à leur place exacte."
        >
          <ThemePair>
            <div className={styles.figRow}>
              <Fig caption="lg · client et TV" wide>
                <Immatriculation value="AB-123-CD" size="lg" />
              </Fig>
              <Fig caption="md · fiche du pro">
                <Immatriculation value="FX-482-KL" size="md" />
              </Fig>
              <Fig caption="sm · listes">
                <Immatriculation value="GH-907-TR" size="sm" />
              </Fig>
            </div>
            <div className={styles.figRow}>
              <Fig caption="masquée · écran TV" wide>
                <Immatriculation maskedValue={maskRegistration('AB-123-CD')} size="lg" />
              </Fig>
              <Fig caption="ancien format · 1234 AB 75">
                <Immatriculation value="1234ab75" size="md" />
              </Fig>
              <Fig caption="étrangère · unie">
                <Immatriculation value="M-AB 1234" country="other" size="md" />
              </Fig>
            </div>
            <div className={styles.tvStrip} aria-label="Extrait du tableau « Véhicules prêts »">
              <p className={styles.tvTitle}>Véhicules prêts</p>
              <ul className={styles.tvList}>
                {[
                  ['Peugeot 208', 'AB-123-CD', '14:32'],
                  ['Clio V', 'FX-482-KL', '15:05'],
                ].map(([model, reg, at]) => (
                  <li key={reg}>
                    <Immatriculation maskedValue={maskRegistration(reg as string)} size="sm" />
                    <span className={styles.tvModel}>{model}</span>
                    <span className={styles.tvAt}>prêt depuis {at}</span>
                  </li>
                ))}
              </ul>
            </div>
          </ThemePair>

          <RegistrationRules />
        </Sec>

        {/* ------------------------------------------------ 02 Étapes */}
        <Sec
          n={2}
          id="etapes"
          title="Reçu, diagnostic, devis, pièce, réparation, prêt"
          note="Horizontal sur la fiche du pro, vertical sur le téléphone du client, où les étapes sont les lattes du Rang. Un seul vermillon : « Prêt ». Devis cuivre, pièce ardoise, atelier cobalt. Une étape sautée n’est jamais dessinée comme faite."
        >
          <ThemePair>
            <div className={styles.railStack}>
              {(
                [
                  ['received', null, 'reçu · à prendre en charge'],
                  ['quote_pending', HISTORY.slice(0, 3), 'devis envoyé · cuivre'],
                  ['waiting_parts', HISTORY_NO_QUOTE, 'pièce · devis sauté'],
                  ['ready', [...HISTORY, { stage: 'ready' as const, at: '2026-09-24T12:32:00Z' }], 'prêt · vermillon'],
                ] as const
              ).map(([stage, history, caption]) => (
                <Fig key={stage} caption={caption} wide>
                  <StageRail profile="vehicle" current={stage} history={history} timeZone={TZ} />
                </Fig>
              ))}
              <Fig caption="boutique · retrait de commande" wide>
                <StageRail profile="retail" current="preparing" />
              </Fig>
            </div>
          </ThemePair>

          <ThemePair>
            <div className={styles.pro}>
              <WorkshopCard />
            </div>
          </ThemePair>

          <ThemePair>
            <div className={styles.phones}>
              <ClientPhone current="in_repair" history={HISTORY} />
              <ClientPhone current="ready" history={[...HISTORY, { stage: 'ready', at: '2026-09-24T12:32:00Z' }]} />
            </div>
          </ThemePair>
        </Sec>

        {/* ------------------------------------------------ 03 Ticket */}
        <Sec
          n={3}
          id="ticket"
          title="Un numéro, un guichet, jamais un nom"
          note="L’exception assumée à « pas de numéro » : au guichet, la salle appelle A-042, et le nom de la personne n’est jamais affiché. Les tuiles restent encre dans les deux thèmes : c’est un tableau d’affichage."
        >
          <ThemePair>
            <div className={styles.figRow}>
              <Fig caption="en attente">
                <TicketNumber value="A-042" size="3rem" />
              </Fig>
              <Fig caption="appelé · destination" wide>
                <TicketNumber value="A-042" destination="Guichet 3" size="3rem" />
              </Fig>
              <Fig caption="dossier d’atelier">
                <TicketNumber value="0042" kind="dossier" size="2.25rem" />
              </Fig>
            </div>
            <div className={styles.callBoard} aria-label="Tableau d’appel, exemple">
              <div className={styles.callNow}>
                <p className="t-label">Appel en cours</p>
                <TicketNumber value="B-117" destination="Box 2" size="clamp(2rem, 1.4rem + 2.6vw, 3.25rem)" />
              </div>
              <ol className={styles.callRecent} aria-label="Derniers appels">
                {[
                  ['B-116', 'Guichet 1'],
                  ['B-115', 'Guichet 3'],
                  ['B-114', 'Box 2'],
                ].map(([no, desk]) => (
                  <li key={no}>
                    <TicketNumber value={no as string} destination={desk} size="1.25rem" />
                  </li>
                ))}
              </ol>
            </div>
          </ThemePair>
          <div className={styles.demoPanel} data-theme="dark">
            <p className="t-label">Volet animé · TicketNumberFlap (îlot client)</p>
            <TicketFlapDemo />
          </div>
        </Sec>

        {/* ---------------------------------------------- 04 Chevalet */}
        <Sec
          n={4}
          id="chevalet"
          title="Le chevalet, posé sur la table"
          note={'Le chiffre qui compte pour l’hôte, lu avant le prénom. Os en attente, cuivre quand le groupe est appelé, vermillon quand sa table est prête. Au-delà du plafond en ligne\u00a0: «\u00a08+\u00a0».'}
        >
          <ThemePair>
            <div className={styles.tents}>
              <Fig caption="en attente · sm">
                <PartySize count={2} size="sm" />
              </Fig>
              <Fig caption="en attente · md">
                <PartySize count={4} />
              </Fig>
              <Fig caption="appelé · prénom">
                <PartySize count={6} name="Karim" state="called" />
              </Fig>
              <Fig caption="table prête · lg">
                <PartySize count={4} state="ready" size="lg" />
              </Fig>
              <Fig caption="grande table">
                <PartySize count={8} plus />
              </Fig>
            </div>
          </ThemePair>
        </Sec>

        {/* --------------------------------------------- 05 Appareils */}
        <Sec
          n={5}
          id="appareils"
          title="Six appareils, un seul trait"
          note="La géométrie des icônes de l’application : grille de 20, trait de 1,6, angles arrondis. Le mot est toujours écrit à côté ; le code de déverrouillage n’est jamais demandé."
        >
          <ThemePair>
            <ul className={styles.glyphs}>
              {DEVICE_KINDS.map((kind) => (
                <li key={kind} className={styles.glyphChip}>
                  <DeviceGlyph kind={kind} size={36} />
                  <span>{DEVICE_LABEL[kind]}</span>
                </li>
              ))}
            </ul>
            <div className={styles.glyphRow}>
              {DEVICE_KINDS.map((kind) => (
                <DeviceGlyph key={kind} kind={kind} title={DEVICE_LABEL[kind]} />
              ))}
            </div>
            <DeviceTicket />
          </ThemePair>
        </Sec>

        {/* ----------------------------------------------- 06 Touches */}
        <Sec
          n={6}
          id="touches"
          title="Chaque métier parle sa langue"
          note="Le vocabulaire vient du registre (lib/profiles) : c’est lui que citent les pages métier, vérifié par test. La touche vermillon prévient le client (Appeler, Prêt · prévenir, Table prête · appeler) ; la touche claire est TERMINER, sous le nom du métier (Rendu au client, Installer)."
        >
          <ul className={styles.vocab}>
            {QUEUE_PROFILES.map((id) => {
              const p = PROFILES[id];
              return (
                <li key={id} className={styles.vocabRow}>
                  <div className={styles.vocabHead}>
                    <p className="t-board">{p.label}</p>
                    <p className="t-small t-muted">{p.tagline}</p>
                  </div>
                  <div className={styles.vocabKeys}>
                    <div className={styles.vocabKey}>
                      <button type="button" className="btn btn--signal btn--key">
                        {p.vocab.call}
                      </button>
                      <span className={`t-micro t-muted ${styles.vocabRole}`}>prévient</span>
                    </div>
                    <div className={styles.vocabKey}>
                      <button type="button" className="btn btn--ghost btn--lg">
                        {p.vocab.complete}
                      </button>
                      <span className={`t-micro t-muted ${styles.vocabRole}`}>TERMINER</span>
                    </div>
                  </div>
                  <p className={`t-micro t-muted ${styles.vocabCounter}`}>
                    {p.vocab.queue} · {p.vocab.subjectPlural} · {p.vocab.todayCounter}
                  </p>
                </li>
              );
            })}
          </ul>
        </Sec>

        {/* ----------------------------------------- 07 Notifications */}
        <Sec
          n={7}
          id="notifications"
          title="Ce que lit l’écran verrouillé"
          note="Textes réels de profileNotificationCopy. Jamais d’immatriculation complète, jamais de prénom, jamais de motif au guichet. En walkin, exactement les textes d’aujourd’hui."
        >
          <ThemePair>
            <ul className={styles.locks}>
              {NOTIFICATIONS.map(({ profile, kind, ctx }) => {
                const text = profileNotificationCopy(kind, ctx);
                return (
                  <li key={`${profile}-${kind}`} className={styles.lock}>
                    <span className={styles.lockIcon} aria-hidden="true" />
                    <div className={styles.lockText}>
                      <p className={styles.lockApp}>
                        <span>Rangvia</span>
                        <span>maintenant</span>
                      </p>
                      <p className={styles.lockTitle}>{text.title}</p>
                      <p className={styles.lockBody}>{text.body}</p>
                    </div>
                    <span className={`chip ${styles.lockTag}`}>{PROFILES[profile].label}</span>
                  </li>
                );
              })}
            </ul>
          </ThemePair>
        </Sec>
      </main>
    </div>
  );
}
