import { PROFILE_BASE } from '@/lib/metiers/registry';
import { requirementMet } from '@/lib/metiers/select';
import type { Capability, MetierPage, RelatedLink } from '@/lib/metiers/types';
import type { QueueProfile } from '@/lib/profiles/types';
import {
  breadcrumbList,
  faqPage,
  jsonLdGraph,
  softwareApplication,
  videoObject,
  webPage,
  webSite,
  type JsonLdGraph,
  type JsonLdNode,
  type OfferPlan,
} from '@/lib/seo/jsonld';
import { absoluteUrl } from '@/lib/seo/site';
import type { DemoVideoEntry } from '@/components/video/manifest';

/**
 * Ce que les pages métier calculent à partir d'une page du registre :
 * profil ouvert ou non, seuil, maillage, données structurées. Fonctions
 * pures (les capacités sont passées en argument) : pour-pages.test.ts les
 * rejoue avec n'importe quel jeu de capacités.
 */

/** Chemin de l'index des métiers. */
export const INDEX_PATH = '/pour';

/**
 * Le profil du métier est-il OUVERT sur les pages, c'est-à-dire tout le
 * socle de ses capacités livré (`PROFILE_BASE`) ? Tant que non, la page
 * montre le passage au comptoir d'aujourd'hui (les replis du registre) et
 * aucun objet du métier (plaque, rail d'étapes, chevalet, ticket).
 * walkin et event n'ont pas de socle : ils sont le produit d'aujourd'hui.
 */
export function profileOpenOnPages(profile: QueueProfile, shipped: ReadonlySet<Capability>): boolean {
  const base = PROFILE_BASE[profile];
  if (!base) return profile === 'walkin' || profile === 'event';
  return requirementMet(base, shipped);
}

/** Le libellé vermillon du seuil, signature de la page (« Fauteuil », « Réception »…). */
export function metierSeuil(page: MetierPage): string {
  return page.story?.scene.seuil ?? page.signature.seuil;
}

/**
 * Les autres métiers, pour le maillage : les voisins déclarés par le
 * registre d'abord (garages ↔ réparation, restaurants ↔ événements…),
 * puis tous les autres métiers publiés, dans l'ordre du registre.
 */
export function otherMetiers(page: MetierPage, all: readonly MetierPage[]): Array<RelatedLink & { page: MetierPage }> {
  const bySlug = new Map(all.map((p) => [p.slug, p]));
  const out: Array<RelatedLink & { page: MetierPage }> = [];
  const seen = new Set<string>([page.slug]);
  for (const r of page.related) {
    const p = bySlug.get(r.slug);
    if (p && !seen.has(r.slug)) {
      seen.add(r.slug);
      out.push({ ...r, page: p });
    }
  }
  for (const p of all) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    out.push({ slug: p.slug, label: p.nav.label, short: p.nav.short, href: p.path, page: p });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Index                                                                */
/* ------------------------------------------------------------------ */

/**
 * Textes de l'index `/pour`. Aucun métier n'y est nommé en dur : la liste
 * vient du registre (seuls les métiers publiés), la description reste
 * vraie quel que soit leur nombre.
 */
export const INDEX_COPY = {
  title: 'File d’attente virtuelle par métier',
  description:
    'Une file d’attente virtuelle réglée pour votre métier : vos clients prennent leur place d’un scan, partent, et reviennent quand leur tour approche.',
  label: 'File d’attente virtuelle\u00a0· par métier',
  h1: 'Chaque métier a sa file.',
  lead: 'Le même geste pour tous vos clients, un scan ou une plaque, mais pas le même comptoir. Choisissez le vôtre : on vous montre comment la file y avance.',
  ogTitle: 'Chaque métier a sa file',
} as const;

/* ------------------------------------------------------------------ */
/* Données structurées                                                  */
/* ------------------------------------------------------------------ */

export interface MetierJsonLdInput {
  page: MetierPage;
  siteUrl: string;
  /** Offres publiques lues en base ; `null` si la lecture a échoué (pas d'`offers`). */
  plans: readonly OfferPlan[] | null;
  video: DemoVideoEntry | null;
  appClip: boolean;
}

/**
 * Le graphe JSON-LD d'une page métier : application, site, page, fil
 * d'Ariane, FAQ (la MÊME liste que celle affichée) et vidéo s'il y en a
 * une. Jamais de note ni d'avis (`softwareApplication` n'en produit pas).
 */
export function metierJsonLd({ page, siteUrl, plans, video, appClip }: MetierJsonLdInput): JsonLdGraph {
  const videoNode: JsonLdNode | null = video
    ? videoObject(
        {
          name: `Démonstration Rangvia : ${page.nav.label.toLowerCase()}`,
          description:
            video.chapters.length > 0
              ? `Filmée sur le vrai produit, avec un commerce fictif. ${video.chapters.join(' ')}`
              : 'Filmée sur le vrai produit, avec un commerce fictif.',
          thumbnailUrls: [video.files.poster.jpg],
          uploadDate: video.uploadDate,
          durationSeconds: video.duration,
          contentUrl: video.files.mp4,
          embedUrl: page.path,
        },
        siteUrl,
      )
    : null;
  return jsonLdGraph([
    softwareApplication({ siteUrl, description: page.seo.description, audience: page.nav.label, plans, appClip }),
    webSite({ siteUrl }),
    webPage({ siteUrl, path: page.path, name: page.seo.title, description: page.seo.description, withBreadcrumb: true }),
    breadcrumbList({
      siteUrl,
      pagePath: page.path,
      items: [
        { name: 'Accueil', path: '/' },
        { name: 'Métiers', path: INDEX_PATH },
        { name: page.nav.label },
      ],
    }),
    faqPage(page.faq),
    videoNode,
  ]);
}

/** Le graphe de l'index : la page, son fil d'Ariane et la liste des métiers. */
export function indexJsonLd(pages: readonly MetierPage[], siteUrl: string, appClip: boolean): JsonLdGraph {
  const list: JsonLdNode = {
    '@type': 'ItemList',
    name: INDEX_COPY.title,
    itemListElement: pages.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.nav.label,
      url: absoluteUrl(p.path, siteUrl),
    })),
  };
  return jsonLdGraph([
    // La page parle de l'application (`about`) : le nœud qu'elle désigne
    // doit exister dans le graphe. Sans offres : l'index n'en affiche pas.
    softwareApplication({ siteUrl, description: INDEX_COPY.description, appClip }),
    webSite({ siteUrl }),
    webPage({
      siteUrl,
      path: INDEX_PATH,
      name: INDEX_COPY.title,
      description: INDEX_COPY.description,
      withBreadcrumb: true,
    }),
    breadcrumbList({
      siteUrl,
      pagePath: INDEX_PATH,
      items: [{ name: 'Accueil', path: '/' }, { name: 'Métiers' }],
    }),
    pages.length > 0 ? list : null,
  ]);
}
