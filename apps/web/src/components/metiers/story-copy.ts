import { notificationCopy } from '@/lib/copy';
import { NO_REVIEW_ACTIVITIES } from '@/lib/profiles';
import { profileNotificationCopy } from '@/lib/profiles/copy';
import type { ProfileNotificationKind, QueueProfile } from '@/lib/profiles/types';
import type { MetierPage } from '@/lib/metiers/types';
import { HOME_STORY_COPY, type StoryText } from '@/components/home/story/copy';

/**
 * LA SÉQUENCE D'UNE PAGE MÉTIER — les mots de `Story`, tirés de la page
 * rendue par le registre (`selectMetier`).
 *
 * Calculée CÔTÉ SERVEUR (la page est statique) puis passée à `Story` en
 * props : le paquet JavaScript de l'accueil n'embarque ni ce module ni
 * les textes des profils qu'il importe.
 *
 * Rien n'est écrit ici qui ne vienne du registre ou du produit : le héros,
 * les six étapes et la scène viennent de la page (conditions déjà
 * résolues), la notification est un vrai texte de `profileNotificationCopy`,
 * et le rideau reprend ce que lit le client à son tour (l'état de
 * l'étape 5, lui-même importé du vocabulaire du profil).
 */

/**
 * Le rideau, en deux lignes, à partir de ce que lit réellement le client
 * à son tour :
 *  « C’est votre tour »          → « C’est » / « votre tour »
 *  « Vous êtes le prochain »     → « Vous êtes » / « le prochain »
 *  « Votre véhicule est prêt »   → « Votre véhicule » / « est prêt »
 *  « A-042 · Guichet 3 »         → « A-042 » / « Guichet 3 »
 */
export function splitTurn(text: string): { lead: string; main: string } {
  const t = text.trim();
  const dot = t.indexOf(' · ');
  if (dot > 0) return { lead: t.slice(0, dot), main: t.slice(dot + 3) };
  // « Vous êtes » : le sujet et son verbe restent ensemble, sinon la
  // grande ligne commencerait par un verbe orphelin.
  const vous = /^(Vous\s+êtes)\s+(.+)$/u.exec(t);
  if (vous) return { lead: vous[1]!, main: vous[2]! };
  // Espace ordinaire ou insécable (le registre pose ses espaces au rendu).
  const est = t.search(/\s(est|sont)\s/u);
  if (est > 0) return { lead: t.slice(0, est), main: t.slice(est + 1) };
  const space = t.search(/\s/u);
  if (space > 0) return { lead: t.slice(0, space), main: t.slice(space + 1) };
  return { lead: '', main: t };
}

/** Sous le rideau du client, en file d'aujourd'hui (app/e/[slug]/TurnCurtain.tsx). */
export const TURN_HINT = 'Présentez-vous au comptoir';

/** Le titre de fin de visite, tel que le produit l'écrit (« Merci pour votre visite »). */
const VISIT_DONE_TITLE = notificationCopy('visit_completed', { locationName: '' }).title;

/**
 * Le bouton de l'avis Google, à la fin de la scène, seulement si :
 *  - la sixième étape EST la fin de visite (le restaurant finit sur
 *    « File en pause », une liste fermée n'invite à aucun avis) ;
 *  - aucune activité de la page n'est exclue des demandes d'avis par
 *    défaut (`NO_REVIEW_ACTIVITIES` : santé, services administratifs).
 */
export function reviewButton(page: MetierPage): string | null {
  const last = page.story?.steps[5];
  if (!last || last.state !== VISIT_DONE_TITLE) return null;
  if (page.activities.some((a) => NO_REVIEW_ACTIVITIES.has(a))) return null;
  return 'Laisser un avis Google';
}

/**
 * La séquence d'une page métier (qui en a une : les événements n'en ont
 * pas, `null`).
 *
 * `enriched` : le profil du métier est-il OUVERT (tout son socle de
 * capacités livré, voir `profileOpenOnPages`) ? Alors c'est le métier qui
 * parle dans la scène (notification d'étape à l'atelier, « Votre table est
 * prête »). Sinon, la page montre le passage au comptoir d'aujourd'hui,
 * et la scène parle comme l'accueil.
 */
export function metierStoryCopy(page: MetierPage, { enriched }: { enriched: boolean }): StoryText | null {
  if (!page.story) return null;
  const { scene, steps } = page.story;
  const profile: QueueProfile = enriched ? page.profile : 'walkin';
  const workshop = profile === 'vehicle' || profile === 'device';
  const kind: ProfileNotificationKind = workshop ? 'stage_update' : 'ahead_one';
  const notif = profileNotificationCopy(kind, {
    profile,
    locationName: scene.place,
    stage: workshop ? 'in_repair' : null,
    ticketNo: profile === 'desk' ? scene.clientName : null,
  });

  return {
    hero: {
      label: page.hero.label,
      title: page.hero.title,
      lead: page.hero.lead,
      primary: { label: page.cta.label, href: page.cta.href },
      secondary: { label: 'Voir la file avancer', href: '#comment' },
      micro: ['Sans compte client ·', 'Sans application à installer ·', 'Sans SMS payant'],
      scrollHint: 'Faites défiler : la file avance avec vous.',
    },
    place: scene.place,
    seuil: scene.seuil,
    proKey: scene.proKey,
    proLabels: scene.proLabels,
    // Un atelier ne compte pas ses clients en minutes : pas de durée.
    proTime: workshop ? '' : '18 min',
    clientName: scene.clientName,
    slotHints: scene.slotHints,
    notif,
    // Sous le rideau : en file d'aujourd'hui (walkin), la phrase exacte de
    // l'écran du client (TurnCurtain) ; profil de métier ouvert, le nom du
    // commerce, l'écran du profil disant lui-même où se présenter.
    turn: { ...splitTurn(steps[4].state), line: profile === 'walkin' ? TURN_HINT : scene.place },
    merci: { title: steps[5].state, button: reviewButton(page) },
    steps,
  };
}
