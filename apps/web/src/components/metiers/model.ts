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
 * Un titre affiché comme une phrase, avec son point final. Le registre
 * écrit certains titres sans ponctuation (ils servent aussi de balise
 * <title> ou de titre Open Graph, où le point n'a rien à faire) ; à
 * l'écran et sur les images de partage, tous les H2 et tous les titres
 * finissent par un point, comme sur l'accueil.
 */
export function asSentence(text: string): string {
  const t = text.trim();
  return /[.!?…:»]$/u.test(t) ? t : `${t}.`;
}

/** Au-delà, la phrase d'accroche d'une image de partage déborderait de trois lignes. */
const OG_LEAD_MAX = 130;
/**
 * Signes par ligne du titre d'une image de partage, en Archivo étendu, à
 * 64 px : 15 à 16 selon les lettres, relevé sur les images rendues. On
 * compte 15, par prudence : mieux vaut une accroche en moins qu'un titre
 * qui remonte sur le mot-symbole.
 */
const OG_CHARS_AT_64 = 15;

/**
 * Nombre de lignes du titre d'une image de partage, estimé par une coupe
 * aux mots (Satori coupe de même) à la taille de police donnée.
 */
export function ogTitleLines(title: string, fontSize: number): number {
  const budget = (OG_CHARS_AT_64 * 64) / fontSize;
  let lines = 1;
  let current = 0;
  for (const word of title.trim().split(/\s+/u)) {
    const next = current === 0 ? word.length : current + 1 + word.length;
    if (next > budget && current > 0) {
      lines += 1;
      current = word.length;
    } else {
      current = next;
    }
  }
  return lines;
}

/**
 * La phrase d'accroche de l'image de partage d'un métier : la première
 * phrase du chapô du héros (celle qui dit le geste), si elle tient en
 * trois lignes ET si le titre en laisse la place (quatre lignes au plus) ;
 * sinon rien, plutôt qu'une image qui déborde sur le mot-symbole.
 */
export function metierOgLead(page: MetierPage, titleFontSize: number): string | null {
  if (ogTitleLines(asSentence(page.seo.ogTitle), titleFontSize) > 4) return null;
  const first = /^.+?[.!?](?=\s|$)/u.exec(page.hero.lead.trim())?.[0] ?? page.hero.lead.trim();
  return first.length > 0 && first.length <= OG_LEAD_MAX ? first : null;
}

/**
 * Texte alternatif de l'image de partage d'un métier : ce qu'elle montre
 * vraiment (le métier, sa promesse, son seuil), propre à chaque page.
 */
export function metierOgAlt(page: MetierPage): string {
  return `${page.seo.ogKicker} — ${asSentence(page.seo.ogTitle)} La file Rangvia, couchée au sol jusqu’au seuil « ${metierSeuil(page)} ».`;
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
