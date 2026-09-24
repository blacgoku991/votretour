/**
 * TEXTES PAR PROFIL — notifications et libellés du client.
 *
 * `lib/copy.ts` n'est pas modifié : ses textes SONT ceux des barbiers, et
 * `profileNotificationCopy` lui délègue À L'IDENTIQUE en walkin et en
 * event (même titre, même corps, caractère pour caractère ; un test le
 * vérifie pour chaque genre de notification). Les autres profils parlent
 * leur métier : « Votre véhicule est prêt », « A-042 · Guichet 3 ».
 *
 * Règles de l'écran verrouillé, vraies pour TOUS les profils :
 *  - jamais d'immatriculation complète : seulement la forme masquée
 *    (`••-••3-CD`), et un garde-fou final la remplace si elle s'y glissait ;
 *  - jamais de prénom : un téléphone posé sur une table se lit à l'envers ;
 *  - jamais de motif en guichet : il peut révéler une information de santé ;
 *  - aucune promesse de temps calculée par Rangvia. Seuls les horaires
 *    réels de l'établissement sont cités (« Ouvert jusqu'à 19 h 00 »).
 */

import { notificationCopy, peopleAheadLabel } from '@/lib/copy';
import { getProfile, isLegacyProfile } from './index';
import { displayRegistration, maskRegistration, normalizeRegistration } from './registration';
import {
  isBaseNotificationKind,
  type DeviceKind,
  type EntryDetails,
  type ProfileNotificationKind,
  type ProfileStage,
  type QueueProfile,
} from './types';

/** Espace insécable : « 19 h 00 » ne se coupe jamais en fin de ligne. */
const NBSP = '\u00a0';

/**
 * État d'ouverture au moment de l'envoi, calculé par le serveur à partir
 * des vrais horaires du jour (`internal.today_hours`). Absent : le texte
 * ne dit rien des horaires plutôt que d'inventer.
 */
export type OpeningState =
  | { status: 'open'; closesAt: string }
  | { status: 'closed'; reopensAt: string; reopensDay: 'today' | 'tomorrow' | string };

export interface ProfileCopyContext {
  /** Défaut : walkin, le comportement d'aujourd'hui. */
  profile?: QueueProfile;
  locationName: string;
  peopleAhead?: number;
  clientName?: string | null;
  stage?: ProfileStage | null;
  details?: EntryDetails | null;
  /** Déjà formaté (« A-042 », « 0042 »). */
  ticketNo?: string | null;
  deskLabel?: string | null;
  hours?: OpeningState | null;
  /** Table : délai pour se présenter, en minutes (`absent_grace_minutes`). */
  graceMinutes?: number | null;
  /** Table : minutes restantes avant que la table ne soit rendue. */
  remainingMinutes?: number | null;
  /** Devis envoyé (montant en centimes et libellé). */
  quote?: { amountCents: number; label: string } | null;
  /** Texte d'un message du pro (`custom`), déjà rendu par `renderTemplate`. */
  body?: string | null;
}

export interface NotificationText {
  title: string;
  body: string;
}

/* ------------------------------------------------------------------ */
/* Petites mises en forme                                               */
/* ------------------------------------------------------------------ */

/** « 19:00 » → « 19 h 00 » (espaces insécables), comme `TimeField`. */
export function formatClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  return `${m[1]!.padStart(2, '0')}${NBSP}h${NBSP}${m[2]}`;
}

/** Montant d'un devis, toujours avec ses centimes : « 184,00 € ». */
export function formatAmount(cents: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, Math.round(cents)) / 100);
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function withoutFinalPunctuation(s: string): string {
  return s.trim().replace(/[\s.!?…;:,]+$/u, '');
}

const DEVICE_NOUN: Record<DeviceKind, string> = {
  phone: 'téléphone',
  tablet: 'tablette',
  computer: 'ordinateur',
  console: 'console',
  watch: 'montre',
  other: 'appareil',
};

/**
 * « votre Peugeot 208 », « votre tablette », « votre véhicule ». Le
 * possessif « votre » ne s'accorde pas : les phrases sont écrites pour ne
 * jamais devoir accorder un participe avec un modèle dont on ignore le genre.
 */
function subjectPhrase(profile: QueueProfile, details: EntryDetails | null | undefined): string {
  const model = details?.model?.trim();
  if (model) return `votre ${model}`;
  if (profile === 'device') return `votre ${DEVICE_NOUN[details?.deviceKind ?? 'other']}`;
  return `votre ${getProfile(profile).vocab.subject}`;
}

function maskedRegistrationOf(details: EntryDetails | null | undefined): string | null {
  const raw = details?.registration;
  if (!raw) return null;
  return maskRegistration(displayRegistration(raw, details?.country ?? 'FR'));
}

function hoursSentence(hours: OpeningState | null | undefined): string {
  if (!hours) return '';
  if (hours.status === 'open') return `Ouvert jusqu’à ${formatClock(hours.closesAt)}.`;
  const day =
    hours.reopensDay === 'today' ? 'aujourd’hui' : hours.reopensDay === 'tomorrow' ? 'demain' : hours.reopensDay;
  return `Réouverture ${day} à ${formatClock(hours.reopensAt)}.`;
}

function join(...parts: Array<string | null | undefined | false>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

/**
 * « Guichet 3 » → « au guichet 3 » ; « Salle 1 » → « en salle 1 ». Un
 * libellé inconnu est cité tel quel, entre guillemets, plutôt que mal
 * accordé.
 */
export function deskDestination(label: string): string {
  const clean = label.trim();
  const rules: Array<[RegExp, string]> = [
    [/^guichet\b/i, 'au'],
    [/^box\b/i, 'au'],
    [/^bureau\b/i, 'au'],
    [/^comptoir\b/i, 'au'],
    [/^poste\b/i, 'au'],
    [/^salle\b/i, 'en'],
    [/^caisse\b/i, 'à la'],
    [/^porte\b/i, 'à la'],
  ];
  for (const [re, prep] of rules) {
    if (re.test(clean)) {
      const lowered = clean.charAt(0).toLowerCase() + clean.slice(1);
      // « en salle 1 » : pas d'article après « en ».
      return `${prep} ${lowered}`;
    }
  }
  return `à «${NBSP}${clean}${NBSP}»`;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

function workshopCopy(kind: ProfileNotificationKind, ctx: ProfileCopyContext, profile: 'vehicle' | 'device'): NotificationText {
  const loc = ctx.locationName;
  const subject = subjectPhrase(profile, ctx.details);
  const vocab = getProfile(profile).vocab;
  const masked = profile === 'vehicle' ? maskedRegistrationOf(ctx.details) : null;
  const dossier = profile === 'device' && ctx.ticketNo ? `(dossier ${ctx.ticketNo})` : null;
  const hours = hoursSentence(ctx.hours);

  switch (kind) {
    case 'your_turn':
      return profile === 'vehicle'
        ? { title: vocab.clientTurn, body: join(`${capitalize(join(subject, masked))} vous attend chez ${loc}.`, hours) }
        : {
            title: vocab.clientTurn,
            body: join(`Réparation terminée : ${join(subject, dossier)} vous attend chez ${loc}.`, hours),
          };
    case 'quote_ready': {
      const label = ctx.quote?.label ? withoutFinalPunctuation(ctx.quote.label) : '';
      return {
        title: ctx.quote ? `Devis à valider · ${formatAmount(ctx.quote.amountCents)}` : 'Devis à valider',
        body: join(label && `${label}.`, 'Touchez pour accepter ou refuser.'),
      };
    }
    case 'stage_update':
      return { title: loc, body: stageSentence(ctx.stage ?? null, subject, loc) };
    case 'recall':
      return {
        title: loc,
        body: join(
          `${capitalize(subject)} vous attend toujours.`,
          ctx.hours?.status === 'open' ? `Nous fermons à ${formatClock(ctx.hours.closesAt)}.` : hours,
        ),
      };
    case 'visit_completed':
      return { title: 'Merci pour votre confiance', body: `Merci d’être passé chez ${loc}.` };
    case 'removed':
      return { title: loc, body: `Le suivi de ${subject} est terminé.` };
    case 'queue_closed':
      return { title: loc, body: `Les dépôts sont fermés pour le moment. Le suivi de ${subject} continue.` };
    case 'ahead_two': {
      const n = ctx.peopleAhead ?? 2;
      return { title: loc, body: `Plus que ${n} ${vocab.subjectPlural} avant le vôtre.` };
    }
    case 'ahead_one':
      return { title: loc, body: `Plus qu’un ${vocab.subject} avant le vôtre.` };
    case 'custom':
      return { title: loc, body: ctx.body?.trim() || 'Mise à jour de votre suivi.' };
    default:
      return notificationCopy(kind, { locationName: loc, peopleAhead: ctx.peopleAhead });
  }
}

function stageSentence(stage: ProfileStage | null, subject: string, loc: string): string {
  switch (stage) {
    case 'received':
      return `Nous avons bien reçu ${subject}.`;
    case 'diagnosis':
      return `Diagnostic en cours pour ${subject}.`;
    case 'quote_pending':
      return `Un devis vous attend pour ${subject}. Touchez pour le consulter.`;
    case 'waiting_parts':
      return `Une pièce est commandée pour ${subject}. Nous vous prévenons dès sa réception.`;
    case 'in_repair':
      return `C’est parti : ${subject} est en réparation.`;
    case 'ready':
      return `${capitalize(subject)} vous attend chez ${loc}.`;
    case 'preparing':
      return 'Votre commande est en préparation.';
    default:
      return 'Mise à jour de votre suivi.';
  }
}

function tableCopy(kind: ProfileNotificationKind, ctx: ProfileCopyContext): NotificationText {
  const loc = ctx.locationName;
  switch (kind) {
    case 'ahead_two':
      return { title: loc, body: `Plus que ${ctx.peopleAhead ?? 2} tables avant la vôtre. Restez dans les parages.` };
    case 'ahead_one':
      return { title: loc, body: 'Vous êtes les prochains. Rapprochez-vous de l’entrée.' };
    case 'your_turn': {
      const g = ctx.graceMinutes;
      const delay = g && g > 0 ? (g === 1 ? ' dans la minute' : ` dans les ${g}${NBSP}minutes`) : '';
      return { title: 'Votre table est prête', body: `Présentez-vous à l’accueil de ${loc}${delay}.` };
    }
    case 'recall': {
      const r = ctx.remainingMinutes;
      if (r == null) return { title: loc, body: 'Votre table vous attend. Présentez-vous à l’accueil.' };
      if (r <= 0) return { title: loc, body: 'Votre table vous attend. Présentez-vous vite à l’accueil.' };
      return {
        title: loc,
        body: `Votre table vous attend encore ${r}${NBSP}${r === 1 ? 'minute' : 'minutes'}.`,
      };
    }
    case 'visit_completed':
      return { title: 'Merci pour votre visite', body: `Toute l’équipe de ${loc} vous remercie.` };
    case 'removed':
      return { title: loc, body: 'Votre groupe a été retiré de la liste d’attente.' };
    case 'queue_closed':
      return { title: loc, body: 'La liste d’attente vient de fermer.' };
    case 'custom':
      return { title: loc, body: ctx.body?.trim() || 'Mise à jour de votre place.' };
    case 'stage_update':
    case 'quote_ready':
      return { title: loc, body: 'Mise à jour de votre place.' };
    default:
      return notificationCopy(kind, { locationName: loc, peopleAhead: ctx.peopleAhead });
  }
}

function deskCopy(kind: ProfileNotificationKind, ctx: ProfileCopyContext): NotificationText {
  const loc = ctx.locationName;
  const ticket = ctx.ticketNo ?? null;
  const desk = ctx.deskLabel?.trim() || null;
  const ticketSentence = ticket ? `Ticket ${ticket}.` : null;
  switch (kind) {
    case 'ahead_two':
      return { title: loc, body: join(`Plus que ${ctx.peopleAhead ?? 2} personnes avant vous.`, ticketSentence) };
    case 'ahead_one':
      return { title: loc, body: join('Plus qu’une personne avant vous. Rapprochez-vous des guichets.', ticketSentence) };
    case 'your_turn': {
      const title = ticket && desk ? `${ticket} · ${desk}` : ticket ? `${ticket} · C’est votre tour` : desk ?? 'C’est votre tour';
      return { title, body: desk ? `Présentez-vous maintenant ${deskDestination(desk)}.` : 'Présentez-vous maintenant.' };
    }
    case 'recall': {
      const who = ticket ? `ticket ${ticket}` : 'votre ticket';
      const where = desk ? `, ${desk.charAt(0).toLowerCase()}${desk.slice(1)}` : '';
      return { title: loc, body: `Dernier appel : ${who}${where}.` };
    }
    case 'visit_completed':
      return { title: 'Merci pour votre visite', body: `Merci d’être passé chez ${loc}.` };
    case 'removed':
      return { title: loc, body: ticket ? `Votre ticket ${ticket} a été retiré de la file.` : 'Votre ticket a été retiré de la file.' };
    case 'queue_closed':
      return { title: loc, body: 'Les guichets viennent de fermer.' };
    case 'custom':
      return { title: loc, body: ctx.body?.trim() || 'Mise à jour de votre ticket.' };
    case 'stage_update':
    case 'quote_ready':
      return { title: loc, body: 'Mise à jour de votre ticket.' };
    default:
      return notificationCopy(kind, { locationName: loc, peopleAhead: ctx.peopleAhead });
  }
}

function retailCopy(kind: ProfileNotificationKind, ctx: ProfileCopyContext): NotificationText {
  const loc = ctx.locationName;
  const ref = ctx.details?.orderRef?.trim() || null;
  const pickup = ctx.stage === 'ready' || ctx.stage === 'preparing';
  switch (kind) {
    case 'your_turn':
      if (!pickup) return notificationCopy('your_turn', { locationName: loc });
      return {
        title: 'Votre commande est prête',
        body: ref
          ? `Votre commande n°${NBSP}${ref} est prête à la caisse de ${loc}.`
          : `Votre commande est prête : présentez-vous à la caisse de ${loc}.`,
      };
    case 'stage_update':
      return {
        title: loc,
        body: ctx.stage === 'ready'
          ? 'Votre commande est prête à la caisse.'
          : ref ? `Votre commande n°${NBSP}${ref} est en préparation.` : 'Votre commande est en préparation.',
      };
    case 'recall':
      return {
        title: loc,
        body: pickup ? 'Votre commande vous attend toujours à la caisse.' : 'C’est toujours votre tour : présentez-vous à la caisse.',
      };
    case 'custom':
      return { title: loc, body: ctx.body?.trim() || 'Mise à jour de votre place.' };
    case 'quote_ready':
      return { title: loc, body: 'Mise à jour de votre place.' };
    default:
      return notificationCopy(kind, { locationName: loc, peopleAhead: ctx.peopleAhead, clientName: ctx.clientName });
  }
}

/**
 * Dernier garde-fou : si l'immatriculation complète s'est glissée dans un
 * texte (message libre du pro, par exemple), elle est remplacée par sa
 * forme masquée. La comparaison se fait sur les formes normalisées, pour
 * attraper `AB-123-CD` comme `ab 123 cd`.
 */
function scrubRegistration(text: NotificationText, details: EntryDetails | null | undefined): NotificationText {
  const raw = details?.registration;
  if (!raw) return text;
  const key = normalizeRegistration(raw);
  if (key.length < 4) return text;
  const masked = maskRegistration(displayRegistration(raw, details?.country ?? 'FR'));
  // Motif souple : les caractères de la clé, séparés ou non par espaces et tirets.
  const pattern = new RegExp(Array.from(key).join('[\\s-]*'), 'gi');
  return { title: text.title.replace(pattern, masked), body: text.body.replace(pattern, masked) };
}

/**
 * Texte d'une notification, selon le profil de la file. En walkin et en
 * event : exactement `notificationCopy` (genres nouveaux compris, qui
 * retombent sur son texte par défaut).
 */
export function profileNotificationCopy(kind: ProfileNotificationKind, ctx: ProfileCopyContext): NotificationText {
  const profile = ctx.profile ?? 'walkin';
  if (isLegacyProfile(profile)) {
    return notificationCopy(isBaseNotificationKind(kind) ? kind : 'custom', {
      locationName: ctx.locationName,
      peopleAhead: ctx.peopleAhead,
      clientName: ctx.clientName,
    });
  }
  let text: NotificationText;
  switch (profile) {
    case 'vehicle':
    case 'device':
      text = workshopCopy(kind, ctx, profile);
      break;
    case 'table':
      text = tableCopy(kind, ctx);
      break;
    case 'desk':
      text = deskCopy(kind, ctx);
      break;
    case 'retail':
      text = retailCopy(kind, ctx);
      break;
    default:
      text = notificationCopy(isBaseNotificationKind(kind) ? kind : 'custom', { locationName: ctx.locationName });
  }
  return scrubRegistration(text, ctx.details);
}

/* ------------------------------------------------------------------ */
/* Libellés du client                                                   */
/* ------------------------------------------------------------------ */

/**
 * Ce que lit le client en attendant, selon le profil. En walkin, event,
 * guichet et boutique : `peopleAheadLabel`, inchangé.
 */
export function clientAheadLabel(profile: QueueProfile, count: number): string {
  switch (profile) {
    case 'table':
      if (count <= 0) return 'Vous êtes les prochains';
      return count === 1 ? '1 groupe avant vous' : `${count} groupes avant vous`;
    case 'vehicle':
    case 'device': {
      const { subject, subjectPlural } = getProfile(profile).vocab;
      if (count <= 0) return 'Le vôtre est le prochain';
      return count === 1 ? `1 ${subject} avant le vôtre` : `${count} ${subjectPlural} avant le vôtre`;
    }
    default:
      return peopleAheadLabel(count);
  }
}

/** Libellé client d'une étape (« En réparation ») ; chaîne vide si inconnue. */
export function stageClientLabel(profile: QueueProfile, stage: ProfileStage | null | undefined): string {
  return getProfile(profile).stages.find((s) => s.key === stage)?.client ?? '';
}

/** Libellé pro d'une étape (« Pièce commandée ») ; chaîne vide si inconnue. */
export function stageStaffLabel(profile: QueueProfile, stage: ProfileStage | null | undefined): string {
  return getProfile(profile).stages.find((s) => s.key === stage)?.staff ?? '';
}
