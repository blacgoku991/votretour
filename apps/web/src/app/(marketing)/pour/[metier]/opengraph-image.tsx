import { asSentence, metierOgAlt, metierOgLead, metierSeuil } from '@/components/metiers/model';
import { publishedMetiers } from '@/lib/metiers/registry';
import { selectMetier } from '@/lib/metiers/select';
import { OG_CONTENT_TYPE, OG_SIZE, ogHost, ogTitleSize, renderOgImage } from '@/lib/seo/og';
import { siteUrl } from '@/lib/seo/site';

/**
 * Image de partage d'une page métier (1200 × 630), une par métier publié,
 * rendue à la première demande puis servie depuis le cache (ISR, une
 * heure). La grammaire est celle de l'image du site : le
 * rail, les lattes, « Vous » en vermillon. Ce qui fait la SIGNATURE du
 * métier : son étiquette (« GARAGES ET CENTRES AUTO »), sa promesse en
 * Archivo étendu, la première phrase de son chapô (le geste du client),
 * et le libellé vermillon de son seuil (« Réception », « Fauteuil »,
 * « Salle »…). Aucune capture d'écran, aucun chiffre.
 */

export const revalidate = 3600;

interface Params {
  metier: string;
}

export function generateStaticParams(): Params[] {
  return publishedMetiers().map((m) => ({ metier: m.slug }));
}

/**
 * Une image par page, avec un texte alternatif PROPRE AU MÉTIER : un
 * export `alt` serait le même pour tous les slugs. Next en tire l'URL
 * (suffixe de groupe de routes compris : jamais écrite à la main) et les
 * balises og:image:alt et twitter:image:alt ; la page n'a rien à déclarer.
 *
 * Un slug inconnu ou non publié n'a AUCUNE image : la route répond 404
 * avant tout rendu (Next compare l'identifiant demandé à cette liste), si
 * bien qu'une URL inventée ne coûte jamais un rendu Satori. (Pas de
 * `dynamicParams = false` ici : Next ajoute un paramètre interne,
 * l'identifiant de l'image, que generateStaticParams ne peut pas nommer.)
 */
export function generateImageMetadata({ params }: { params: Params }) {
  const page = selectMetier(params.metier);
  if (!page) return [];
  return [{ id: 'partage', size: OG_SIZE, contentType: OG_CONTENT_TYPE, alt: metierOgAlt(page) }];
}

export default async function MetierOgImage({ params }: { params: Promise<Params> | Params }) {
  // Objet simple ou promesse selon la version de Next : on accepte les deux.
  const { metier } = await Promise.resolve(params);
  const page = selectMetier(metier);
  // Déjà refusé par generateImageMetadata ; défensif.
  if (!page) return new Response(null, { status: 404 });
  const title = asSentence(page.seo.ogTitle);
  const lead = metierOgLead(page, ogTitleSize(title));
  return renderOgImage({
    kicker: page.seo.ogKicker,
    title,
    ...(lead ? { lead } : {}),
    seuil: metierSeuil(page),
    host: ogHost(siteUrl()),
  });
}
