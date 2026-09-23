/**
 * Messages d’erreur d’authentification, en français.
 *
 * Le message brut de Supabase (« Email rate limit exceeded », « Unable to
 * validate email address: invalid format »…) n’est JAMAIS affiché : il est
 * en anglais et parle au développeur. On part du code d’erreur (ou, à
 * défaut, du statut HTTP) ; tout cas inconnu reçoit un message générique.
 */

interface AuthErrorLike {
  code?: string | null;
  status?: number | null;
  message?: string | null;
}

const GENERIC_SIGNUP = 'Impossible de créer le compte pour le moment. Réessayez dans un instant.';
const GENERIC_LOGIN = 'Connexion impossible pour le moment. Réessayez dans un instant.';

const RATE_LIMIT = 'Trop de tentatives en peu de temps. Patientez quelques minutes avant de réessayer.';
const INVALID_EMAIL = 'Cette adresse e-mail n’est pas valide. Vérifiez-la puis réessayez.';

/** Codes communs à l’inscription et à la connexion. */
function common(code: string | undefined, status: number | undefined): string | null {
  switch (code) {
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return RATE_LIMIT;
    case 'email_address_invalid':
      return INVALID_EMAIL;
    case 'email_address_not_authorized':
      return 'Cette adresse e-mail ne peut pas recevoir nos messages. Essayez avec une autre adresse.';
    case 'captcha_failed':
      return 'La vérification anti-robot a échoué. Rechargez la page puis réessayez.';
    case 'request_timeout':
    case 'hook_timeout':
    case 'hook_timeout_after_retry':
      return 'Le service met trop de temps à répondre. Réessayez dans un instant.';
    default:
      break;
  }
  if (status === 429) return RATE_LIMIT;
  return null;
}

/** Message affiché quand supabase.auth.signUp échoue. */
export function signupErrorMessage(error: AuthErrorLike): string {
  const code = error.code ?? undefined;
  const status = error.status ?? undefined;
  const message = (error.message ?? '').toLowerCase();

  switch (code) {
    case 'user_already_exists':
    case 'email_exists':
    case 'identity_already_exists':
      return 'Un compte existe déjà avec cette adresse. Connectez-vous plutôt.';
    case 'weak_password':
      return 'Ce mot de passe est trop facile à deviner. Allongez-le ou mélangez lettres, chiffres et symboles.';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'Les inscriptions sont momentanément fermées. Réessayez plus tard.';
    case 'validation_failed':
      return 'Vérifiez votre adresse e-mail et votre mot de passe, puis réessayez.';
    default:
      break;
  }
  const shared = common(code, status);
  if (shared) return shared;

  // Anciennes versions du serveur d’authentification : pas de code, seulement un message.
  if (message.includes('already registered')) return 'Un compte existe déjà avec cette adresse. Connectez-vous plutôt.';
  if (message.includes('rate limit')) return RATE_LIMIT;
  if (message.includes('invalid format') || message.includes('validate email')) return INVALID_EMAIL;
  if (message.includes('password')) return 'Ce mot de passe n’est pas accepté. Choisissez-en un plus long ou plus varié.';

  return GENERIC_SIGNUP;
}

/** Message affiché quand supabase.auth.signInWithPassword échoue. */
export function loginErrorMessage(error: AuthErrorLike): string {
  const code = error.code ?? undefined;
  const status = error.status ?? undefined;
  const message = (error.message ?? '').toLowerCase();

  switch (code) {
    case 'invalid_credentials':
    case 'user_not_found':
      return 'Adresse e-mail ou mot de passe incorrect.';
    case 'email_not_confirmed':
      return 'Confirmez d’abord votre adresse e-mail : le lien vous a été envoyé à l’inscription.';
    case 'user_banned':
      return 'Ce compte est suspendu. Contactez-nous pour en savoir plus.';
    default:
      break;
  }
  const shared = common(code, status);
  if (shared) return shared;

  if (message.includes('invalid login')) return 'Adresse e-mail ou mot de passe incorrect.';
  if (message.includes('email not confirmed')) {
    return 'Confirmez d’abord votre adresse e-mail : le lien vous a été envoyé à l’inscription.';
  }
  if (message.includes('rate limit')) return RATE_LIMIT;

  return GENERIC_LOGIN;
}
