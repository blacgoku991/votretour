import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SiteFooter, type SiteFooterProps } from '@/components/SiteChrome';
import { NAV, navCurrent } from '@/app/(marketing)/_chrome/HeaderClient';
import { selectPublishedMetiers } from '@/lib/metiers/select';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { parseActivityParam } from '@/app/bienvenue/metiers';
import {
  awaitingConfirmationPath,
  confirmationRedirect,
  welcomePath,
} from '@/app/(auth)/inscription/activity';

/**
 * MAILLAGE PUBLIC (lot S4) — en-tête, pied de page, /tarifs et le chemin
 * de `?activite=` jusqu'à l'onboarding.
 *
 *  - « Métiers » (/pour) dans l'en-tête et le pied ; un lien par page
 *    métier PUBLIÉE dans le pied (même liste que l'index) ;
 *  - la vitrine des dix premiers n'apparaît que si le serveur l'a lue ;
 *  - `?activite=` : liste blanche, transmis jusqu'à /bienvenue, et le lien
 *    de confirmation reste un chemin interne (safeRedirectPath inchangé).
 */

const metiers = selectPublishedMetiers().map((p) => ({ href: p.path, label: p.nav.label }));
// Composant serveur sans hook : on l'appelle comme une fonction.
const footer = (props: SiteFooterProps) => renderToStaticMarkup(SiteFooter(props));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe('en-tête', () => {
  it('« Métiers » vers /pour, entre « Comment ça marche » et « Tarifs »', () => {
    expect(NAV.map((i) => i.href)).toEqual(['/#comment', '/pour', '/tarifs', '/pour/evenements-et-drops']);
    expect(NAV[1]?.label).toBe('Métiers');
  });

  it('« Métiers » est courant sur /pour et chaque page métier, sauf celle des événements', () => {
    const [comment, metiersItem, tarifs, events] = NAV;
    expect(navCurrent(metiersItem!, '/pour')).toBe(true);
    expect(navCurrent(metiersItem!, '/pour/garages')).toBe(true);
    expect(navCurrent(metiersItem!, '/pour/evenements-et-drops')).toBe(false);
    expect(navCurrent(events!, '/pour/evenements-et-drops')).toBe(true);
    expect(navCurrent(metiersItem!, '/pourboire')).toBe(false);
    expect(navCurrent(tarifs!, '/tarifs')).toBe(true);
    expect(navCurrent(comment!, '/')).toBe(false);
  });
});

describe('pied de page', () => {
  it('avec les métiers : lien /pour, un lien par page publiée, aucun doublon', () => {
    const links = hrefs(footer({ metiers }));
    expect(links).toContain('/pour');
    expect(metiers.length).toBeGreaterThan(0);
    for (const m of metiers) expect(links).toContain(m.href);
    // Le groupe « Métiers » : colonnes (ordinateur) + grille (téléphone),
    // chaque page exactement deux fois, jamais trois.
    for (const m of metiers) expect(links.filter((h) => h === m.href)).toHaveLength(2);
    expect(footer({ metiers })).toContain('>Métiers</p>');
  });

  it('sans les métiers (page qui ne les fournit pas) : le pied d’avant, avec /pour', () => {
    const html = footer({});
    expect(hrefs(html)).toContain('/pour');
    expect(hrefs(html)).toContain('/pour/evenements-et-drops');
    expect(html).not.toContain('>Métiers</p>');
  });

  it('vitrine : absente sans données, dix places libres sans volontaire', () => {
    expect(footer({ founders: null })).not.toContain('premiers-commerces');
    const html = footer({ founders: [] });
    expect(html).toContain('id="premiers-commerces"');
    expect(html.match(/data-kind="free"/g)).toHaveLength(10);
  });

  it('garde la tête de file et « Ouvrir ma file »', () => {
    const html = footer({ metiers, founders: [] });
    expect(html).toContain('Vous êtes en tête de file.');
    expect(hrefs(html)).toContain('/inscription');
  });

  it('mentions légales publiées : le lien s’ajoute au groupe « Légal »', () => {
    expect(hrefs(footer({ legalNotice: true }))).toContain('/mentions-legales');
    expect(hrefs(footer({ legalNotice: false }))).not.toContain('/mentions-legales');
  });
});

describe('/tarifs', () => {
  it('porte un lien « Voir par métier » vers /pour', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/app/(marketing)/tarifs/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(src).toMatch(/<Link href="\/pour"[^>]*>Voir par métier<\/Link>/);
  });
});

describe('inscription : ?activite= jusqu’à l’onboarding', () => {
  it('liste blanche : un code connu est gardé, le reste ignoré', () => {
    expect(parseActivityParam('garage')).toBe('garage');
    for (const value of ['inconnu', 'GARAGE', '', '<script>', '__proto__', 'toString', undefined, ['garage', 'barber']]) {
      expect(parseActivityParam(value)).toBeNull();
    }
  });

  it('après la création du compte : /bienvenue, avec le métier s’il est connu', () => {
    expect(welcomePath('garage')).toBe('/bienvenue?activite=garage');
    expect(welcomePath(null)).toBe('/bienvenue');
  });

  it('lien de confirmation : exactement celui d’avant sans métier, encodé avec', () => {
    expect(confirmationRedirect('https://rangvia.fr', null)).toBe('https://rangvia.fr/auth/callback?next=/bienvenue');
    const withActivity = new URL(confirmationRedirect('https://rangvia.fr', 'garage'));
    const next = withActivity.searchParams.get('next');
    expect(next).toBe('/bienvenue?activite=garage');
    // auth/callback le relit avec safeRedirectPath : chemin interne, gardé tel quel.
    expect(safeRedirectPath(next)).toBe('/bienvenue?activite=garage');
  });

  it('adresse à confirmer : /connexion garde le métier pour la connexion suivante', () => {
    expect(awaitingConfirmationPath(null)).toBe('/connexion?inscrit=1');
    const url = new URL(awaitingConfirmationPath('restaurant'), 'https://rangvia.fr');
    expect(url.searchParams.get('inscrit')).toBe('1');
    expect(safeRedirectPath(url.searchParams.get('next'))).toBe('/bienvenue?activite=restaurant');
  });

  it('la redirection ouverte reste refusée', () => {
    for (const bad of ['//exemple.com', '/\\exemple.com', 'https://exemple.com/bienvenue']) {
      expect(safeRedirectPath(bad)).toBe('/app');
    }
  });
});
