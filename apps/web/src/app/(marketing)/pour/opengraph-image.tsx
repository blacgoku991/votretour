import { INDEX_COPY } from '@/components/metiers/model';
import { OG_CONTENT_TYPE, OG_SIZE, ogHost, renderOgImage } from '@/lib/seo/og';
import { siteUrl } from '@/lib/seo/site';

/**
 * Image de partage de l'index /pour. Générée au build ; les pages métier
 * ont chacune la leur (`[metier]/opengraph-image.tsx`), qui prend le pas
 * sur celle-ci dans leur segment.
 */

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Rangvia — Chaque métier a sa file : une file d’attente virtuelle réglée pour votre comptoir.';

export default function MetiersOgImage() {
  return renderOgImage({
    kicker: 'File d’attente virtuelle\u00a0· par métier',
    title: INDEX_COPY.ogTitle,
    lead: 'Le même geste pour vos clients, un scan ou une plaque. Votre comptoir, vos mots.',
    seuil: 'Votre métier',
    host: ogHost(siteUrl()),
  });
}
