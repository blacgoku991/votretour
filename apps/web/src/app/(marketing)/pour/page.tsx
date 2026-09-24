import type { Metadata } from 'next';
import { MetiersIndex } from '@/components/metiers/MetiersIndex';
import { INDEX_COPY, INDEX_PATH } from '@/components/metiers/model';
import { selectPublishedMetiers } from '@/lib/metiers/select';
import { SITE_LOCALE, SITE_NAME, appClipPublished, seoIndexable, siteUrl } from '@/lib/seo/site';

/**
 * /pour — l'index des métiers : un grand tableau des départs, une ligne
 * par métier publié, chacune vers sa page. Statique, régénéré au plus
 * toutes les heures, comme les pages métier.
 */

export const revalidate = 3600;

export function generateMetadata(): Metadata {
  return {
    title: INDEX_COPY.title,
    description: INDEX_COPY.description,
    alternates: { canonical: INDEX_PATH },
    openGraph: {
      type: 'website',
      url: INDEX_PATH,
      locale: SITE_LOCALE,
      siteName: SITE_NAME,
      title: INDEX_COPY.ogTitle,
      description: INDEX_COPY.description,
    },
    twitter: { card: 'summary_large_image', title: INDEX_COPY.ogTitle, description: INDEX_COPY.description },
    robots: seoIndexable() ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default function MetiersIndexRoute() {
  return <MetiersIndex pages={selectPublishedMetiers()} siteUrl={siteUrl()} appClip={appClipPublished()} />;
}
