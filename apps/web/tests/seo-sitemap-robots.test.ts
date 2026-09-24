import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { config as middlewareConfig } from '@/middleware';
import { publishedMetiers } from '@/lib/metiers/registry';
import { buildRobots, buildSitemap } from '@/lib/seo/crawl';
import {
  DISALLOWED_PATHS,
  PUBLIC_PAGES,
  SITE_DATES,
  absoluteUrl,
  appClipPublished,
  isIndexable,
  seoIndexable,
  siteUrl,
} from '@/lib/seo/site';

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
const TOUCHED = ['SEO_INDEXABLE', 'VERCEL_ENV', 'NEXT_PUBLIC_APP_CLIP_PUBLIE', ...Object.keys(LEGAL_COMPLETE)];

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

  it('une prévisualisation Vercel reste fermée, même avec SEO_INDEXABLE=1', () => {
    expect(isIndexable('1', 'https://rangvia-git-x.vercel.app', 'preview')).toBe(false);
    expect(isIndexable('1', 'https://rangvia-git-x.vercel.app', 'development')).toBe(false);
    expect(isIndexable('1', 'https://rangvia.fr', 'production')).toBe(true);
    // Hors Vercel (Docker, poste local), la variable n'existe pas.
    expect(isIndexable('1', 'https://rangvia.fr', undefined)).toBe(true);
    expect(isIndexable('1', 'https://rangvia.fr', '')).toBe(true);
    process.env.SEO_INDEXABLE = '1';
    process.env.VERCEL_ENV = 'preview';
    expect(seoIndexable()).toBe(false);
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
    expect(sitemap()).toEqual([]);
    process.env.VERCEL_ENV = 'production';
    expect(seoIndexable()).toBe(true);
  });
});

describe('App Clip', () => {
  it('fermé par défaut : aucune page ne le promet sans « 1 » explicite', () => {
    expect(appClipPublished()).toBe(false);
    for (const value of ['', '0', 'true', 'oui']) {
      process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE = value;
      expect(appClipPublished(), value).toBe(false);
    }
    process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE = '1';
    expect(appClipPublished()).toBe(true);
  });
});

describe('dates de révision', () => {
  it('SITE_DATES : jours ISO réels, jamais dans le futur', () => {
    const now = Date.now();
    for (const [page, day] of Object.entries(SITE_DATES)) {
      expect(day, page).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const at = new Date(`${day}T00:00:00Z`);
      // Aller-retour : « 2026-02-30 » passerait la regex et Date.parse.
      expect(at.toISOString().slice(0, 10), page).toBe(day);
      expect(at.getTime(), page).toBeLessThanOrEqual(now);
    }
    for (const page of PUBLIC_PAGES) {
      expect(Object.values(SITE_DATES), page.path).toContain(page.lastModified);
    }
  });
});

describe('déploiement Docker : SEO_INDEXABLE identique au build et à l’exécution', () => {
  // Les pages statiques et ISR figent leur balise robots au build : sans
  // l'argument, une image « de production » servirait noindex.
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

  it('le Dockerfile le déclare en ARG et le passe à l’étape de compilation', () => {
    const dockerfile = read('../Dockerfile');
    const builder = dockerfile.slice(dockerfile.indexOf('AS builder'), dockerfile.indexOf('AS runner'));
    expect(builder).toMatch(/^ARG SEO_INDEXABLE=?$/m);
    expect(builder).toMatch(/^\s*SEO_INDEXABLE=\$SEO_INDEXABLE\b/m);
    expect(builder.indexOf('SEO_INDEXABLE=$SEO_INDEXABLE')).toBeLessThan(builder.indexOf('npm run build'));
  });

  it('compose le passe en argument de build ET en variable d’exécution', () => {
    const compose = read('../../../deploy/docker-compose.yml');
    const app = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  caddy:'));
    const args = app.slice(app.indexOf('args:'), app.indexOf('image:'));
    const environment = app.slice(app.indexOf('environment:'), app.indexOf('volumes:'));
    expect(args).toMatch(/^\s+SEO_INDEXABLE: \$\{SEO_INDEXABLE:-\}$/m);
    expect(environment).toMatch(/^\s+SEO_INDEXABLE: \$\{SEO_INDEXABLE:-\}$/m);
    // Inlinée au build : la répéter à l'exécution ferait croire qu'un
    // redémarrage suffit.
    expect(args).toMatch(/NEXT_PUBLIC_APP_CLIP_PUBLIE:/);
    expect(environment).not.toMatch(/NEXT_PUBLIC_APP_CLIP_PUBLIE:/);
  });
});

describe('sitemap.xml', () => {
  it('SEO_INDEXABLE absent : sitemap vide', () => {
    expect(sitemap()).toEqual([]);
  });

  it('indexable : les pages publiques (statiques + métiers publiés), en URL absolues sur siteUrl, sans route privée', () => {
    process.env.SEO_INDEXABLE = '1';
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    // Les pages métier viennent du registre (même source que
    // generateStaticParams de /pour/[metier]) : construites ici depuis
    // publishedMetiers(), jamais recopiées, pour qu'un métier publié de
    // plus ne casse pas ce test et qu'un métier oublié le casse.
    const metiers = publishedMetiers();
    expect(metiers.length).toBeGreaterThan(0);
    expect(urls).toEqual([
      `${SITE}/`,
      `${SITE}/tarifs`,
      `${SITE}/cgu`,
      `${SITE}/confidentialite`,
      `${SITE}/pour`,
      ...metiers.map((m) => `${SITE}/pour/${m.slug}`),
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
  // Le vrai compilateur de motifs de Next, pas une RegExp reconstruite.
  const runs = (url: string) => unstable_doesMiddlewareMatch({ config: middlewareConfig, url });

  it('exclut /pour, sitemap.xml, robots.txt, les images de partage, /videos, /s/ et les icônes', () => {
    for (const path of [
      '/pour',
      '/pour/garages',
      '/pour/garages/opengraph-image',
      '/sitemap.xml',
      '/robots.txt',
      '/opengraph-image',
      '/videos/garages/demo.mp4',
      '/s/jeton-brut',
      '/icon.png',
      '/apple-icon.png',
      '/e/barber-house',
    ]) {
      expect(runs(path), path).toBe(false);
    }
  });

  it('le reste continue d’y passer, y compris des chemins voisins', () => {
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
      '/s',
    ]) {
      expect(runs(path), path).toBe(true);
    }
  });
});
