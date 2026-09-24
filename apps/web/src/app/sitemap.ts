import type { MetadataRoute } from 'next';
import { hasLegalNotice } from '@/lib/legal';
import { publishedMetiers } from '@/lib/metiers/registry';
import { buildSitemap } from '@/lib/seo/crawl';
import { seoIndexable, siteUrl } from '@/lib/seo/site';

/**
 * sitemap.xml — rendu à la requête : les mentions légales se règlent dans
 * l'environnement du conteneur, sans nouvelle image, et le sitemap suit
 * SEO_INDEXABLE tel qu'il est au démarrage (argument de build ET variable
 * d'exécution : voir le Dockerfile). Figé au build, il ne verrait ni les
 * mentions complétées après coup, ni une image construite sans le drapeau.
 */
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap({
    siteUrl: siteUrl(),
    indexable: seoIndexable(),
    legalNotice: hasLegalNotice(),
    // Pages métier publiées : le constructeur ajoute /pour (daté du texte
    // le plus récent) et chaque /pour/<slug>, daté de la révision de SON
    // texte (`updatedAt` du registre), jamais de la date du jour. Même
    // source que `generateStaticParams` : une URL du sitemap a toujours sa
    // page, et une page publiée son URL.
    metiers: publishedMetiers(),
  });
}
