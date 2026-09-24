import { env } from '@/lib/env';

/**
 * Socle SEO du site public : URL canonique, indexabilité, pages publiques.
 *
 * Deux règles guident ce module :
 *  - une préproduction, un poste local ou le banc de démonstration ne
 *    doivent JAMAIS être indexés à la place de la production. L'indexation
 *    est donc fermée par défaut et ne s'ouvre que sur un double signal :
 *    SEO_INDEXABLE=1 ET une URL publique en https ;
 *  - rien n'est daté au hasard : `lastModified` est la date de révision
 *    réelle du contenu, versionnée ici, jamais `new Date()` (qui ferait
 *    croire aux robots que tout change à chaque passage).
 *
 * Les valeurs sont lues à l'APPEL, pas au chargement du module : robots.txt
 * et sitemap.xml sont rendus à la requête, et SEO_INDEXABLE se règle dans
 * l'environnement du conteneur, sans reconstruire l'image.
 *
 * Seul `env.siteUrl` est importé de lib/env (en lecture) : ce module ne
 * doit pas faire grossir lib/env, que d'autres chantiers modifient.
 */

export const SITE_NAME = 'Rangvia';
export const SITE_LOCALE = 'fr_FR';
export const SITE_LANGUAGE = 'fr-FR';

/** URL publique du site, sans barre finale (« https://rangvia.fr »). */
export function siteUrl(): string {
  return env.siteUrl.replace(/\/+$/, '');
}

/**
 * URL absolue sur le domaine du site. Un chemin relatif est rattaché à la
 * racine ; une URL déjà absolue (http ou https) est rendue telle quelle.
 */
export function absoluteUrl(path: string, base: string = siteUrl()): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanBase = base.replace(/\/+$/, '');
  if (path === '' || path === '/') return `${cleanBase}/`;
  return `${cleanBase}/${path.replace(/^\/+/, '')}`;
}

/**
 * Règle pure d'indexabilité. Le drapeau seul ne suffit pas : une
 * préproduction servie en http, ou un localhost oublié avec
 * SEO_INDEXABLE=1, reste fermée.
 */
export function isIndexable(flag: string | undefined, url: string): boolean {
  return flag?.trim() === '1' && url.startsWith('https://');
}

/** Le site peut-il être indexé ici et maintenant ? */
export function seoIndexable(): boolean {
  return isIndexable(process.env.SEO_INDEXABLE, siteUrl());
}

/**
 * L'App Clip est-il PUBLIÉ sur l'App Store (et pas seulement configuré) ?
 * Tant que non, aucune page ne doit le promettre. Variable figée au build
 * (préfixe NEXT_PUBLIC_, argument du Dockerfile) : elle ne change qu'avec
 * une nouvelle image, comme l'App Clip lui-même.
 */
export function appClipPublished(): boolean {
  return process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE?.trim() === '1';
}

/**
 * Dates de dernière révision du TEXTE des pages publiques (AAAA-MM-JJ).
 * À mettre à jour dans la même modification que le texte : c'est ce que
 * lit sitemap.xml.
 */
export const SITE_DATES = {
  home: '2026-09-23',
  tarifs: '2026-09-23',
  cgu: '2026-09-23',
  confidentialite: '2026-09-23',
  mentionsLegales: '2026-09-23',
} as const;

export interface PublicPage {
  /** Chemin absolu depuis la racine du site. */
  path: string;
  lastModified: string;
  /** Page publiée seulement si les mentions légales sont complètes. */
  onlyWithLegalNotice?: boolean;
}

/**
 * Pages publiques indexables aujourd'hui. Les pages de connexion,
 * d'inscription, de file (/e/…), d'écran (/tv, /ecran/…), de pass et la
 * planche /design portent déjà `noindex` : elles n'ont rien à faire ici.
 */
export const PUBLIC_PAGES: readonly PublicPage[] = [
  { path: '/', lastModified: SITE_DATES.home },
  { path: '/tarifs', lastModified: SITE_DATES.tarifs },
  { path: '/cgu', lastModified: SITE_DATES.cgu },
  { path: '/confidentialite', lastModified: SITE_DATES.confidentialite },
  { path: '/mentions-legales', lastModified: SITE_DATES.mentionsLegales, onlyWithLegalNotice: true },
];

/**
 * Chemins fermés aux robots. On n'y met QUE le privé et l'API : une page
 * publique en `noindex` (/e/, /s/, /pass, /tv, /ecran/, /design…) doit
 * rester lisible, sinon le robot ne voit jamais le `noindex` et peut
 * garder l'URL dans son index, sans titre.
 *
 * `/app$` et `/admin$` ferment la racine exacte ; un simple préfixe
 * « /app » fermerait aussi /apple-icon.png et l'association Apple.
 */
export const DISALLOWED_PATHS: readonly string[] = [
  '/app$',
  '/app/',
  '/admin$',
  '/admin/',
  '/api/',
  '/auth/',
  '/bienvenue',
  '/invitation/',
  '/scan/',
];
