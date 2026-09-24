import { SITE_LANGUAGE, SITE_NAME, absoluteUrl } from './site';

/**
 * Constructeurs JSON-LD (schema.org), purs et testés.
 *
 * Règle absolue : on ne balise que ce que la page montre et ce que le code
 * sait. Donc :
 *  - JAMAIS d'`aggregateRating` ni de `review` : Rangvia n'a ni note ni
 *    avis vérifiables. On renonce aux étoiles, c'est voulu ;
 *  - `offers` n'existe que si les offres ont réellement été lues, avec
 *    leurs vrais prix minimum et maximum (hors taxes, comme sur /tarifs) ;
 *    si la lecture échoue, pas d'offre, et surtout pas de prix par défaut ;
 *  - la FAQ balisée est celle qui est affichée : la page passe le MÊME
 *    tableau au rendu et à `faqPage` ;
 *  - un `VideoObject` n'est produit que pour une vidéo complète (durée,
 *    date, fichiers) ; une entrée incomplète est ignorée plutôt que devinée.
 *
 * Tout le graphe d'une page tient dans un seul `@graph`, relié par `@id`.
 */

export type JsonLdValue = string | number | boolean | null | JsonLdValue[] | { [key: string]: JsonLdValue };
export type JsonLdNode = { '@type': string } & { [key: string]: JsonLdValue };

export interface JsonLdGraph {
  '@context': 'https://schema.org';
  '@graph': JsonLdNode[];
}

/**
 * Sérialisation sûre pour `<script type="application/ld+json">`.
 * `<`, `>` et `&` sont échappés en \u00XX : une chaîne du registre ou de la
 * base contenant `</script>` ne peut pas fermer la balise ni injecter du
 * HTML. U+2028 et U+2029 aussi, pour les analyseurs JavaScript anciens.
 * Le résultat reste du JSON strictement équivalent.
 */
export function safeJsonLd(data: unknown): string {
  const json = JSON.stringify(data);
  if (json === undefined) throw new TypeError('safeJsonLd : valeur non sérialisable.');
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Rassemble les nœuds d'une page ; les nœuds absents (null…) sont ignorés. */
export function jsonLdGraph(nodes: ReadonlyArray<JsonLdNode | null | undefined | false>): JsonLdGraph {
  return {
    '@context': 'https://schema.org',
    '@graph': nodes.filter((node): node is JsonLdNode => Boolean(node)),
  };
}

/** Identifiants stables des nœuds partagés par toutes les pages. */
export const jsonLdIds = {
  app: (siteUrl: string) => `${absoluteUrl('/', siteUrl)}#app`,
  site: (siteUrl: string) => `${absoluteUrl('/', siteUrl)}#site`,
  page: (siteUrl: string, path: string) => `${absoluteUrl(path, siteUrl)}#page`,
  breadcrumb: (siteUrl: string, path: string) => `${absoluteUrl(path, siteUrl)}#fil`,
} as const;

// ---------------------------------------------------------------------
// Offres
// ---------------------------------------------------------------------

/** Ce qu'il faut d'une offre publique pour la baliser. */
export interface OfferPlan {
  /** Prix mensuel hors taxes, en centimes. */
  priceMonthCents: number;
  /** Code ISO 4217 (« EUR »). */
  currency: string;
}

const formatPrice = (cents: number): string => (cents / 100).toFixed(2);

/**
 * `AggregateOffer` des offres publiques, ou `null` si rien de fiable :
 * liste absente ou vide, prix invalide, devises mélangées. Dans le doute,
 * on ne balise pas : un prix faux est pire qu'un prix absent.
 */
export function aggregateOffer(plans: readonly OfferPlan[] | null | undefined): JsonLdNode | null {
  if (!plans || plans.length === 0) return null;
  const currencies = new Set(plans.map((plan) => plan.currency.trim().toUpperCase()));
  if (currencies.size !== 1) return null;
  const [currency] = [...currencies];
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const prices = plans.map((plan) => plan.priceMonthCents);
  if (prices.some((cents) => !Number.isInteger(cents) || cents < 0)) return null;
  return {
    '@type': 'AggregateOffer',
    priceCurrency: currency,
    lowPrice: formatPrice(Math.min(...prices)),
    highPrice: formatPrice(Math.max(...prices)),
    offerCount: plans.length,
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      priceCurrency: currency,
      // Les prix de Rangvia sont affichés hors taxes (« /mois HT »).
      valueAddedTaxIncluded: false,
      unitCode: 'MON',
      unitText: 'mois',
    },
  };
}

// ---------------------------------------------------------------------
// Application, site, page
// ---------------------------------------------------------------------

export interface SoftwareApplicationInput {
  siteUrl: string;
  description: string;
  /** Public visé (« Garages »), pour une page métier. */
  audience?: string;
  /** Offres publiques lues en base ; `null` si la lecture a échoué. */
  plans?: readonly OfferPlan[] | null;
  /** App Clip publié sur l'App Store (voir `appClipPublished()`). */
  appClip?: boolean;
}

export function softwareApplication({
  siteUrl,
  description,
  audience,
  plans,
  appClip = false,
}: SoftwareApplicationInput): JsonLdNode {
  const offers = aggregateOffer(plans);
  return {
    '@type': 'SoftwareApplication',
    '@id': jsonLdIds.app(siteUrl),
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    // L'App Clip n'est cité qu'une fois publié : pas de promesse d'avance.
    operatingSystem: appClip ? 'Web, iOS (App Clip)' : 'Web',
    url: absoluteUrl('/', siteUrl),
    inLanguage: SITE_LANGUAGE,
    description,
    ...(audience ? { audience: { '@type': 'BusinessAudience', audienceType: audience } } : {}),
    ...(offers ? { offers } : {}),
  };
}

export function webSite({ siteUrl }: { siteUrl: string }): JsonLdNode {
  return {
    '@type': 'WebSite',
    '@id': jsonLdIds.site(siteUrl),
    url: absoluteUrl('/', siteUrl),
    name: SITE_NAME,
    inLanguage: SITE_LANGUAGE,
  };
}

export interface WebPageInput {
  siteUrl: string;
  path: string;
  name: string;
  description?: string;
  /** Relie la page à son fil d'Ariane (même `path`). */
  withBreadcrumb?: boolean;
}

export function webPage({ siteUrl, path, name, description, withBreadcrumb = false }: WebPageInput): JsonLdNode {
  return {
    '@type': 'WebPage',
    '@id': jsonLdIds.page(siteUrl, path),
    url: absoluteUrl(path, siteUrl),
    name,
    inLanguage: SITE_LANGUAGE,
    ...(description ? { description } : {}),
    isPartOf: { '@id': jsonLdIds.site(siteUrl) },
    about: { '@id': jsonLdIds.app(siteUrl) },
    ...(withBreadcrumb ? { breadcrumb: { '@id': jsonLdIds.breadcrumb(siteUrl, path) } } : {}),
  };
}

// ---------------------------------------------------------------------
// Fil d'Ariane
// ---------------------------------------------------------------------

export interface Crumb {
  name: string;
  /** Chemin du niveau ; absent pour la page courante (dernier niveau). */
  path?: string;
}

/**
 * `BreadcrumbList` aligné sur le fil visible. Positions 1…n dans l'ordre
 * donné ; la page courante (dernier niveau) n'a pas besoin d'URL.
 */
export function breadcrumbList({
  siteUrl,
  pagePath,
  items,
}: {
  siteUrl: string;
  pagePath: string;
  items: readonly Crumb[];
}): JsonLdNode | null {
  if (items.length === 0) return null;
  return {
    '@type': 'BreadcrumbList',
    '@id': jsonLdIds.breadcrumb(siteUrl, pagePath),
    itemListElement: items.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      ...(crumb.path !== undefined ? { item: absoluteUrl(crumb.path, siteUrl) } : {}),
    })),
  };
}

// ---------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------

export interface FaqEntry {
  q: string;
  a: string;
}

/**
 * `FAQPage` construit à partir de la FAQ AFFICHÉE : la page passe ici le
 * même tableau qu'à son rendu, jamais une copie. Vide → pas de nœud.
 */
export function faqPage(items: readonly FaqEntry[]): JsonLdNode | null {
  if (items.length === 0) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

// ---------------------------------------------------------------------
// Vidéo
// ---------------------------------------------------------------------

/** Durée ISO 8601 (« PT52S », « PT1M5S », « PT1H2M ») ; secondes arrondies. */
export function isoDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (!Number.isFinite(totalSeconds) || s <= 0) {
    throw new RangeError('isoDuration : la durée doit être strictement positive.');
  }
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return `PT${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${seconds ? `${seconds}S` : ''}`;
}

export interface VideoInput {
  name: string;
  description: string;
  /** Affiches (chemins du site ou URL absolues), au moins une. */
  thumbnailUrls: readonly string[];
  /** Date du montage, ISO 8601 (« 2026-10-02 » ou avec l'heure). */
  uploadDate: string;
  durationSeconds: number;
  /** Fichier vidéo principal (chemin du site ou URL absolue). */
  contentUrl: string;
  /** Page de visionnage éventuelle. */
  embedUrl?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Date ISO 8601 réelle. La forme ne suffit pas : V8 accepte
 * « 2026-02-30 » et le reporte au 2 mars, et la chaîne sortirait telle
 * quelle dans le JSON-LD. On refait donc l'aller-retour du jour civil,
 * lu en UTC pour qu'un décalage horaire ne fasse pas changer de jour.
 */
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  const civil = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(civil.getTime()) && civil.toISOString().slice(0, 10) === day;
}

/**
 * `VideoObject` d'une vidéo réellement montée, ou `null` si l'entrée est
 * incomplète ou incohérente : on ne complète jamais une durée ou une date.
 */
export function videoObject(video: VideoInput, siteUrl: string): JsonLdNode | null {
  const name = video.name.trim();
  const description = video.description.trim();
  const thumbnails = video.thumbnailUrls.map((url) => url.trim()).filter(Boolean);
  if (!name || !description || thumbnails.length === 0 || !video.contentUrl.trim()) return null;
  if (!isRealIsoDate(video.uploadDate)) return null;
  if (!Number.isFinite(video.durationSeconds) || Math.round(video.durationSeconds) <= 0) return null;
  return {
    '@type': 'VideoObject',
    name,
    description,
    thumbnailUrl: thumbnails.map((url) => absoluteUrl(url, siteUrl)),
    uploadDate: video.uploadDate,
    duration: isoDuration(video.durationSeconds),
    contentUrl: absoluteUrl(video.contentUrl, siteUrl),
    inLanguage: SITE_LANGUAGE,
    ...(video.embedUrl ? { embedUrl: absoluteUrl(video.embedUrl, siteUrl) } : {}),
  };
}
