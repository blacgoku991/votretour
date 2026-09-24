import { describe, expect, it } from 'vitest';
import { CORE } from '@/lib/metiers/capabilities';
import { METIERS, SHARED_FAQ } from '@/lib/metiers/registry';
import { fr, pageTexts, renderable } from '@/lib/metiers/select';
import type { Capability, MetierPage } from '@/lib/metiers/types';
import { CAPABILITY_PROFILE, type ProfileCapability } from '@/lib/profiles/capabilities';

/**
 * UNICITÉ — chaque page cible sa propre requête, avec ses propres mots.
 *
 * Deux pages au titre, à la description ou au H1 identiques se font
 * concurrence dans les résultats, et Google n'en garde qu'une ; des pages
 * qui ne diffèrent que par un nom de métier ressemblent à des pages
 * satellites. On vérifie donc l'unicité de ce qui compte pour le
 * référencement, et que chaque page tient par ses propres textes.
 */

const TODAY = new Set<Capability>(CORE);
const ALL = new Set<Capability>([
  ...CORE,
  ...(Object.keys(CAPABILITY_PROFILE) as ProfileCapability[]),
  'channel.app_clip',
]);
const SETS = [
  ['aujourd’hui', TODAY],
  ['tout livré', ALL],
] as const;

/** Suffixe du gabarit de titre du site (`app/layout.tsx` : « %s · Rangvia »). */
const TITLE_SUFFIX = ' · Rangvia';
/** Titres déjà pris ailleurs sur le site. */
const SITE_TITLES = ['Tarifs', 'Rangvia — la file d’attente qui vous laisse partir'];

const norm = (text: string): string =>
  text.replace(/[\u00a0\u202f]/g, ' ').replace(/[’']/g, '’').toLocaleLowerCase('fr').trim();

function expectUnique(label: string, values: readonly string[]): void {
  const seen = new Map<string, string>();
  for (const value of values) {
    const key = norm(value);
    expect(seen.has(key), `${label} en double : « ${value} »`).toBe(false);
    seen.set(key, value);
  }
}

const pages = (shipped: ReadonlySet<Capability>): MetierPage[] => METIERS.map((m) => renderable(m, shipped));

describe('ce que lit le moteur de recherche', () => {
  it('titres, descriptions et H1 uniques entre toutes les pages (publiées ou non)', () => {
    const all = pages(TODAY);
    expectUnique('titre', [...all.map((p) => p.seo.title), ...SITE_TITLES]);
    expectUnique('description', all.map((p) => p.seo.description));
    expectUnique('H1', all.map((p) => p.hero.title));
    expectUnique('titre Open Graph', all.map((p) => p.seo.ogTitle));
    expectUnique('libellé de navigation', all.map((p) => p.nav.label));
    expectUnique('libellé du héros', all.map((p) => p.hero.label));
  });

  it('chaque page vise sa propre requête principale, présente dans son titre ou son H1', () => {
    expectUnique('requête principale', METIERS.map((m) => m.intent.primary));
    for (const m of METIERS) {
      expectUnique(`variante (${m.slug})`, [m.intent.primary, ...m.intent.variants]);
      // Le mot du métier (« barbier », « garage »…) figure dans le titre.
      const page = renderable(m, TODAY);
      const words = norm(m.intent.primary).split(/\s+/);
      const trade = words[words.length - 1] ?? '';
      const stem = trade.slice(0, Math.max(4, trade.length - 2));
      expect(norm(`${page.seo.title} ${page.hero.label}`), `${m.slug} : « ${stem} »`).toContain(stem);
    }
  });

  it('un titre tient dans un résultat de recherche, suffixe compris', () => {
    for (const p of pages(TODAY)) {
      const full = `${p.seo.title}${TITLE_SUFFIX}`;
      expect(full.length, full).toBeLessThanOrEqual(60);
      expect(p.seo.title.length, p.seo.title).toBeGreaterThanOrEqual(25);
    }
  });

  it('une description dit l’essentiel sans être tronquée', () => {
    for (const p of pages(TODAY)) {
      expect(p.seo.description.length, p.seo.description).toBeGreaterThanOrEqual(110);
      expect(p.seo.description.length, p.seo.description).toBeLessThanOrEqual(160);
      expect(p.seo.description, p.slug).toMatch(/[.!?]$/);
    }
  });

  it('le titre, la description et le H1 d’une page ne se répètent pas entre eux', () => {
    for (const p of pages(TODAY)) {
      expect(norm(p.seo.title)).not.toBe(norm(p.hero.title));
      expect(norm(p.seo.description)).not.toContain(norm(p.hero.title));
    }
  });
});

describe('chaque page tient par ses propres textes', () => {
  it.each(SETS)('problèmes, étapes, arguments et questions ne se recopient pas d’une page à l’autre (%s)', (_label, shipped) => {
    const all = pages(shipped);
    const shared = new Set(
      Object.values(SHARED_FAQ).flatMap((f) => [fr(f.q), fr(f.a), ...('fallback' in f ? [fr(f.fallback.q), fr(f.fallback.a)] : [])]),
    );
    expectUnique('problème', all.flatMap((p) => p.problem.map((r) => r.text)));
    expectUnique('titre de problème', all.flatMap((p) => p.problem.map((r) => r.key)));
    expectUnique('titre d’étape', all.flatMap((p) => p.story?.steps.map((s) => s.title) ?? []));
    expectUnique('texte d’étape', all.flatMap((p) => p.story?.steps.map((s) => s.body) ?? []));
    expectUnique('argument', all.flatMap((p) => p.arguments.map((r) => r.text)));
    expectUnique('question', all.flatMap((p) => p.faq.map((f) => f.q).filter((q) => !shared.has(q))));
    expectUnique('réponse', all.flatMap((p) => p.faq.map((f) => f.a).filter((a) => !shared.has(a))));
    expectUnique('titre de signature', all.map((p) => p.signature.title));
    expectUnique('légende de signature', all.map((p) => p.signature.caption));
    expectUnique('appel final', all.map((p) => p.cta.title));
  });

  it.each(SETS)('dans une page, aucune question ni aucun argument en double (%s)', (_label, shipped) => {
    for (const p of pages(shipped)) {
      expectUnique(`question (${p.slug})`, p.faq.map((f) => f.q));
      expectUnique(`argument (${p.slug})`, p.arguments.map((r) => r.key));
      expectUnique(`touche (${p.slug})`, p.counter.map((r) => r.key));
      expectUnique(`réglage (${p.slug})`, p.settings.map((s) => s.label));
    }
  });

  it('au plus une question partagée par page : l’essentiel de la FAQ lui est propre', () => {
    const shared = new Set(Object.values(SHARED_FAQ).map((f) => fr(f.q)));
    for (const p of pages(TODAY)) {
      const common = p.faq.filter((f) => shared.has(f.q)).length;
      expect(common, p.slug).toBeLessThanOrEqual(1);
      expect(p.faq.length - common, p.slug).toBeGreaterThanOrEqual(3);
    }
  });

  it('une page partage au plus un texte sur dix avec ses voisines', () => {
    // Garde-fou contre le gabarit « recherche et remplace » : hors libellés
    // du produit (touches, états, statuts), les phrases sont propres au métier.
    const all = pages(TODAY);
    const sentences = (p: MetierPage) =>
      new Set(pageTexts(p).filter((t) => t.length >= 40).map(norm));
    for (const p of all) {
      const mine = sentences(p);
      const others = new Set(all.filter((o) => o.slug !== p.slug).flatMap((o) => [...sentences(o)]));
      const common = [...mine].filter((t) => others.has(t));
      expect(common.length / mine.size, `${p.slug} : ${common.join(' | ')}`).toBeLessThanOrEqual(0.1);
    }
  });
});
