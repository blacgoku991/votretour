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
 * Les valeurs sont lues à l'APPEL, pas au chargement du module. Mais
 * « à l'appel » ne veut pas dire « à la requête » : une page statique ou
 * ISR appelle ses fonctions au BUILD, et fige le résultat dans son HTML
 * prérendu. SEO_INDEXABLE doit donc valoir la même chose au build et à
 * l'exécution : c'est un argument de build du Dockerfile, et le changer
 * impose de reconstruire l'image (voir deploy/.env.example).
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
 *
 * Sur Vercel, une prévisualisation est servie en https (l'URL retombe sur
 * VERCEL_URL) : si SEO_INDEXABLE=1 est posé par erreur sur l'environnement
 * Preview, elle deviendrait indexable, avec un sitemap pointant vers son
 * URL jetable. `vercelEnv` ferme donc tout ce qui n'est pas la production
 * Vercel ; absent (Docker, poste local), il ne change rien.
 */
export function isIndexable(flag: string | undefined, url: string, vercelEnv?: string): boolean {
  const env = vercelEnv?.trim();
  if (env && env !== 'production') return false;
  return flag?.trim() === '1' && url.startsWith('https://');
}

/**
 * Le site peut-il être indexé ?
 *
 * ATTENTION au contexte d'appel :
 *  - dans une route dynamique (robots.txt, sitemap.xml, `force-dynamic`),
 *    la réponse suit l'environnement du serveur à chaque requête ;
 *  - dans une page STATIQUE ou ISR (`generateMetadata` de /pour/[metier],
 *    layout racine prérendu…), la valeur est FIGÉE AU BUILD dans le HTML,
 *    et ne se corrige qu'à la régénération suivante. D'où l'argument de
 *    build SEO_INDEXABLE du Dockerfile : sans lui, une image construite
 *    sans le drapeau servirait `noindex` en production jusqu'à la première
 *    régénération, le temps pour un robot de désindexer la page.
 */
export function seoIndexable(): boolean {
  return isIndexable(process.env.SEO_INDEXABLE, siteUrl(), process.env.VERCEL_ENV);
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
 * lit sitemap.xml. Un test refuse une date mal formée, impossible ou dans
 * le futur.
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
 * « /app » fermerait aussi /apple-icon.png et l'association Apple. Le
 * middleware applique la même règle (segment entier, jamais un préfixe
 * de texte), et ne voit de toute façon pas passer /apple-icon.png.
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
