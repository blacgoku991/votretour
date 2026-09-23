/**
 * Traduction des erreurs métier PostgreSQL (SQLSTATE VT0xx) en messages
 * destinés à l'utilisateur, en français, sans jargon technique.
 */

export const QUEUE_ERROR_CODES = {
  VT001: 'queue_closed',
  VT002: 'queue_paused',
  VT003: 'queue_full',
  VT004: 'already_in_queue',
  VT005: 'not_found',
  VT006: 'invalid_transition',
  VT007: 'organization_suspended',
  VT008: 'no_staff_available',
  VT009: 'session_mismatch',
  VT010: 'staff_busy',
  VT011: 'plate_not_found',
  VT012: 'plate_locked',
  VT013: 'plate_unavailable',
  VT014: 'invalid_quantity',
} as const;

export type QueueErrorCode = (typeof QUEUE_ERROR_CODES)[keyof typeof QUEUE_ERROR_CODES];

const MESSAGES: Record<QueueErrorCode, string> = {
  queue_closed: "La file est fermée pour le moment.",
  queue_paused: "La file est momentanément en pause.",
  queue_full: "La file est complète. Repassez dans un moment.",
  already_in_queue: "Vous êtes déjà dans cette file.",
  not_found: "Introuvable.",
  invalid_transition: "Cette action n’est pas possible dans l’état actuel.",
  organization_suspended: "Cet établissement n’est pas accessible actuellement.",
  no_staff_available: "Aucun professionnel n’est disponible pour l’instant.",
  session_mismatch: "Ce ticket n’appartient pas à cet appareil.",
  staff_busy: "Ce professionnel a déjà une prestation en cours.",
  plate_not_found: "Cette plaque est introuvable dans cet établissement.",
  plate_locked: "Ce tag a été verrouillé : il ne peut plus être réécrit.",
  plate_unavailable: "Cette plaque n’est pas disponible : elle est déjà attribuée ou mise au rebut.",
  invalid_quantity: 'Un lot compte entre 1 et 1000 plaques.',
};

const HTTP_STATUS: Record<QueueErrorCode, number> = {
  queue_closed: 409,
  queue_paused: 409,
  queue_full: 409,
  already_in_queue: 409,
  not_found: 404,
  invalid_transition: 409,
  organization_suspended: 403,
  no_staff_available: 409,
  session_mismatch: 403,
  staff_busy: 409,
  plate_not_found: 404,
  plate_locked: 409,
  plate_unavailable: 409,
  invalid_quantity: 422,
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type PostgrestLike = { code?: string | null; message?: string | null; details?: string | null };

function isPostgrestError(value: unknown): value is PostgrestLike {
  return typeof value === 'object' && value !== null && ('code' in value || 'message' in value);
}

/** Convertit n'importe quelle erreur en AppError présentable. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (isPostgrestError(error)) {
    const sqlState = error.code ?? '';
    const mapped = QUEUE_ERROR_CODES[sqlState as keyof typeof QUEUE_ERROR_CODES];
    if (mapped) {
      return new AppError(mapped, MESSAGES[mapped], HTTP_STATUS[mapped]);
    }
    // Violation d'unicité : typiquement un double envoi de formulaire.
    if (sqlState === '23505') {
      return new AppError('conflict', 'Cette action a déjà été enregistrée.', 409);
    }
    // Interblocage ou conflit de sérialisation : PostgreSQL a annulé
    // l'opération au profit d'une autre, simultanée. Rien n'est écrit.
    if (sqlState === '40P01' || sqlState === '40001') {
      return new AppError('conflict', 'Une autre opération touchait les mêmes données. Réessayez.', 409);
    }
    if (sqlState === '42501') {
      return new AppError('forbidden', "Accès refusé.", 403);
    }
    if (sqlState === 'PGRST301' || sqlState === '401') {
      return new AppError('unauthorized', 'Session expirée, reconnectez-vous.', 401);
    }
  }

  const message = error instanceof Error ? error.message : 'Une erreur est survenue.';
  return new AppError('internal', message, 500);
}

export function messageFor(code: QueueErrorCode): string {
  return MESSAGES[code];
}
