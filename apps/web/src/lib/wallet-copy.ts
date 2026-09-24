import { notificationCopy, peopleAheadLabel } from '@/lib/copy';
import type { EntryStatus } from '@/lib/types';
import type { WalletPhase, WalletView } from '@/server/wallet/types';

/**
 * Textes des passes Apple Wallet et Google Wallet : SOURCE UNIQUE.
 *
 * Les deux plateformes, l'aperçu /design et les composants d'offre lisent
 * ces mêmes chaînes. Un pass qui dit « Bientôt votre tour » sur iPhone le
 * dit aussi sur Android, au même moment, et exactement comme la page web
 * (mêmes libellés que lib/copy.ts : peopleAheadLabel, notificationCopy).
 *
 * Règles de rédaction, verrouillées par tests/wallet/copy.test.ts :
 *  - apostrophes typographiques (’), jamais droites ;
 *  - jamais de prénom : un pass s'affiche sur l'écran verrouillé et peut
 *    être synchronisé sur d'autres appareils ;
 *  - jamais de numéro de ticket en file (la page web n'en montre pas) :
 *    seul le billet d'un drop porte un numéro humain (« A-042 »), qui se
 *    vérifie au contrôle ;
 *  - au-delà de 20 personnes, un plancher vrai (« Plus de 20 ») plutôt
 *    qu'un chiffre qui changerait à chaque passage : beaucoup moins
 *    d'envois pendant un drop, et jamais une valeur arrondie.
 *
 * Fichier pur, sans `server-only` : importable par un composant client.
 */

/** Au-delà, le pass affiche « Plus de 20 » (le chiffre exact reste sur la page web). */
export const WALLET_PLUS_THRESHOLD = 20;

export function walletPositionLabel(peopleAhead: number): string {
  return peopleAhead > WALLET_PLUS_THRESHOLD ? `Plus de ${WALLET_PLUS_THRESHOLD}` : String(Math.max(0, peopleAhead));
}

/** Titre d'un ticket de file : « 6 personnes devant vous », palier au-delà de 20. */
export function walletAheadHeadline(peopleAhead: number): string {
  if (peopleAhead > WALLET_PLUS_THRESHOLD) return `Plus de ${WALLET_PLUS_THRESHOLD} personnes devant vous`;
  return peopleAheadLabel(peopleAhead);
}

/**
 * Titre d'un billet de drop en attente. À 0, on ne dit PAS « C’est votre
 * tour » : en mode Événement, seul l'accès émis fait venir le client.
 */
export function eventAheadHeadline(peopleAhead: number): string {
  if (peopleAhead <= 0) return 'Personne devant vous';
  return walletAheadHeadline(peopleAhead);
}

/** Numéro humain d'un billet de drop : 42 → « A-042 ». */
export function formatEventTicketNumber(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isSafeInteger(value) || value < 1) return null;
  return `A-${String(value).padStart(3, '0')}`;
}

/** Heure « 14:32 » dans le fuseau de l'établissement (et non celui du serveur). */
export function walletTime(value: string | Date, timeZone: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  try {
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(date);
  } catch {
    // Fuseau inconnu en base : l'heure de Paris vaut mieux qu'une erreur.
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(date);
  }
}

/* ====================================================================
   Titres (headline) et statuts (champ `etat` Apple / module `statut` Google)
   ==================================================================== */

export const WALLET_HEADLINE = {
  turn: 'C’est votre tour',
  /** File en pause ou fermée alors que plus personne n'est devant. */
  first: 'Vous êtes le prochain',
  done: 'Merci de votre visite',
  left: 'Vous avez quitté la file',
  removed: 'Vous avez été retiré de la file',
  expired: 'Ticket expiré',
  eventAccess: 'Accès ouvert',
  eventUsed: 'Utilisé',
  eventExpired: 'Accès expiré',
  eventSoldOut: 'Complet',
  eventEnded: 'Événement terminé',
} as const;

export const WALLET_STATUS = {
  waiting: 'Dans la file',
  returning: 'Retour signalé',
  present: 'Sur place',
  soon: 'Bientôt votre tour',
  one: 'Plus qu’une personne devant vous',
  turn: 'Présentez-vous',
  serving: 'En cours',
  absent: 'Marqué absent : présentez-vous à l’accueil',
  paused: 'File en pause : votre place est conservée',
  closed: 'File fermée pour le moment',
  done: 'Terminé',
  closedTicket: 'Clos',
  eventWaiting: 'En attente de votre vague',
  eventExpired: 'Accès expiré',
} as const;

/** Statut d'un ticket encore en attente (loin du seuil). */
export function waitingStatusText(status: EntryStatus): string {
  if (status === 'returning') return WALLET_STATUS.returning;
  if (status === 'present') return WALLET_STATUS.present;
  return WALLET_STATUS.waiting;
}

/** « Présentez-vous avant 14:32 » : l'heure limite, pas la tolérance. */
export function eventAccessStatusText(limitAt: string, timeZone: string): string {
  return `Présentez-vous avant ${walletTime(limitAt, timeZone)}`;
}

export function eventUsedStatusText(redeemedAt: string | null, timeZone: string): string {
  return redeemedAt ? `Billet utilisé à ${walletTime(redeemedAt, timeZone)}` : 'Billet utilisé';
}

/** Fin d'un drop : mêmes phrases que les notifications existantes. */
export function eventOverCopy(
  reason: 'sold_out' | 'ended',
  locationName: string,
): { headline: string; statusText: string } {
  const copy = notificationCopy(reason === 'sold_out' ? 'event_sold_out' : 'event_ended', { locationName });
  return {
    headline: reason === 'sold_out' ? WALLET_HEADLINE.eventSoldOut : WALLET_HEADLINE.eventEnded,
    statusText: copy.body,
  };
}

/* ====================================================================
   Champs du pass : libellés communs aux deux plateformes
   ==================================================================== */

/**
 * Libellés en casse normale. Apple les affiche tels quels : W2 les passe
 * en capitales (`toLocaleUpperCase('fr-FR')`, qui garde les accents) ;
 * Google les affiche en en-tête de module.
 */
export const WALLET_LABEL = {
  ahead: 'Devant vous',
  status: 'Où en êtes-vous',
  arrival: 'Arrivée',
  updated: 'Mis à jour',
  staff: 'Avec',
  place: 'Lieu',
  ticket: 'N°',
  wave: 'Vague',
  until: 'Jusqu’à',
  grace: 'Tolérance',
  todo: 'À faire',
  follow: 'Suivre en direct',
  leave: 'Quitter la file',
  address: 'Adresse',
  review: 'Votre avis',
  privacy: 'Vos données',
  issuer: 'Émis par',
  rules: 'Règles',
  validity: 'Validité',
} as const;

/** Valeur du grand champ principal (Apple) : le chiffre, ou un mot aux moments clés. */
export function walletPrimaryValue(view: Pick<WalletView, 'phase' | 'position' | 'headline'>): string {
  switch (view.phase) {
    case 'turn':
    case 'serving':
      return 'À vous';
    case 'done':
      return 'Merci';
    case 'event_access':
      return 'Accès ouvert';
    case 'event_used':
      return 'Utilisé';
    case 'event_expired':
      return 'Expiré';
    case 'event_over':
      return view.headline === WALLET_HEADLINE.eventSoldOut ? 'Complet' : 'Terminé';
    case 'left':
    case 'removed':
    case 'expired':
      return '—';
    default:
      return view.position ? view.position.label : '—';
  }
}

export const WALLET_BACK = {
  openTicket: 'Ouvrir mon ticket',
  openEvent: 'Page de l’événement',
  leave:
    'Ouvrez votre ticket en direct et touchez « Quitter la file ». Supprimer ce pass de Wallet ne vous retire pas de la file.',
  review: 'Donner mon avis',
  privacy:
    'Ce pass ne contient ni votre prénom ni vos coordonnées. Ses informations de mise à jour sont effacées au plus tard 24 h après votre passage.',
  eventValidity:
    'Billet à usage unique, valable uniquement pendant votre créneau. Une capture d’écran ne donne aucun droit supplémentaire : le premier passage au contrôle fait foi.',
  scrubbedHeader: 'Ticket clos',
} as const;

export function walletIssuerText(orgName: string): string {
  return `Rangvia pour ${orgName}`;
}

/** Description d'accessibilité (Apple `description`, obligatoire). */
export function walletDescription(kind: 'queue' | 'event', name: string): string {
  return kind === 'event' ? `Billet ${name}` : `Ticket de file chez ${name}`;
}

/** Texte de proximité (Apple `locations[].relevantText`). */
export function walletRelevantText(phase: WalletPhase, placeName: string): string {
  if (phase === 'event_access') return 'Votre accès est ouvert';
  if (phase === 'turn') return `C’est votre tour chez ${placeName}`;
  return `Votre place chez ${placeName}`;
}

/** Vague d'un drop : « Vague 3 ». */
export function eventWaveLabel(wave: number | null): string | null {
  return wave && wave > 0 ? `Vague ${wave}` : null;
}

/** Texte alternatif sous le QR : « A-042 · Vague 3 ». */
export function eventQrAltText(ticketNumber: string | null, wave: number | null): string {
  return [ticketNumber, eventWaveLabel(wave)].filter(Boolean).join(' · ') || 'Billet';
}

/* ====================================================================
   Interface de la page client (lot W4)
   ==================================================================== */

export const WALLET_OFFER_COPY = {
  card: 'Votre place sur l’écran verrouillé : mise à jour en direct, même page fermée.',
  safariHint: 'Ouvrez cette page dans Safari pour ajouter votre ticket à Apple Wallet.',
  appleSaved:
    'Wallet vous préviendra : quand votre tour approchera, une alerte s’affichera sur l’écran verrouillé.',
  googleAfter: 'Une fois ajouté, votre ticket se met à jour tout seul dans Google Wallet.',
  qrNotAccepted: 'Le QR Wallet n’est pas accepté pour cet événement : présentez cette page.',
  unavailable: 'Google Wallet ne répond pas pour l’instant. Votre ticket reste suivi ici.',
  appleBadgeAlt: 'Ajouter à Apple Wallet',
  googleBadgeAlt: 'Ajouter à Google Wallet',
} as const;
