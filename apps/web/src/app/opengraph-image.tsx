import { OG_CONTENT_TYPE, OG_SIZE, ogHost, renderOgImage } from '@/lib/seo/og';
import { siteUrl } from '@/lib/seo/site';

/**
 * Image de partage par défaut (accueil, tarifs, pages légales…). Générée
 * au build puis servie en statique : elle ne dépend que du texte et de
 * NEXT_PUBLIC_SITE_URL, figée elle aussi à la compilation.
 *
 * Les segments qui déclarent leur propre `openGraph` dans `metadata` la
 * gardent tant qu'ils ne fournissent pas d'image : c'est la règle de
 * fusion des métadonnées de Next pour les fichiers `opengraph-image`.
 */

export const alt =
  'Rangvia — Vos clients n’attendent plus debout. Une file d’attente virtuelle : « Vous » en troisième place, deux personnes devant, le comptoir en tête.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return renderOgImage({
    kicker: 'File d’attente virtuelle',
    title: 'Vos clients n’attendent plus debout.',
    lead: 'Ils approchent leur téléphone de la plaque, prennent leur place et s’en vont. On les prévient quand c’est leur tour.',
    seuil: 'Comptoir',
    host: ogHost(siteUrl()),
  });
}
