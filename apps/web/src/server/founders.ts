import 'server-only';
import { unstable_cache } from 'next/cache';
import { env } from '@/lib/env';
import { hasLegalNotice } from '@/lib/legal';
import { selectPublishedMetiers } from '@/lib/metiers/select';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseFounderRows, type FounderTicket } from '@/components/founders/places';
import type { SiteFooterProps } from '@/components/SiteChrome';

/**
 * LES DIX PREMIERS COMMERCES — lecture serveur de la vitrine du pied de page.
 *
 * La base décide de tout (0041, `founders_showcase()`) : accord explicite,
 * commerces actifs, ordre de création, dix au plus, rien que le nom et la
 * ville. La fonction est réservée à service_role : on la lit donc ici, côté
 * serveur uniquement, jamais depuis le navigateur.
 *
 * Le pied de page est sur chaque page publique : la réponse est mise en
 * cache (étiquette `founders`, une heure au plus). L'action d'accord des
 * réglages l'invalide d'un coup (`revalidateTag('founders')`), si bien qu'un
 * commerce qui s'ajoute ou se retire est visible (ou retiré) aussitôt.
 *
 * Indisponible (build sans clé service_role, base injoignable) : `null`,
 * et le pied de page n'affiche pas la vitrine plutôt que dix places
 * « libres » qui seraient fausses. L'échec n'est pas mis en cache (il
 * est levé DANS la fonction cachée, rattrapé dehors) : la lecture suivante
 * réessaie.
 */

/** Étiquette de cache : `revalidateTag(FOUNDERS_TAG)` après chaque changement d'accord. */
export const FOUNDERS_TAG = 'founders';

/** Durée de vie maximale du cache, en secondes. */
export const FOUNDERS_REVALIDATE_SECONDS = 3600;

const readShowcase = unstable_cache(
  async (): Promise<FounderTicket[]> => {
    const { data, error } = await supabaseAdmin().rpc('founders_showcase');
    if (error) throw new Error(`founders_showcase : ${error.message}`);
    return parseFounderRows(data);
  },
  ['founders-showcase-v1'],
  { tags: [FOUNDERS_TAG], revalidate: FOUNDERS_REVALIDATE_SECONDS },
);

/** Les commerces volontaires des places 1 à 10 ; `null` si la vitrine est indisponible. */
export async function getFoundersShowcase(): Promise<FounderTicket[] | null> {
  // Build Docker : pas de clé service_role, et c'est voulu. Pas d'erreur
  // à journaliser : la page est régénérée au runtime.
  if (!env.supabase.serviceRoleKey) return null;
  try {
    return await readShowcase();
  } catch (error) {
    console.error('[vitrine des premiers commerces]', error);
    return null;
  }
}

/**
 * Tout ce que le pied de page public lit côté serveur, en un appel :
 * mentions légales publiées, métiers publiés (même liste que l'index
 * /pour) et vitrine des dix premiers. S'emploie ainsi, dans une page ou un
 * layout serveur : `<SiteFooter {...await siteFooterData()} />`.
 */
export async function siteFooterData(): Promise<Required<SiteFooterProps>> {
  return {
    legalNotice: hasLegalNotice(),
    metiers: selectPublishedMetiers().map((page) => ({ href: page.path, label: page.nav.label })),
    founders: await getFoundersShowcase(),
  };
}

/**
 * La place d'un commerce dans la file des volontaires (réglages) : 1 à 10,
 * au-delà s'il attend qu'une place se libère, `null` sans accord. Lue sans
 * cache : le commerce doit voir l'effet de son choix tout de suite.
 */
export async function getFoundersPlace(organizationId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin().rpc('founders_showcase_place', {
    p_organization_id: organizationId,
  });
  if (error) {
    console.error('[vitrine des premiers commerces]', error);
    return null;
  }
  return typeof data === 'number' && Number.isInteger(data) && data > 0 ? data : null;
}
