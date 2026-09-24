import { describe, expect, it } from 'vitest';
import {
  aggregateOffer,
  breadcrumbList,
  faqPage,
  isoDuration,
  jsonLdGraph,
  jsonLdIds,
  safeJsonLd,
  softwareApplication,
  videoObject,
  webPage,
  webSite,
  type FaqEntry,
  type OfferPlan,
} from '@/lib/seo/jsonld';

const SITE = 'https://rangvia.test';

/** Toutes les clés d'un graphe, à n'importe quelle profondeur. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => allKeys(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.add(key);
      allKeys(child, out);
    }
  }
  return out;
}

const PLANS: OfferPlan[] = [
  { priceMonthCents: 4900, currency: 'EUR' },
  { priceMonthCents: 1900, currency: 'EUR' },
  { priceMonthCents: 12900, currency: 'eur' },
];

describe('safeJsonLd', () => {
  it('ne laisse jamais fermer la balise script ni ouvrir du HTML', () => {
    const out = safeJsonLd({ name: '</script><script>alert(1)</script>', a: 'x & y > z' });
    expect(out).not.toContain('</');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
    // …et reste du JSON strictement équivalent.
    expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script>', a: 'x & y > z' });
  });

  it('échappe U+2028 et U+2029', () => {
    const out = safeJsonLd({ t: 'a\u2028b\u2029c' });
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(JSON.parse(out)).toEqual({ t: 'a\u2028b\u2029c' });
  });

  it('refuse une valeur non sérialisable', () => {
    expect(() => safeJsonLd(undefined)).toThrow(TypeError);
  });
});

describe('SoftwareApplication', () => {
  it('ne porte jamais de note ni d’avis, avec ou sans offres', () => {
    for (const plans of [PLANS, null, undefined, []]) {
      const graph = jsonLdGraph([
        softwareApplication({ siteUrl: SITE, description: 'Desc', plans, appClip: true, audience: 'Garages' }),
        webSite({ siteUrl: SITE }),
      ]);
      const keys = allKeys(graph);
      expect(keys.has('aggregateRating')).toBe(false);
      expect(keys.has('review')).toBe(false);
      expect(keys.has('reviews')).toBe(false);
      expect(keys.has('ratingValue')).toBe(false);
    }
  });

  it('balise les offres réelles : min, max, nombre, EUR, hors taxes', () => {
    const app = softwareApplication({ siteUrl: SITE, description: 'Desc', plans: PLANS });
    expect(app.offers).toEqual({
      '@type': 'AggregateOffer',
      priceCurrency: 'EUR',
      lowPrice: '19.00',
      highPrice: '129.00',
      offerCount: 3,
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        priceCurrency: 'EUR',
        valueAddedTaxIncluded: false,
        unitCode: 'MON',
        unitText: 'mois',
      },
    });
  });

  it('n’invente aucune offre quand la lecture a échoué ou n’est pas fiable', () => {
    expect(softwareApplication({ siteUrl: SITE, description: 'D', plans: null })).not.toHaveProperty('offers');
    expect(softwareApplication({ siteUrl: SITE, description: 'D', plans: [] })).not.toHaveProperty('offers');
    expect(softwareApplication({ siteUrl: SITE, description: 'D' })).not.toHaveProperty('offers');
    // Devises mélangées, prix négatif ou non entier : rien plutôt que faux.
    expect(aggregateOffer([{ priceMonthCents: 1900, currency: 'EUR' }, { priceMonthCents: 2900, currency: 'USD' }])).toBeNull();
    expect(aggregateOffer([{ priceMonthCents: -1, currency: 'EUR' }])).toBeNull();
    expect(aggregateOffer([{ priceMonthCents: 19.5, currency: 'EUR' }])).toBeNull();
    expect(aggregateOffer([{ priceMonthCents: 1900, currency: 'euro' }])).toBeNull();
  });

  it('balise les frais d’installation seulement s’ils sont communs à toutes les offres', () => {
    const one = aggregateOffer([{ priceMonthCents: 5990, currency: 'EUR', setupFeeCents: 14900 }]);
    expect(one?.priceSpecification).toEqual([
      expect.objectContaining({ '@type': 'UnitPriceSpecification', unitCode: 'MON' }),
      { '@type': 'PriceSpecification', name: 'Frais d’installation', price: '149.00', priceCurrency: 'EUR', valueAddedTaxIncluded: false },
    ]);
    // Sans frais, ou des frais qui diffèrent d'une offre à l'autre : seul le prix mensuel.
    expect(aggregateOffer([{ priceMonthCents: 5990, currency: 'EUR' }])?.priceSpecification).toMatchObject({ '@type': 'UnitPriceSpecification' });
    expect(aggregateOffer([
      { priceMonthCents: 5990, currency: 'EUR', setupFeeCents: 14900 },
      { priceMonthCents: 9990, currency: 'EUR', setupFeeCents: 0 },
    ])?.priceSpecification).toMatchObject({ '@type': 'UnitPriceSpecification' });
  });

  it('ne cite l’App Clip que s’il est publié', () => {
    expect(softwareApplication({ siteUrl: SITE, description: 'D' }).operatingSystem).toBe('Web');
    expect(softwareApplication({ siteUrl: SITE, description: 'D', appClip: true }).operatingSystem).toBe(
      'Web, iOS (App Clip)',
    );
  });

  it('se relie au site et à la page par des @id stables', () => {
    const app = softwareApplication({ siteUrl: SITE, description: 'D', audience: 'Garages' });
    expect(app['@id']).toBe('https://rangvia.test/#app');
    expect(app.url).toBe('https://rangvia.test/');
    expect(app.audience).toEqual({ '@type': 'BusinessAudience', audienceType: 'Garages' });
    const page = webPage({ siteUrl: SITE, path: '/pour/garages', name: 'Garages', withBreadcrumb: true });
    expect(page).toMatchObject({
      '@id': 'https://rangvia.test/pour/garages#page',
      url: 'https://rangvia.test/pour/garages',
      isPartOf: { '@id': jsonLdIds.site(SITE) },
      about: { '@id': jsonLdIds.app(SITE) },
      breadcrumb: { '@id': 'https://rangvia.test/pour/garages#fil' },
    });
  });
});

describe('BreadcrumbList', () => {
  it('numérote 1, 2, 3 dans l’ordre du fil visible, URL absolues', () => {
    const fil = breadcrumbList({
      siteUrl: SITE,
      pagePath: '/pour/garages',
      items: [{ name: 'Accueil', path: '/' }, { name: 'Métiers', path: '/pour' }, { name: 'Garages' }],
    });
    expect(fil).toEqual({
      '@type': 'BreadcrumbList',
      '@id': 'https://rangvia.test/pour/garages#fil',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: 'https://rangvia.test/' },
        { '@type': 'ListItem', position: 2, name: 'Métiers', item: 'https://rangvia.test/pour' },
        { '@type': 'ListItem', position: 3, name: 'Garages' },
      ],
    });
  });

  it('pas de fil vide', () => {
    expect(breadcrumbList({ siteUrl: SITE, pagePath: '/', items: [] })).toBeNull();
  });
});

describe('FAQPage', () => {
  // La page passe le MÊME tableau à son rendu et au balisage.
  const rendered: FaqEntry[] = [
    { q: 'Le client doit-il télécharger une application ?', a: 'Non. Il scanne le QR code.' },
    { q: 'Prévenez-vous par SMS ?', a: 'Non : par notification.' },
  ];

  it('reprend la FAQ affichée, question pour question, dans l’ordre', () => {
    const faq = faqPage(rendered);
    expect(faq?.['@type']).toBe('FAQPage');
    const main = faq?.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
    expect(main.map((m) => m.name)).toEqual(rendered.map((r) => r.q));
    expect(main.map((m) => m.acceptedAnswer.text)).toEqual(rendered.map((r) => r.a));
  });

  it('pas de FAQ vide', () => {
    expect(faqPage([])).toBeNull();
  });
});

describe('VideoObject', () => {
  const video = {
    name: 'Rangvia au garage',
    description: 'Un dépôt de véhicule, filmé sur le vrai produit.',
    thumbnailUrls: ['/videos/garages/poster.abc123.jpg'],
    uploadDate: '2026-10-02',
    durationSeconds: 52.4,
    contentUrl: '/videos/garages/demo-16x9.abc123.mp4',
  };

  it('produit un objet complet, URL absolues et durée ISO 8601', () => {
    expect(videoObject(video, SITE)).toEqual({
      '@type': 'VideoObject',
      name: 'Rangvia au garage',
      description: 'Un dépôt de véhicule, filmé sur le vrai produit.',
      thumbnailUrl: ['https://rangvia.test/videos/garages/poster.abc123.jpg'],
      uploadDate: '2026-10-02',
      duration: 'PT52S',
      contentUrl: 'https://rangvia.test/videos/garages/demo-16x9.abc123.mp4',
      inLanguage: 'fr-FR',
    });
  });

  it('ignore une entrée incomplète plutôt que de la deviner', () => {
    expect(videoObject({ ...video, durationSeconds: 0 }, SITE)).toBeNull();
    expect(videoObject({ ...video, durationSeconds: Number.NaN }, SITE)).toBeNull();
    expect(videoObject({ ...video, uploadDate: 'hier' }, SITE)).toBeNull();
    expect(videoObject({ ...video, uploadDate: '2026-13-45' }, SITE)).toBeNull();
    // Forme correcte, jour impossible : V8 le reporterait au 2 mars.
    expect(videoObject({ ...video, uploadDate: '2026-02-30' }, SITE)).toBeNull();
    expect(videoObject({ ...video, uploadDate: '2026-02-29T10:00:00Z' }, SITE)).toBeNull();
    expect(videoObject({ ...video, uploadDate: '2026-04-31' }, SITE)).toBeNull();
    expect(videoObject({ ...video, thumbnailUrls: [] }, SITE)).toBeNull();
    expect(videoObject({ ...video, name: '  ' }, SITE)).toBeNull();
    expect(videoObject({ ...video, contentUrl: '' }, SITE)).toBeNull();
  });

  it('accepte une date avec heure et décalage, même quand l’UTC tombe la veille', () => {
    const at = '2026-10-02T00:30:00+02:00';
    expect(videoObject({ ...video, uploadDate: at }, SITE)?.uploadDate).toBe(at);
    expect(videoObject({ ...video, uploadDate: '2028-02-29' }, SITE)?.uploadDate).toBe('2028-02-29');
  });

  it('garde une URL déjà absolue et accepte une page de visionnage', () => {
    const out = videoObject(
      { ...video, contentUrl: 'https://cdn.rangvia.test/v.mp4', embedUrl: '/demonstration' },
      SITE,
    );
    expect(out?.contentUrl).toBe('https://cdn.rangvia.test/v.mp4');
    expect(out?.embedUrl).toBe('https://rangvia.test/demonstration');
  });

  it('isoDuration', () => {
    expect(isoDuration(52)).toBe('PT52S');
    expect(isoDuration(65)).toBe('PT1M5S');
    expect(isoDuration(120)).toBe('PT2M');
    expect(isoDuration(3723)).toBe('PT1H2M3S');
    expect(() => isoDuration(0)).toThrow(RangeError);
    expect(() => isoDuration(0.4)).toThrow(RangeError);
  });
});

describe('jsonLdGraph', () => {
  it('un seul @graph, sans les nœuds absents, sérialisable sans danger', () => {
    const graph = jsonLdGraph([
      webSite({ siteUrl: SITE }),
      faqPage([]),
      null,
      false,
      softwareApplication({ siteUrl: SITE, description: '<b>gras</b>' }),
    ]);
    expect(graph['@context']).toBe('https://schema.org');
    expect(graph['@graph'].map((n) => n['@type'])).toEqual(['WebSite', 'SoftwareApplication']);
    expect(JSON.parse(safeJsonLd(graph))).toEqual(graph);
  });
});
