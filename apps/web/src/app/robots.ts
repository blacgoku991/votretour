import type { MetadataRoute } from 'next';
import { buildRobots } from '@/lib/seo/crawl';
import { seoIndexable, siteUrl } from '@/lib/seo/site';

/**
 * robots.txt — tout est fermé (`Disallow: /`) tant que SEO_INDEXABLE=1
 * n'est pas posé sur une URL en https. Rendu à la requête pour suivre
 * l'environnement du conteneur : figé au build, il resterait fermé en
 * production.
 */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return buildRobots({ siteUrl: siteUrl(), indexable: seoIndexable() });
}
