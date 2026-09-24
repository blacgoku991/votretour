import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /tarifs, L'OFFRE UNIQUE (0043) — ce qu'un visiteur reçoit vraiment.
 *
 * La route est rendue elle-même (composant serveur), la base simulée au
 * niveau du client Supabase. Vérifié :
 *  - une seule offre : 59,90 € HT/mois, + 149 € HT d'installation une
 *    fois ; plus de bascule mensuel/annuel, plus de « le plus choisi » ;
 *  - ce que comprend l'installation, et ce que comprend l'abonnement TIRÉ
 *    DES QUOTAS RÉELS (un quota modifié change la page) ;
 *  - les colonnes publiques seulement, jamais `stripe_*` ;
 *  - base en panne : aucun prix, jamais un prix inventé ;
 *  - le lien « Voir par métier » (lot S4) est toujours là ;
 *  - le bandeau des pages métier montre la même offre, frais compris.
 */

const db = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as unknown,
  selects: [] as string[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const builder = {
        select: (columns: string) => { db.selects.push(columns); return builder; },
        eq: () => builder,
        order: async () => ({ data: db.error ? null : db.rows, error: db.error }),
      };
      return builder;
    },
  }),
}));

const { default: PricingPage } = await import('@/app/(marketing)/tarifs/page');
const { PricingBoard } = await import('@/app/(marketing)/tarifs/PricingBoard');
const { PlansStrip } = await import('@/components/metiers/PlansStrip');
const { parsePublicPlan, PUBLIC_PLAN_COLUMNS } = await import('@/lib/public-plans');

const RANGVIA = {
  code: 'rangvia',
  name: 'Rangvia',
  tagline: 'Une file d’attente installée et réglée pour votre métier.',
  description: null,
  price_month_cents: 5990,
  price_year_cents: 0,
  setup_fee_cents: 14900,
  currency: 'EUR',
  trial_days: 14,
  max_locations: -1,
  max_staff: -1,
  max_plates: -1,
  max_queues: -1,
  history_days: 730,
};

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (path: string) => readFileSync(`${SRC}${path}`, 'utf8');

/** Le texte lu : balises retirées, entités courantes décodées, blancs réduits. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;| | /g, ' ')
    .replace(/\s+/g, ' ');

async function renderPage(): Promise<string> {
  const element = (await PricingPage()) as ReactElement;
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  db.rows = [RANGVIA];
  db.error = null;
  db.selects = [];
});

describe('/tarifs : une seule offre', () => {
  it('le prix mensuel HT et les frais d’installation, une fois', async () => {
    const body = text(await renderPage());
    expect(body).toContain('Une offre. Tout compris.');
    // Lus en toutes lettres par les lecteurs d'écran, une fois chacun.
    expect(body).toContain('59,90 € par mois, hors taxes');
    expect(body).toContain('plus 149 € hors taxes de frais d’installation, payés une fois');
    expect(body).toContain('/mois HT');
    expect(body).toContain('149 € HT, une fois');
    expect(body).toContain('59,90 € HT par mois');
  });

  it('plus de packs : ni bascule mensuel/annuel, ni comparatif, ni « le plus choisi »', async () => {
    const html = await renderPage();
    expect(html).not.toMatch(/aria-pressed/);
    expect(text(html)).not.toMatch(/Mensuel|Annuel|par an|mois offerts?|le plus choisi|populaire|Starter|Business|Comparer/i);
    // Une seule offre rendue : un seul prix en tuiles.
    expect(html.match(/par mois, hors taxes/g)).toHaveLength(1);
  });

  it('ce que comprend l’installation', async () => {
    const body = text(await renderPage());
    expect(body).toContain('Installation et configuration de votre métier par l’équipe Rangvia');
    for (const key of ['Votre métier, activé', 'Vos réglages, posés avec vous', 'Prêt à ouvrir']) {
      expect(body).toContain(key);
    }
  });

  it('ce que comprend l’abonnement, d’après les quotas réels', async () => {
    let body = text(await renderPage());
    expect(body).toContain('Établissements, professionnels, plaques et files sans limite');
    expect(body).toContain('2 ans d’historique');

    // Le super-admin change un quota : la page suit, sans redéploiement.
    db.rows = [{ ...RANGVIA, max_staff: 5, history_days: 180 }];
    body = text(await renderPage());
    expect(body).toContain('Établissements, plaques et files sans limite');
    expect(body).toContain('5 professionnels');
    expect(body).toContain('180 jours d’historique');
  });

  it('un seul appel à l’essai, et le lien « Voir par métier »', async () => {
    const html = await renderPage();
    expect(html).toContain('href="/pour"');
    expect(text(html)).toContain('Voir par métier');
    expect(html).toMatch(/href="\/inscription"[^>]*>Essayer 14 jours/);
    expect(text(html)).toContain('Essai sans carte bancaire');
  });

  it('ne lit que les colonnes publiques, jamais un identifiant Stripe', async () => {
    await renderPage();
    expect(db.selects).toEqual([PUBLIC_PLAN_COLUMNS.join(', ')]);
    expect(db.selects[0]).not.toMatch(/stripe|features|\*/);
  });

  it('base en panne ou aucune offre : aucun prix affiché', async () => {
    db.error = { message: 'panne' };
    let html = await renderPage();
    expect(text(html)).toContain('Tarifs momentanément indisponibles');
    expect(html).not.toMatch(/par mois, hors taxes|59,90|149/);

    db.error = null;
    db.rows = [];
    html = await renderPage();
    expect(text(html)).toContain('Tarifs momentanément indisponibles');
  });

  it('une offre sans frais d’installation n’affiche ni latte ni section d’installation', () => {
    const plan = parsePublicPlan({ ...RANGVIA, setup_fee_cents: 0 })!;
    const body = text(renderToStaticMarkup(createElement(PricingBoard, { plan, appClip: false })));
    expect(body).not.toMatch(/installation/i);
    expect(body).toContain('L’abonnement');
  });

  it('sans App Clip publié, on ne le promet pas', async () => {
    delete process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE;
    expect(text(await renderPage())).not.toMatch(/App Clip/);
  });

  it('composant serveur : aucun JavaScript propre au tableau des tarifs', () => {
    expect(read('app/(marketing)/tarifs/PricingBoard.tsx')).not.toMatch(/^'use client'|useState|useEffect/m);
  });

  it('mouvement : seulement transform et opacité, jamais sans préférence de mouvement réduit', () => {
    const css = read('app/(marketing)/tarifs/tarifs.module.css');
    expect(css).not.toMatch(/transition\s*:[^;]*(width|height|top|left|margin|padding|background)/);
    for (const block of css.match(/@keyframes[^{]+\{[\s\S]*?\n\}/g) ?? []) {
      const properties = [...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const property of properties) expect(['transform', 'opacity']).toContain(property);
    }
    // Toute animation est rangée sous prefers-reduced-motion: no-preference.
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '');
    expect(outside).not.toMatch(/animation\s*:/);
  });
});

describe('pages métier : le bandeau d’offre', () => {
  it('l’offre unique et ses frais d’installation, un seul appel', () => {
    const plan = parsePublicPlan(RANGVIA)!;
    const html = renderToStaticMarkup(createElement(PlansStrip, { plans: [plan], ctaHref: '/inscription?activite=garage' }));
    const body = text(html);
    expect(body).toContain('Tarifs · 59,90 € HT/mois');
    expect(body).toContain('Abonnement');
    expect(body).toContain('/mois HT');
    expect(body).toContain('Installation');
    expect(body).toContain('149 €');
    expect(body).toContain('HT, une fois');
    expect(body).toContain('Installation et configuration de votre métier par l’équipe Rangvia');
    expect(body).toContain('Établissements, professionnels, plaques et files sans limite');
    expect(html.match(/href="\/inscription\?activite=garage"/g)).toHaveLength(1);
    expect(html).toContain('href="/tarifs"');
    expect(body).not.toMatch(/dès|le plus choisi|populaire|Comparer/i);
  });

  it('base injoignable : aucun prix, le seul lien vers les tarifs', () => {
    const body = text(renderToStaticMarkup(createElement(PlansStrip, { plans: null, ctaHref: '/inscription' })));
    expect(body).toContain('Voir les tarifs');
    expect(body).not.toMatch(/€/);
  });
});
