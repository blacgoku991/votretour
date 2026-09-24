import { notificationCopy } from '@/lib/copy';

/**
 * LES TEXTES DE LA SÉQUENCE — ce que `Story` affiche, séparé de la
 * chorégraphie.
 *
 * La séquence 3D est la même partout (frame.ts ne change pas : six
 * étapes, mêmes seuils, même caméra). Ce qui change d'une page à l'autre,
 * ce sont les mots : le héros, les six étapes, le nom du commerce fictif,
 * le seuil (« Comptoir », « Réception », « Salle »), la touche du pro et
 * les indices des lattes.
 *
 *  - `HOME_STORY_COPY` : l'accueil, mot pour mot comme avant le
 *    paramétrage (story-copy.test.ts le compare à des chaînes littérales) ;
 *  - une page métier : `metierStoryCopy()` (components/metiers), construite
 *    côté serveur depuis la page rendue par le registre (`selectMetier`),
 *    donc sans aucune promesse qui ne soit pas livrée. Elle vit à part pour
 *    que le paquet JavaScript de l'accueil n'embarque pas les textes des
 *    profils.
 *
 * Certains textes vivent dans le CSS (`content:` des pseudo-éléments,
 * décoratifs, sous `aria-hidden`). Ils passent par des variables CSS
 * (`storyCssVars`) : le CSS garde les textes de l'accueil en valeur de
 * repli, et l'accueil ne pose AUCUNE variable. Son DOM est donc
 * strictement celui d'avant.
 */

export interface StoryStepCopy {
  kicker: string;
  title: string;
  body: string;
  benefit: string;
  /** Vignette d'état : ce que lit le client à ce moment-là. */
  state: string;
  /** Vignette en contour (place gardée) plutôt que pleine. */
  outline?: boolean;
}

export interface StoryLink {
  label: string;
  href: string;
}

export interface StoryText {
  hero: {
    label: string;
    title: string;
    lead: string;
    primary: StoryLink;
    secondary: StoryLink;
    /** Micro-ligne sous les boutons ; « · » collé au mot qui le précède. */
    micro: readonly string[];
    scrollHint: string;
  };
  /** Commerce FICTIF de la scène. */
  place: string;
  /** Libellé du seuil 3D. */
  seuil: string;
  /** La touche du panneau pro. */
  proKey: string;
  /** Panneau pro : avant l'appui, puis après. */
  proLabels: { current: string; currentName: string; next: string; nextName: string };
  /** Durée affichée dans le panneau pro ; vide : rien (un atelier ne compte pas en minutes). */
  proTime: string;
  clientName: string;
  slotHints: { self: string; kept: string; back: string; turn: string; ghost: string; next: string };
  /** Notification affichée dans la scène : un texte RÉEL du produit. */
  notif: { title: string; body: string };
  /** Rideau « C'est votre tour », sur deux lignes, puis sa légende. */
  turn: { lead: string; main: string; line: string };
  /**
   * Écran de fin. `button` : le bouton de l'avis Google, `null` quand la
   * scène ne se termine pas par un avis (liste en pause, métier sans
   * demande d'avis par défaut).
   */
  merci: { title: string; button: string | null };
  steps: readonly [StoryStepCopy, StoryStepCopy, StoryStepCopy, StoryStepCopy, StoryStepCopy, StoryStepCopy];
}

/* ------------------------------------------------------------------ */
/* L'accueil                                                            */
/* ------------------------------------------------------------------ */

const HOME_PLACE = 'Barber House';

/**
 * Étape 1 de l'accueil. L'App Clip n'est cité qu'une fois PUBLIÉ sur
 * l'App Store (`appClipPublished()`, figé au build) : avant, la même
 * phrase dit ce qui est vrai, le navigateur sur les deux systèmes.
 */
const ARRIVE_WITH_CLIP =
  'Il approche son téléphone de votre plaque NFC ou scanne le QR code. Sur iPhone, l’App Clip s’ouvre tout seul ; sur Android, le navigateur suffit. Rien à installer, aucun compte.';
const ARRIVE_WITHOUT_CLIP =
  'Il approche son téléphone de votre plaque NFC ou scanne le QR code. La file s’ouvre dans son navigateur, sur iPhone comme sur Android. Rien à installer, aucun compte.';

/** L'accueil, pour un état donné de l'App Clip (pur : les tests rejouent les deux). */
export function buildHomeStoryCopy({ appClip }: { appClip: boolean }): StoryText {
  return {
    hero: {
      label: 'File d’attente virtuelle · barbiers, garages, ongleries, réparateurs',
      title: 'Vos clients n’attendent plus debout.',
      lead: 'Ils approchent leur téléphone de la plaque, prennent leur place dans la file et s’en vont. On les prévient quand c’est leur tour.',
      primary: { label: 'Ouvrir ma file', href: '/inscription' },
      secondary: { label: 'Voir la file avancer', href: '#comment' },
      micro: ['Sans compte client ·', 'Sans application à installer ·', 'Sans SMS payant'],
      scrollHint: 'Faites défiler : la file avance avec vous.',
    },
    place: HOME_PLACE,
    seuil: 'Comptoir',
    proKey: 'Terminer',
    proLabels: { current: 'En cours · avec Karim', currentName: 'Léa', next: 'Suivant', nextName: 'Camille' },
    proTime: '18 min',
    clientName: 'Camille',
    slotHints: {
      self: 'Votre place',
      kept: 'Place gardée',
      back: 'De retour',
      turn: 'À vous',
      ghost: 'Votre place',
      next: 'Prochain client',
    },
    notif: notificationCopy('ahead_one', { locationName: HOME_PLACE }),
    turn: { lead: 'C’est', main: 'votre tour', line: 'Présentez-vous au comptoir' },
    merci: { title: 'Merci pour votre visite', button: 'Laisser un avis Google' },
    steps: [
      {
        kicker: 'Il arrive',
        title: 'Un geste pour prendre sa place.',
        body: appClip ? ARRIVE_WITH_CLIP : ARRIVE_WITHOUT_CLIP,
        benefit: 'Inscrit en trois secondes, sans vous déranger.',
        state: '3 personnes devant vous',
      },
      {
        kicker: 'Il sort',
        title: 'Sa place reste. Lui, il part.',
        body: 'Café, course, coup de fil : il attend où il veut. Votre salon ne ressemble plus à une salle d’attente.',
        benefit: 'Plus personne ne repart en voyant la queue.',
        state: 'Place gardée · vous pouvez partir',
        outline: true,
      },
      {
        kicker: 'Il suit',
        title: 'Un seul chiffre. Aucune question au comptoir.',
        body: 'Son écran n’affiche qu’une chose : combien de personnes sont devant lui. Pas de numéro de ticket, pas d’heure promise qu’on ne tiendra pas.',
        benefit: 'Fini les « c’est encore long ? ».',
        state: '2 personnes devant vous',
      },
      {
        kicker: 'Il revient',
        title: 'Prévenu au bon moment.',
        body: '« Plus qu’une personne devant vous. Commencez à revenir. » La notification arrive toute seule, sur iPhone comme sur Android. Sans SMS payant.',
        benefit: 'Il revient pile quand il faut.',
        state: 'Plus qu’une personne devant vous',
      },
      {
        kicker: 'Vous',
        title: 'Vous appuyez sur Terminer. C’est tout.',
        body: 'Un seul geste entre deux clients : la file avance, chacun voit sa place bouger, le suivant est prévenu.',
        benefit: 'Un bouton. Même avec les mains prises.',
        state: 'C’est votre tour',
      },
      {
        kicker: 'Après',
        title: 'Et l’avis Google suit.',
        body: 'À la fin du passage, votre client voit « Merci pour votre visite » et un bouton qui ouvre directement votre fiche Google.',
        benefit: 'Plus d’avis, sans y penser.',
        state: 'Merci pour votre visite',
      },
    ],
  };
}

/**
 * La copie par défaut de `Story` : l'accueil, MOT POUR MOT comme avant
 * le paramétrage (App Clip compris). C'est un contrat de non-régression :
 * un composant qui ne passe pas `copy` rend exactement le même DOM
 * qu'hier (story-copy.test.ts).
 *
 * Mettre l'accueil en conformité avec la règle « l'App Clip n'est cité
 * qu'une fois publié » revient à la page d'accueil, qui porte déjà une
 * section App Clip entière : elle passera
 * `copy={buildHomeStoryCopy({ appClip: appClipPublished() })}`, dans la
 * même modification que cette section. Changer le défaut ici changerait
 * l'accueil en silence, sans cette section.
 */
export const HOME_STORY_COPY: StoryText = buildHomeStoryCopy({ appClip: true });

/* ------------------------------------------------------------------ */
/* Textes posés en CSS                                                  */
/* ------------------------------------------------------------------ */

/**
 * Chaîne CSS sûre pour `content: var(--…)`. `JSON.stringify` produit une
 * chaîne entre guillemets doubles que CSS lit telle quelle ; on retire
 * d'abord ce qui n'a rien à faire dans un libellé décoratif (retours à la
 * ligne, barres obliques inverses, caractères de contrôle), que le
 * registre refuse de toute façon (metiers-registry.test.ts).
 */
export function cssString(text: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f\\]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return JSON.stringify(clean);
}

/** Variables CSS des textes décoratifs de la scène (voir Story.module.css). */
export function storyCssVars(copy: StoryText): Record<string, string> {
  return {
    '--story-pro-current': cssString(copy.proLabels.current),
    '--story-pro-current-name': cssString(copy.proLabels.currentName),
    '--story-pro-next': cssString(copy.proLabels.next),
    '--story-pro-next-name': cssString(copy.proLabels.nextName),
    '--story-hint-self': cssString(copy.slotHints.self),
    '--story-hint-kept': cssString(copy.slotHints.kept),
    '--story-hint-back': cssString(copy.slotHints.back),
    '--story-hint-turn': cssString(copy.slotHints.turn),
    '--story-ghost': cssString(copy.slotHints.ghost),
    '--story-next': cssString(copy.slotHints.next),
  };
}
