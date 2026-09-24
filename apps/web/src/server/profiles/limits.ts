import 'server-only';

/**
 * Barèmes de débit des profils métier.
 *
 * `server/ratelimit.ts` (et son `LIMITS`) n'est pas modifié : le compteur
 * `consumeRateLimit(key, max, window)` est déjà générique, on ne fait
 * qu'ajouter nos propres barèmes ici. Chaque clé commence par un préfixe
 * qui lui est propre, pour ne jamais partager un compteur avec le parcours
 * des barbiers (`join:ip:…`, `staff:…`).
 */
export const PROFILE_LIMITS = {
  /**
   * Rattachement d'une fiche par QR de suivi (`POST /api/client/claim`),
   * par adresse IP anonymisée. Le jeton fait 256 bits : aucune chance de
   * le deviner, mais un robot qui balaie des jetons n'a rien à gagner à
   * insister, et un vrai client ne scanne son étiquette qu'une fois.
   */
  claim: { max: 10, window: 60 },
  /**
   * Affichage de l'aperçu `/s/[jeton]`, par IP. Plus large que le
   * rattachement : un client peut recharger la page, la rouvrir depuis
   * l'appareil photo, la montrer à quelqu'un.
   */
  claimPeek: { max: 30, window: 60 },
  /**
   * Messages du pro (« Vos clés sont à l'accueil »), par compte. La base
   * borne déjà chaque ticket (10 messages, 30 s d'écart : VT016) ; ce
   * barème borne un compte qui en enverrait à toute la file.
   */
  message: { max: 30, window: 300 },
  /** Création de liens de suivi, par compte : un QR par fiche, rarement plus. */
  trackingLink: { max: 60, window: 300 },
} as const;

export type ProfileLimit = keyof typeof PROFILE_LIMITS;
