import type { EntryStatus, NotificationKind, QueueStatus } from '@/lib/types';

/**
 * Traduction des états techniques en langage courant.
 *
 * Deux vocabulaires distincts et assumés :
 *  - CLIENT : on ne dit jamais « notified » ni « serving », et on
 *    n'affiche JAMAIS de numéro de ticket. Seulement où il en est.
 *  - PROFESSIONNEL : des mots courts, lisibles d'un coup d'œil entre
 *    deux clients.
 */

export const CLIENT_STATUS_LABEL: Record<EntryStatus, string> = {
  waiting: 'Dans la file',
  notified: 'Votre tour approche',
  returning: 'Vous revenez',
  present: 'Vous êtes sur place',
  next: 'Vous êtes le prochain',
  serving: "C'est votre tour",
  completed: 'Visite terminée',
  absent: 'Vous avez été noté absent',
  skipped: 'Vous avez été retiré de la file',
  cancelled: 'Vous avez quitté la file',
  expired: 'Votre place a expiré',
};

export const STAFF_STATUS_LABEL: Record<EntryStatus, string> = {
  waiting: 'En attente',
  notified: 'Prévenu',
  returning: 'Revient',
  present: 'Présent',
  next: 'Appelé',
  serving: 'En cours',
  completed: 'Terminé',
  absent: 'Absent',
  skipped: 'Retiré',
  cancelled: 'Parti',
  expired: 'Expiré',
};

export const QUEUE_STATUS_LABEL: Record<QueueStatus, string> = {
  open: 'File ouverte',
  paused: 'File en pause',
  closed: 'File fermée',
};

/**
 * Le seul chiffre montré au client. Pas de « ticket A013 », pas de temps
 * estimé : juste le nombre de personnes devant lui.
 */
export function peopleAheadLabel(count: number): string {
  if (count <= 0) return "C'est votre tour";
  if (count === 1) return '1 personne devant vous';
  return `${count} personnes devant vous`;
}

export function peopleAheadUnit(count: number): string {
  if (count <= 0) return 'à vous de jouer';
  return count === 1 ? 'personne devant vous' : 'personnes devant vous';
}

export function waitingCountLabel(count: number): string {
  if (count === 0) return 'Personne dans la file';
  if (count === 1) return '1 personne dans la file';
  return `${count} personnes dans la file`;
}

/** Textes exacts des notifications poussées. */
export function notificationCopy(
  kind: NotificationKind,
  context: { locationName: string; peopleAhead?: number; clientName?: string | null },
): { title: string; body: string } {
  switch (kind) {
    case 'ahead_two':
      return {
        title: context.locationName,
        body: `Plus que ${context.peopleAhead ?? 2} personnes devant vous.`,
      };
    case 'ahead_one':
      return {
        title: context.locationName,
        body: "Plus qu'une personne devant vous. Commencez à revenir.",
      };
    case 'your_turn':
      return {
        title: "C'est votre tour",
        body: `Présentez-vous maintenant chez ${context.locationName}.`,
      };
    case 'visit_completed':
      return {
        title: 'Merci pour votre visite',
        body: `Merci d'être passé chez ${context.locationName}.`,
      };
    case 'removed':
      return {
        title: context.locationName,
        body: 'Vous avez été retiré de la file.',
      };
    case 'queue_closed':
      return {
        title: context.locationName,
        body: 'La file vient de fermer.',
      };
    default:
      return { title: context.locationName, body: 'Mise à jour de votre place.' };
  }
}

export const ACTIVITY_LABEL: Record<string, string> = {
  barber: 'Barbier',
  hair_salon: 'Salon de coiffure',
  nail_bar: 'Bar à ongles',
  beauty: 'Institut de beauté',
  phone_repair: 'Réparation téléphone',
  garage: 'Garage',
  auto_center: 'Centre auto',
  shop: 'Boutique',
  aftersales: 'Service après-vente',
  restaurant: 'Restaurant',
  counter: 'Guichet / comptoir',
  admin_service: 'Service administratif',
  health: 'Santé',
  other: 'Autre',
};

export const ACTIVITY_OPTIONS = Object.entries(ACTIVITY_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export const SOURCE_LABEL: Record<string, string> = {
  qr: 'QR code',
  nfc: 'Plaque NFC',
  appclip: 'App Clip',
  staff: 'Ajouté au comptoir',
  link: 'Lien',
};
