import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { buildRobots, buildSitemap } from '@/lib/seo/crawl';
import { DISALLOWED_PATHS, PUBLIC_PAGES, absoluteUrl, isIndexable, seoIndexable, siteUrl } from '@/lib/seo/site';

// tests/setup.ts pose NEXT_PUBLIC_SITE_URL=https://votretour.test.
const SITE = 'https://votretour.test';

const LEGAL_COMPLETE = {
  LEGAL_COMPANY: 'Rangvia SAS',
  LEGAL_ADDRESS: '1 rue de la File, 75011 Paris',
  LEGAL_SIRET: '123 456 789 00012',
  LEGAL_EMAIL: 'contact@rangvia.test',
  LEGAL_HOST_NAME: 'Hébergeur',
  LEGAL_HOST_ADDRESS: '2 rue du Serveur, 59100 Roubaix',
} as const;

const saved: Record<string, string | undefined> = {};
const TOUCHED = ['SEO_INDEXABLE', ...Object.keys(LEGAL_COMPLETE)];

beforeEach(() => {
  for (const key of TOUCHED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const PRIVATE = /\/(app|admin|api|auth|bienvenue|invitation|scan|connexion|inscription|e|s|tv|ecran|pass|design)(\/|$)/;

describe('indexabilité', () => {
  it('exige SEO_INDEXABLE=1 ET une URL en https', () => {
    expect(isIndexable('1', 'https://rangvia.fr')).toBe(true);
    expect(isIndexable(' 1 ', 'https://rangvia.fr')).toBe(true);
    expect(isIndexable(undefined, 'https://rangvia.fr')).toBe(false);
    expect(isIndexable('', 'https://rangvia.fr')).toBe(false);
    expect(isIndexable('true', 'https://rangvia.fr')).toBe(false);
    expect(isIndexable('0', 'https://rangvia.fr')).toBe(false);
    expect(isIndexable('1', 'http://localhost:3000')).toBe(false);
    expect(isIndexable('1', 'http://preprod.rangvia.fr')).toBe(false);
  });

  it('lit l’environnement à l’appel, pas au chargement', () => {
    expect(seoIndexable()).toBe(false);
    process.env.SEO_INDEXABLE = '1';
    expect(seoIndexable()).toBe(true);
  });
});

describe('sitemap.xml', () => {
  it('SEO_INDEXABLE absent : sitemap vide', () => {
    expect(sitemap()).toEqual([]);
  });

  it('indexable : les pages publiques, en URL absolues sur siteUrl, sans route privée', () => {
    process.env.SEO_INDEXABLE = '1';
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toEqual([
      `${SITE}/`,
      `${SITE}/tarifs`,
      `${SITE}/cgu`,
      `${SITE}/confidentialite`,
    ]);
    for (const entry of entries) {
      expect(entry.url.startsWith(`${siteUrl()}/`)).toBe(true);
      expect(new URL(entry.url).pathname).not.toMatch(PRIVATE);
      // Une date de révision réelle, jamais « maintenant ».
      expect(typeof entry.lastModified).toBe('string');
      expect(Number.isNaN(Date.parse(String(entry.lastModified)))).toBe(false);
      expect(entry).not.toHaveProperty('priority');
      expect(entry).not.toHaveProperty('changeFrequency');
    }
  });

  it('/mentions-legales seulement quand les mentions sont complètes', () => {
    process.env.SEO_INDEXABLE = '1';
    expect(sitemap().map((e) => e.url)).not.toContain(`${SITE}/mentions-legales`);
    Object.assign(process.env, LEGAL_COMPLETE);
    expect(sitemap().map((e) => e.url)).toContain(`${SITE}/mentions-legales`);
    delete process.env.LEGAL_SIRET;
    expect(sitemap().map((e) => e.url)).not.toContain(`${SITE}/mentions-legales`);
  });

  it('les dates viennent des constantes versionnées', () => {
    process.env.SEO_INDEXABLE = '1';
    const byUrl = new Map(sitemap().map((e) => [e.url, e.lastModified]));
    for (const page of PUBLIC_PAGES.filter((p) => !p.onlyWithLegalNotice)) {
      expect(byUrl.get(absoluteUrl(page.path, SITE))).toBe(page.lastModified);
    }
  });

  it('pages métier : /pour et chaque métier publié, index daté du plus récent', () => {
    const entries = buildSitemap({
      siteUrl: SITE,
      indexable: true,
      legalNotice: false,
      metiers: [
        { slug: 'garages', updatedAt: '2026-10-01' },
        { slug: 'barbiers', updatedAt: '2026-10-12' },
        { slug: 'restaurants', updatedAt: '2026-09-30' },
      ],
    });
    const urls = entries.map((e) => e.url);
    expect(urls).toContain(`${SITE}/pour`);
    expect(urls).toContain(`${SITE}/pour/garages`);
    expect(urls).toContain(`${SITE}/pour/barbiers`);
    expect(entries.find((e) => e.url === `${SITE}/pour`)?.lastModified).toBe('2026-10-12');
    expect(entries.find((e) => e.url === `${SITE}/pour/garages`)?.lastModified).toBe('2026-10-01');
  });

  it('sans métier publié, pas de /pour ; un slug douteux n’entre jamais', () => {
    const none = buildSitemap({ siteUrl: SITE, indexable: true, legalNotice: false, metiers: [] });
    expect(none.map((e) => e.url)).not.toContain(`${SITE}/pour`);
    const odd = buildSitemap({
      siteUrl: SITE,
      indexable: true,
      legalNotice: false,
      metiers: [
        { slug: '../admin', updatedAt: '2026-10-01' },
        { slug: 'Garages', updatedAt: '2026-10-01' },
        { slug: 'a b', updatedAt: '2026-10-01' },
      ],
    });
    expect(odd.map((e) => e.url).some((u) => u.includes('/pour'))).toBe(false);
  });

  it('fermé : rien, même avec des métiers publiés', () => {
    expect(
      buildSitemap({ siteUrl: SITE, indexable: false, legalNotice: true, metiers: [{ slug: 'garages', updatedAt: '2026-10-01' }] }),
    ).toEqual([]);
  });
});

describe('robots.txt', () => {
  it('SEO_INDEXABLE absent : Disallow: / et aucun sitemap annoncé', () => {
    const out = robots();
    expect(out.rules).toEqual({ userAgent: '*', disallow: '/' });
    expect(out.sitemap).toBeUndefined();
  });

  it('indexable : ferme le privé, annonce le sitemap absolu', () => {
    process.env.SEO_INDEXABLE = '1';
    const out = robots();
    expect(out.sitemap).toBe(`${SITE}/sitemap.xml`);
    const rules = Array.isArray(out.rules) ? out.rules : [out.rules];
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect(rule?.userAgent).toBe('*');
    expect(rule?.allow).toBe('/');
    const disallow = ([] as string[]).concat(rule?.disallow ?? []);
    for (const path of ['/app/', '/admin/', '/api/', '/auth/', '/bienvenue', '/invitation/', '/scan/']) {
      expect(disallow).toContain(path);
    }
  });

  it('n’interdit PAS les pages publiques en noindex : le robot doit lire leur noindex', () => {
    const out = buildRobots({ siteUrl: SITE, indexable: true });
    const rules = Array.isArray(out.rules) ? out.rules : [out.rules];
    const disallow = rules.flatMap((r) => ([] as string[]).concat(r.disallow ?? []));
    // Même logique qu'un robot : correspondance de préfixe, « $ » = fin de chemin.
    const blocked = (path: string) =>
      disallow.some((rule) => (rule.endsWith('$') ? path === rule.slice(0, -1) : path.startsWith(rule)));
    for (const path of ['/e/barber-house', '/s/jeton', '/pass', '/tv', '/ecran/barber-house', '/design', '/connexion', '/inscription', '/pour/garages', '/opengraph-image', '/videos/garages/demo.mp4', '/sitemap.xml']) {
      expect(blocked(path), path).toBe(false);
    }
    // …ni les fichiers Apple, qu'un préfixe « /app » naïf fermerait.
    expect(blocked('/apple-icon.png')).toBe(false);
    expect(blocked('/.well-known/apple-app-site-association')).toBe(false);
    // Le privé, lui, est bien fermé, racine comprise.
    for (const path of ['/app', '/app/barber-house/file', '/admin', '/admin/offres', '/api/health', '/bienvenue', '/scan/abc', '/auth/callback', '/invitation/abc']) {
      expect(blocked(path), path).toBe(true);
    }
    expect(DISALLOWED_PATHS.length).toBe(disallow.length);
  });
});

describe('middleware : le site public en cache ne passe pas par l’authentification', () => {
  it('exclut /pour, sitemap.xml, robots.txt, l’image de partage, /videos et /s/', async () => {
    const { config } = await import('@/middleware');
    const [pattern] = config.matcher;
    expect(pattern).toBeDefined();
    // Même lecture que Next : le motif doit couvrir TOUT le chemin.
    const runs = (path: string) => new RegExp(`^${pattern}$`).test(path);
    for (const path of [
      '/pour',
      '/pour/garages',
      '/pour/garages/opengraph-image',
      '/sitemap.xml',
      '/robots.txt',
      '/opengraph-image',
      '/videos/garages/demo.mp4',
      '/s/jeton-brut',
    ]) {
      expect(runs(path), path).toBe(false);
    }
    // Le reste continue d'y passer, y compris des chemins voisins.
    for (const path of [
      '/',
      '/app',
      '/app/barber-house/file',
      '/admin',
      '/scan/abc',
      '/bienvenue',
      '/connexion',
      '/tarifs',
      '/pourquoi',
      '/sitemap.xml.bak',
      '/robots.txt/x',
    ]) {
      expect(runs(path), path).toBe(true);
    }
  });
});
