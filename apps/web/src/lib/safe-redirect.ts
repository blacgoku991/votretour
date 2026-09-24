/**
 * Destination de redirection après connexion : un chemin INTERNE, jamais
 * une autre origine.
 *
 * `startsWith('/')` ne suffit pas : « //exemple.com » est une URL
 * relative au protocole, et les navigateurs lisent « /\exemple.com »
 * comme « //exemple.com ». Les deux mènent hors du site (redirection
 * ouverte, utile à l'hameçonnage). On refuse aussi les caractères de
 * contrôle, que certains analyseurs d'URL retirent silencieusement.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/app'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = 'https://rangvia.invalid';
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
