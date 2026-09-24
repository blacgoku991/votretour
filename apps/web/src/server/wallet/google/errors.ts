/**
 * Erreurs Google Wallet, CLASSÉES une fois pour toutes.
 *
 * Tout appel à Google (jeton OAuth, REST) qui échoue lève une
 * GoogleWalletError dont le `kind` décide seul de la suite : nouvel essai,
 * abandon de la ligne, ou arrêt du fournisseur (boutons masqués). La
 * synchronisation (sync.ts) et la distribution (provider.ts) ne relisent
 * jamais un code HTTP brut : un seul endroit pour se tromper.
 *
 * Le message ne contient jamais de secret : ni jeton d'accès, ni clé, ni
 * assertion signée. Il peut contenir l'identifiant d'un objet (aléatoire,
 * sans donnée personnelle) et le message d'erreur renvoyé par Google.
 */

export type GoogleErrorKind =
  /** 400 : requête mal construite (défaut de nos constructeurs). Jamais réessayé. */
  | 'invalid'
  /** 401 persistant après un jeton neuf, ou assertion refusée par le serveur de jetons. */
  | 'unauthorized'
  /** 403 : compte de service non ajouté à l'émetteur, API désactivée. */
  | 'forbidden'
  /** 404 : objet ou classe inconnus (mauvais émetteur, mauvais préfixe). */
  | 'not_found'
  /** 409 : existe déjà (insert) ; message déjà présent (addMessage). */
  | 'conflict'
  /** 429 : débit ou quota dépassé. Réessayable, `Retry-After` respecté. */
  | 'rate_limited'
  /** 5xx : panne passagère chez Google. Réessayable. */
  | 'server'
  /** Réseau coupé, DNS, réponse illisible. Réessayable. */
  | 'network'
  /** Délai de 8 s dépassé. Réessayable. */
  | 'timeout'
  /** Annulé par l'appelant (délai du vidage). Réessayable. */
  | 'aborted';

const RETRYABLE: ReadonlySet<GoogleErrorKind> = new Set<GoogleErrorKind>([
  'rate_limited', 'server', 'network', 'timeout', 'aborted',
]);

/** Refus qui ne se règlent qu'en corrigeant la configuration : on arrête d'insister. */
const CONFIGURATION: ReadonlySet<GoogleErrorKind> = new Set<GoogleErrorKind>(['unauthorized', 'forbidden']);

export class GoogleWalletError extends Error {
  constructor(
    readonly kind: GoogleErrorKind,
    message: string,
    readonly status: number | null = null,
    /** Délai demandé par Google (en-tête Retry-After), en secondes. */
    readonly retryAfterSeconds: number | null = null,
    /** Motif Google (`error.status`, `error.errors[0].reason`…), pour reconnaître un quota. */
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'GoogleWalletError';
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }

  /** Compte de service refusé : inutile d'envoyer les autres passes. */
  get configuration(): boolean {
    return CONFIGURATION.has(this.kind);
  }
}

export function isGoogleWalletError(value: unknown): value is GoogleWalletError {
  return value instanceof GoogleWalletError;
}

/** Classement d'un code HTTP d'échec. */
export function kindForStatus(status: number): GoogleErrorKind {
  if (status === 400) return 'invalid';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  // Autres 4xx (405, 413, 422…) : défaut de construction, comme un 400.
  return 'invalid';
}

/**
 * En-tête Retry-After : secondes, ou date HTTP. Borné à [1 s, 1 h] : une
 * valeur absurde ne doit ni bloquer un pass une journée, ni boucler.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  let seconds: number;
  if (/^\d+$/.test(trimmed)) seconds = Number(trimmed);
  else {
    const at = Date.parse(trimmed);
    if (!Number.isFinite(at)) return null;
    seconds = Math.ceil((at - now) / 1000);
  }
  if (!Number.isFinite(seconds)) return null;
  return Math.min(3600, Math.max(1, seconds));
}

/**
 * Quota de NOTIFICATIONS dépassé (3 par pass et par 24 h côté Google) :
 * le message doit repartir en TEXT, sans sonnerie. Le nom exact de
 * l'erreur est à confirmer en recette (§ 20 du plan) : on reconnaît
 * « quota » dans le motif ou le message d'un 429 / 400 / 403.
 *
 * Le quota de DÉBIT de Google Cloud (« Quota exceeded for quota metric
 * 'Requests' … per minute ») est exclu : repasser en TEXT ne le
 * contournerait pas, et le client perdrait sa sonnerie pour rien.
 */
export function isNotificationQuotaError(error: unknown): boolean {
  if (!(error instanceof GoogleWalletError)) return false;
  if (error.status !== 429 && error.status !== 400 && error.status !== 403) return false;
  const text = `${error.reason ?? ''} ${error.message}`;
  if (/quota metric|per minute|per second|requests per|rateLimitExceeded/i.test(text)) return false;
  return /quota/i.test(text);
}
