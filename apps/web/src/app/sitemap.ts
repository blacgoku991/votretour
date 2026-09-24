import type { MetadataRoute } from 'next';
import { hasLegalNotice } from '@/lib/legal';
import { buildSitemap, type SitemapMetier } from '@/lib/seo/crawl';
import { seoIndexable, siteUrl } from '@/lib/seo/site';

/**
 * sitemap.xml — rendu à la requête : SEO_INDEXABLE et les mentions
 * légales se règlent dans l'environnement du conteneur, sans nouvelle
 * image. Figé au build (où SEO_INDEXABLE n'existe pas), le sitemap
 * resterait vide en production.
 */
export const dynamic = 'force-dynamic';

/**
 * Pages métier publiées (/pour/[slug]). Le registre des métiers
 * (lib/metiers/registry.ts) n'existe pas encore : tant qu'il n'est pas là,
 * le sitemap ne liste que les pages publiques actuelles. Le lot qui publie
 * les pages /pour branche ici `publishedMetiers()`, et rien d'autre ne
 * change (le constructeur ajoute alors /pour et chaque /pour/[slug]).
 */
const PUBLISHED_METIERS: readonly SitemapMetier[] = [];

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap({
    siteUrl: siteUrl(),
    indexable: seoIndexable(),
    legalNotice: hasLegalNotice(),
    metiers: PUBLISHED_METIERS,
  });
}
