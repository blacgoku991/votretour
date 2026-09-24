import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MetierRoute, { generateMetadata, generateStaticParams, dynamicParams, revalidate } from '@/app/(marketing)/pour/[metier]/page';
import MetiersIndexRoute, { generateMetadata as indexMetadata } from '@/app/(marketing)/pour/page';
import sitemap from '@/app/sitemap';
import { MetierPageView } from '@/components/metiers/MetierPageView';
import { SignatureVisual } from '@/components/metiers/Signature';
import { profileOpenOnPages } from '@/components/metiers/model';
import { PlansStrip, startingPrice } from '@/components/metiers/PlansStrip';
import { parseVideoEntry } from '@/components/video/manifest';
import { CORE } from '@/lib/metiers/capabilities';
import { METIERS, PROFILE_BASE, publishedMetiers } from '@/lib/metiers/registry';
import { renderable, selectPublishedMetiers } from '@/lib/metiers/select';
import type { Capability, MetierPage } from '@/lib/metiers/types';
import { CAPABILITY_PROFILE, type ProfileCapability } from '@/lib/profiles/capabilities';
import type { PublicPlanOffer } from '@/lib/public-plans';

/**
 * LES PAGES /pour ET /pour/[metier] — ce qu'un robot et un visiteur
 * reçoivent vraiment.
 *
 * On rend les ROUTES elles-mêmes (composants serveur), offres simulées
 * au niveau de `fetch` : le HTML testé est celui que Next prérend au
 * build. Vérifié :
 *  - une URL par métier publié, la même dans le sitemap ; 404 statique
 *    pour le reste ; métadonnées uniques ; `noindex` hors production ;
 *  - un seul H1, les sections dans l'ordre du métier, le fil d'Ariane ;
 *  - un JSON-LD sans note ni avis, dont la FAQ est la FAQ affichée et
 *    dont les offres n'existent que si la page affiche des prix ;
 *  - l'appel à l'inscription porte `?activite=<métier>` ;
 *  - « Gratuit » seul pour une offre à 0 € ;
 *  - l'atelier ne montre plaque et rail d'étapes que profil ouvert, et la
 *    plaque n'y est jamais lisible au-delà de ses trois derniers
 *    caractères ;
 *  - pas d'App Clip tant qu'il n'est pas publié.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (path: string) => readFileSync(`${SRC}${path}`, 'utf8');

const SITE = 'https://votretour.test';
const PROFILE_CAPS = Object.keys(CAPABILITY_PROFILE) as ProfileCapability[];
const TODAY = new Set<Capability>(CORE);
const ALL = new Set<Capability>([...CORE, ...PROFILE_CAPS]);

const PLAN_ROW = (code: string, name: string, cents: number) => ({
  code,
  name,
  tagline: null,
  description: null,
  price_month_cents: cents,
  price_year_cents: cents * 10,
  currency: 'EUR',
  trial_days: 14,
  max_locations: 1,
  max_staff: 3,
  max_plates: 2,
  max_queues: 1,
  history_days: 30,
});
const ROWS = [PLAN_ROW('starter', 'Starter', 1900), PLAN_ROW('pro', 'Pro', 4900), PLAN_ROW('business', 'Business', 12900)];

type FetchMode = 'ok' | 'down' | 'free';
function stubPlans(mode: FetchMode) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (mode === 'down') throw new TypeError('fetch failed');
      const rows = mode === 'free' ? [PLAN_ROW('decouverte', 'Découverte', 0), ...ROWS] : ROWS;
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

async function renderRoute(slug: string, mode: FetchMode = 'ok'): Promise<string> {
  stubPlans(mode);
  const element = (await MetierRoute({ params: Promise.resolve({ metier: slug }) })) as ReactElement;
  return renderToStaticMarkup(element);
}

/** Le graphe JSON-LD d'une page rendue. */
function jsonLd(html: string): { '@graph': Array<Record<string, unknown>> } {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  return JSON.parse(scripts[0]![1]!);
}

const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const published = publishedMetiers();

beforeEach(() => {
  delete process.env.SEO_INDEXABLE;
  delete process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SEO_INDEXABLE;
});

describe('routes : une URL par métier publié', () => {
  it('SSG + ISR, 404 statique pour un slug inconnu', () => {
    expect(dynamicParams).toBe(false);
    expect(revalidate).toBe(3600);
    expect(generateStaticParams()).toEqual(published.map((m) => ({ metier: m.slug })));
    // Un métier du registre non publié n'a pas de route.
    const unpublished = METIERS.filter((m) => !m.published).map((m) => m.slug);
    expect(unpublished.length).toBeGreaterThan(0);
    for (const slug of unpublished) expect(generateStaticParams()).not.toContainEqual({ metier: slug });
  });

  it('un slug inconnu répond 404', async () => {
    await expect(MetierRoute({ params: Promise.resolve({ metier: 'inconnu' }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it('le sitemap liste /pour et chaque page publiée, datée de son texte', () => {
    process.env.SEO_INDEXABLE = '1';
    const entries = sitemap();
    const byUrl = new Map(entries.map((e) => [e.url, e.lastModified]));
    expect(byUrl.has(`${SITE}/pour`)).toBe(true);
    for (const m of published) expect(byUrl.get(`${SITE}/pour/${m.slug}`)).toBe(m.updatedAt);
    const pourUrls = entries.filter((e) => e.url.startsWith(`${SITE}/pour/`)).map((e) => e.url);
    expect(pourUrls).toHaveLength(published.length);
    const latest = published.map((m) => m.updatedAt).sort().at(-1);
    expect(byUrl.get(`${SITE}/pour`)).toBe(latest);
  });

  it('le sitemap reste vide hors production', () => {
    expect(sitemap()).toEqual([]);
  });
});

describe('métadonnées', () => {
  it('uniques, canoniques, et noindex hors production', async () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const { slug } of published) {
      const meta = await generateMetadata({ params: Promise.resolve({ metier: slug }) });
      expect(meta.alternates?.canonical).toBe(`/pour/${slug}`);
      expect(meta.robots).toEqual({ index: false, follow: false });
      expect(typeof meta.title).toBe('string');
      titles.add(String(meta.title));
      descriptions.add(String(meta.description));
      expect(meta.openGraph).toMatchObject({ url: `/pour/${slug}`, locale: 'fr_FR', siteName: 'Rangvia' });
    }
    expect(titles.size).toBe(published.length);
    expect(descriptions.size).toBe(published.length);
  });

  it('indexables en production', async () => {
    process.env.SEO_INDEXABLE = '1';
    const meta = await generateMetadata({ params: Promise.resolve({ metier: published[0]!.slug }) });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(indexMetadata().robots).toEqual({ index: true, follow: true });
  });

  it('un slug inconnu n’a pas de métadonnées', async () => {
    expect(await generateMetadata({ params: Promise.resolve({ metier: 'inconnu' }) })).toEqual({});
  });
});

describe('le gabarit rendu', () => {
  for (const { slug } of published) {
    describe(slug, () => {
      it('un seul H1, fil d’Ariane, sections dans l’ordre du métier', async () => {
        const html = await renderRoute(slug);
        expect(html.match(/<h1\b/g)).toHaveLength(1);
        expect(html).toContain('aria-label="Fil d’Ariane"');
        expect(html).toMatch(/href="\/pour"[^>]*>Métiers</);
        const page = selectPublishedMetiers().find((p) => p.slug === slug)!;
        // Aucune vidéo au manifeste : pas de section vidéo, jamais une vidéo générique.
        expect(html).not.toContain('id="demo"');
        expect(html).not.toMatch(/<video\b/);
        // Les titres de section, dans l'ordre déclaré par le registre.
        const expectedIds: Record<string, string> = {
          problem: 'probleme-titre',
          signature: 'signature-titre',
          counter: 'comptoir-titre',
          settings: 'reglages-titre',
          arguments: 'pourquoi-titre',
          plans: 'offres-titre',
          faq: 'questions-titre',
          cta: 'ouvrir-titre',
          related: 'autres-metiers-titre',
        };
        const positions = page.sections
          .filter((id) => expectedIds[id])
          .map((id) => html.indexOf(`id="${expectedIds[id]}"`));
        for (const p of positions) expect(p).toBeGreaterThan(-1);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        // Une séquence 3D seulement pour les métiers qui en ont une.
        expect(html.includes('data-story=""')).toBe(page.story !== null);
      });

      it('appel à l’inscription avec le métier présélectionné', async () => {
        const html = await renderRoute(slug);
        const page = selectPublishedMetiers().find((p) => p.slug === slug)!;
        const href = `/inscription?activite=${page.activities[0]}`;
        expect(page.cta.href).toBe(href);
        expect(html).toContain(`href="${href.replace('&', '&amp;')}"`);
        // Le QR de la plaque pointe vers la même inscription, en URL absolue.
        expect(html).toMatch(/<svg[^>]*viewBox/);
      });

      it('JSON-LD : pas de note, FAQ affichée = FAQ balisée, offres réelles', async () => {
        const html = await renderRoute(slug);
        const raw = JSON.stringify(jsonLd(html));
        expect(raw).not.toMatch(/aggregateRating|"review"|ratingValue/);
        const graph = jsonLd(html)['@graph'];
        const types = graph.map((n) => n['@type']);
        expect(types).toEqual(expect.arrayContaining(['SoftwareApplication', 'WebSite', 'WebPage', 'BreadcrumbList', 'FAQPage']));
        const faq = graph.find((n) => n['@type'] === 'FAQPage') as { mainEntity: Array<{ name: string }> };
        const shown = [...html.matchAll(/<summary[^>]*><span>([^<]*)<\/span>/g)].map((m) => m[1]!.replace(/&#x27;/g, '’'));
        expect(faq.mainEntity.map((q) => q.name)).toEqual(shown);
        const app = graph.find((n) => n['@type'] === 'SoftwareApplication') as Record<string, unknown>;
        expect(app.offers).toMatchObject({ '@type': 'AggregateOffer', priceCurrency: 'EUR', lowPrice: '19.00', highPrice: '129.00' });
        expect(app.operatingSystem).toBe('Web');
      });

      it('base injoignable : aucun prix, ni affiché ni balisé', async () => {
        const html = await renderRoute(slug, 'down');
        expect(text(html)).not.toMatch(/\d\s?€/);
        expect(html).toContain('href="/tarifs"');
        const app = jsonLd(html)['@graph'].find((n) => n['@type'] === 'SoftwareApplication')!;
        expect(app).not.toHaveProperty('offers');
      });

      it('pas d’App Clip tant qu’il n’est pas publié', async () => {
        expect(text(await renderRoute(slug))).not.toMatch(/App\s*Clip/i);
      });
    });
  }
});

describe('offres', () => {
  it('« Gratuit » seul pour une offre à 0 €', async () => {
    const html = await renderRoute('barbiers', 'free');
    const body = text(html);
    expect(body).toContain('Gratuit');
    expect(body).not.toMatch(/dès\s+Gratuit|Gratuit\s*\/\s*mois|Gratuit\s+HT|0\s?€/);
    expect(body).toMatch(/Tarifs\s·\sGratuit/);
  });

  it('« dès … HT/mois » sinon', () => {
    const plans = ROWS as unknown as PublicPlanOffer[];
    expect(startingPrice(plans)).toBe('dès 19 € HT/mois');
    expect(startingPrice([])).toBeNull();
    const html = renderToStaticMarkup(createElement(PlansStrip, { plans, ctaHref: '/inscription?activite=barber' }));
    expect(html).toContain('/mois HT');
    expect(html).not.toMatch(/le plus choisi|populaire/i);
  });
});

describe('signatures visuelles', () => {
  const pageOf = (slug: string, shipped: ReadonlySet<Capability>): MetierPage =>
    renderable(METIERS.find((m) => m.slug === slug)!, shipped);
  const visual = (page: MetierPage, open: boolean) =>
    renderToStaticMarkup(createElement(SignatureVisual, { page, profileOpen: open }));

  it('atelier fermé : la « Réception » d’aujourd’hui, sans plaque ni rail d’étapes', () => {
    for (const slug of ['garages', 'reparation-telephone']) {
      const page = pageOf(slug, TODAY);
      expect(profileOpenOnPages(page.profile, TODAY)).toBe(false);
      const html = visual(page, false);
      expect(html).not.toMatch(/En réparation|Diagnostic|Sur le poste de l’atelier/);
      expect(html).not.toMatch(/Immatriculation|immatriculation/);
      // Même en forçant le drapeau, un registre en repli ne rend pas l'atelier.
      expect(visual(page, true)).not.toMatch(/Sur le poste de l’atelier/);
    }
  });

  it('atelier ouvert : plaque masquée (trois derniers caractères) et rail d’étapes', () => {
    const page = pageOf('garages', ALL);
    expect(profileOpenOnPages(page.profile, ALL)).toBe(true);
    const html = visual(page, true);
    expect(html).toContain('Sur le poste de l’atelier');
    expect(html).toMatch(/En réparation/);
    // Jamais la plaque complète : ni la forme saisie, ni la forme affichée.
    expect(html).not.toMatch(/AB-?123-?CD|AB\s?123/);
    expect(html).toMatch(/3-?CD/);
  });

  it('le socle incomplet ne suffit pas : une capacité isolée n’allume pas l’atelier', () => {
    const base = PROFILE_BASE.vehicle!;
    for (const missing of base) {
      const shipped = new Set<Capability>([...CORE, ...base.filter((c) => c !== missing)]);
      expect(profileOpenOnPages('vehicle', shipped), missing).toBe(false);
    }
  });

  it('restaurants et guichets : objets du profil seulement profil ouvert', () => {
    expect(visual(pageOf('restaurants', TODAY), false)).not.toMatch(/couverts/i);
    expect(visual(pageOf('restaurants', ALL), true)).toMatch(/couverts/i);
    expect(visual(pageOf('guichets-et-services', TODAY), false)).not.toMatch(/Appel en cours/);
    expect(visual(pageOf('guichets-et-services', ALL), true)).toMatch(/Appel en cours/);
  });

  it('les composants de signature sont des composants serveur', () => {
    for (const file of ['Chairs', 'Guichets', 'Reception', 'Tables', 'Workshop']) {
      const source = read(`components/metiers/signatures/${file}.tsx`);
      expect(source, file).not.toMatch(/'use client'|useState|useEffect/);
    }
  });
});

describe('vidéo : la section n’existe qu’avec une vraie vidéo du métier', () => {
  it('rendue après « Côté comptoir » quand le manifeste en contient une', () => {
    const page = selectPublishedMetiers().find((p) => p.slug === 'barbiers')!;
    const video = parseVideoEntry({
      id: 'barbiers-2026-10',
      metier: 'barbiers',
      duration: 52,
      width: 1920,
      height: 1080,
      uploadDate: '2026-10-02',
      files: { mp4: '/videos/barbiers/demo.1a2b.mp4', poster: { jpg: '/videos/barbiers/poster.1a2b.jpg' } },
      chapters: ['Camille prend sa place.'],
    });
    const html = renderToStaticMarkup(
      createElement(MetierPageView, {
        page,
        all: selectPublishedMetiers(),
        plans: null,
        qrSvg: null,
        video,
        profileOpen: true,
        siteUrl: SITE,
        appClip: false,
      }),
    );
    expect(html).toContain('id="demo"');
    expect(html.indexOf('id="comptoir-titre"')).toBeLessThan(html.indexOf('id="demo-titre"'));
    const graph = jsonLd(html)['@graph'];
    expect(graph.find((n) => n['@type'] === 'VideoObject')).toMatchObject({ duration: 'PT52S', uploadDate: '2026-10-02' });
    // Rien ne se charge avant le clic (l'URL n'est que dans le JSON-LD, qui ne télécharge rien).
    expect(html.replace(/<script[\s\S]*?<\/script>/g, '')).not.toMatch(/<video\b|\.mp4/);
  });
});

describe('index /pour', () => {
  it('un H1, une ligne par métier publié, rien d’autre', () => {
    const html = renderToStaticMarkup(MetiersIndexRoute());
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    for (const { slug } of published) expect(html).toContain(`href="/pour/${slug}"`);
    for (const m of METIERS.filter((x) => !x.published)) expect(html).not.toContain(`/pour/${m.slug}"`);
    const graph = jsonLd(html)['@graph'];
    const list = graph.find((n) => n['@type'] === 'ItemList') as { itemListElement: Array<{ url: string }> };
    expect(list.itemListElement.map((i) => i.url)).toEqual(published.map((m) => `${SITE}/pour/${m.slug}`));
    expect(JSON.stringify(graph)).not.toMatch(/aggregateRating|"review"/);
    expect(indexMetadata().alternates?.canonical).toBe('/pour');
  });
});
