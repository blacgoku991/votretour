import {
  CLIENT_STATUS_LABEL,
  QUEUE_STATUS_LABEL,
  STAFF_STATUS_LABEL,
  notificationCopy,
  peopleAheadLabel,
} from '@/lib/copy';
import { PROFILES } from '@/lib/profiles';
import { clientAheadLabel, profileNotificationCopy } from '@/lib/profiles/copy';
import { PARTY_MAX_LIMIT, REVIEW_DELAY_MAX, REVIEW_DELAY_MIN, defaultProfileOptions } from '@/lib/profiles/options';
import { displayRegistration, maskRegistration } from '@/lib/profiles/registration';
import { WORKSHOP_STAGES } from '@/lib/profiles/stages';
import { formatTicketNo } from '@/lib/profiles/ticket';
import type { ProfileStage, StageDef } from '@/lib/profiles/types';
import type { Conditional, FaqContent, Metier, Plain } from './types';

/**
 * REGISTRE DES MÉTIERS — le texte des pages `/pour/[metier]`.
 *
 * Trois règles, vérifiées par les tests `metiers-*` :
 *
 *  1. VRAI AUJOURD'HUI. Tout ce qui dépend d'un profil métier pas encore
 *     ouvert (fiche d'atelier, couverts, numéro de ticket…) porte
 *     `requires`, et sa version « vraie aujourd'hui » en `fallback`. Les
 *     pages garages, réparation, restaurants et guichets paraissent donc
 *     dès maintenant, avec la file de réception d'aujourd'hui, puis
 *     s'enrichissent seules le jour où le lot P9 ajoute la capacité.
 *     L'URL, le titre, la description et le H1 ne changent jamais.
 *
 *  2. LES MOTS DU PRODUIT. Une touche citée (« Prêt · prévenir »,
 *     « Installer ») est IMPORTÉE du vocabulaire du profil
 *     (`lib/profiles/<profil>.ts`), jamais recopiée ; une touche du poste
 *     d'aujourd'hui vient de `PRODUCT_TEXT`, dont chaque libellé est
 *     retrouvé dans le fichier source qui l'affiche. Si le produit change
 *     un mot, la page suit, ou le test casse.
 *
 *  3. RIEN D'INVENTÉ. Ni note, ni avis, ni témoignage, ni pourcentage, ni
 *     « x clients ». Les commerces des scènes sont fictifs. Les chiffres
 *     cités sont des réglages réels (importés : délai de l'avis, couverts
 *     maximum…) ou des exemples d'écran, jamais des statistiques.
 *
 * Le texte s'écrit avec des espaces ordinaires : `renderable()` pose les
 * espaces insécables et les apostrophes typographiques.
 */

/* ------------------------------------------------------------------ */
/* Les mots du produit                                                  */
/* ------------------------------------------------------------------ */

const QUEUE_BOARD = 'app/app/[org]/file/QueueBoard.tsx';
const CLIENT = 'app/e/[slug]/ClientExperience.tsx';
const SETTINGS = 'app/app/[org]/reglages/SettingsManager.tsx';
const EVENTS = 'app/app/[org]/evenements/EventsPanel.tsx';
const SCAN = 'app/scan/[token]/ScanPassCard.tsx';

/**
 * Libellés du produit d'aujourd'hui qu'une page peut citer, avec le
 * fichier (sous `apps/web/src/`) où ils s'affichent. `metiers-vocab`
 * vérifie que chacun s'y trouve encore, mot pour mot.
 */
export const PRODUCT_TEXT = {
  // Poste du pro
  present: { text: 'Présent', file: QUEUE_BOARD },
  absent: { text: 'Absent', file: QUEUE_BOARD },
  decaler: { text: 'Décaler', file: QUEUE_BOARD },
  retirer: { text: 'Retirer', file: QUEUE_BOARD },
  remettre: { text: 'Remettre en file', file: QUEUE_BOARD },
  ajouter: { text: 'Ajouter au comptoir', file: QUEUE_BOARD },
  ecranTv: { text: 'Afficher l’écran TV', file: QUEUE_BOARD },
  // Écran du client
  rejoindre: { text: 'Rejoindre la file', file: CLIENT },
  deRetour: { text: 'Je suis de retour', file: CLIENT },
  prevenir: { text: 'Me prévenir quand c’est mon tour', file: CLIENT },
  quitter: { text: 'Quitter la file', file: CLIENT },
  avisGoogle: { text: 'Laisser un avis Google', file: CLIENT },
  partir: { text: 'Vous pouvez partir, on vous rappelle.', file: CLIENT },
  peuImporte: { text: 'Peu importe', file: CLIENT },
  surPlace: { text: 'Je verrai sur place', file: CLIENT },
  // Événements
  vagueSuivante: { text: 'Ouvrir la vague suivante', file: EVENTS },
  pauseAppels: { text: 'Pause appels', file: EVENTS },
  stockEpuise: { text: 'Stock épuisé', file: EVENTS },
  validerEntree: { text: 'Valider l’entrée', file: SCAN },
  dejaUtilise: { text: 'Pass déjà utilisé', file: SCAN },
  passExpire: { text: 'Pass expiré', file: SCAN },
  // Réglages : libellés et choix, tels que l'écran les affiche
  mode: { text: 'Mode', file: SETTINGS },
  apresTerminer: { text: 'Après « Terminer »', file: SETTINGS },
  demanderPrenom: { text: 'Demander le prénom', file: SETTINGS },
  prenomObligatoire: { text: 'Prénom obligatoire', file: SETTINGS },
  choixPro: { text: 'Choix du professionnel', file: SETTINGS },
  choixPrestation: { text: 'Choix de la prestation', file: SETTINGS },
  prevenirAPartir: { text: 'Prévenir à partir de', file: SETTINGS },
  clientAbsent: { text: 'Client absent', file: SETTINGS },
  expiration: { text: 'Expiration automatique', file: SETTINGS },
  conservation: { text: 'Durée de conservation', file: SETTINGS },
  avisFin: { text: 'Proposer l’avis Google en fin de passage', file: SETTINGS },
  fileParPro: { text: 'Une file par professionnel', file: SETTINGS },
  fileCommune: { text: 'File commune', file: SETTINGS },
  suivantAppele: { text: 'Le suivant est seulement appelé', file: SETTINGS },
  mettreDeCote: { text: 'Le mettre de côté', file: SETTINGS },
  reculer: { text: 'Le reculer dans la file', file: SETTINGS },
  sortir: { text: 'Le sortir de la file', file: SETTINGS },
  tailleVague: { text: 'Taille d’une vague', file: EVENTS },
  passValide: { text: 'Pass valide', file: EVENTS },
  grace: { text: 'Grâce', file: EVENTS },
} as const satisfies Record<string, { text: string; file: string }>;

const t = (key: keyof typeof PRODUCT_TEXT): string => PRODUCT_TEXT[key].text;

/**
 * Libellés des réglages PROPRES AUX PROFILS. L'écran qui les affichera
 * (Réglages, section « Profil métier », lot P6) n'existe pas encore :
 * ces blocs sont tous conditionnés, et P6 est invité à reprendre ces
 * libellés tels quels (un seul nom par réglage, sur la page et au poste).
 */
export const PROFILE_SETTING_LABEL = {
  tvRegistration: 'Immatriculation à l’écran',
  stayChoice: 'Attente sur place',
  quotes: 'Devis en ligne',
  dossierNumbering: 'Numéro de dossier',
  partyMax: 'Couverts maximum',
  tableSizes: 'Tailles de table',
  reviewDelayMinutes: 'Délai de l’avis Google',
  ticketNumbering: 'Numérotation des tickets',
  ticketPrefix: 'Préfixe des tickets',
  deskLabel: 'Nom du guichet',
} as const;

/**
 * Paroles de clients citées entre guillemets. Ce ne sont ni des touches
 * ni des textes du produit : elles commencent donc par une minuscule, et
 * `metiers-vocab` les distingue ainsi des libellés.
 */
export const SPOKEN = [
  'c’est encore long ?',
  'on en a pour combien de temps ?',
  'elle est prête ?',
  'juste pour voir',
  'complet ce soir',
] as const;

/** Guillemets français ; les espaces insécables sont posées au rendu. */
const q = (text: string): string => `« ${text} »`;

/* ------------------------------------------------------------------ */
/* Vocabulaire des profils (importé, jamais recopié)                    */
/* ------------------------------------------------------------------ */

const WALKIN = PROFILES.walkin.vocab;
const VEHICLE = PROFILES.vehicle.vocab;
const DEVICE = PROFILES.device.vocab;
const TABLE = PROFILES.table.vocab;
const DESK = PROFILES.desk.vocab;
const RETAIL = PROFILES.retail.vocab;
const EVENT = PROFILES.event.vocab;

/**
 * Une touche facultative du vocabulaire (`start` vaut `null` au
 * restaurant) que la page cite : si le profil la retire un jour, le
 * registre refuse de se charger au lieu d'afficher une ligne vide.
 */
function touch(value: string | null, name: string): string {
  if (!value) throw new Error(`Touche absente du vocabulaire : ${name}`);
  return value;
}

const WALKIN_START = touch(WALKIN.start, 'walkin.start');
const VEHICLE_START = touch(VEHICLE.start, 'vehicle.start');
const DEVICE_START = touch(DEVICE.start, 'device.start');
const DESK_START = touch(DESK.start, 'desk.start');

function workshopStage(key: ProfileStage): StageDef {
  const stage = WORKSHOP_STAGES.find((s) => s.key === key);
  if (!stage) throw new Error(`Étape d’atelier inconnue : ${key}`);
  return stage;
}

const RECEIVED = workshopStage('received');
const DIAGNOSIS = workshopStage('diagnosis');
const QUOTE = workshopStage('quote_pending');
const PARTS = workshopStage('waiting_parts');
const REPAIR = workshopStage('in_repair');
const READY = workshopStage('ready');

/**
 * Le rail d'atelier sans l'étape « Devis » : le devis est une capacité à
 * part (`profile.garage.quote`), et la réparation d'appareils n'en a pas
 * encore. Un visuel ne doit pas promettre ce que la page tait.
 */
const WORKSHOP_LANES = WORKSHOP_STAGES.filter((s) => s.key !== 'quote_pending').map((s) => ({
  label: s.short,
  hint: s.client,
}));

/** Textes réels des notifications (lieu fictif, jamais affiché ici). */
const AHEAD_ONE = notificationCopy('ahead_one', { locationName: '' }).body;
const VISIT_DONE = notificationCopy('visit_completed', { locationName: '' }).title;
const TABLE_AHEAD_ONE = profileNotificationCopy('ahead_one', { profile: 'table', locationName: '' }).body;
const DESK_AHEAD_ONE = profileNotificationCopy('ahead_one', { profile: 'desk', locationName: '' }).body;

/** Réglages par défaut des profils, tels que le code les pose. */
const TABLE_DEFAULTS = defaultProfileOptions('table');
const PARTY_MAX = TABLE_DEFAULTS.partyMax ?? 12;
const TABLE_SIZES = TABLE_DEFAULTS.tableSizes ?? [2, 4, 6, 8];
const REVIEW_DELAY = TABLE_DEFAULTS.reviewDelayMinutes ?? REVIEW_DELAY_MIN;

/** « 2, 4, 6 et 8 » */
function frenchList(items: readonly (string | number)[]): string {
  const words = items.map(String);
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} et ${words[words.length - 1]}`;
}

/** Exemples d'écran : un ticket, une plaque masquée (fictifs). */
const TICKET = (n: number): string => formatTicketNo('desk', n) ?? '';
const MASKED_PLATE = maskRegistration(displayRegistration('AB123CD'));
const DESK_TURN = profileNotificationCopy('your_turn', {
  profile: 'desk',
  locationName: '',
  ticketNo: TICKET(42),
  deskLabel: 'Guichet 3',
}).title;

/* ------------------------------------------------------------------ */
/* Habillage commun de la scène                                         */
/* ------------------------------------------------------------------ */

/** Indices des lattes d'une file de passage (ceux de l'accueil). */
const QUEUE_HINTS = {
  self: 'Votre place',
  kept: 'Place gardée',
  back: 'De retour',
  turn: 'À vous',
  ghost: 'Votre place',
  next: 'Prochain client',
} as const;

const serving = (who: string): string => `${STAFF_STATUS_LABEL.serving} · avec ${who}`;

/* ------------------------------------------------------------------ */
/* Questions partagées                                                  */
/* ------------------------------------------------------------------ */

/**
 * Questions communes à plusieurs pages. Exportées pour que le test
 * d'unicité les écarte : une page doit tenir par ses questions propres.
 */
export const SHARED_FAQ = {
  app: {
    q: 'Vos clients doivent-ils installer une application ?',
    a: 'Non. Sur iPhone, l’App Clip s’ouvre d’un geste en approchant le téléphone de la plaque, sans rien installer ; sur Android, le navigateur suffit. Ni compte, ni mot de passe, ni e-mail.',
    requires: 'channel.app_clip',
    fallback: {
      q: 'Vos clients doivent-ils installer une application ?',
      a: 'Non. Ils scannent le QR code ou approchent leur téléphone de la plaque NFC, et la file s’ouvre dans leur navigateur, sur iPhone comme sur Android. Ni compte, ni mot de passe, ni e-mail.',
    },
  },
  notification: {
    q: 'Comment le client est-il prévenu ?',
    a: 'Par une notification gratuite, qu’il active d’un geste en rejoignant la file : dans le navigateur sur Android, dans l’App Clip sur iPhone. Aucun SMS, donc rien à payer à l’unité. S’il ne l’active pas, sa page se met à jour toute seule tant qu’elle reste ouverte.',
    requires: 'channel.app_clip',
    fallback: {
      q: 'Comment le client est-il prévenu ?',
      a: 'Par une notification du navigateur, gratuite, qu’il active d’un geste en rejoignant la file. Sur iPhone, Safari ne l’autorise que si la page est ajoutée à l’écran d’accueil, et l’écran du client le lui explique ; sinon, sa page se met à jour toute seule tant qu’elle reste ouverte. Aucun SMS, donc rien à payer à l’unité.',
    },
  },
  data: {
    q: 'Quelles données gardez-vous sur les personnes qui attendent ?',
    a: 'Un prénom, et seulement si vous le demandez : la file peut aussi ne rien demander du tout. Ni téléphone, ni e-mail. Au-delà de la durée de conservation que vous choisissez dans Réglages, les prénoms sont effacés automatiquement.',
  },
} as const satisfies Record<string, Plain<FaqContent> | Conditional<FaqContent>>;

/** Lead commun de l'appel final : l'essai, tel que /tarifs le décrit. */
const TRIAL = 'Essai gratuit, sans carte bancaire.';

/* ------------------------------------------------------------------ */
/* Les métiers                                                          */
/* ------------------------------------------------------------------ */

const REVISED = '2026-09-24';

const barbiers: Metier = {
  slug: 'barbiers',
  activities: ['barber'],
  published: true,
  updatedAt: REVISED,
  nav: { label: 'Barbiers', short: 'Barbier' },
  intent: {
    primary: 'file d’attente barbier',
    variants: [
      'file d’attente virtuelle barbier',
      'barbershop sans rendez-vous file d’attente',
      'ticket d’attente barbier',
      'liste d’attente barbier',
    ],
    problems: ['clients qui repartent en voyant la queue', 'barbershop plein le samedi'],
  },
  seo: {
    title: 'File d’attente virtuelle pour barbiers',
    description:
      'Vos clients prennent leur place au comptoir avec leur téléphone et reviennent quand leur tour approche. File commune ou par barbier, sans application.',
    ogTitle: 'Le barbershop est plein, personne n’attend debout',
    ogKicker: 'Barbiers',
  },
  hero: {
    label: 'File d’attente virtuelle · barbiers',
    title: 'Le salon est plein. Personne n’attend debout.',
    lead: 'Vos clients prennent leur place d’un geste sur leur téléphone, vont boire un café et reviennent quand leur tour approche. Vous, vous coupez.',
  },
  story: {
    scene: {
      place: 'Barber House',
      seuil: 'Fauteuil',
      proKey: WALKIN.complete,
      proLabels: { current: serving('Karim'), currentName: 'Léa', next: 'Prochain', nextName: 'Camille' },
      clientName: 'Camille',
      slotHints: QUEUE_HINTS,
    },
    steps: [
      {
        kicker: 'Il arrive',
        title: 'Il choisit son barbier, ou le premier libre.',
        body: `Il scanne le QR code du comptoir ou approche son téléphone de la plaque, donne son prénom et choisit Karim, Sofia ou ${q(t('peuImporte'))}. Le voilà dans la file, sans compte ni application.`,
        benefit: 'Inscrit en quelques secondes, sans vous interrompre.',
        state: peopleAheadLabel(3),
      },
      {
        kicker: 'Il sort',
        title: 'Sa place l’attend pendant qu’il fait sa course.',
        body: 'Boulangerie, distributeur, coup de fil : il attend où il veut, sa place ne bouge pas. Votre salon n’a plus l’air d’une salle d’attente, et la vitrine ne fait plus fuir les passants.',
        benefit: 'Plus personne ne repart en voyant la queue.',
        state: t('partir'),
        outline: true,
      },
      {
        kicker: 'Il suit',
        title: 'Un chiffre, en direct, sur son téléphone.',
        body: 'Son écran n’affiche que le nombre de personnes devant lui, mis à jour à chaque coupe terminée. Pas d’heure promise : un dégradé soigné prend le temps qu’il faut, et personne ne se sent trahi.',
        benefit: `Fini les ${q(SPOKEN[0])} entre deux coupes.`,
        state: peopleAheadLabel(2),
      },
      {
        kicker: 'Il revient',
        title: 'Prévenu quand son tour approche.',
        body: `${q(AHEAD_ONE)} La notification arrive sur son téléphone, sans SMS. Il repasse la porte au bon moment et touche ${q(t('deRetour'))} : vous le voyez sur le poste.`,
        benefit: 'Il revient au bon moment, ni trop tôt ni trop tard.',
        state: peopleAheadLabel(1),
      },
      {
        kicker: 'Vous',
        title: `Vous touchez ${q(WALKIN.complete)}. La file avance.`,
        body: 'Un geste entre deux clients : le suivant passe au fauteuil, chacun voit sa place bouger, et celui qui approche est prévenu. Karim part déjeuner ? Un appui sur son prénom le met en pause.',
        benefit: 'Un seul bouton, même la tondeuse à la main.',
        state: CLIENT_STATUS_LABEL.serving,
      },
      {
        kicker: 'Après',
        title: 'Et l’avis Google, à chaud.',
        body: `La coupe terminée, votre client lit ${q(VISIT_DONE)} et trouve un bouton qui ouvre directement votre fiche Google. Pas de relance, pas de QR code collé au miroir.`,
        benefit: 'L’avis se laisse quand on se trouve beau.',
        state: VISIT_DONE,
      },
    ],
  },
  problem: [
    {
      key: 'Samedi après-midi',
      text: 'Quatre personnes debout près de la porte, la veste encore sur le dos, et plus une chaise de libre.',
    },
    { key: 'Le passant', text: 'Un client passe la tête, compte ceux qui attendent, et repart. Vous ne le reverrez peut-être pas.' },
    {
      key: 'Entre deux coupes',
      text: `On vous demande sans cesse ${q(SPOKEN[0])}, pendant que vous tenez la tondeuse.`,
    },
  ],
  signature: {
    kind: 'chairs',
    title: 'Un fauteuil, une file',
    caption: `En ${q(t('fileParPro'))}, chaque barbier a sa propre file : le client qui veut Sofia attend Sofia, et vous voyez d’un coup d’œil qui attend qui.`,
    seuil: 'Fauteuil',
    lanes: [{ label: 'Karim' }, { label: 'Sofia' }, { label: 'Mehdi' }],
  },
  counter: {
    rows: [
      { key: WALKIN.complete, text: 'Le client en cours a fini : un appui, et le suivant passe au fauteuil.' },
      {
        key: WALKIN_START,
        requires: 'core.call_next',
        text: 'Vous préférez souffler entre deux clients ? Le suivant est seulement appelé, et vous démarrez sa coupe quand vous êtes prêt.',
      },
      {
        key: t('absent'),
        requires: 'core.absent_policy',
        text: 'Il n’est pas revenu à temps ? Il recule de quelques places ou il est mis de côté, selon votre réglage, et vous pouvez toujours choisir au cas par cas.',
      },
      {
        key: t('ajouter'),
        requires: 'core.walkin',
        text: 'Le client sans smartphone donne son prénom au comptoir : vous l’ajoutez à la file depuis le poste, et il attend comme tout le monde.',
      },
      {
        key: t('ecranTv'),
        requires: 'core.tv_screen',
        text: 'La file s’affiche au mur du salon : le prénom du client au fauteuil, les suivants en initiales seulement.',
      },
    ],
  },
  settings: {
    rows: [
      {
        label: t('mode'),
        value: t('fileParPro'),
        text: 'Si vos clients viennent pour un barbier précis. Sinon, gardez la file commune : le premier libre prend le suivant.',
        ref: { source: 'queues', column: 'mode', value: 'per_staff' },
      },
      {
        label: t('choixPro'),
        value: 'Activé',
        text: `Le client choisit son barbier en s’inscrivant, ou répond ${q(t('peuImporte'))}.`,
        ref: { source: 'queues', column: 'allow_staff_choice', value: true },
      },
      {
        label: t('prevenirAPartir'),
        value: '2 personnes',
        text: 'Le temps d’une coupe pour finir son café et revenir : ni trop tôt, ni trop tard.',
        ref: { source: 'queues', column: 'notify_ahead_threshold', value: 2 },
      },
      {
        label: t('clientAbsent'),
        value: t('reculer'),
        text: 'Une seconde chance pour celui qui s’est attardé, sans pénaliser ceux qui sont là.',
        ref: { source: 'queues', column: 'absent_policy', value: 'move_back' },
      },
    ],
  },
  arguments: [
    {
      key: 'Rien à installer',
      text: 'Vos clients rejoignent la file dans leur navigateur, en scannant un QR code ou en approchant leur téléphone de la plaque.',
    },
    {
      key: 'Aucun SMS à payer',
      text: 'Les notifications passent par le navigateur : rien à payer à l’unité, quel que soit le nombre de passages.',
    },
    {
      key: 'En direct partout',
      text: 'La file bouge en même temps sur votre poste, sur le téléphone du client et sur l’écran du salon.',
    },
    {
      key: 'Vos chiffres',
      requires: 'core.stats',
      text: 'Clients accueillis, attente médiane, heures d’affluence, passages par barbier : tout se lit dans vos statistiques.',
    },
  ],
  faq: [
    {
      q: 'Un client veut un barbier précis ?',
      requires: ['core.staff_choice', 'core.per_staff'],
      a: `Activez ${q(t('choixPro'))} : il choisit en s’inscrivant. Si la plupart de vos clients ont leur barbier attitré, passez en ${q(t('fileParPro'))} : chaque barbier a sa propre file.`,
    },
    {
      q: 'Et le client qui n’a pas de smartphone ?',
      requires: 'core.walkin',
      a: `Vous l’ajoutez au comptoir avec son prénom, grâce à ${q(t('ajouter'))}. Il attend dans la même file que les autres, et vous l’appelez de vive voix quand c’est son tour.`,
    },
    {
      q: 'Je peux mettre un barbier en pause ?',
      requires: ['core.staff_break', 'core.queue_pause'],
      a: 'Oui : touchez son prénom sur le poste pour le mettre en pause, puis à nouveau pour le remettre en service. Vous pouvez aussi mettre toute la file en pause, avec un motif que vos clients lisent sur leur écran.',
    },
    {
      q: 'Le client voit-il une heure d’attente ?',
      a: 'Non, et c’est voulu. Il voit le nombre de personnes devant lui, jamais une heure calculée : une coupe ne dure pas toujours le même temps, et une promesse non tenue coûte plus cher qu’une absence de promesse.',
    },
    SHARED_FAQ.notification,
  ],
  cta: {
    label: 'Ouvrir ma file',
    title: 'Posez la plaque sur le comptoir. C’est tout.',
    lead: `Votre file est prête en quelques minutes, avec son QR code et son lien NFC. ${TRIAL}`,
  },
  sections: ['story', 'problem', 'counter', 'signature', 'video', 'settings', 'arguments', 'plans', 'faq', 'cta', 'related'],
  related: ['salons-de-coiffure', 'restaurants'],
};

const salons: Metier = {
  slug: 'salons-de-coiffure',
  activities: ['hair_salon'],
  published: true,
  updatedAt: REVISED,
  nav: { label: 'Salons de coiffure', short: 'Salon' },
  intent: {
    primary: 'file d’attente salon de coiffure',
    variants: [
      'file d’attente virtuelle coiffeur',
      'coiffeur sans rendez-vous attente',
      'logiciel file d’attente coiffeur',
      'gestion attente salon sans rendez-vous',
    ],
    problems: ['salle d’attente trop petite', 'clients qui demandent combien de temps il reste'],
  },
  seo: {
    title: 'File d’attente virtuelle pour salons de coiffure',
    description:
      'Coupe, couleur ou brushing : vos clients prennent leur place sur leur téléphone, profitent du quartier et reviennent quand leur tour approche.',
    ogTitle: 'Un salon sans rendez-vous, sans salle d’attente',
    ogKicker: 'Salons de coiffure',
  },
  hero: {
    label: 'File d’attente virtuelle · salons de coiffure',
    title: 'Un salon sans rendez-vous, sans salle d’attente.',
    lead: 'Vos clients prennent leur place d’un scan, font leurs courses et reviennent au bon moment. Votre salon reste calme, même un samedi.',
  },
  story: {
    scene: {
      place: 'Salon Lumière',
      seuil: 'Bac',
      proKey: WALKIN.complete,
      proLabels: { current: serving('Inès'), currentName: 'Nora', next: 'Prochain', nextName: 'Chloé' },
      clientName: 'Chloé',
      slotHints: QUEUE_HINTS,
    },
    steps: [
      {
        kicker: 'Elle arrive',
        title: 'Un scan à l’accueil, et sa place est prise.',
        body: `Elle scanne le QR code posé à l’accueil, indique son prénom et choisit sa prestation parmi celles que vous proposez, ou ${q(t('surPlace'))}. Aucun compte, aucune application.`,
        benefit: 'L’accueil ne s’arrête plus pour noter les arrivées.',
        state: peopleAheadLabel(4),
      },
      {
        kicker: 'Elle sort',
        title: 'Pas de magazine, pas de chaise pliante.',
        body: 'Elle part faire une course ou prendre un café : sa place est gardée. Votre petit salon n’a plus besoin de chaises d’attente coincées près de la porte.',
        benefit: 'Un salon plus calme, pour vous comme pour elle.',
        state: t('partir'),
        outline: true,
      },
      {
        kicker: 'Elle suit',
        title: 'Elle voit la file avancer, sans heure promise.',
        body: 'Une couleur qui déborde ne se transforme plus en attente inquiète : elle voit simplement combien de personnes restent devant elle, en direct.',
        benefit: `Plus de ${q(SPOKEN[1])} lancé depuis l’entrée.`,
        state: peopleAheadLabel(2),
      },
      {
        kicker: 'Elle revient',
        title: 'Prévenue à temps pour revenir.',
        body: `Quand son tour approche, son téléphone affiche ${q(AHEAD_ONE)} Elle revient, touche ${q(t('deRetour'))}, et vous le voyez sur le poste.`,
        benefit: 'Le bac ne reste jamais vide à attendre quelqu’un.',
        state: peopleAheadLabel(1),
      },
      {
        kicker: 'Vous',
        title: `Un geste : ${q(WALKIN.complete)}.`,
        body: 'La cliente précédente passe en caisse, vous touchez le bouton : la suivante passe en cours, et la file se met à jour partout, jusque sur l’écran de l’accueil.',
        benefit: 'Aucune liste papier à tenir entre deux brushings.',
        state: CLIENT_STATUS_LABEL.serving,
      },
      {
        kicker: 'Après',
        title: 'Un merci, et votre fiche Google.',
        body: `${q(VISIT_DONE)} s’affiche avec un bouton vers votre fiche Google : le moment où l’on a envie de dire que la coupe est réussie.`,
        benefit: 'L’avis se laisse devant le miroir, pas trois jours plus tard.',
        state: VISIT_DONE,
      },
    ],
  },
  problem: [
    {
      key: 'Le petit salon',
      text: 'Trois chaises d’attente, sept clients, et une cliente qui patiente debout entre le bac et la porte.',
    },
    {
      key: 'La couleur qui déborde',
      text: 'Une pose dure plus que prévu, la file prend du retard, et tout le monde regarde l’horloge.',
    },
    {
      key: 'Qui était là avant ?',
      text: 'Deux clientes arrivées presque en même temps, et personne ne sait plus qui passe la première.',
    },
  ],
  signature: {
    kind: 'counter',
    title: 'L’ordre d’arrivée, sans discussion',
    caption: 'Le poste affiche chaque cliente dans l’ordre où elle s’est inscrite : plus besoin de se souvenir qui était là avant qui.',
    seuil: 'Bac',
    lanes: [{ label: 'Chloé' }, { label: 'Nora' }, { label: 'Yasmine' }],
  },
  counter: {
    rows: [
      { key: WALKIN.complete, text: 'La cliente se lève du fauteuil : un appui, et la suivante passe en cours.' },
      {
        key: WALKIN.call,
        text: `Vous prévenez vous-même la suivante : son écran indique ${q(CLIENT_STATUS_LABEL.next)}.`,
      },
      {
        key: t('decaler'),
        text: 'Une cliente pas tout à fait prête cède sa place de quelques rangs, sans la perdre.',
      },
      {
        key: t('ajouter'),
        requires: 'core.walkin',
        text: 'La cliente qui a téléphoné, ou qui n’a pas de smartphone, est inscrite par son prénom depuis le poste.',
      },
      {
        key: t('remettre'),
        requires: 'core.absent_policy',
        text: 'Une cliente notée absente revient finalement ? Elle retrouve la file en un geste.',
      },
    ],
  },
  settings: {
    rows: [
      {
        label: t('choixPrestation'),
        value: 'Activé',
        requires: 'core.service_on_board',
        text: 'Coupe, couleur ou soin : la prestation de chaque cliente s’affiche sur le poste, et vous organisez la journée d’un coup d’œil.',
        ref: { source: 'queues', column: 'allow_service_choice', value: true },
      },
      {
        label: t('prevenirAPartir'),
        value: '3 personnes',
        text: 'Une couleur laisse du temps : prévenir un peu plus tôt évite de faire attendre le bac.',
        ref: { source: 'queues', column: 'notify_ahead_threshold', value: 3 },
      },
      {
        label: t('expiration'),
        value: '4 h',
        text: 'Un ticket oublié libère sa place tout seul : la file reste juste, même en fin de journée.',
        ref: { source: 'queues', column: 'entry_ttl_minutes', value: 240 },
      },
      {
        label: t('avisFin'),
        value: 'Activé',
        text: 'Avec le lien de votre fiche Google renseigné dans Réglages, le bouton d’avis apparaît à la fin de chaque passage.',
        ref: { source: 'organization_settings', column: 'send_completion_review', value: true },
      },
    ],
  },
  arguments: [
    {
      key: 'Un accueil apaisé',
      text: 'Plus de clientes entassées à l’entrée : celles qui attendent sont dehors, au café, ou chez elles.',
    },
    {
      key: 'Pas d’heure promise',
      text: 'Rangvia n’annonce jamais une heure qu’une pose de couleur ferait mentir : seulement le nombre de personnes devant.',
    },
    {
      key: 'La prestation d’avance',
      requires: 'core.service_on_board',
      text: 'Vous savez qui vient pour une couleur et qui vient pour une coupe rapide avant même qu’elle s’assoie.',
    },
    {
      key: 'Vos avis Google',
      requires: 'core.google_review',
      text: 'À la fin du passage, un bouton ouvre directement votre fiche Google, si vous en avez renseigné le lien.',
    },
  ],
  faq: [
    {
      q: 'La cliente peut-elle choisir sa prestation ?',
      a: `Oui. Activez ${q(t('choixPrestation'))} et créez vos prestations dans Réglages : coupe, couleur, brushing… Elle choisit en s’inscrivant, ou répond ${q(t('surPlace'))}.`,
    },
    {
      q: 'Rangvia calcule-t-il un temps d’attente ?',
      a: 'Non. Vos clientes voient le nombre de personnes devant elles, jamais une heure estimée : une couleur ne se chronomètre pas à l’avance, et une heure non tenue déçoit plus qu’un chiffre honnête.',
    },
    {
      q: 'Comment arrêter les arrivées avant la fermeture ?',
      requires: 'core.queue_pause',
      a: 'Mettez la file en pause depuis le poste, avec un motif que vos clientes lisent sur leur écran : plus personne ne s’inscrit, et celles qui attendent gardent leur place. Fermez-la quand la dernière est passée.',
    },
    {
      q: 'La file ferme-t-elle toute seule le soir ?',
      a: 'Non : les horaires que vous renseignez sont indicatifs, et c’est vous qui ouvrez et fermez la file, d’un geste. Rien ne se ferme par surprise au milieu d’une couleur.',
    },
    SHARED_FAQ.app,
  ],
  cta: {
    label: 'Ouvrir ma file',
    title: 'Libérez vos chaises d’attente.',
    lead: `Créez votre file, imprimez votre QR code, et la prochaine cliente prend sa place depuis son téléphone. ${TRIAL}`,
  },
  sections: ['story', 'problem', 'counter', 'signature', 'video', 'settings', 'arguments', 'plans', 'faq', 'cta', 'related'],
  related: ['barbiers', 'boutiques', 'restaurants'],
};

/** Capacités qui font d'une file de réception un vrai atelier. */
const GARAGE_WORKSHOP = ['profile.garage.dropoff', 'profile.garage.vehicle_ready'] as const;

const garages: Metier = {
  slug: 'garages',
  activities: ['garage', 'auto_center'],
  published: true,
  updatedAt: REVISED,
  nav: { label: 'Garages et centres auto', short: 'Garage' },
  intent: {
    primary: 'gestion file d’attente garage',
    variants: [
      'ticket d’attente garage',
      'file d’attente garage sans rendez-vous',
      'accueil atelier sans rendez-vous',
      'file d’attente centre auto pneus',
      'prévenir client véhicule prêt',
    ],
    problems: ['clients qui appellent pour savoir si la voiture est prête', 'comptoir de réception encombré le matin'],
  },
  seo: {
    title: 'Gestion de la file d’attente pour garages',
    description:
      'L’accueil atelier sans attente au comptoir : vos clients prennent leur place d’un scan et suivent tout sur leur téléphone. Centres auto compris.',
    ogTitle: 'Un garage où personne ne fait la queue au comptoir',
    ogKicker: 'Garages et centres auto',
  },
  hero: {
    label: 'File d’attente virtuelle · garages et centres auto',
    title: 'Un garage où personne ne fait la queue au comptoir.',
    lead: 'Vos clients prennent leur place d’un scan au lieu de patienter devant la réception, puis suivent tout depuis leur téléphone. Votre comptoir reste libre pour ce qui compte.',
  },
  story: {
    requires: GARAGE_WORKSHOP,
    scene: {
      place: 'Garage des Tilleuls',
      seuil: 'Atelier',
      proKey: VEHICLE.call,
      proLabels: { current: REPAIR.staff, currentName: 'Camille', next: READY.staff, nextName: 'Camille' },
      clientName: 'Camille',
      slotHints: {
        self: 'Votre véhicule',
        kept: 'Déposé',
        back: 'De retour',
        turn: READY.short,
        ghost: 'Votre véhicule',
        next: 'Véhicule suivant',
      },
    },
    steps: [
      {
        kicker: 'Il dépose',
        title: 'Un scan à la réception, et il laisse ses clés.',
        body: 'Immatriculation, modèle, motif : il remplit sa fiche d’atelier sur son téléphone en scannant le QR code de la réception. Ou c’est vous qui la créez, et il la suit en scannant le QR imprimé sur l’étiquette de sa clé.',
        benefit: 'La réception ne recopie plus rien à la main.',
        state: RECEIVED.client,
        requires: 'profile.garage.key_tag',
        fallback: {
          kicker: 'Il dépose',
          title: 'Un scan à la réception, et il laisse ses clés.',
          body: 'Immatriculation, modèle, motif : il remplit sa fiche d’atelier sur son téléphone en scannant le QR code de la réception. Aucun compte, aucune application.',
          benefit: 'La réception ne recopie plus rien à la main.',
          state: RECEIVED.client,
        },
      },
      {
        kicker: 'Il repart',
        title: 'Sa voiture reste à l’atelier. Lui, il vit sa journée.',
        body: 'Il repart au travail ou chez lui : son téléphone suit le véhicule à sa place, même quand la réparation prend plusieurs jours.',
        benefit: 'Le hall d’accueil n’est plus une salle d’attente.',
        state: DIAGNOSIS.client,
        outline: true,
      },
      {
        kicker: 'Il suit',
        title: 'Chaque étape, sans appeler le garage.',
        body: `${q(DIAGNOSIS.client)}, ${q(REPAIR.client)}, ${q(PARTS.client)} : il voit où en est sa voiture chaque fois que vous la faites avancer.`,
        benefit: `Fini les ${q(SPOKEN[2])} au téléphone.`,
        state: REPAIR.client,
      },
      {
        kicker: 'Il valide',
        title: 'Le devis, accepté depuis son téléphone.',
        body: 'Vous envoyez le montant et le détail des travaux : il accepte ou refuse d’un geste, et l’heure de sa réponse s’inscrit sur la fiche.',
        benefit: 'Plus de rappels en boucle pour obtenir un accord.',
        state: QUOTE.client,
        requires: 'profile.garage.quote',
        fallback: {
          kicker: 'Il patiente',
          title: 'Une pièce se fait attendre ? Il le sait.',
          body: `L’étape ${q(PARTS.client)} le prévient, et il comprend pourquoi sa voiture n’est pas encore prête, sans avoir à vous appeler pour l’apprendre.`,
          benefit: 'Le retard est expliqué avant d’être reproché.',
          state: PARTS.client,
        },
      },
      {
        kicker: 'Vous',
        title: `Un geste : ${q(VEHICLE.call)}.`,
        body: `La voiture descend du pont : vous touchez la touche vermillon, et il reçoit ${q(VEHICLE.clientTurn)}, avec vos horaires du jour.`,
        benefit: 'Il sait quand revenir, et votre parking se libère.',
        state: VEHICLE.clientTurn,
      },
      {
        kicker: 'Il récupère',
        title: `${q(VEHICLE.complete)}, puis l’avis Google.`,
        body: 'Vous lui rendez ses clés : un appui, la fiche se ferme, et son téléphone affiche un merci avec un bouton vers la fiche Google du garage.',
        benefit: 'L’avis se laisse clés en main.',
        state: VEHICLE.clientTurn,
      },
    ],
    fallback: {
      scene: {
        place: 'Garage des Tilleuls',
        seuil: 'Réception',
        proKey: WALKIN.complete,
        proLabels: { current: serving('Julien'), currentName: 'Thomas', next: 'Prochain', nextName: 'Camille' },
        clientName: 'Camille',
        slotHints: QUEUE_HINTS,
      },
      steps: [
        {
          kicker: 'Il arrive',
          title: 'Il prend sa place d’un scan, à la réception.',
          body: 'Pneus, vidange, contrôle rapide : il scanne le QR code de la réception ou approche son téléphone de la plaque NFC, donne son prénom, et le voilà dans la file. Rien à installer.',
          benefit: 'La file du matin ne bloque plus l’entrée.',
          state: peopleAheadLabel(3),
        },
        {
          kicker: 'Il attend où il veut',
          title: 'Dans sa voiture, au café, ou au travail.',
          body: 'Sa place est gardée pendant qu’il attend ailleurs que devant votre comptoir. Le hall d’accueil redevient un hall d’accueil.',
          benefit: 'Le comptoir reste libre pour le client que vous recevez.',
          state: t('partir'),
          outline: true,
        },
        {
          kicker: 'Il suit',
          title: 'Sa position en direct, sans venir demander.',
          body: 'Son écran affiche le nombre de personnes devant lui et se met à jour tout seul. Il n’a plus besoin de passer la tête au comptoir pour savoir où il en est.',
          benefit: `Moins de ${q(SPOKEN[0])} pendant que vous remplissez un ordre de réparation.`,
          state: peopleAheadLabel(2),
        },
        {
          kicker: 'Il revient',
          title: 'Prévenu avant son tour.',
          body: `${q(AHEAD_ONE)} Il traverse le parking et touche ${q(t('deRetour'))} en arrivant.`,
          benefit: 'Il revient au bon moment, sans rester planté dans le hall.',
          state: peopleAheadLabel(1),
        },
        {
          kicker: 'Vous',
          title: `${q(WALKIN.complete)}, et la réception passe au suivant.`,
          body: 'Le réceptionnaire clôt le client en cours d’un geste : le suivant passe en cours, et chacun voit sa place avancer sur son téléphone.',
          benefit: 'Un seul bouton, même les mains dans le cambouis.',
          state: CLIENT_STATUS_LABEL.serving,
        },
        {
          kicker: 'Après',
          title: 'Un merci, et l’avis Google.',
          body: `Le passage terminé, votre client lit ${q(VISIT_DONE)} et trouve un bouton vers la fiche Google du garage.`,
          benefit: 'Vos avis grandissent au rythme de vos passages.',
          state: VISIT_DONE,
        },
      ],
    },
  },
  problem: [
    {
      key: 'Huit heures du matin',
      text: 'Cinq clients alignés devant la réception, clés à la main, pendant que les ponts attendent leurs voitures.',
    },
    {
      key: 'Le téléphone',
      text: `Il sonne entre deux diagnostics : ${q(SPOKEN[2])}. La réponse est souvent non, et il faudra rappeler.`,
    },
    {
      key: 'La chaise du hall',
      text: 'Un client attend une heure pour un équilibrage, les yeux rivés sur la porte de l’atelier.',
    },
  ],
  signature: {
    requires: GARAGE_WORKSHOP,
    kind: 'workshop',
    title: 'Le planning d’atelier, vu par le client',
    caption: `Chaque véhicule avance à son rythme, de la réception au retrait. L’écran du hall n’affiche que les véhicules prêts, immatriculation masquée : ${MASKED_PLATE}, seuls les trois derniers caractères.`,
    seuil: 'Atelier',
    lanes: WORKSHOP_LANES,
    fallback: {
      kind: 'counter',
      title: 'Une file pour la réception',
      caption: 'Le poste de la réception montre qui attend, depuis quand, et dans quel ordre : le premier arrivé est le premier reçu.',
      seuil: 'Réception',
      lanes: [
        { label: STAFF_STATUS_LABEL.serving },
        { label: STAFF_STATUS_LABEL.next },
        { label: STAFF_STATUS_LABEL.waiting },
      ],
    },
  },
  counter: {
    requires: GARAGE_WORKSHOP,
    rows: [
      {
        key: VEHICLE_START,
        text: 'Le véhicule monte sur le pont : sa fiche passe en diagnostic, et le client le voit sur son téléphone.',
      },
      {
        key: QUOTE.staff,
        requires: 'profile.garage.quote',
        text: 'Vous saisissez le montant et le détail des travaux : le client répond d’un geste, et son accord arrive sur la fiche avec l’heure.',
      },
      {
        key: PARTS.staff,
        text: 'Le client apprend que sa voiture attend une pièce : il ne s’étonne plus qu’elle ne soit pas prête.',
      },
      {
        key: VEHICLE.call,
        text: `La touche vermillon. Le client reçoit ${q(VEHICLE.clientTurn)}, avec l’heure de fermeture du jour quand vos horaires sont renseignés.`,
      },
      {
        key: VEHICLE.complete,
        text: `Clés rendues, fiche close : elle rejoint les véhicules ${VEHICLE.todayCounter}.`,
      },
    ],
    fallback: {
      rows: [
        { key: WALKIN.complete, text: 'Le client en cours est reçu : un appui, et la réception passe au suivant.' },
        {
          key: t('absent'),
          text: 'Il n’a pas répondu à l’appel ? Il recule de quelques places ou il est mis de côté, selon votre réglage.',
        },
        {
          key: t('ajouter'),
          text: 'Le client qui a téléphoné, ou qui n’a pas de smartphone, est inscrit par la réception avec son prénom.',
        },
        {
          key: t('ecranTv'),
          text: 'La file de la réception s’affiche dans le hall : le prénom du client reçu, les suivants en initiales.',
        },
      ],
    },
  },
  settings: {
    requires: GARAGE_WORKSHOP,
    rows: [
      {
        label: PROFILE_SETTING_LABEL.tvRegistration,
        value: 'Masquée',
        text: 'Seuls les trois derniers caractères s’affichent sur l’écran du hall : le client reconnaît sa voiture, les autres ne lisent rien.',
        ref: { source: 'profile_options', profile: 'vehicle', key: 'tvRegistration', value: 'masked' },
      },
      {
        label: PROFILE_SETTING_LABEL.stayChoice,
        value: 'Proposée',
        text: 'Le client indique s’il laisse son véhicule ou s’il attend sur place : vous savez qui patiente dans le hall.',
        ref: { source: 'profile_options', profile: 'vehicle', key: 'stayChoice', value: true },
      },
      {
        label: PROFILE_SETTING_LABEL.quotes,
        value: 'Activé',
        requires: 'profile.garage.quote',
        text: 'Le devis part sur le téléphone du client, qui l’accepte ou le refuse : sa réponse reste sur la fiche, horodatée.',
        ref: { source: 'profile_options', profile: 'vehicle', key: 'quotes', value: true },
      },
    ],
    fallback: {
      rows: [
        {
          label: t('apresTerminer'),
          value: t('suivantAppele'),
          text: 'La réception finit de remplir l’ordre de réparation avant de faire venir le client suivant.',
          ref: { source: 'queues', column: 'advance_mode', value: 'call_next' },
        },
        {
          label: t('prevenirAPartir'),
          value: '2 personnes',
          text: 'Le temps de revenir du café d’en face ou de sa voiture.',
          ref: { source: 'queues', column: 'notify_ahead_threshold', value: 2 },
        },
        {
          label: t('clientAbsent'),
          value: t('mettreDeCote'),
          text: `Un client parti chercher ses papiers ne perd pas sa place : vous le remettez en file à son retour, avec ${q(t('remettre'))}.`,
          ref: { source: 'queues', column: 'absent_policy', value: 'hold' },
        },
      ],
    },
  },
  arguments: [
    {
      key: `Fini les ${q(SPOKEN[2])}`,
      requires: 'profile.garage.vehicle_ready',
      text: `Le client reçoit ${q(VEHICLE.clientTurn)} au moment où vous touchez ${q(VEHICLE.call)} : le téléphone de l’accueil sonne moins.`,
    },
    {
      key: 'Le devis validé à distance',
      requires: 'profile.garage.quote',
      text: 'Le client accepte ou refuse depuis son téléphone, et l’heure de sa réponse reste sur la fiche.',
    },
    {
      key: 'Un parking qui se libère',
      requires: 'profile.garage.vehicle_ready',
      text: 'Prévenu dès que sa voiture est prête, le client sait quand revenir la chercher.',
    },
    {
      key: 'L’étiquette de clé',
      requires: 'profile.garage.key_tag',
      text: 'Un QR imprimé relie la clé, la voiture et le client : il suit sa réparation sans rien saisir.',
    },
    {
      key: 'Des plaques jamais en clair',
      requires: 'profile.garage.vehicle_ready',
      text: 'L’écran du hall affiche les véhicules prêts avec les trois derniers caractères de l’immatriculation, rien de plus.',
    },
    {
      key: 'Une réception qui respire',
      text: 'Le matin, les clients prennent leur place d’un scan au lieu de faire la queue devant le comptoir.',
    },
    {
      key: 'Le client qui a appelé',
      requires: 'core.walkin',
      text: 'Celui qui a téléphoné, ou qui n’a pas de smartphone, est inscrit par la réception avec son prénom : il attend dans la même file que les autres.',
    },
    {
      key: 'Rien à payer à l’unité',
      text: 'Pas de SMS : les notifications passent par le navigateur, même les matins où la file déborde jusqu’au parking.',
    },
    {
      key: 'Plusieurs adresses',
      requires: 'core.multi_location',
      text: 'Un garage, un centre auto : chaque établissement a sa file, piloté depuis le même compte, selon votre offre.',
    },
  ],
  faq: [
    SHARED_FAQ.app,
    {
      q: 'Je peux inscrire un client qui a appelé ?',
      requires: 'profile.garage.dropoff',
      a: 'Oui. La réception crée la fiche du véhicule depuis le poste (immatriculation, modèle, motif), et le client la suit ensuite sur son téléphone.',
      fallback: {
        q: 'Je peux inscrire un client qui a appelé ?',
        a: `Oui : ${q(t('ajouter'))}, son prénom, et il prend sa place dans la file comme les autres. Vous le prévenez de vive voix, ou par téléphone, quand c’est son tour.`,
      },
    },
    {
      q: 'Combien de temps gardez-vous ses informations ?',
      requires: 'profile.garage.dropoff',
      a: 'Le temps de la réparation, puis la durée de conservation que vous choisissez : au-delà, prénom, immatriculation et détails de la fiche sont effacés automatiquement. Rangvia ne demande ni téléphone, ni e-mail, ni numéro de châssis.',
      fallback: {
        q: 'Combien de temps gardez-vous ses informations ?',
        a: 'Rangvia ne connaît que son prénom, et seulement si vous le demandez. Au-delà de la durée de conservation que vous choisissez, il est effacé automatiquement. Ni téléphone, ni e-mail.',
      },
    },
    {
      q: 'Prévenez-vous par SMS ?',
      a: 'Non : pas de SMS, donc rien à payer à l’unité. Sur iPhone, l’App Clip reçoit la notification sans rien installer ; sur Android, c’est le navigateur. Et sa page se met à jour toute seule tant qu’elle reste ouverte.',
      requires: 'channel.app_clip',
      fallback: {
        q: 'Prévenez-vous par SMS ?',
        a: 'Non : pas de SMS, donc rien à payer à l’unité. Le client est prévenu par une notification du navigateur. Sur iPhone, Safari l’autorise quand la page est ajoutée à l’écran d’accueil ; sinon, sa page se met à jour toute seule tant qu’elle reste ouverte.',
      },
    },
    {
      q: 'Et si la réparation dure plusieurs jours ?',
      requires: 'profile.garage.dropoff',
      a: 'La fiche reste active une semaine après sa dernière étape. Si le client a activé ses notifications, il est prévenu des étapes importantes, même le lendemain.',
    },
    {
      q: 'Le client peut-il refuser un devis ?',
      requires: 'profile.garage.quote',
      a: 'Oui. Il accepte ou refuse depuis son téléphone, et vous voyez sa réponse avec l’heure. Cet accord ne remplace pas un devis signé si vous en exigez un.',
    },
    {
      q: 'Le matin, tout le monde arrive en même temps : ça tient ?',
      requires: 'core.position_live',
      a: 'Oui. Chaque client prend sa place dans l’ordre d’arrivée, depuis son téléphone, et la file se met à jour en direct sur le poste de la réception comme sur l’écran du hall.',
    },
  ],
  cta: {
    requires: GARAGE_WORKSHOP,
    label: VEHICLE.openQueue,
    title: 'Votre réception, sans file devant.',
    lead: `Créez votre atelier en quelques minutes : QR code de la réception, fiches de véhicule et notifications sont prêts. ${TRIAL}`,
    fallback: {
      label: 'Ouvrir ma file',
      title: 'Votre réception, sans file devant.',
      lead: `Créez votre file de réception en quelques minutes, avec son QR code et son lien NFC. ${TRIAL}`,
    },
  },
  sections: ['story', 'problem', 'signature', 'counter', 'video', 'settings', 'arguments', 'plans', 'faq', 'cta', 'related'],
  related: ['reparation-telephone', 'guichets-et-services'],
};

/** Capacités qui font d'un comptoir de réparation un atelier à dossiers. */
const REPAIR_WORKSHOP = ['profile.repair.dropoff', 'profile.repair.device_ready'] as const;

const reparation: Metier = {
  slug: 'reparation-telephone',
  activities: ['phone_repair', 'aftersales'],
  published: true,
  updatedAt: REVISED,
  nav: { label: 'Réparation et SAV', short: 'Réparation' },
  intent: {
    primary: 'file d’attente réparation téléphone',
    variants: [
      'ticket d’attente boutique réparation smartphone',
      'gestion file d’attente réparation informatique',
      'file d’attente service après-vente',
      'prévenir client réparation terminée',
    ],
    problems: ['comptoir encombré entre dépôts et retraits', 'clients qui repassent pour rien'],
  },
  seo: {
    title: 'File d’attente pour la réparation de téléphones',
    description:
      'Dépôts, retraits, diagnostics : vos clients prennent leur place d’un scan et suivent tout sur leur téléphone. Réparation mobile, informatique et SAV.',
    ogTitle: 'Un comptoir de réparation qui ne déborde plus',
    ogKicker: 'Réparation et SAV',
  },
  hero: {
    label: 'File d’attente virtuelle · réparation et SAV',
    title: 'Un comptoir de réparation qui ne déborde plus.',
    lead: 'Diagnostic, dépôt ou retrait : chacun prend sa place d’un scan et attend ailleurs que devant le comptoir. Vous réparez, la file se tient toute seule.',
  },
  story: {
    requires: REPAIR_WORKSHOP,
    scene: {
      place: 'Répar’Express',
      seuil: 'Atelier',
      proKey: DEVICE.call,
      proLabels: { current: REPAIR.staff, currentName: 'Hugo', next: READY.staff, nextName: 'Hugo' },
      clientName: 'Hugo',
      slotHints: {
        self: 'Votre appareil',
        kept: 'Déposé',
        back: 'De retour',
        turn: READY.short,
        ghost: 'Votre appareil',
        next: 'Appareil suivant',
      },
    },
    steps: [
      {
        kicker: 'Il dépose',
        title: 'Un numéro de dossier, dès le dépôt.',
        body: 'Type d’appareil, modèle, panne : il remplit sa fiche en scannant le QR code du comptoir et reçoit son numéro de dossier. Jamais son code de déverrouillage : l’écran le lui rappelle.',
        benefit: 'Plus de fiche cartonnée à remplir au stylo.',
        state: RECEIVED.client,
      },
      {
        kicker: 'Il repart',
        title: 'L’ordinateur reste. Son téléphone suit.',
        body: 'Il vous confie son ordinateur portable et repart avec son téléphone en poche : c’est lui qui suivra la réparation, étape par étape.',
        benefit: 'Personne ne patiente contre la vitrine.',
        state: DIAGNOSIS.client,
        outline: true,
      },
      {
        kicker: 'Il suit',
        title: 'Chaque étape, sans repasser au comptoir.',
        body: `${q(DIAGNOSIS.client)}, puis ${q(REPAIR.client)} : il voit son dossier avancer quand vous le faites avancer, et ne passe plus ${q(SPOKEN[3])}.`,
        benefit: 'Le comptoir sert à réparer, pas à renseigner.',
        state: REPAIR.client,
      },
      {
        kicker: 'Il patiente',
        title: 'Une pièce en commande ? Il le sait.',
        body: `L’étape ${q(PARTS.client)} lui explique le retard avant qu’il ne s’en inquiète.`,
        benefit: 'Un retard annoncé ne devient pas une réclamation.',
        state: PARTS.client,
      },
      {
        kicker: 'Vous',
        title: `La réparation finie : ${q(DEVICE.call)}.`,
        body: `Il reçoit ${q(DEVICE.clientTurn)}, avec vos horaires du jour, et vient le chercher quand il peut.`,
        benefit: 'Vous n’avez pas décroché le téléphone.',
        state: DEVICE.clientTurn,
      },
      {
        kicker: 'Il récupère',
        title: `${q(DEVICE.complete)} : le dossier se ferme.`,
        body: 'Vous lui rendez son appareil : le dossier se ferme, et son téléphone lui propose de laisser un avis sur votre fiche Google.',
        benefit: 'L’avis se laisse quand l’écran est comme neuf.',
        state: DEVICE.clientTurn,
      },
    ],
    fallback: {
      scene: {
        place: 'Répar’Express',
        seuil: 'Comptoir',
        proKey: WALKIN.complete,
        proLabels: { current: serving('Yanis'), currentName: 'Lina', next: 'Prochain', nextName: 'Hugo' },
        clientName: 'Hugo',
        slotHints: QUEUE_HINTS,
      },
      steps: [
        {
          kicker: 'Il arrive',
          title: 'Écran cassé ? Il prend sa place d’un scan.',
          body: 'Il scanne le QR code du comptoir ou approche son téléphone de la plaque, donne son prénom et entre dans la file. Dépôt, retrait ou diagnostic : tout le monde passe dans l’ordre d’arrivée.',
          benefit: 'Plus de mêlée devant la caisse.',
          state: peopleAheadLabel(3),
        },
        {
          kicker: 'Il sort',
          title: 'Il attend dehors, pas contre la vitrine.',
          body: 'Sa place est gardée pendant qu’il fait un tour. Le comptoir reste dégagé pour le client que vous servez.',
          benefit: 'Une boutique qui respire, même le samedi.',
          state: t('partir'),
          outline: true,
        },
        {
          kicker: 'Il suit',
          title: 'Il voit la file avancer depuis son téléphone.',
          body: 'Un seul chiffre, mis à jour en direct : le nombre de personnes devant lui. Il sait s’il a le temps de finir son café.',
          benefit: 'Personne ne vous interrompt pendant une microsoudure.',
          state: peopleAheadLabel(2),
        },
        {
          kicker: 'Il revient',
          title: 'Il revient au bon moment.',
          body: `Son téléphone l’avertit quand il ne reste plus qu’une personne devant lui. En arrivant, il touche ${q(t('deRetour'))} et vous le savez.`,
          benefit: 'Le comptoir ne reste jamais vide à attendre.',
          state: peopleAheadLabel(1),
        },
        {
          kicker: 'Vous',
          title: 'Un appui entre deux réparations.',
          body: `Vous touchez ${q(WALKIN.complete)} quand le client repart : le suivant passe en cours, et la file avance sur tous les écrans.`,
          benefit: 'Aucun ticket papier à appeler.',
          state: CLIENT_STATUS_LABEL.serving,
        },
        {
          kicker: 'Après',
          title: 'Et l’avis Google du comptoir.',
          body: `Le passage terminé, votre client lit ${q(VISIT_DONE)} et trouve un bouton vers la fiche Google de votre boutique.`,
          benefit: 'L’avis se laisse à chaud, quand l’écran est comme neuf.',
          state: VISIT_DONE,
        },
      ],
    },
  },
  problem: [
    {
      key: 'Le comptoir encombré',
      text: 'Un dépôt, deux retraits et un diagnostic se mélangent devant la caisse, et personne ne sait qui était là avant.',
    },
    {
      key: 'Le client qui repasse',
      text: 'Il revient voir si son écran est changé. Il ne l’est pas encore, et il repartira bredouille.',
    },
    {
      key: 'Le téléphone de la boutique',
      text: 'Il sonne en pleine microsoudure : quelqu’un veut savoir si c’est prêt.',
    },
  ],
  signature: {
    requires: REPAIR_WORKSHOP,
    kind: 'workshop',
    title: 'Le dossier, étape par étape',
    caption: 'Chaque appareil a son numéro de dossier et avance à son rythme : reçu, en diagnostic, en réparation, prêt.',
    seuil: 'Atelier',
    lanes: WORKSHOP_LANES,
    fallback: {
      kind: 'counter',
      title: 'Dépôt, retrait, diagnostic : une seule file',
      caption: 'Le poste du comptoir montre qui attend, depuis quand, et dans quel ordre. Les clients passent un par un, sans bousculade.',
      seuil: 'Comptoir',
      lanes: [
        { label: STAFF_STATUS_LABEL.serving },
        { label: STAFF_STATUS_LABEL.next },
        { label: STAFF_STATUS_LABEL.waiting },
      ],
    },
  },
  counter: {
    requires: REPAIR_WORKSHOP,
    rows: [
      { key: DEVICE_START, text: 'L’appareil passe au diagnostic : le client le voit sur son téléphone.' },
      { key: PARTS.staff, text: 'Le client apprend qu’une pièce est en route, sans avoir à demander.' },
      { key: DEVICE.call, text: `Il reçoit ${q(DEVICE.clientTurn)}. Vous n’avez pas décroché le téléphone.` },
      {
        key: DEVICE.complete,
        text: `L’appareil rendu, le dossier se ferme et rejoint les appareils ${DEVICE.todayCounter}.`,
      },
    ],
    fallback: {
      rows: [
        { key: WALKIN.complete, text: 'Le client repart avec son appareil : un appui, et c’est au suivant.' },
        {
          key: WALKIN.call,
          text: `Le comptoir se libère : vous appelez le client suivant, et son écran affiche ${q(CLIENT_STATUS_LABEL.next)}.`,
        },
        { key: t('decaler'), text: 'Un client pas encore prêt cède sa place de quelques rangs, sans la perdre.' },
        { key: t('ajouter'), text: 'Un client sans smartphone ? Son prénom suffit pour l’inscrire depuis le poste.' },
      ],
    },
  },
  settings: {
    requires: REPAIR_WORKSHOP,
    rows: [
      {
        label: PROFILE_SETTING_LABEL.dossierNumbering,
        value: 'Activé',
        text: 'Un numéro continu, jamais remis à zéro : le client, l’écran et le poste parlent du même dossier.',
        ref: { source: 'profile_options', profile: 'device', key: 'numbering', value: true },
      },
      {
        label: t('choixPrestation'),
        value: 'Activé',
        text: 'Écran, batterie, connecteur de charge : la panne est connue dès le dépôt.',
        ref: { source: 'queues', column: 'allow_service_choice', value: true },
      },
    ],
    fallback: {
      rows: [
        {
          label: t('clientAbsent'),
          value: t('mettreDeCote'),
          text: 'Le client parti chercher sa facture garde sa place : vous le remettez en file à son retour.',
          ref: { source: 'queues', column: 'absent_policy', value: 'hold' },
        },
        {
          label: t('expiration'),
          value: '2 h',
          text: 'Un client qui ne revient pas libère sa place au bout de deux heures, sans que vous ayez à le retirer.',
          ref: { source: 'queues', column: 'entry_ttl_minutes', value: 120 },
        },
        {
          label: t('prevenirAPartir'),
          value: '2 personnes',
          text: 'Juste le temps de revenir du café d’à côté.',
          ref: { source: 'queues', column: 'notify_ahead_threshold', value: 2 },
        },
      ],
    },
  },
  arguments: [
    {
      key: 'Une seule file, dans l’ordre',
      text: 'Dépôt, retrait et diagnostic passent dans l’ordre d’arrivée : plus de débat devant la caisse.',
    },
    {
      key: `${q(DEVICE.clientTurn)} en un geste`,
      requires: 'profile.repair.device_ready',
      text: 'Le client est prévenu dès que la réparation est finie : il vient chercher son appareil sans appeler avant.',
    },
    {
      key: 'Un numéro de dossier',
      requires: 'profile.repair.dropoff',
      text: 'Le client, le poste et l’écran de la boutique parlent du même numéro : fini les confusions entre deux appareils du même modèle.',
    },
    {
      key: 'Aucun code demandé',
      requires: 'profile.repair.dropoff',
      text: 'Rangvia ne demande jamais le code de déverrouillage, et l’écran du client le rappelle au moment du dépôt.',
    },
    {
      key: 'Une boutique qui respire',
      text: 'Les clients attendent dehors ou au café, et reviennent quand leur tour approche.',
    },
    {
      key: 'Vos heures de pointe',
      requires: 'core.stats',
      text: 'Les statistiques montrent à quelle heure arrivent vos clients : de quoi prévoir un technicien de plus le samedi.',
    },
  ],
  faq: [
    {
      q: 'Dépôt et retrait, dans la même file ?',
      requires: 'core.multi_queue',
      a: 'Oui, ou dans deux files séparées, selon votre offre : chaque file a son QR code et sa plaque.',
      fallback: {
        q: 'Dépôt et retrait, dans la même file ?',
        a: 'Oui : tout le monde passe dans l’ordre d’arrivée, quel que soit le motif. Vous pouvez aussi créer des prestations dépôt, retrait et diagnostic, que le client choisit en s’inscrivant.',
      },
    },
    {
      q: 'Que voit le client sur son téléphone ?',
      requires: 'profile.repair.dropoff',
      a: `Son numéro de dossier et l’étape en cours : ${frenchList([RECEIVED.short, DIAGNOSIS.short, REPAIR.short, READY.short].map((s) => s.toLowerCase()))}. Aucune heure estimée : une réparation ne se chronomètre pas à l’avance.`,
      fallback: {
        q: 'Que voit le client sur son téléphone ?',
        a: `Le nombre de personnes devant lui, en direct, puis ${q(CLIENT_STATUS_LABEL.serving)} quand vient son moment. Aucune heure estimée : une réparation ne se chronomètre pas à l’avance.`,
      },
    },
    {
      q: 'Et s’il ne revient pas ?',
      requires: ['core.absent_policy', 'core.expiry'],
      a: `Le bouton ${q(t('absent'))} le recule ou le met de côté, selon votre réglage. Un ticket oublié expire tout seul au bout du délai que vous choisissez.`,
    },
    {
      q: 'Et si le client me confie son seul téléphone ?',
      requires: 'profile.repair.dropoff',
      a: 'Les notifications arrivent sur l’appareil qui a servi au dépôt. S’il vous laisse son seul téléphone, il garde son numéro de dossier et repasse au moment que vous lui indiquez : le dossier, lui, avance quand même sur le poste.',
    },
    {
      q: 'Demandez-vous le code de déverrouillage ?',
      requires: 'profile.repair.dropoff',
      a: 'Jamais. Rangvia ne le demande pas, et l’écran du client rappelle de ne pas le saisir. Si vous en avez besoin pour un test, demandez-le de vive voix.',
    },
    {
      q: 'Ça marche aussi pour un service après-vente ?',
      a: 'Oui : un SAV reçoit, diagnostique et rend des appareils comme une boutique de réparation. Chaque client prend sa place d’un scan, et vous le servez dans l’ordre d’arrivée.',
    },
    SHARED_FAQ.app,
  ],
  cta: {
    requires: REPAIR_WORKSHOP,
    label: DEVICE.openQueue,
    title: 'Votre comptoir, enfin dégagé.',
    lead: `Créez votre atelier en quelques minutes : QR code du comptoir, dossiers et notifications sont prêts. ${TRIAL}`,
    fallback: {
      label: 'Ouvrir ma file',
      title: 'Votre comptoir, enfin dégagé.',
      lead: `Créez votre file en quelques minutes, imprimez son QR code, et le prochain client prend sa place depuis son téléphone. ${TRIAL}`,
    },
  },
  sections: ['story', 'problem', 'signature', 'counter', 'video', 'settings', 'arguments', 'plans', 'faq', 'cta', 'related'],
  related: ['garages', 'boutiques', 'guichets-et-services'],
};

/** Capacités de la liste d'attente par table. */
const TABLE_LIST = ['profile.restaurant.party_size', 'profile.restaurant.table_ready'] as const;

const restaurants: Metier = {
  slug: 'restaurants',
  activities: ['restaurant'],
  published: true,
  updatedAt: REVISED,
  nav: { label: 'Restaurants', short: 'Restaurant' },
  intent: {
    primary: 'liste d’attente restaurant',
    variants: [
      'file d’attente restaurant sans application',
      'waitlist restaurant',
      'prévenir client table prête',
      'gestion attente restaurant sans réservation',
    ],
    problems: ['groupe qui attend sur le trottoir', 'prénoms criés à la porte'],
  },
  seo: {
    title: 'Liste d’attente pour restaurants, sans application',
    description:
      'Complet ce soir ? Vos clients s’inscrivent sur leur téléphone, attendent au bar d’à côté et reviennent quand leur table approche. Sans bipeur ni SMS.',
    ogTitle: 'Plus personne n’attend sur le trottoir',
    ogKicker: 'Restaurants',
  },
  hero: {
    label: 'Liste d’attente virtuelle · restaurants',
    title: 'Plus personne n’attend sur le trottoir.',
    lead: 'Un QR code sur la vitrine, un prénom, et vos clients attendent où ils veulent. Vous appelez le groupe suivant d’un geste, sans crier de prénoms à la porte.',
  },
  story: {
    requires: TABLE_LIST,
    scene: {
      place: 'Chez Margaux',
      seuil: TABLE.counter,
      proKey: TABLE.call,
      proLabels: { current: 'Table de quatre', currentName: 'Paul', next: TABLE.clientTurn, nextName: 'Inès' },
      clientName: 'Inès',
      slotHints: {
        self: 'Votre groupe',
        kept: 'Place gardée',
        back: 'De retour',
        turn: 'À table',
        ghost: 'Votre groupe',
        next: 'Groupe suivant',
      },
    },
    steps: [
      {
        kicker: 'Ils arrivent',
        title: 'Un prénom, et le nombre de couverts.',
        body: 'Ils scannent le QR code de l’entrée, indiquent combien ils sont, salle ou terrasse, chaise haute ou accès facilité si besoin. Aucun numéro de téléphone demandé.',
        benefit: 'L’accueil sait tout de suite quelle table il faudra.',
        state: clientAheadLabel('table', 3),
      },
      {
        kicker: 'Ils sortent',
        title: 'Un verre ailleurs, leur place ici.',
        body: 'Ils patientent au bar d’en face ou font le tour du quartier : leur groupe garde sa place dans la liste.',
        benefit: 'Le trottoir reste libre, l’entrée aussi.',
        state: t('partir'),
        outline: true,
      },
      {
        kicker: 'Ils suivent',
        title: 'Ils comptent les groupes, pas les minutes.',
        body: 'Leur écran montre combien de groupes passent avant eux, en direct. Aucune heure promise : un dessert qui s’éternise ne fait mentir personne.',
        benefit: 'Personne ne vient demander où il en est.',
        state: clientAheadLabel('table', 2),
      },
      {
        kicker: 'Ils reviennent',
        title: 'Prévenus avant d’être appelés.',
        body: `${q(TABLE_AHEAD_ONE)} Ils règlent leur verre et remontent la rue.`,
        benefit: 'Ils sont là quand la table se libère.',
        state: clientAheadLabel('table', 0),
      },
      {
        kicker: 'Vous',
        title: `${q(TABLE.call)}, et ils arrivent.`,
        body: `Une table se libère : vous indiquez sa taille, Rangvia met en évidence le premier groupe arrivé qui y tient, et vous confirmez. Leur téléphone affiche ${q(TABLE.clientTurn)}.`,
        benefit: 'Personne ne crie de prénom à la porte.',
        state: TABLE.clientTurn,
      },
      {
        kicker: 'Après',
        title: 'L’avis Google, après le dessert.',
        body: `Vous touchez ${q(TABLE.complete)} quand ils s’assoient. La demande d’avis part après le repas, pas à l’apéritif : ${REVIEW_DELAY} minutes plus tard par défaut, un délai que vous réglez.`,
        benefit: 'L’avis se laisse le ventre plein, pas le menu à la main.',
        state: VISIT_DONE,
        requires: 'profile.restaurant.delayed_review',
        fallback: {
          kicker: 'Complet',
          title: 'Complet ce soir ? Vous le dites.',
          body: 'Une pause de la liste, avec un motif que vos clients lisent sur leur écran : plus personne ne s’inscrit, et ceux qui attendent gardent leur place.',
          benefit: 'Un refus clair vaut mieux qu’une attente inutile.',
          state: QUEUE_STATUS_LABEL.paused,
        },
      },
    ],
    fallback: {
      scene: {
        place: 'Chez Margaux',
        seuil: 'Salle',
        proKey: WALKIN.complete,
        proLabels: { current: serving('Paul'), currentName: 'Sarah', next: 'Prochain', nextName: 'Inès' },
        clientName: 'Inès',
        slotHints: QUEUE_HINTS,
      },
      steps: [
        {
          kicker: 'Ils arrivent',
          title: 'Complet ? Ils s’inscrivent à la porte.',
          body: 'Un QR code sur la vitrine ou une plaque à l’accueil : un prénom, et le groupe prend sa place dans la liste. Ni compte à créer, ni application à installer.',
          benefit: 'Plus de liste griffonnée sur un coin de comptoir.',
          state: peopleAheadLabel(3),
        },
        {
          kicker: 'Ils sortent',
          title: 'Un verre au bar d’à côté, en attendant.',
          body: 'Leur place est gardée pendant qu’ils se promènent ou prennent l’apéritif ailleurs.',
          benefit: 'Le trottoir reste libre, et l’entrée aussi.',
          state: t('partir'),
          outline: true,
        },
        {
          kicker: 'Ils suivent',
          title: 'La liste avance sous leurs yeux.',
          body: 'Leur téléphone affiche combien d’inscrits passent avant eux, en direct. Pas d’heure promise : un dessert qui s’éternise ne fait mentir personne.',
          benefit: 'Personne ne vient demander où il en est.',
          state: peopleAheadLabel(2),
        },
        {
          kicker: 'Ils reviennent',
          title: 'Prévenus quand leur tour approche.',
          body: `${q(AHEAD_ONE)} Ils finissent leur verre et remontent la rue.`,
          benefit: 'Ils sont là quand la table se libère.',
          state: peopleAheadLabel(1),
        },
        {
          kicker: 'Vous',
          title: `Une table se libère : ${q(WALKIN.complete)}.`,
          body: 'Le groupe installé sort de la liste, le suivant est prévenu sur son téléphone que c’est son tour, et la liste avance pour tout le monde.',
          benefit: 'Personne ne crie de prénom à la porte.',
          state: CLIENT_STATUS_LABEL.serving,
        },
        {
          kicker: 'Complet',
          title: 'Complet ce soir ? Vous le dites.',
          body: 'Une pause de la liste, avec un motif que vos clients lisent sur leur écran : plus personne ne s’inscrit, et ceux qui attendent gardent leur place.',
          benefit: 'Un refus clair vaut mieux qu’une attente inutile.',
          state: QUEUE_STATUS_LABEL.paused,
        },
      ],
    },
  },
  problem: [
    {
      key: 'Vendredi soir',
      text: 'Un groupe de six attend sur le trottoir, sous la pluie, en regardant les tables à travers la vitre.',
    },
    {
      key: 'Les prénoms à la porte',
      text: 'On appelle un nom dans le brouhaha. Personne ne répond, et la table reste vide.',
    },
    {
      key: 'Le couple qui part',
      text: 'Il va boire un verre en face, le temps qu’une table se libère, et ne revient jamais.',
    },
  ],
  signature: {
    requires: TABLE_LIST,
    kind: 'tables',
    title: 'La liste, par taille de groupe',
    caption: 'Chaque groupe porte son nombre de couverts : d’un coup d’œil, vous voyez qui tient à la table qui se libère.',
    seuil: TABLE.counter,
    lanes: TABLE_SIZES.map((n) => ({ label: `${n} couverts` })),
    fallback: {
      kind: 'counter',
      title: 'La liste, dans l’ordre d’arrivée',
      caption: 'Le poste de l’accueil montre chaque groupe inscrit, par prénom, dans l’ordre où il est arrivé.',
      seuil: 'Salle',
      lanes: [
        { label: STAFF_STATUS_LABEL.serving },
        { label: STAFF_STATUS_LABEL.next },
        { label: STAFF_STATUS_LABEL.waiting },
      ],
    },
  },
  counter: {
    requires: TABLE_LIST,
    rows: [
      {
        key: TABLE.call,
        text: 'Vous indiquez la taille de la table libre : le premier groupe arrivé qui y tient est proposé, et vous confirmez d’un geste. L’ordre n’est jamais sauté sans votre choix.',
      },
      {
        key: TABLE.complete,
        text: `Le groupe est assis : il quitte la liste, et le compteur des ${TABLE.todayCounter} avance.`,
      },
      {
        key: t('absent'),
        text: 'Le groupe ne s’est pas présenté à temps ? Il sort de la liste, et la table va au suivant.',
      },
    ],
    fallback: {
      rows: [
        {
          key: WALKIN.complete,
          text: 'Une table se libère : un appui, le groupe installé sort de la liste et le suivant est prévenu sur son téléphone.',
        },
        {
          key: WALKIN.call,
          text: 'Vous préférez choisir ? Appelez vous-même le groupe suivant, quand la salle est prête.',
        },
        {
          key: t('absent'),
          text: 'Personne à l’appel ? Le groupe est mis de côté, et vous le remettez en file s’il revient.',
        },
        { key: t('ajouter'), text: 'Un groupe sans smartphone s’inscrit à l’accueil, par son prénom.' },
      ],
    },
  },
  settings: {
    requires: TABLE_LIST,
    rows: [
      {
        label: PROFILE_SETTING_LABEL.partyMax,
        value: `${PARTY_MAX} couverts`,
        text: 'Au-delà, le client est invité à se présenter à l’accueil : une grande tablée se place de vive voix.',
        ref: { source: 'profile_options', profile: 'table', key: 'partyMax', value: PARTY_MAX },
      },
      {
        label: PROFILE_SETTING_LABEL.tableSizes,
        value: `${frenchList(TABLE_SIZES)} couverts`,
        text: 'Les touches de l’accueil correspondent à vos vraies tables : la bonne suggestion en un geste.',
        ref: { source: 'profile_options', profile: 'table', key: 'tableSizes', value: TABLE_SIZES },
      },
      {
        label: PROFILE_SETTING_LABEL.reviewDelayMinutes,
        value: `${REVIEW_DELAY} minutes`,
        requires: 'profile.restaurant.delayed_review',
        text: `La demande d’avis arrive après le repas, pas à l’apéritif. Réglable de ${REVIEW_DELAY_MIN} à ${REVIEW_DELAY_MAX} minutes, ou désactivée.`,
        ref: { source: 'profile_options', profile: 'table', key: 'reviewDelayMinutes', value: REVIEW_DELAY },
      },
      {
        label: t('prevenirAPartir'),
        value: '2 groupes',
        text: 'Deux groupes avant eux : le temps de régler un verre et de revenir.',
        ref: { source: 'queues', column: 'notify_ahead_threshold', value: 2 },
      },
    ],
    fallback: {
      rows: [
        {
          label: t('prenomObligatoire'),
          value: 'Activé',
          text: 'L’accueil appelle des prénoms : autant qu’il y en ait un sur chaque ligne.',
          ref: { source: 'queues', column: 'client_name_required', value: true },
        },
        {
          label: t('prevenirAPartir'),
          value: '2 personnes',
          text: 'Le temps de finir un verre et de remonter la rue.',
          ref: { source: 'queues', column: 'notify_ahead_threshold', value: 2 },
        },
        {
          label: t('clientAbsent'),
          value: t('sortir'),
          text: 'Une table ne s’attend pas : le groupe absent laisse la place au suivant.',
          ref: { source: 'queues', column: 'absent_policy', value: 'remove' },
        },
        {
          label: t('expiration'),
          value: '4 h',
          text: 'Le temps d’un service : les inscriptions oubliées ne traînent pas jusqu’au lendemain.',
          ref: { source: 'queues', column: 'entry_ttl_minutes', value: 240 },
        },
      ],
    },
  },
  arguments: [
    {
      key: 'Pas de bipeur',
      text: 'Rien à acheter, à recharger ni à récupérer en fin de soirée : le téléphone de vos clients fait le travail.',
    },
    {
      key: 'Le trottoir dégagé',
      text: 'Vos clients attendent au bar d’à côté ou dans le quartier, pas devant la porte.',
    },
    {
      key: 'Le bon groupe, dans l’ordre',
      requires: 'profile.restaurant.table_ready',
      text: 'Une table de quatre se libère : Rangvia propose le premier groupe qui y tient, sans sauter personne sans votre accord.',
    },
    {
      key: 'Les couverts d’avance',
      requires: 'profile.restaurant.party_size',
      text: 'Vous savez combien de couverts attendent, et combien vous en avez installé ce soir.',
    },
    {
      key: 'L’avis au bon moment',
      requires: 'profile.restaurant.delayed_review',
      text: 'La demande d’avis Google part après le repas, jamais au moment où l’on s’assoit.',
    },
    {
      key: 'Juste un prénom',
      text: 'Aucun numéro de téléphone, aucun e-mail : vos clients s’inscrivent sans rien laisser d’autre.',
    },
  ],
  faq: [
    {
      q: 'Le client peut-il partir boire un verre ?',
      a: 'Oui, c’est tout l’intérêt : sa place est gardée, et son téléphone le prévient quand son tour approche. Il revient au bon moment, sans rester planté sur le trottoir.',
    },
    {
      q: `Comment dire ${q(SPOKEN[4])} ?`,
      requires: 'core.queue_pause',
      a: 'Mettez la liste en pause depuis le poste, avec un motif que vos clients lisent sur leur écran : plus personne ne s’inscrit, et ceux qui attendent gardent leur place. Fermez-la à la fin du service.',
    },
    {
      q: 'Les clients doivent-ils donner leur numéro ?',
      a: 'Non. Un prénom suffit, pour que l’accueil puisse les appeler. Pas de téléphone, pas d’e-mail, et le prénom est effacé automatiquement après la durée de conservation que vous choisissez.',
    },
    {
      q: 'Et les grandes tablées ?',
      requires: 'profile.restaurant.party_size',
      a: `Le client indique jusqu’à ${PARTY_MAX} couverts par défaut, un maximum que vous pouvez porter à ${PARTY_MAX_LIMIT}. Au-delà, il est invité à se présenter à l’accueil.`,
    },
    {
      q: 'La demande d’avis Google arrive-t-elle pendant le repas ?',
      requires: 'profile.restaurant.delayed_review',
      a: `Non. Elle part ${REVIEW_DELAY} minutes après que vous avez installé le groupe, un délai réglable de ${REVIEW_DELAY_MIN} à ${REVIEW_DELAY_MAX} minutes. Vous pouvez aussi la désactiver.`,
      fallback: {
        q: 'La demande d’avis Google arrive-t-elle pendant le repas ?',
        a: `Elle s’affiche quand vous terminez le passage du groupe, et seulement si vous avez renseigné le lien de votre fiche Google. Vous pouvez aussi la couper : ${q(t('avisFin'))}, dans Réglages.`,
      },
    },
    SHARED_FAQ.notification,
  ],
  cta: {
    requires: TABLE_LIST,
    label: TABLE.openQueue,
    title: 'Ce soir, personne sur le trottoir.',
    lead: `Créez votre liste en quelques minutes : QR code de l’entrée, touches de tables et notifications sont prêts. ${TRIAL}`,
    fallback: {
      label: 'Ouvrir ma file',
      title: 'Ce soir, personne sur le trottoir.',
      lead: `Créez votre liste d’attente en quelques minutes, avec son QR code pour la vitrine. ${TRIAL}`,
    },
  },
  sections: ['story', 'problem', 'signature', 'counter', 'video', 'settings', 'arguments', 'plans', 'faq', 'cta', 'related'],
  related: ['evenements-et-drops', 'barbiers'],
};

/** Capacités du guichet numéroté. */
const DESK_CALLS = ['profile.counter.ticket_number', 'profile.counter.desk_number'] as const;

const guichets: Metier = {
  slug: 'guichets-et-services',
  activities: ['counter', 'admin_service'],
  published: true,
  updatedAt: REVISED,
  nav: { label: 'Guichets et services', short: 'Guichet' },
  intent: {
    primary: 'ticket d’attente virtuel',
    variants: [
      'gestion file d’attente accueil',
      'file d’attente guichet',
      'alternative borne ticket d’attente',
      'écran d’appel salle d’attente',
    ],
    problems: ['salle d’attente saturée', 'tickets papier perdus'],
  },
  seo: {
    title: 'Ticket d’attente virtuel pour guichets et accueils',
    description:
      'Remplacez la borne à tickets par un QR code : chacun prend sa place sur son téléphone, attend où il veut et voit la file avancer sur l’écran de la salle.',
    ogTitle: 'Une salle d’attente vide, une file qui avance',
    ogKicker: 'Guichets et services',
  },
  hero: {
    label: 'Ticket d’attente virtuel · guichets et services',
    title: 'Une salle d’attente vide. Une file qui avance.',
    lead: 'Pas de borne, pas de rouleau de tickets : un QR code à l’entrée, et chacun prend sa place sur son téléphone. L’écran de la salle montre où en est la file.',
  },
  story: {
    requires: DESK_CALLS,
    scene: {
      place: 'Maison des services',
      seuil: 'Guichet 2',
      proKey: DESK.call,
      proLabels: { current: `${DESK.counter} 2`, currentName: TICKET(41), next: STAFF_STATUS_LABEL.next, nextName: TICKET(42) },
      clientName: TICKET(42),
      slotHints: {
        self: 'Votre ticket',
        kept: 'Place gardée',
        back: 'De retour',
        turn: 'Au guichet',
        ghost: 'Votre ticket',
        next: 'Ticket suivant',
      },
    },
    steps: [
      {
        kicker: 'Elle arrive',
        title: 'Un numéro, sans borne ni papier.',
        body: `Elle scanne le QR code de l’entrée, choisit son motif et reçoit un numéro, ${TICKET(42)} par exemple. Son prénom ne lui est pas demandé.`,
        benefit: 'Moins de données collectées, et aucun nom à appeler.',
        state: `Ticket ${TICKET(42)}`,
      },
      {
        kicker: 'Elle sort',
        title: 'Elle attend où elle veut.',
        body: 'Dehors, dans sa voiture ou au café : son numéro garde sa place, et son téléphone la suit.',
        benefit: 'La salle d’attente se vide sans que la file ralentisse.',
        state: t('partir'),
        outline: true,
      },
      {
        kicker: 'Elle suit',
        title: 'Le nombre de personnes devant elle, en direct.',
        body: 'Son écran se met à jour à chaque appel. Pas d’heure promise : une démarche compliquée prend le temps qu’il faut.',
        benefit: 'Personne ne revient demander à l’accueil.',
        state: peopleAheadLabel(3),
      },
      {
        kicker: 'Elle revient',
        title: 'Prévenue quand son tour approche.',
        body: `${q(DESK_AHEAD_ONE)} Elle revient à temps, sans avoir surveillé l’écran de la salle.`,
        benefit: 'Plus de numéro raté parce qu’on était sorti téléphoner.',
        state: peopleAheadLabel(1),
      },
      {
        kicker: 'Vous',
        title: `${q(DESK.call)}.`,
        body: 'Le numéro suivant s’affiche sur l’écran de la salle avec le guichet où se présenter, et son téléphone affiche le même : personne n’entend son nom dans la salle.',
        benefit: 'Chaque agent appelle à son guichet, sans se coordonner à voix haute.',
        state: DESK_TURN,
      },
      {
        kicker: 'Après',
        title: 'Aucun nom affiché dans la salle.',
        body: 'L’écran de la salle n’affiche que des numéros et des guichets, jamais un prénom. Pour un service administratif, la demande d’avis Google est coupée par défaut.',
        benefit: 'La confidentialité de chacun, sans effort.',
        state: VISIT_DONE,
      },
    ],
    fallback: {
      scene: {
        place: 'Maison des services',
        seuil: 'Accueil',
        proKey: WALKIN.complete,
        proLabels: { current: serving('Claire'), currentName: 'Sami', next: 'Prochain', nextName: 'Anna' },
        clientName: 'Anna',
        slotHints: QUEUE_HINTS,
      },
      steps: [
        {
          kicker: 'Elle arrive',
          title: 'Un QR code à la place de la borne.',
          body: 'Elle scanne le QR code affiché à l’entrée et prend sa place. Ni ticket papier, ni compte à créer, ni application à installer.',
          benefit: 'Plus de borne en panne, plus de rouleau à changer.',
          state: peopleAheadLabel(5),
        },
        {
          kicker: 'Elle sort',
          title: 'Elle attend dehors, ou dans sa voiture.',
          body: 'Sa place est gardée : elle n’a plus besoin de rester assise dans la salle pour ne pas rater son tour.',
          benefit: 'La salle d’attente se vide sans que la file ralentisse.',
          state: t('partir'),
          outline: true,
        },
        {
          kicker: 'Elle suit',
          title: 'Sa position, sur son téléphone et sur l’écran.',
          body: 'Le nombre de personnes devant elle se met à jour en direct. Dans la salle, l’écran montre la personne reçue et les suivantes en initiales.',
          benefit: 'Personne ne revient demander à l’accueil.',
          state: peopleAheadLabel(3),
        },
        {
          kicker: 'Elle revient',
          title: 'Prévenue quand son tour approche.',
          body: `${q(AHEAD_ONE)} Elle revient à temps et touche ${q(t('deRetour'))}.`,
          benefit: 'Plus de tour raté parce qu’on était sorti téléphoner.',
          state: peopleAheadLabel(1),
        },
        {
          kicker: 'Vous',
          title: `${q(WALKIN.complete)}, la personne suivante est appelée.`,
          body: 'Une démarche finie, un appui : la personne suivante est prévenue sur son téléphone, l’écran de la salle se met à jour, et vous la recevez quand elle arrive.',
          benefit: 'Aucun numéro à crier dans la salle.',
          state: CLIENT_STATUS_LABEL.next,
        },
        {
          kicker: 'Le soir',
          title: 'Vos chiffres, sans rien saisir.',
          body: 'Personnes accueillies, attente médiane, heures d’affluence, activité par agent : les statistiques se remplissent toutes seules.',
          benefit: 'De quoi ajuster vos horaires d’ouverture sur des faits.',
          state: VISIT_DONE,
        },
      ],
    },
  },
  problem: [
    {
      key: 'Lundi matin',
      text: 'Trente personnes dans une salle prévue pour quinze, et une file qui déborde dans le couloir.',
    },
    {
      key: 'Le ticket papier',
      text: 'Un numéro froissé au fond d’une poche, et un tour raté parce qu’on était sorti téléphoner.',
    },
    {
      key: 'La borne en panne',
      text: 'Plus de papier dans la borne, et une file qui se reforme à l’ancienne devant l’accueil.',
    },
  ],
  signature: {
    requires: DESK_CALLS,
    kind: 'guichets',
    title: 'Le tableau d’appel',
    caption: 'Un numéro, un guichet, en grand sur l’écran de la salle et sur le téléphone de la personne appelée. Aucun prénom affiché.',
    seuil: 'Guichet 2',
    lanes: [
      { label: `${DESK.counter} 1`, hint: TICKET(40) },
      { label: `${DESK.counter} 2`, hint: TICKET(41) },
      { label: `${DESK.counter} 3`, hint: TICKET(42) },
    ],
    fallback: {
      kind: 'counter',
      title: 'La file de l’accueil, sur grand écran',
      caption: 'L’écran de la salle montre la personne reçue et les suivantes en initiales : chacun sait où en est la file sans rien demander.',
      seuil: 'Accueil',
      lanes: [
        { label: STAFF_STATUS_LABEL.serving },
        { label: STAFF_STATUS_LABEL.next },
        { label: STAFF_STATUS_LABEL.waiting },
      ],
    },
  },
  counter: {
    requires: DESK_CALLS,
    rows: [
      {
        key: DESK.call,
        text: 'Le numéro suivant s’affiche sur l’écran de la salle, avec votre guichet, et sur le téléphone de la personne.',
      },
      { key: DESK_START, text: 'La personne est arrivée : la démarche commence, et la salle le voit.' },
      { key: DESK.complete, text: 'Démarche terminée : le numéro suivant est appelé à votre guichet.' },
      {
        key: t('absent'),
        text: 'Personne ne se présente ? Le numéro recule ou est mis de côté, selon votre réglage, et vous appelez le suivant.',
      },
    ],
    fallback: {
      rows: [
        { key: WALKIN.complete, text: 'La démarche est finie : un appui, et la personne suivante est appelée.' },
        {
          key: WALKIN_START,
          text: 'Elle est arrivée au guichet : vous démarrez, et l’écran de la salle se met à jour.',
        },
        {
          key: t('ajouter'),
          text: 'Une personne sans smartphone ? L’agent d’accueil l’inscrit lui-même depuis son poste.',
        },
        { key: t('ecranTv'), text: 'La file s’affiche sur la télévision de la salle, en direct.' },
      ],
    },
  },
  settings: {
    requires: DESK_CALLS,
    rows: [
      {
        label: PROFILE_SETTING_LABEL.ticketNumbering,
        value: 'Activée',
        text: 'Un numéro par personne, remis à zéro chaque jour : la salle appelle des numéros, jamais des noms.',
        ref: { source: 'profile_options', profile: 'desk', key: 'numbering', value: true },
      },
      {
        label: PROFILE_SETTING_LABEL.ticketPrefix,
        value: 'A',
        text: `La lettre qui précède chaque numéro, comme dans ${TICKET(42)} : choisissez celle qui parle à vos visiteurs.`,
        ref: { source: 'queues', column: 'ticket_prefix', value: 'A' },
      },
      {
        label: PROFILE_SETTING_LABEL.deskLabel,
        value: 'Guichet 1, Guichet 2…',
        text: 'Chaque agent choisit son guichet en ouvrant le poste : l’écran et le téléphone indiquent où se présenter.',
        ref: { source: 'staff', column: 'desk_label', value: 'Guichet 1' },
      },
      {
        label: t('demanderPrenom'),
        value: 'Désactivé',
        text: 'Le numéro suffit : moins de données collectées, et aucun nom affiché dans la salle.',
        ref: { source: 'queues', column: 'ask_client_name', value: false },
      },
    ],
    fallback: {
      rows: [
        {
          label: t('apresTerminer'),
          value: t('suivantAppele'),
          text: 'L’agent appelle, la personne arrive à son rythme, et la démarche ne commence que quand elle est là.',
          ref: { source: 'queues', column: 'advance_mode', value: 'call_next' },
        },
        {
          label: t('prevenirAPartir'),
          value: '3 personnes',
          text: 'Le temps de revenir du parking ou de la machine à café.',
          ref: { source: 'queues', column: 'notify_ahead_threshold', value: 3 },
        },
        {
          label: t('conservation'),
          value: '7 jours',
          text: 'Pour un accueil, une semaine d’historique suffit souvent : les prénoms s’effacent ensuite automatiquement.',
          ref: { source: 'organization_settings', column: 'data_retention_days', value: 7 },
        },
      ],
    },
  },
  arguments: [
    {
      key: 'Pas de borne à louer',
      text: 'Un QR code imprimé ou une plaque suffit : pas de rouleau de tickets, rien à brancher.',
    },
    {
      key: 'La salle désengorgée',
      text: 'Chacun attend où il veut et revient quand son tour approche.',
    },
    {
      key: 'Des numéros, pas des noms',
      requires: 'profile.counter.ticket_number',
      text: `Au guichet, on appelle ${TICKET(42)}, pas un prénom : la confidentialité de chacun est préservée.`,
    },
    {
      key: 'Le bon guichet',
      requires: 'profile.counter.desk_number',
      text: 'L’écran de la salle et le téléphone indiquent où se présenter, guichet par guichet.',
    },
    {
      key: 'Personne n’est laissé de côté',
      requires: 'core.walkin',
      text: 'L’agent inscrit lui-même la personne qui n’a pas de smartphone : elle attend comme tout le monde.',
    },
  ],
  faq: [
    {
      q: 'Faut-il une borne à tickets ?',
      a: 'Non. Un QR code affiché à l’entrée, ou une plaque NFC, suffit : chacun prend sa place sur son téléphone.',
    },
    {
      q: 'Et les personnes sans smartphone ?',
      requires: 'core.walkin',
      a: `L’agent d’accueil les inscrit depuis son poste, avec ${q(t('ajouter'))}. Elles attendent dans la même file que les autres et sont appelées de vive voix.`,
    },
    {
      q: 'Peut-on afficher la file sur un écran ?',
      requires: DESK_CALLS,
      a: 'Oui : l’écran de la salle affiche le numéro appelé et le guichet où se présenter, jamais un prénom. Un navigateur sur une télévision ou un écran connecté suffit.',
      fallback: {
        q: 'Peut-on afficher la file sur un écran ?',
        a: 'Oui : ouvrez l’écran de la salle dans le navigateur d’une télévision ou d’un écran connecté. Il affiche la personne reçue et les suivantes en initiales, en direct.',
      },
    },
    {
      q: 'Rangvia est-il conforme au RGAA ?',
      a: 'Rangvia n’a pas encore fait l’objet d’un audit d’accessibilité : nous ne revendiquons donc aucune conformité. Le parcours reste court (un QR code, une page, un bouton), et l’agent peut toujours inscrire une personne lui-même.',
    },
    {
      q: 'Et la demande d’avis Google ?',
      requires: DESK_CALLS,
      a: 'Pour un service administratif, elle est coupée par défaut. Vous pouvez la réactiver dans Réglages si elle a du sens pour votre accueil.',
      fallback: {
        q: 'Et la demande d’avis Google ?',
        a: 'Elle ne s’affiche que si vous renseignez le lien de votre fiche Google dans Réglages. Sans lien, la personne voit simplement un merci en fin de passage.',
      },
    },
    SHARED_FAQ.data,
  ],
  cta: {
    requires: DESK_CALLS,
    label: DESK.openQueue,
    title: 'Remplacez la borne par un QR code.',
    lead: `Créez votre accueil en quelques minutes : QR code de l’entrée, guichets et écran de salle sont prêts. ${TRIAL}`,
    fallback: {
      label: 'Ouvrir ma file',
      title: 'Remplacez la borne par un QR code.',
      lead: `Créez votre file en quelques minutes, affichez son QR code à l’entrée, et votre salle d’attente se vide. ${TRIAL}`,
    },
  },
  sections: ['story', 'problem', 'signature', 'counter', 'settings', 'video', 'arguments', 'plans', 'faq', 'cta', 'related'],
  related: ['garages', 'evenements-et-drops'],
};

const evenements: Metier = {
  slug: 'evenements-et-drops',
  activities: ['event'],
  published: true,
  updatedAt: REVISED,
  nav: { label: 'Événements et drops', short: 'Événement' },
  intent: {
    primary: 'file d’attente virtuelle événement',
    variants: [
      'file d’attente drop sneakers',
      'gestion flux lancement produit',
      'pass d’accès QR à usage unique',
      'file d’attente virtuelle vente privée',
    ],
    problems: ['campement devant la boutique', 'foule à l’ouverture des portes'],
  },
  seo: {
    title: 'File d’attente virtuelle pour événements et drops',
    description:
      'Lancement, drop, vente privée : les inscrits entrent par vagues avec un pass QR à usage unique, contrôlé à l’entrée. Stock épuisé ? Tout se ferme.',
    ogTitle: 'Le jour du drop, la file est sur les téléphones',
    ogKicker: 'Événements et drops',
  },
  hero: {
    label: 'File d’attente virtuelle · événements et drops',
    title: 'Le jour du drop, la file est sur les téléphones.',
    lead: 'Les inscrits attendent chez eux ou au café, puis entrent par vagues, pass QR en main. Vous contrôlez le flux, pas la foule.',
  },
  story: null,
  problem: [
    {
      key: 'La veille au soir',
      text: 'Des tentes sur le trottoir, des voisins agacés, et une file qu’on ne maîtrise plus.',
    },
    {
      key: 'L’ouverture des portes',
      text: 'Tout le monde pousse en même temps, et l’équipe gère la foule au lieu de vendre.',
    },
    {
      key: 'Le stock qui s’épuise',
      text: 'Les derniers de la file attendent longtemps pour apprendre qu’il ne reste plus rien.',
    },
  ],
  signature: {
    kind: 'waves',
    title: 'Des vagues, pas une cohue',
    caption: 'Vous ouvrez une vague : chaque inscrit appelé reçoit un pass QR valable quelques minutes, contrôlé à l’entrée.',
    seuil: EVENT.counter,
    lanes: [{ label: 'Vague 1' }, { label: 'Vague 2' }, { label: 'Vague 3' }],
  },
  counter: {
    rows: [
      {
        key: t('vagueSuivante'),
        requires: 'events.waves',
        text: 'Les inscrits suivants reçoivent leur pass QR, autant que la taille de vague que vous avez choisie.',
      },
      {
        key: t('validerEntree'),
        requires: 'events.scan',
        text: `À la porte, l’équipe scanne le pass : l’entrée est enregistrée, et le même pass affiche ${q(t('dejaUtilise'))} s’il revient.`,
      },
      {
        key: t('pauseAppels'),
        requires: 'events.waves',
        text: 'La boutique est pleine ? Les appels s’arrêtent, et les inscrits gardent leur place.',
      },
      {
        key: t('stockEpuise'),
        requires: 'events.sold_out',
        text: 'Un appui : les pass restants sont annulés, et chaque inscrit apprend qu’il n’y a plus rien.',
      },
    ],
  },
  settings: {
    rows: [
      {
        label: t('tailleVague'),
        value: '10 personnes',
        text: 'Autant que votre boutique accueille d’un coup, sans bousculade. De 1 à 200 personnes.',
        ref: { source: 'event_campaigns', column: 'wave_size', value: 10 },
      },
      {
        label: t('passValide'),
        value: '10 minutes',
        text: 'Le temps de venir depuis le quartier. De 1 à 120 minutes.',
        ref: { source: 'event_campaigns', column: 'pass_valid_minutes', value: 10 },
      },
      {
        label: t('grace'),
        value: '5 minutes',
        text: 'Un retard toléré après la fin du pass, pour ceux qui courent. De 0 à 60 minutes.',
        ref: { source: 'event_campaigns', column: 'grace_minutes', value: 5 },
      },
    ],
  },
  arguments: [
    { key: 'Pas de campement', text: 'Les inscrits attendent chez eux : personne ne dort devant la vitrine.' },
    {
      key: 'Un pass, une entrée',
      requires: 'events.single_use_pass',
      text: 'Chaque pass QR ne sert qu’une fois : validé à l’entrée, il est refusé s’il revient.',
    },
    {
      key: 'Le flux à la main',
      requires: 'events.waves',
      text: 'Vous ouvrez les vagues au rythme de la boutique, vous faites une pause, vous reprenez.',
    },
    {
      key: 'Une fin nette',
      requires: 'events.sold_out',
      text: `${q(t('stockEpuise'))} ferme tout d’un geste et prévient chacun, au lieu de laisser espérer la fin de la file.`,
    },
  ],
  faq: [
    {
      q: 'Un pass peut-il servir deux fois ?',
      requires: 'events.single_use_pass',
      a: `Non. Il est à usage unique : une fois l’entrée validée, le même QR affiche ${q(t('dejaUtilise'))}.`,
    },
    {
      q: 'Que se passe-t-il si un inscrit est en retard ?',
      a: `Son pass reste valable pendant la durée choisie, plus le délai de grâce. Au-delà, il expire, et l’équipe à l’entrée lit ${q(t('passExpire'))}.`,
    },
    {
      q: 'Comment arrêter quand le stock est épuisé ?',
      requires: 'events.sold_out',
      a: `Touchez ${q(t('stockEpuise'))} : les pass encore valables sont annulés, et chaque inscrit l’apprend sur sa page, et par notification s’il l’a activée.`,
    },
    {
      q: 'Faut-il une application pour scanner les pass ?',
      requires: 'events.scan',
      a: 'Non. L’équipe scanne le QR du pass avec l’appareil photo de son téléphone, connectée à votre espace, et valide l’entrée d’un geste.',
    },
    SHARED_FAQ.app,
  ],
  cta: {
    label: 'Ouvrir ma file',
    title: 'Votre prochain drop, sans barrières.',
    lead: `Créez votre file, puis votre événement : vagues, pass QR et contrôle à l’entrée sont prêts. ${TRIAL}`,
  },
  sections: ['signature', 'problem', 'counter', 'video', 'settings', 'arguments', 'plans', 'faq', 'cta', 'related'],
  related: ['restaurants', 'boutiques', 'barbiers'],
};

/**
 * BOUTIQUES — rédigée, testée, NON PUBLIÉE (plan § 1 : pas de page
 * `retail` en phase 1). Aucune capacité de profil ne l'enrichit encore :
 * elle ne parle que de la file d'aujourd'hui. La publier = passer
 * `published` à `true`, rien d'autre.
 */
const boutiques: Metier = {
  slug: 'boutiques',
  activities: ['shop'],
  published: false,
  updatedAt: REVISED,
  nav: { label: 'Boutiques', short: 'Boutique' },
  intent: {
    primary: 'file d’attente boutique',
    variants: ['file d’attente magasin', 'retrait de commande sans attente', 'file d’attente conseil en magasin'],
    problems: ['queue à la caisse pour un simple retrait', 'vendeurs débordés le samedi'],
  },
  seo: {
    title: 'File d’attente pour boutiques et magasins',
    description:
      'Conseil, retrait ou échange : vos clients prennent leur place d’un scan, flânent en rayon et reviennent quand leur tour approche. Sans application.',
    ogTitle: 'La boutique pleine, la caisse dégagée',
    ogKicker: 'Boutiques',
  },
  hero: {
    label: 'File d’attente virtuelle · boutiques',
    title: 'La boutique pleine, la caisse dégagée.',
    lead: 'Vos clients prennent leur place d’un scan, continuent leurs achats et reviennent quand un vendeur se libère.',
  },
  story: {
    scene: {
      place: 'Atelier Rivière',
      seuil: RETAIL.counter,
      proKey: WALKIN.complete,
      proLabels: { current: serving('Lucas'), currentName: 'Élise', next: 'Prochain', nextName: 'Malik' },
      clientName: 'Malik',
      slotHints: QUEUE_HINTS,
    },
    steps: [
      {
        kicker: 'Il arrive',
        title: 'Un scan, et il continue ses achats.',
        body: 'Il scanne le QR code posé près de la caisse, donne son prénom et prend sa place. Aucune application.',
        benefit: 'Plus de file qui barre l’allée principale.',
        state: peopleAheadLabel(4),
      },
      {
        kicker: 'Il flâne',
        title: 'Il regarde les rayons au lieu de la queue.',
        body: 'Sa place est gardée pendant qu’il essaie, compare ou fait un tour dans la rue.',
        benefit: 'Un client qui flâne est un client qui découvre.',
        state: t('partir'),
        outline: true,
      },
      {
        kicker: 'Il suit',
        title: 'Un seul chiffre sur son téléphone.',
        body: 'Le nombre de personnes devant lui, en direct. Pas d’heure promise, pas de ticket à garder.',
        benefit: 'Personne ne vient demander combien de temps il reste.',
        state: peopleAheadLabel(2),
      },
      {
        kicker: 'Il revient',
        title: 'Rappelé vers la caisse au bon moment.',
        body: `${q(AHEAD_ONE)} Il revient vers la caisse et touche ${q(t('deRetour'))}.`,
        benefit: 'Le vendeur ne cherche plus son client dans les rayons.',
        state: peopleAheadLabel(1),
      },
      {
        kicker: 'Vous',
        title: `${q(WALKIN.complete)}, et au suivant.`,
        body: 'Un client servi, un appui : le suivant passe en cours, et chacun voit sa place avancer.',
        benefit: 'Un geste entre deux encaissements.',
        state: CLIENT_STATUS_LABEL.serving,
      },
      {
        kicker: 'Après',
        title: 'Un merci au moment de partir.',
        body: `En repartant, votre client lit ${q(VISIT_DONE)} et trouve un bouton vers votre fiche Google.`,
        benefit: 'L’avis se laisse sac à la main.',
        state: VISIT_DONE,
      },
    ],
  },
  problem: [
    {
      key: 'Le samedi',
      text: 'Une file devant la caisse pour un simple retrait, pendant que les vendeurs courent entre les rayons.',
    },
    {
      key: 'Le client pressé',
      text: 'Il voulait un conseil, il voit la queue, il repart acheter ailleurs.',
    },
    {
      key: 'L’allée bloquée',
      text: 'La file s’allonge entre deux présentoirs, et plus personne ne peut circuler.',
    },
  ],
  signature: {
    kind: 'counter',
    title: 'La file de la caisse, rangée',
    caption: 'Le poste montre qui attend, depuis quand et dans quel ordre, pendant que vos clients profitent de la boutique.',
    seuil: RETAIL.counter,
    lanes: [
      { label: STAFF_STATUS_LABEL.serving },
      { label: STAFF_STATUS_LABEL.next },
      { label: STAFF_STATUS_LABEL.waiting },
    ],
  },
  counter: {
    rows: [
      { key: WALKIN.complete, text: 'Le client est servi : un appui, et c’est au suivant.' },
      { key: WALKIN.call, text: `Un vendeur se libère : son écran affiche ${q(CLIENT_STATUS_LABEL.next)}.` },
      { key: t('ajouter'), text: 'Un client sans smartphone est inscrit par son prénom depuis le poste.' },
    ],
  },
  settings: {
    rows: [
      {
        label: t('prevenirAPartir'),
        value: '2 personnes',
        text: 'Le temps de finir un essayage et de revenir vers la caisse.',
        ref: { source: 'queues', column: 'notify_ahead_threshold', value: 2 },
      },
      {
        label: t('clientAbsent'),
        value: t('reculer'),
        text: 'Un client encore en cabine perd quelques places, pas son tour.',
        ref: { source: 'queues', column: 'absent_policy', value: 'move_back' },
      },
    ],
  },
  arguments: [
    { key: 'Des rayons vivants', text: 'Vos clients attendent en regardant vos produits, pas le dos de celui qui les précède.' },
    { key: 'Un QR code, et c’est tout', text: 'Un QR code près de la caisse suffit, pour vous comme pour eux.' },
    { key: 'Pas de SMS', text: 'Les notifications passent par le navigateur : rien à payer à l’unité.' },
  ],
  faq: [
    {
      q: 'Conseil et retrait dans la même file ?',
      a: 'Oui : tout le monde passe dans l’ordre d’arrivée, quel que soit le motif. Vous pouvez créer des prestations conseil, retrait et échange, que le client choisit en s’inscrivant.',
    },
    {
      q: 'Et si le client est en cabine quand son tour arrive ?',
      a: `Le bouton ${q(t('absent'))} le recule de quelques places ou le met de côté, selon votre réglage : il ne perd pas tout.`,
    },
    {
      q: 'Faut-il un matériel particulier ?',
      a: 'Non. Un QR code imprimé près de la caisse, ou une plaque NFC, et le téléphone ou la tablette de la boutique pour le poste.',
    },
    SHARED_FAQ.data,
  ],
  cta: {
    label: 'Ouvrir ma file',
    title: 'Dégagez la caisse dès samedi.',
    lead: `Créez votre file en quelques minutes et posez son QR code près de la caisse. ${TRIAL}`,
  },
  sections: ['story', 'problem', 'counter', 'signature', 'video', 'settings', 'arguments', 'plans', 'faq', 'cta', 'related'],
  related: ['salons-de-coiffure', 'reparation-telephone'],
};

/** Tous les métiers, dans l'ordre d'affichage (index, pied de page, maillage). */
export const METIERS: readonly Metier[] = [
  barbiers,
  salons,
  garages,
  reparation,
  restaurants,
  guichets,
  evenements,
  boutiques,
];

/** Le métier d'un slug, publié ou non ; `undefined` s'il n'existe pas. */
export function getMetier(slug: string): Metier | undefined {
  return METIERS.find((m) => m.slug === slug);
}

/**
 * Les métiers PUBLIÉS, dans l'ordre du registre. C'est la source du
 * sitemap (`{ slug, updatedAt }`), de `generateStaticParams` et du
 * maillage : un métier non publié n'a ni route, ni URL, ni lien.
 */
export function publishedMetiers(): Metier[] {
  return METIERS.filter((m) => m.published);
}
