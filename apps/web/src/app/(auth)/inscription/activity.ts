import type { ActivityType } from '@/lib/profiles/types';

/**
 * LE MÉTIER CHOISI SUR UNE PAGE MÉTIER, jusqu'à l'onboarding.
 *
 * `/pour/garages` envoie vers `/inscription?activite=garage`. La page
 * d'inscription lit ce paramètre sur LISTE BLANCHE (`parseActivityParam`,
 * la même fonction que `/bienvenue`), et seul ce code voyage ensuite :
 * jusqu'à `/bienvenue?activite=garage` après la création du compte, ou
 * dans le lien de confirmation envoyé par e-mail. Rien d'autre n'est repris
 * de l'URL.
 *
 * Fonctions pures, testées sans navigateur avec le reste du maillage
 * public (tests/site-chrome.test.ts).
 */

/** Où mène la création du compte : l'onboarding, avec le métier s'il est connu. */
export function welcomePath(activity: ActivityType | null): string {
  return activity ? `/bienvenue?activite=${encodeURIComponent(activity)}` : '/bienvenue';
}

/**
 * Le lien de confirmation par e-mail : `auth/callback` redirige vers
 * `next`, contrôlé par `safeRedirectPath` (chemin interne seulement).
 * Sans métier, exactement le lien d'avant.
 */
export function confirmationRedirect(origin: string, activity: ActivityType | null): string {
  const next = activity ? encodeURIComponent(welcomePath(activity)) : '/bienvenue';
  return `${origin}/auth/callback?next=${next}`;
}

/**
 * Compte créé, adresse à confirmer : la page de connexion l'annonce, et
 * garde le métier pour la connexion qui suivra la confirmation.
 */
export function awaitingConfirmationPath(activity: ActivityType | null): string {
  return activity
    ? `/connexion?inscrit=1&next=${encodeURIComponent(welcomePath(activity))}`
    : '/connexion?inscrit=1';
}
