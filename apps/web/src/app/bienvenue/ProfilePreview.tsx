'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { DeviceGlyph } from '@/components/objects/DeviceGlyph';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { PartySize } from '@/components/objects/PartySize';
import { StageRail } from '@/components/objects/StageRail';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { useReducedMotion } from '@/components/motion/useMotionPreference';
import { getProfile } from '@/lib/profiles';
import { maskRegistration } from '@/lib/profiles/registration';
import type { ActivityType, ProfileStage } from '@/lib/profiles/types';
import type { PreviewProfile } from './metiers';
import styles from './onboarding.module.css';

/**
 * L'APERÇU — ce que verront le client et l'écran de la salle, pour CE
 * métier, avant même d'avoir créé quoi que ce soit.
 *
 * Trois objets posés sur le sol (--floor), comme sur l'accueil :
 *   - la touche du poste du pro, dans son vocabulaire (« Prêt · prévenir ») ;
 *   - le téléphone du client (thème sombre, celui de l'expérience client),
 *     avec les vrais objets du produit : l'immatriculation, le rail
 *     d'étapes, le numéro en volets, le chevalet de table ;
 *   - l'écran de la salle, qui ne montre jamais une plaque en clair (trois
 *     derniers caractères seulement) ni un nom au guichet.
 *
 * Deux places, un seul composant (`variant`) :
 *   - « side » : à partir de 1280 px, l'aperçu tient sa propre colonne,
 *     collée à droite du formulaire. Il est sous les yeux dès l'arrivée,
 *     et se réhabille à l'instant où l'on touche une tuile ;
 *   - « inline » : sous la grille de métiers. Replié sur téléphone derrière
 *     « Voir ce que verront vos clients » (ouverture pilotée par le parcours,
 *     qui propose aussi ce bouton près de la tuile touchée), ouvert d'office
 *     de 1024 à 1279 px.
 *
 * Les maquettes sont dessinées à leur taille d'affichage : aucun texte ne
 * descend sous 11 px. Seul l'écran de la salle est réduit (zoom) quand la
 * place manque, et ses plus petits textes sont dessinés assez grands pour
 * rester lisibles.
 *
 * L'histoire se joue UNE fois à chaque choix de métier, puis s'arrête :
 * la touche s'enfonce, le rideau du téléphone tombe (« prêt »), la ligne
 * arrive sur l'écran. Elle attend que la scène soit à l'écran
 * (IntersectionObserver) : une histoire jouée hors de la vue serait perdue.
 * Seuls transform et opacity bougent ; en mouvement réduit, l'état final
 * s'affiche d'emblée.
 *
 * L'état final est propre, puisqu'il reste affiché : le rideau descend
 * jusqu'à une frontière de la mise en page (l'identité du client, ou tout
 * l'écran au guichet), et ce qu'il recouvre s'efface (`data-under`), sans
 * jamais laisser dépasser une moitié de latte ou de numéro.
 *
 * Libellé « Aperçu » et « Données d'exemple » : rien ici n'est simulé
 * dans la base, et ces images ne servent ni aux pages métier ni à la
 * vidéo, qui ne montrent que le vrai produit.
 *
 * Accessibilité : la scène est décrite une fois en toutes lettres (texte
 * réservé aux lecteurs d'écran) ; les maquettes, purement visuelles, sont
 * masquées de l'arbre d'accessibilité.
 */

type Phase = 'before' | 'press' | 'after';

/** Instants de l'histoire (ms après le choix du métier). */
const PRESS_AT = 1100;
const AFTER_AT = 1400;

interface Scene {
  /** Ce que lit le lecteur d'écran. */
  summary: string;
  phoneCaption: string;
  screenCaption: string;
  /** Pied de l'écran du téléphone : la promesse de notification du métier. */
  phoneFoot: string;
}

/** « Guichet 3 » ne se coupe jamais entre le mot et son numéro. */
const desk = (n: number) => `Guichet ${n}`;

function sceneFor(profile: PreviewProfile, activity: ActivityType): Scene {
  const vocab = getProfile(profile).vocab;
  switch (profile) {
    case 'vehicle':
      return {
        summary:
          'Aperçu avec des données d’exemple. Au poste, la touche « ' + vocab.call + ' ». '
          + 'Sur le téléphone du client : l’immatriculation AB-123-CD, une Peugeot 208, et les étapes du suivi ; '
          + `il passe de « En réparation » à « ${vocab.clientTurn} ». `
          + 'L’écran de l’accueil liste les véhicules prêts, plaque masquée : seuls les trois derniers caractères restent visibles.',
        phoneCaption: 'Le téléphone de votre client',
        screenCaption: 'L’écran de l’accueil',
        phoneFoot: 'Prévenu à chaque étape.',
      };
    case 'device':
      return {
        summary:
          'Aperçu avec des données d’exemple. Au poste, la touche « ' + vocab.call + ' ». '
          + 'Sur le téléphone du client : le dossier 0042, un iPhone 13, et les étapes du suivi ; '
          + `il passe de « En réparation » à « ${vocab.clientTurn} ». `
          + 'L’écran de l’accueil liste les appareils prêts, par numéro de dossier.',
        phoneCaption: 'Le téléphone de votre client',
        screenCaption: 'L’écran de l’accueil',
        phoneFoot: 'Prévenu à chaque étape.',
      };
    case 'table':
      return {
        summary:
          'Aperçu avec des données d’exemple. Au poste, la touche « ' + vocab.call + ' ». '
          + 'Sur le téléphone du client : 4 couverts, 2 groupes avant lui, puis « ' + vocab.clientTurn + ' ». '
          + 'L’écran de l’entrée annonce le prénom et le nombre de couverts.',
        phoneCaption: 'Le téléphone de votre client',
        screenCaption: 'L’écran de l’entrée',
        phoneFoot: 'On vous prévient ici.',
      };
    case 'desk':
      return {
        summary:
          'Aperçu avec des données d’exemple. Au poste, la touche « ' + vocab.call + ' ». '
          + 'Sur le téléphone du visiteur : le ticket A-042, 12 personnes devant lui, puis « Guichet 3 ». '
          + 'L’écran de la salle affiche le numéro et le guichet, jamais un nom.'
          + (activity === 'health' ? ' Aucun motif de visite n’y apparaît.' : ''),
        phoneCaption: activity === 'health' ? 'Le téléphone du patient' : 'Le téléphone du visiteur',
        screenCaption: 'L’écran de la salle d’attente',
        phoneFoot: 'Votre téléphone vous appellera.',
      };
    case 'retail':
      return {
        summary:
          'Aperçu avec des données d’exemple. Au poste, la touche « ' + vocab.call + ' ». '
          + 'Sur le téléphone du client : la commande n° 1234, qui passe de « En préparation » à « ' + vocab.clientTurn + ' ». '
          + 'L’écran de la caisse liste les commandes prêtes.',
        phoneCaption: 'Le téléphone de votre client',
        screenCaption: 'L’écran de la caisse',
        phoneFoot: 'Prévenu dès qu’elle est prête.',
      };
  }
}

/* Historiques d'exemple (heures fixes : rendu identique serveur et client). */
const WORKSHOP_BEFORE: { stage: ProfileStage; at: string }[] = [
  { stage: 'received', at: '2026-09-24T06:42:00Z' },
  { stage: 'diagnosis', at: '2026-09-24T07:10:00Z' },
  { stage: 'in_repair', at: '2026-09-24T09:05:00Z' },
];
const WORKSHOP_AFTER = [...WORKSHOP_BEFORE, { stage: 'ready' as const, at: '2026-09-24T12:32:00Z' }];
const RETAIL_BEFORE: { stage: ProfileStage; at: string }[] = [{ stage: 'preparing', at: '2026-09-24T12:05:00Z' }];
const RETAIL_AFTER = [...RETAIL_BEFORE, { stage: 'ready' as const, at: '2026-09-24T12:32:00Z' }];
const TZ = 'Europe/Paris';

const PLATE = 'AB-123-CD';

export type PreviewVariant = 'inline' | 'side';

export function ProfilePreview({
  profile,
  activity,
  placeName,
  variant,
  open = true,
  onToggle,
  run = 0,
}: {
  profile: PreviewProfile;
  activity: ActivityType;
  /** Nom saisi (établissement, sinon commerce), ou l'exemple du métier. */
  placeName: string;
  variant: PreviewVariant;
  /** Inline, sur téléphone : l'aperçu est-il déplié ? (Ignoré ailleurs.) */
  open?: boolean;
  onToggle?: () => void;
  /** Incrémenté à chaque ouverture : l'histoire se rejoue. */
  run?: number;
}) {
  const reduced = useReducedMotion();
  const sceneKey = `${profile}:${activity}:${run}`;
  // La phase est rattachée à la scène qui l'a produite : au changement de
  // métier, la nouvelle scène part de « avant » dès son premier rendu,
  // sans jamais montrer un instant l'état final de la précédente.
  const [played, setPlayed] = useState<{ key: string; phase: Phase }>({ key: sceneKey, phase: 'before' });
  const phase: Phase = reduced ? 'after' : played.key === sceneKey ? played.phase : 'before';
  const bodyId = useId();
  const titleId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  // La scène est-elle vraiment sous les yeux ? (Repliée ou masquée par la
  // mise en page, elle ne l'est pas : `display: none` ne croise jamais.)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const io = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry && entry.isIntersecting && entry.intersectionRatio >= 0.45)),
      { threshold: [0, 0.45, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sceneKey]);

  // L'histoire se joue une fois par métier choisi, quand on la regarde,
  // puis s'arrête sur son état final.
  const done = played.key === sceneKey && played.phase === 'after';
  useEffect(() => {
    if (reduced || !inView || done) return;
    setPlayed({ key: sceneKey, phase: 'before' });
    const press = window.setTimeout(() => setPlayed({ key: sceneKey, phase: 'press' }), PRESS_AT);
    const after = window.setTimeout(() => setPlayed({ key: sceneKey, phase: 'after' }), AFTER_AT);
    return () => { window.clearTimeout(press); window.clearTimeout(after); };
  }, [sceneKey, reduced, inView, done]);

  const scene = sceneFor(profile, activity);
  const vocab = getProfile(profile).vocab;
  const collapsible = variant === 'inline';
  const parts = phoneParts(profile, activity);

  return (
    <section
      className={styles.preview}
      aria-labelledby={titleId}
      data-variant={variant}
      data-open={!collapsible || open ? '1' : undefined}
      data-theme="dark"
    >
      <div className={styles.previewHead}>
        <span className={styles.previewTag}>Aperçu</span>
        <h2 id={titleId} className={styles.previewTitle}>Ce que verront vos clients</h2>
        {collapsible && (
          <button
            type="button"
            className={styles.previewToggle}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={onToggle}
          >
            {open ? 'Masquer l’aperçu' : 'Voir ce que verront vos clients'}
          </button>
        )}
      </div>

      <div id={bodyId} className={styles.previewBody} data-phase={phase} key={sceneKey}>
        <p className="sr-only">{scene.summary}</p>
        <div className={styles.stage} aria-hidden="true" ref={stageRef}>
          <span className={styles.stageNote}>Données d’exemple</span>
          <figure className={styles.keyFig}>
            <span className={styles.previewKey}>{vocab.call}</span>
            <figcaption className={styles.figCaption}>Votre poste, en un geste</figcaption>
          </figure>

          <figure className={styles.phoneFig}>
            <div className={styles.phone}>
              <div className={styles.phoneScreen} data-reach={profile === 'desk' ? 'full' : 'head'}>
                <div className={styles.phoneStatus}>
                  <span>14:32</span>
                  <span className={styles.phoneIsland} />
                  <span className={styles.phoneBars} />
                </div>
                <div className={styles.phoneHeader} data-under="">
                  <span className={styles.phonePlace}>{placeName}</span>
                  <span className={styles.phoneLive}><span className="pip pip--live" />En direct</span>
                </div>
                <div className={styles.phoneHead} data-under="">{parts.head}</div>
                <div className={styles.phoneRest} data-under={profile === 'desk' ? '' : undefined}>{parts.rest}</div>
                <div className={styles.phoneFoot}>
                  <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                    <path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.8h-13z" />
                    <path d="M8.3 17.2a1.9 1.9 0 0 0 3.4 0" />
                  </svg>
                  {scene.phoneFoot}
                </div>
                <div className={styles.curtain}>
                  <span className={styles.curtainKicker}>{curtainKicker(profile)}</span>
                  <span className={styles.curtainTitle}>{curtainTitle(profile)}</span>
                  <span className={styles.curtainText}>{curtainText(profile)}</span>
                </div>
              </div>
            </div>
            <figcaption className={styles.figCaption}>{scene.phoneCaption}</figcaption>
          </figure>

          <figure className={styles.screenFig}>
            <div className={styles.screenFrame}>
              <div className={styles.tvScreen} data-theme="dark">
                <ScreenBody profile={profile} />
              </div>
            </div>
            <figcaption className={styles.figCaption}>{scene.screenCaption}</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

/**
 * À la place de l'aperçu, dans la colonne de droite, quand le métier choisi
 * n'en a pas (barbier, événement…) : une invitation, avec la silhouette
 * des deux écrans. Elle ne cite que des métiers dont le profil est ouvert.
 */
export function PreviewInvitation({ text }: { text: string }) {
  const titleId = useId();
  return (
    <section className={styles.invite} aria-labelledby={titleId} data-theme="dark">
      <div className={styles.previewHead}>
        <span className={styles.previewTag}>Aperçu</span>
        <h2 id={titleId} className={styles.previewTitle}>Ce que verront vos clients</h2>
      </div>
      <div className={styles.inviteStage}>
        <span className={styles.inviteTv} aria-hidden="true" />
        <span className={styles.invitePhone} aria-hidden="true" />
        <p className={styles.inviteText}>{text}</p>
      </div>
    </section>
  );
}

function curtainKicker(profile: PreviewProfile): string {
  return profile === 'desk' ? 'Ticket A-042' : 'Maintenant';
}
function curtainTitle(profile: PreviewProfile): string {
  return profile === 'desk' ? desk(3) : getProfile(profile).vocab.clientTurn;
}
function curtainText(profile: PreviewProfile): string {
  switch (profile) {
    case 'vehicle': return 'Il vous attend. Ouvert jusqu’à 19 h 00.';
    case 'device': return 'Venez le récupérer. Ouvert jusqu’à 19 h 00.';
    case 'table': return 'Présentez-vous à l’accueil dans les 5 minutes.';
    case 'desk': return 'Présentez-vous maintenant au guichet 3.';
    case 'retail': return 'Elle vous attend à la caisse.';
  }
}

/* ------------------------------------------------------------------ */
/* Le téléphone                                                         */
/* ------------------------------------------------------------------ */

/**
 * Deux étages : `head`, l'identité du client, que le rideau recouvre
 * exactement quand il tombe ; `rest`, ce qui reste à lire sous le rideau
 * (le suivi passé à « prêt », le chevalet). Au guichet, le rideau couvre
 * tout l'écran : il porte lui-même le numéro et le guichet.
 */
function phoneParts(profile: PreviewProfile, activity: ActivityType): { head: React.ReactNode; rest: React.ReactNode } {
  switch (profile) {
    case 'vehicle':
      return {
        head: (
          <>
            <span className={styles.phoneKicker}>Votre véhicule</span>
            <Immatriculation value={PLATE} width={184} />
            <span className={styles.phoneMeta}>Peugeot 208 · Karim</span>
          </>
        ),
        rest: (
          <Swap
            before={<StageRail profile="vehicle" current="in_repair" history={WORKSHOP_BEFORE} orientation="vertical" timeZone={TZ} className={styles.phoneRail} />}
            after={<StageRail profile="vehicle" current="ready" history={WORKSHOP_AFTER} orientation="vertical" timeZone={TZ} className={styles.phoneRail} />}
          />
        ),
      };
    case 'device':
      return {
        head: (
          <>
            <span className={styles.phoneKicker}>Votre dossier</span>
            <span className={styles.phoneTicketRow}>
              <TicketNumber value="0042" kind="dossier" size="2.1rem" />
              <span className={styles.phoneDevice}>
                <DeviceGlyph kind="phone" size={18} />
                iPhone 13
              </span>
            </span>
          </>
        ),
        rest: (
          <Swap
            before={<StageRail profile="device" current="in_repair" history={WORKSHOP_BEFORE} orientation="vertical" timeZone={TZ} className={styles.phoneRail} />}
            after={<StageRail profile="device" current="ready" history={WORKSHOP_AFTER} orientation="vertical" timeZone={TZ} className={styles.phoneRail} />}
          />
        ),
      };
    case 'retail':
      return {
        head: (
          <>
            <span className={styles.phoneKicker}>Votre commande</span>
            <span className={styles.phoneOrder}>n°&nbsp;1234</span>
            <span className={styles.phoneMeta}>Retirer une commande</span>
          </>
        ),
        rest: (
          <Swap
            before={<StageRail profile="retail" current="preparing" history={RETAIL_BEFORE} orientation="vertical" timeZone={TZ} className={styles.phoneRail} />}
            after={<StageRail profile="retail" current="ready" history={RETAIL_AFTER} orientation="vertical" timeZone={TZ} className={styles.phoneRail} />}
          />
        ),
      };
    case 'table':
      return {
        head: (
          <span className={styles.phoneAhead}>
            <span className={styles.phoneKicker}>Liste d’attente</span>
            <TicketNumber value="2" size="3.4rem" />
            <span className={styles.phoneAheadText}>groupes avant vous</span>
          </span>
        ),
        rest: (
          <span className={styles.phoneCenter}>
            <Swap
              before={<PartySize count={4} state="waiting" size="lg" />}
              after={<PartySize count={4} state="ready" size="lg" />}
            />
            <span className={styles.phoneMeta}>Karim · salle ou terrasse</span>
          </span>
        ),
      };
    case 'desk':
      return {
        head: null,
        rest: (
          <span className={styles.phoneCenter}>
            <span className={styles.phoneKicker}>Votre numéro</span>
            <TicketNumber value="A-042" size="3rem" />
            <span className={styles.phoneAheadText}>12 personnes devant vous</span>
            {activity !== 'health' && (
              <span className={styles.phoneChip}>{activity === 'admin_service' ? 'Carte grise' : 'Retrait de colis'}</span>
            )}
          </span>
        ),
      };
  }
}

/** Deux états superposés dans la même case ; la phase choisit lequel se voit. */
function Swap({ before, after }: { before: React.ReactNode; after: React.ReactNode }) {
  return (
    <span className={styles.swap}>
      <span className={styles.swapBefore}>{before}</span>
      <span className={styles.swapAfter}>{after}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* L'écran de la salle (dessiné à 384 × 216)                            */
/* ------------------------------------------------------------------ */

function ScreenBody({ profile }: { profile: PreviewProfile }) {
  switch (profile) {
    case 'vehicle':
      return (
        <ScreenBoard
          title="Véhicules prêts"
          side={[['À l’atelier', '7'], ['Aujourd’hui', '12']]}
          fresh={<ReadyRow label="208" plate={maskRegistration(PLATE)} since="14:32" />}
          rows={[
            <ReadyRow key="a" label="Clio" plate={maskRegistration('FX-482-KL')} since="14:05" />,
            <ReadyRow key="b" label="Golf" plate={maskRegistration('GH-915-TR')} since="13:40" />,
          ]}
        />
      );
    case 'device':
      return (
        <ScreenBoard
          title="Appareils prêts"
          side={[['À l’atelier', '9'], ['Aujourd’hui', '6']]}
          fresh={<DossierRow no="0042" kind="phone" label="iPhone" since="14:32" />}
          rows={[
            <DossierRow key="a" no="0039" kind="tablet" label="iPad" since="13:50" />,
            <DossierRow key="b" no="0035" kind="phone" label="Galaxy" since="13:12" />,
          ]}
        />
      );
    case 'table':
      return (
        <ScreenBoard
          title="Tables prêtes"
          side={[['En attente', '6'], ['Couverts', '18']]}
          fresh={<TableRow name="Karim" count={4} />}
          rows={[<TableRow key="a" name="Léa" count={2} />, <TableRow key="b" name="Tom" count={6} />]}
        />
      );
    case 'desk':
      return (
        <div className={styles.callBoard}>
          <span className={styles.screenTitle}>Appel en cours</span>
          <span className={styles.callNow}>
            <span className={styles.swap}>
              <span className={styles.swapBefore}><TicketNumber value="A-041" size="2.5rem" destination={desk(1)} /></span>
              <span className={styles.swapAfter}><TicketNumber value="A-042" size="2.5rem" destination={desk(3)} /></span>
            </span>
          </span>
          <span className={styles.callPast}>
            <span className={styles.screenSideLabel}>Derniers appels</span>
            {/* Avant l'appel, A-041 est à l'écran : la liste commence à A-040. */}
            <span className={styles.swap}>
              <span className={styles.swapBefore}>
                <PastCalls calls={[['A-040', 2], ['A-039', 1]]} />
              </span>
              <span className={styles.swapAfter}>
                <PastCalls calls={[['A-041', 1], ['A-040', 2]]} />
              </span>
            </span>
          </span>
        </div>
      );
    case 'retail':
      return (
        <ScreenBoard
          title="Commandes prêtes"
          side={[['En cours', '4'], ['Aujourd’hui', '23']]}
          fresh={<OrderRow no="1234" since="14:32" />}
          rows={[<OrderRow key="a" no="0871" since="14:10" />, <OrderRow key="b" no="0866" since="13:58" />]}
        />
      );
  }
}

function PastCalls({ calls }: { calls: [string, number][] }) {
  return (
    <span className={styles.callPastRows}>
      {calls.map(([no, n]) => (
        <span key={no} className={styles.callPastRow}>
          <span>{no}</span>
          <span className={styles.callPastArrow}>→</span>
          <span>{desk(n)}</span>
        </span>
      ))}
    </span>
  );
}

function ScreenBoard({
  title, side, fresh, rows,
}: { title: string; side: [string, string][]; fresh: React.ReactNode; rows: React.ReactNode[] }) {
  return (
    <div className={styles.board}>
      <div className={styles.boardMain}>
        <span className={styles.screenTitle}>{title}</span>
        <span className={styles.boardRows}>
          <span className={styles.boardFresh}>{fresh}</span>
          {rows}
        </span>
      </div>
      <div className={styles.boardSide}>
        {side.map(([label, value]) => (
          <span key={label} className={styles.boardStat}>
            <span className={styles.boardStatLabel}>{label}</span>
            <span className={styles.boardValue}>{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ReadyRow({ label, plate, since }: { label: string; plate: ReturnType<typeof maskRegistration>; since: string }) {
  return (
    <span className={styles.boardRow}>
      <span className={styles.boardLabel}>{label}</span>
      <Immatriculation maskedValue={plate} width={104} />
      <span className={styles.boardSince}>{since}</span>
    </span>
  );
}

function DossierRow({ no, kind, label, since }: { no: string; kind: 'phone' | 'tablet'; label: string; since: string }) {
  return (
    <span className={styles.boardRow}>
      <TicketNumber value={no} kind="dossier" size="1.3rem" />
      <span className={styles.boardDevice}><DeviceGlyph kind={kind} size={16} />{label}</span>
      <span className={styles.boardSince}>{since}</span>
    </span>
  );
}

function TableRow({ name, count }: { name: string; count: number }) {
  return (
    <span className={styles.boardRow}>
      <span className={styles.boardName}>{name}</span>
      <span className={styles.boardCount}>{count}&nbsp;couverts</span>
    </span>
  );
}

function OrderRow({ no, since }: { no: string; since: string }) {
  return (
    <span className={styles.boardRow}>
      <span className={styles.boardLabel}>n°</span>
      <TicketNumber value={no} size="1.3rem" />
      <span className={styles.boardSince}>{since}</span>
    </span>
  );
}
