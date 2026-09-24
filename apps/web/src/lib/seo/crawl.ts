import type { MetadataRoute } from 'next';
import { DISALLOWED_PATHS, PUBLIC_PAGES, absoluteUrl, type PublicPage } from './site';

/**
 * Constructeurs PURS de sitemap.xml et robots.txt. Les routes
 * `app/sitemap.ts` et `app/robots.ts` ne font que leur passer l'état du
 * serveur (URL, indexabilité, mentions légales, métiers publiés) : tout
 * ce qui compte se teste ici sans Next ni environnement.
 */

/** Ce que le sitemap doit savoir d'une page métier (/pour/[slug]). */
export interface SitemapMetier {
  slug: string;
  /** Date ISO de dernière révision du texte de la page. */
  updatedAt: string;
}

export interface SitemapInput {
  siteUrl: string;
  indexable: boolean;
  /** Les mentions légales sont-elles complètes (page publiée) ? */
  legalNotice: boolean;
  /** Métiers PUBLIÉS uniquement. Vide tant que le registre n'existe pas. */
  metiers: readonly SitemapMetier[];
  pages?: readonly PublicPage[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** La plus récente de dates ISO (comparaison chronologique, pas textuelle). */
function latest(dates: readonly string[]): string | undefined {
  let best: { at: number; raw: string } | undefined;
  for (const raw of dates) {
    const at = Date.parse(raw);
    if (Number.isNaN(at)) continue;
    if (!best || at > best.at) best = { at, raw };
  }
  return best?.raw;
}

export function buildSitemap({
  siteUrl,
  indexable,
  legalNotice,
  metiers,
  pages = PUBLIC_PAGES,
}: SitemapInput): MetadataRoute.Sitemap {
  // Fermé : un sitemap vide plutôt qu'une liste d'URL de préproduction.
  if (!indexable) return [];

  // Pas de `priority` ni de `changeFrequency` : Google les ignore, et une
  // valeur inventée n'apporte rien.
  const statics = pages
    .filter((page) => !page.onlyWithLegalNotice || legalNotice)
    .map((page) => ({ url: absoluteUrl(page.path, siteUrl), lastModified: page.lastModified }));

  // Un slug douteux n'entre jamais dans une URL publique.
  const published = metiers.filter((m) => SLUG.test(m.slug));
  if (published.length === 0) return statics;

  const indexDate = latest(published.map((m) => m.updatedAt));
  return [
    ...statics,
    { url: absoluteUrl('/pour', siteUrl), ...(indexDate ? { lastModified: indexDate } : {}) },
    ...published.map((m) => ({
      url: absoluteUrl(`/pour/${m.slug}`, siteUrl),
      ...(Number.isNaN(Date.parse(m.updatedAt)) ? {} : { lastModified: m.updatedAt }),
    })),
  ];
}

export interface RobotsInput {
  siteUrl: string;
  indexable: boolean;
}

export function buildRobots({ siteUrl, indexable }: RobotsInput): MetadataRoute.Robots {
  // Préproduction, poste local, banc de démonstration : tout est fermé,
  // et l'adresse du sitemap n'est même pas annoncée.
  if (!indexable) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...DISALLOWED_PATHS] },
    sitemap: absoluteUrl('/sitemap.xml', siteUrl),
  };
}
