/**
 * Libellés français des codes bruts affichés dans l'espace super-admin.
 *
 * La base parle en codes (« trialing », « event.paused »…) ; l'écran,
 * lui, parle français. Un code inconnu n'est jamais affiché tel quel
 * sans avoir tenté une traduction mot à mot.
 */

/** État d'une inscription dans une file. */
export const ENTRY_STATUS_LABEL: Record<string, string> = {
  waiting: 'En attente',
  notified: 'Prévenu',
  returning: 'En route',
  present: 'Sur place',
  next: 'Le prochain',
  serving: 'En cours',
  completed: 'Terminé',
  cancelled: 'Annulé',
  canceled: 'Annulé',
  no_show: 'Absent',
  expired: 'Expiré',
};

/** État d'un abonnement (Stripe). */
export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trialing: 'Essai',
  active: 'Actif',
  past_due: 'Impayé',
  canceled: 'Résilié',
  incomplete: 'Incomplet',
  incomplete_expired: 'Expiré',
  unpaid: 'Impayé',
  paused: 'En pause',
};

/** État d'une organisation. */
export const ORGANIZATION_STATUS_LABEL: Record<string, string> = {
  active: 'Actif',
  suspended: 'Suspendu',
  pending: 'En attente',
};

/** État d'un événement. */
export const EVENT_STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  scheduled: 'Programmé',
  live: 'En direct',
  paused: 'En pause',
  sold_out: 'Complet',
  ended: 'Terminé',
};

/** Gravité d'un incident. */
export const ERROR_LEVEL_LABEL: Record<string, string> = {
  fatal: 'Critique',
  error: 'Erreur',
  warning: 'Alerte',
  warn: 'Alerte',
  info: 'Info',
};

/** Type de la cible d'une entrée du journal. */
export const TARGET_TYPE_LABEL: Record<string, string> = {
  organization: 'Établissement',
  location: 'Site',
  queue: 'File',
  queue_entry: 'Inscription',
  event: 'Événement',
  event_campaign: 'Événement',
  event_pass: 'Pass',
  plate: 'Plaque',
  plate_batch: 'Lot de plaques',
  plate_stock: 'Stock de plaques',
  display: 'Écran',
  display_device: 'Écran',
  member: 'Membre',
  membership: 'Membre',
  staff: 'Collaborateur',
  plan: 'Offre',
  subscription: 'Abonnement',
  settings: 'Réglages',
  billing: 'Facturation',
  support_ticket: 'Demande de support',
  user: 'Utilisateur',
  profile: 'Utilisateur',
};

/** Actions connues du journal, rédigées une à une. */
const AUDIT_ACTION_LABEL: Record<string, string> = {
  'organization.created': 'Établissement créé',
  'organization.created_by_platform': 'Établissement créé par la plateforme',
  'organization.updated_by_platform': 'Établissement modifié par la plateforme',
  'organization.configuration_updated': 'Configuration de l’établissement modifiée',
  'organization.suspended': 'Établissement suspendu',
  'organization.reactivated': 'Établissement réactivé',
  'organization.sessions_revoked': 'Sessions de l’établissement révoquées',
  'organization.deleted_by_platform': 'Établissement supprimé par la plateforme',
  'queue.configured': 'File configurée',
  'queue.created': 'File créée',
  'queue.updated': 'File modifiée',
  'queue.opened': 'File ouverte',
  'queue.closed': 'File fermée',
  'queue.paused': 'File mise en pause',
  'event.created': 'Événement créé',
  'event.created_by_platform': 'Événement créé par la plateforme',
  'event.updated': 'Événement modifié',
  'event.updated_by_platform': 'Événement modifié par la plateforme',
  'event.paused': 'Événement mis en pause',
  'event.paused_by_platform': 'Événement mis en pause par la plateforme',
  'event.resumed': 'Événement relancé',
  'event.started': 'Événement lancé',
  'event.ended': 'Événement terminé',
  'event.pass_checked': 'Pass contrôlé',
  'event.wave_called': 'Vague appelée',
  'event.wave_called_by_platform': 'Vague appelée par la plateforme',
  'plate.created': 'Plaque créée',
  'plate.created_by_platform': 'Plaque créée par la plateforme',
  'plate.updated': 'Plaque modifiée',
  'plate.updated_by_platform': 'Plaque modifiée par la plateforme',
  'plate.deleted_by_platform': 'Plaque supprimée par la plateforme',
  'plate.programmed': 'Plaque programmée',
  'plate.programmed_by_platform': 'Plaque programmée par la plateforme',
  'plate.order_requested': 'Plaque commandée',
  'plate_stock.batch_created': 'Lot de plaques généré',
  'plate_stock.batch_exported': 'Lot de plaques exporté',
  'plate_stock.plate_released': 'Plaque remise en stock',
  'plate_stock.plate_withdrawn': 'Plaque retirée du stock',
  'display.pair_code_created': 'Code d’appairage d’écran créé',
  'display.updated': 'Écran modifié',
  'display.revoked': 'Écran révoqué',
  'member.invited': 'Membre invité',
  'member.accepted': 'Invitation acceptée',
  'member.updated': 'Membre modifié',
  'member.removed': 'Membre retiré',
  'staff.created': 'Collaborateur ajouté',
  'settings.updated': 'Réglages modifiés',
  'location.updated': 'Site modifié',
  'plan.updated': 'Offre modifiée',
  'quota.override': 'Quota ajusté',
  'onboarding.completed': 'Mise en route terminée',
  'billing.checkout_started': 'Paiement commencé',
};

const VERB_LABEL: Record<string, string> = {
  created: 'créé', updated: 'modifié', deleted: 'supprimé', paused: 'mis en pause',
  resumed: 'relancé', started: 'lancé', ended: 'terminé', suspended: 'suspendu', reactivated: 'réactivé', revoked: 'révoqué',
  configured: 'configuré', invited: 'invité', removed: 'retiré', exported: 'exporté',
  enabled: 'activé', disabled: 'désactivé', opened: 'ouvert', closed: 'fermé',
};

/**
 * « event.paused » → « Événement mis en pause ». Une clé inconnue est
 * traduite mot à mot (entité + verbe) ; faute de mieux, on garde la clé
 * lisible, sans points ni tirets bas.
 */
export function auditActionLabel(action: string): string {
  const known = AUDIT_ACTION_LABEL[action];
  if (known) return known;
  const [entity = '', rest = ''] = action.split('.', 2);
  const byPlatform = rest.endsWith('_by_platform');
  const verb = rest.replace(/_by_platform$/, '');
  const noun = TARGET_TYPE_LABEL[entity];
  const done = VERB_LABEL[verb];
  if (noun && done) return `${noun} ${done}${byPlatform ? ' par la plateforme' : ''}`;
  const readable = action.replace(/[._]/g, ' ').trim();
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function targetTypeLabel(type: string | null | undefined): string {
  if (!type) return '—';
  return TARGET_TYPE_LABEL[type] ?? type.replace(/_/g, ' ');
}

/** Libellé d'un code, ou le code lui-même s'il est inconnu. */
export function labelOf(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return '—';
  return map[code] ?? code;
}
