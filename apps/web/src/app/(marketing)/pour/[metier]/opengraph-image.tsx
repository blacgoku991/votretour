import { metierSeuil } from '@/components/metiers/model';
import { publishedMetiers } from '@/lib/metiers/registry';
import { selectMetier } from '@/lib/metiers/select';
import { OG_CONTENT_TYPE, OG_SIZE, ogHost, renderOgImage } from '@/lib/seo/og';
import { siteUrl } from '@/lib/seo/site';

/**
 * Image de partage d'une page métier (1200 × 630), générée au build pour
 * chaque métier publié. La grammaire est celle de l'image du site : le
 * rail, les lattes, « Vous » en vermillon. Ce qui fait la SIGNATURE du
 * métier : son étiquette (« GARAGES ET CENTRES AUTO »), sa promesse en
 * Archivo étendu, et le libellé vermillon de son seuil (« Réception »,
 * « Fauteuil », « Salle »…). Aucune capture d'écran, aucun chiffre.
 */

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Rangvia, file d’attente virtuelle par métier';
export const revalidate = 3600;
export const dynamicParams = false;

interface Params {
  metier: string;
}

export function generateStaticParams(): Params[] {
  return publishedMetiers().map((m) => ({ metier: m.slug }));
}

export default async function MetierOgImage({ params }: { params: Promise<Params> | Params }) {
  // Objet simple ou promesse selon la version de Next : on accepte les deux.
  const { metier } = await Promise.resolve(params);
  const page = selectMetier(metier);
  if (!page) {
    return renderOgImage({
      kicker: 'File d’attente virtuelle',
      title: 'Chaque métier a sa file.',
      host: ogHost(siteUrl()),
    });
  }
  return renderOgImage({
    kicker: page.seo.ogKicker,
    title: page.seo.ogTitle,
    seuil: metierSeuil(page),
    host: ogHost(siteUrl()),
  });
}
