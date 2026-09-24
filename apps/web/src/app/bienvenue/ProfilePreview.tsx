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
 *   - le téléphone du client (thème sombre, celui de l'expérience client),
 *     avec les vrais objets du produit : l'immatriculation, le rail
 *     d'étapes, le numéro en volets, le chevalet de table ;
 *   - la touche du poste du pro, dans son vocabulaire (« Prêt · prévenir ») ;
 *   - l'écran de la salle, qui ne montre jamais une plaque en clair (trois
 *     derniers caractères seulement) ni un nom au guichet.
 *
 * L'histoire se joue UNE fois à chaque choix de métier, puis s'arrête :
 * la touche s'enfonce, le téléphone passe à « prêt » (le rideau tombe),
 * la ligne arrive sur l'écran. Elle attend que la scène soit à l'écran
 * (IntersectionObserver) : sur ordinateur, l'aperçu est sous la grille,
 * et une histoire jouée hors de la vue serait une histoire perdue. Seuls transform et opacity bougent ; en
 * mouvement réduit, l'état final s'affiche d'emblée.
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

function sceneFor(profile: PreviewProfile, activity: ActivityType): Scene {
  const vocab = getProfile(profile).vocab;
  switch (profile) {
    case 'vehicle':
      return {
        summary:
          'Aperçu avec des données d’exemple. Sur le téléphone du client : l’immatriculation AB-123-CD, une Peugeot 208, et les étapes du suivi, « En réparation ». '
          + `Au poste, la touche « ${vocab.call} ». Le téléphone affiche alors « ${vocab.clientTurn} ». `
          + 'L’écran de l’accueil liste les véhicules prêts, plaque masquée : seuls les trois derniers caractères restent visibles.',
        phoneCaption: 'Le téléphone de votre client',
        screenCaption: 'L’écran de l’accueil',
        phoneFoot: 'Prévenu à chaque étape, même demain.',
      };
    case 'device':
      return {
        summary:
          'Aperçu avec des données d’exemple. Sur le téléphone du client : le dossier 0042, un iPhone 13, et les étapes du suivi, « En réparation ». '
          + `Au poste, la touche « ${vocab.call} ». Le téléphone affiche alors « ${vocab.clientTurn} ». `
          + 'L’écran de l’accueil liste les dossiers prêts, par numéro.',
        phoneCaption: 'Le téléphone de votre client',
        screenCaption: 'L’écran de l’accueil',
        phoneFoot: 'Prévenu à chaque étape, même demain.',
      };
    case 'table':
      return {
        summary:
          'Aperçu avec des données d’exemple. Sur le téléphone du client : 4 couverts, 2 groupes avant lui. '
          + `Au poste, la touche « ${vocab.call} ». Le téléphone affiche alors « ${vocab.clientTurn} ». `
          + 'L’écran de l’entrée annonce le prénom et le nombre de couverts.',
        phoneCaption: 'Le téléphone de votre client',
        screenCaption: 'L’écran de l’entrée',
        phoneFoot: 'Restez dans les parages : on vous prévient.',
      };
    case 'desk':
      return {
        summary:
          'Aperçu avec des données d’exemple. Sur le téléphone du visiteur : le ticket A-042, 12 personnes devant lui. '
          + `Au poste, la touche « ${vocab.call} ». Le téléphone affiche alors « Guichet 3 ». `
          + 'L’écran de la salle affiche le numéro et le guichet, jamais un nom.'
          + (activity === 'health' ? ' Aucun motif de visite n’y apparaît.' : ''),
        phoneCaption: activity === 'health' ? 'Le téléphone du patient' : 'Le téléphone du visiteur',
        screenCaption: 'L’écran de la salle d’attente',
        phoneFoot: 'Asseyez-vous : votre téléphone vous appellera.',
      };
    case 'retail':
      return {
        summary:
          'Aperçu avec des données d’exemple. Sur le téléphone du client : la commande n° 1234, « En préparation ». '
          + `Au poste, la touche « ${vocab.call} ». Le téléphone affiche alors « ${vocab.clientTurn} ». `
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

export function ProfilePreview({
  profile,
  activity,
  placeName,
}: {
  profile: PreviewProfile;
  activity: ActivityType;
  /** Nom saisi (établissement, sinon commerce), ou l'exemple du métier. */
  placeName: string;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  // Sur téléphone, l'aperçu est replié : l'histoire se rejoue quand on l'ouvre.
  const [opened, setOpened] = useState(0);
  const sceneKey = `${profile}:${activity}:${opened}`;
  // La phase est rattachée à la scène qui l'a produite : au changement de
  // métier, la nouvelle scène part de « avant » dès son premier rendu,
  // sans jamais montrer un instant l'état final de la précédente.
  const [played, setPlayed] = useState<{ key: string; phase: Phase }>({ key: sceneKey, phase: 'before' });
  const phase: Phase = reduced ? 'after' : played.key === sceneKey ? played.phase : 'before';
  const bodyId = useId();
  const summaryId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  // La scène est-elle vraiment sous les yeux ? (Repliée, elle ne l'est pas.)
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

  return (
    <section
      className={styles.preview}
      aria-labelledby={`${summaryId}-titre`}
      data-open={open ? '1' : undefined}
      data-theme="dark"
    >
      <div className={styles.previewHead}>
        <span className={styles.previewTag}>Aperçu</span>
        <h2 id={`${summaryId}-titre`} className={styles.previewTitle}>Ce que verront vos clients</h2>
        <button
          type="button"
          className={styles.previewToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            if (!open) setOpened((n) => n + 1);
            setOpen(!open);
          }}
        >
          {open ? 'Masquer l’aperçu' : 'Voir ce que verront vos clients'}
        </button>
      </div>

      <div id={bodyId} className={styles.previewBody} data-phase={phase} key={sceneKey}>
        <p className="sr-only">{scene.summary}</p>
        <div className={styles.stage} aria-hidden="true" ref={stageRef}>
          <span className={styles.stageNote}>Données d’exemple</span>

          <figure className={styles.phoneFig}>
            <div className={styles.phone} data-theme="dark">
              <div className={styles.phoneScreen}>
                <div className={styles.phoneStatus}>
                  <span>14:32</span>
                  <span className={styles.phoneIsland} />
                  <span className={styles.phoneBars} />
                </div>
                <div className={styles.phoneHeader}>
                  <span className={styles.phonePlace}>{placeName}</span>
                  <span className={styles.phoneLive}><span className="pip pip--live" />En direct</span>
                </div>
                <PhoneBody profile={profile} activity={activity} />
                <div className={styles.phoneFoot}>
                  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor"
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

          <div className={styles.stageSide}>
            <figure className={styles.keyFig}>
              <span className={styles.previewKey}>{vocab.call}</span>
              <figcaption className={styles.figCaption}>Votre poste, en un geste</figcaption>
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
      </div>
    </section>
  );
}

function curtainKicker(profile: PreviewProfile): string {
  return profile === 'desk' ? 'Ticket A-042' : 'Maintenant';
}
function curtainTitle(profile: PreviewProfile): string {
  return profile === 'desk' ? 'Guichet 3' : getProfile(profile).vocab.clientTurn;
}
function curtainText(profile: PreviewProfile): string {
  switch (profile) {
    case 'vehicle': return 'Il vous attend. Ouvert jusqu’à 19\u00a0h\u00a000.';
    case 'device': return 'Venez le récupérer. Ouvert jusqu’à 19\u00a0h\u00a000.';
    case 'table': return 'Présentez-vous à l’accueil dans les 5 minutes.';
    case 'desk': return 'Présentez-vous maintenant au guichet 3.';
    case 'retail': return 'Elle vous attend à la caisse.';
  }
}

/* ------------------------------------------------------------------ */
/* Le téléphone                                                         */
/* ------------------------------------------------------------------ */

function PhoneBody({ profile, activity }: { profile: PreviewProfile; activity: ActivityType }) {
  switch (profile) {
    case 'vehicle':
      return (
        <div className={styles.phoneBody}>
          <span className={styles.phoneKicker}>Votre véhicule</span>
          <Immatriculation value={PLATE} width={236} />
          <span className={styles.phoneMeta}>Peugeot 208 · Karim</span>
          <Swap
            before={<StageRail profile="vehicle" current="in_repair" history={WORKSHOP_BEFORE} orientation="vertical" timeZone={TZ} />}
            after={<StageRail profile="vehicle" current="ready" history={WORKSHOP_AFTER} orientation="vertical" timeZone={TZ} />}
          />
        </div>
      );
    case 'device':
      return (
        <div className={styles.phoneBody}>
          <span className={styles.phoneKicker}>Votre dossier</span>
          <span className={styles.phoneTicketRow}>
            <TicketNumber value="0042" kind="dossier" size="2.6rem" />
            <span className={styles.phoneDevice}>
              <DeviceGlyph kind="phone" size={22} />
              iPhone 13
            </span>
          </span>
          <Swap
            before={<StageRail profile="device" current="in_repair" history={WORKSHOP_BEFORE} orientation="vertical" timeZone={TZ} />}
            after={<StageRail profile="device" current="ready" history={WORKSHOP_AFTER} orientation="vertical" timeZone={TZ} />}
          />
        </div>
      );
    case 'table':
      return (
        <div className={`${styles.phoneBody} ${styles.phoneCenter}`}>
          <span className={styles.phoneKicker}>Liste d’attente</span>
          <span className={styles.phoneAhead}>
            <TicketNumber value="2" size="5.5rem" />
            <span className={styles.phoneAheadText}>groupes avant vous</span>
          </span>
          <Swap
            before={<PartySize count={4} state="waiting" size="md" />}
            after={<PartySize count={4} state="ready" size="md" />}
          />
          <span className={styles.phoneMeta}>Karim · salle ou terrasse</span>
        </div>
      );
    case 'desk':
      return (
        <div className={`${styles.phoneBody} ${styles.phoneCenter}`}>
          <span className={styles.phoneKicker}>Votre numéro</span>
          <Swap
            before={<TicketNumber value="A-042" size="4.25rem" />}
            after={<TicketNumber value="A-042" size="3.25rem" destination="Guichet 3" />}
          />
          <span className={styles.phoneAheadText}>12 personnes devant vous</span>
          {activity !== 'health' && (
            <span className={styles.phoneChip}>{activity === 'admin_service' ? 'Carte grise' : 'Retrait de colis'}</span>
          )}
        </div>
      );
    case 'retail':
      return (
        <div className={styles.phoneBody}>
          <span className={styles.phoneKicker}>Votre commande</span>
          <span className={styles.phoneOrder}>n° 1234</span>
          <span className={styles.phoneMeta}>Retirer une commande</span>
          <Swap
            before={<StageRail profile="retail" current="preparing" history={RETAIL_BEFORE} orientation="vertical" timeZone={TZ} />}
            after={<StageRail profile="retail" current="ready" history={RETAIL_AFTER} orientation="vertical" timeZone={TZ} />}
          />
        </div>
      );
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
/* L'écran de la salle                                                  */
/* ------------------------------------------------------------------ */

function ScreenBody({ profile }: { profile: PreviewProfile }) {
  switch (profile) {
    case 'vehicle':
      return (
        <ScreenBoard
          title="Véhicules prêts"
          side={[['À l’atelier', '7'], ['Pris en charge aujourd’hui', '12']]}
          fresh={<ReadyRow label="208" plate={maskRegistration(PLATE)} since="14:32" />}
          rows={[<ReadyRow key="a" label="Clio" plate={maskRegistration('FX-482-KL')} since="14:05" />]}
        />
      );
    case 'device':
      return (
        <ScreenBoard
          title="Appareils prêts"
          side={[['À l’atelier', '9'], ['Rendus aujourd’hui', '6']]}
          fresh={<DossierRow no="0042" kind="phone" label="iPhone" since="14:32" />}
          rows={[<DossierRow key="a" no="0039" kind="tablet" label="Tablette" since="13:50" />]}
        />
      );
    case 'table':
      return (
        <ScreenBoard
          title="Tables prêtes"
          side={[['Groupes en attente', '6'], ['Couverts', '18']]}
          fresh={<TableRow name="Karim" count={4} />}
          rows={[<TableRow key="a" name="Léa" count={2} />]}
        />
      );
    case 'desk':
      return (
        <div className={styles.callBoard}>
          <span className={styles.screenTitle}>Appel en cours</span>
          <span className={styles.callNow}>
            <span className={styles.swap}>
              <span className={styles.swapBefore}><TicketNumber value="A-041" size="4.6rem" destination="Guichet 1" /></span>
              <span className={styles.swapAfter}><TicketNumber value="A-042" size="4.6rem" destination="Guichet 3" /></span>
            </span>
          </span>
          <span className={styles.callPast}>
            <span className={styles.screenSideLabel}>Derniers appels</span>
            <span className={styles.callPastRows}>
              <span>A-041 · Guichet 1</span>
              <span>A-040 · Guichet 2</span>
            </span>
          </span>
        </div>
      );
    case 'retail':
      return (
        <ScreenBoard
          title="Commandes prêtes"
          side={[['En préparation', '4'], ['Remises aujourd’hui', '23']]}
          fresh={<OrderRow no="1234" since="14:32" />}
          rows={[<OrderRow key="a" no="0871" since="14:10" />]}
        />
      );
  }
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
            <span className={styles.screenSideLabel}>{label}</span>
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
      <Immatriculation maskedValue={plate} width={150} />
      <span className={styles.boardSince}>prêt depuis {since}</span>
    </span>
  );
}

function DossierRow({ no, kind, label, since }: { no: string; kind: 'phone' | 'tablet'; label: string; since: string }) {
  return (
    <span className={styles.boardRow}>
      <TicketNumber value={no} kind="dossier" size="1.9rem" />
      <span className={styles.boardDevice}><DeviceGlyph kind={kind} size={20} />{label}</span>
      <span className={styles.boardSince}>prêt depuis {since}</span>
    </span>
  );
}

function TableRow({ name, count }: { name: string; count: number }) {
  return (
    <span className={styles.boardRow}>
      <span className={styles.boardName}>{name}</span>
      <PartySize count={count} size="sm" state="ready" />
    </span>
  );
}

function OrderRow({ no, since }: { no: string; since: string }) {
  return (
    <span className={styles.boardRow}>
      <span className={styles.boardLabel}>n°</span>
      <TicketNumber value={no} size="1.9rem" />
      <span className={styles.boardSince}>prête depuis {since}</span>
    </span>
  );
}
