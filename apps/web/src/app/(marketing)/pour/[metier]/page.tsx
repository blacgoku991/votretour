import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { MetierPageView } from '@/components/metiers/MetierPageView';
import { profileOpenOnPages } from '@/components/metiers/model';
import { videoForMetier } from '@/components/video/manifest';
import { shippedCapabilities } from '@/lib/metiers/capabilities';
import { publishedMetiers } from '@/lib/metiers/registry';
import { selectMetier, selectPublishedMetiers } from '@/lib/metiers/select';
import { getPublicPlans } from '@/lib/public-plans';
import { SITE_LOCALE, SITE_NAME, absoluteUrl, appClipPublished, seoIndexable, siteUrl } from '@/lib/seo/site';

/**
 * /pour/[metier] — une page par métier publié ([SEO § 3]).
 *
 * Rendue au build (SSG) pour chaque métier de `publishedMetiers()`, puis
 * régénérée au plus toutes les heures (ISR) : c'est ainsi qu'une capacité
 * livrée (lot P9) ou une offre modifiée (étiquette « plans ») apparaît
 * sans intervention. Un slug inconnu ou non publié : 404 statique
 * (`dynamicParams = false`).
 *
 * Aucune API dynamique ici (ni cookies, ni en-têtes, ni searchParams) :
 * le QR de l'appel final est calculé au rendu, les offres sont lues avec
 * la clé anon (jamais service_role au build).
 */

export const revalidate = 3600;
export const dynamicParams = false;

interface Params {
  metier: string;
}

export function generateStaticParams(): Params[] {
  return publishedMetiers().map((m) => ({ metier: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const page = selectMetier((await params).metier);
  if (!page) return {};
  return {
    // « · Rangvia » est ajouté par le gabarit du layout racine.
    title: page.seo.title,
    description: page.seo.description,
    alternates: { canonical: page.path },
    openGraph: {
      type: 'website',
      url: page.path,
      locale: SITE_LOCALE,
      siteName: SITE_NAME,
      title: page.seo.ogTitle,
      description: page.seo.description,
    },
    twitter: { card: 'summary_large_image', title: page.seo.ogTitle, description: page.seo.description },
    // Figé au build (page statique) : voir seoIndexable() et l'argument
    // de build SEO_INDEXABLE du Dockerfile.
    robots: seoIndexable() ? { index: true, follow: true } : { index: false, follow: false },
  };
}

/** QR de l'appel final : un vrai lien vers l'inscription du métier, en SVG. */
async function ctaQr(href: string): Promise<string | null> {
  try {
    return await QRCode.toString(absoluteUrl(href), {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#0B0E13', light: '#0000' },
    });
  } catch {
    // Pas de QR plutôt qu'une page en erreur : la plaque garde son pictogramme.
    return null;
  }
}

export default async function MetierRoute({ params }: { params: Promise<Params> }) {
  const { metier } = await params;
  const page = selectMetier(metier);
  if (!page) notFound();

  const shipped = shippedCapabilities();
  const [plans, qrSvg] = await Promise.all([getPublicPlans(), ctaQr(page.cta.href)]);

  return (
    <MetierPageView
      page={page}
      all={selectPublishedMetiers()}
      plans={plans}
      qrSvg={qrSvg}
      video={videoForMetier(page.slug)}
      profileOpen={profileOpenOnPages(page.profile, shipped)}
      siteUrl={siteUrl()}
      appClip={appClipPublished()}
    />
  );
}
