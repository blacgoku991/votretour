import { ACTIVITY_PROFILE } from '@/lib/profiles';
import { shippedCapabilities } from './capabilities';
import { METIERS, getMetier } from './registry';
import type {
  Capability,
  CounterContent,
  CtaContent,
  FaqContent,
  Gated,
  Metier,
  MetierPage,
  Requirement,
  RowContent,
  SceneContent,
  SettingContent,
  SignatureContent,
  Slot,
  StepContent,
  StoryContent,
  StoryCopy,
} from './types';

/**
 * SÉLECTION — du registre à la page affichable.
 *
 * `renderable()` résout chaque condition contre les capacités LIVRÉES :
 * un bloc dont la capacité manque disparaît, ou cède la place à sa
 * version « vraie aujourd'hui ». La page qui en sort ne contient plus
 * aucune condition, et sa typographie est française (espaces insécables
 * avant « : ? ! ; », dans les guillemets et après un nombre, apostrophes
 * courbes) : le registre s'écrit avec des espaces ordinaires, la page
 * sort juste.
 *
 * Fonction pure : les tests la rejouent avec n'importe quel jeu de
 * capacités. Les pages passent par `selectMetier()`, qui lit les
 * capacités réelles (`shippedCapabilities()`, côté serveur).
 */

/* ------------------------------------------------------------------ */
/* Typographie                                                          */
/* ------------------------------------------------------------------ */

const NBSP = '\u00a0';
/** Espace fine insécable, avant « ? ! ; » (usage de l'Imprimerie nationale). */
const NNBSP = '\u202f';

/**
 * Typographie française d'un texte du registre. Idempotente : l'appliquer
 * deux fois ne change rien. Ne touche ni aux heures (« 14:32 ») ni aux
 * numéros (« A-042 »).
 */
export function fr(text: string): string {
  return text
    .replace(/\.\.\./g, '…')
    .replace(/'/g, '’')
    .replace(/"([^"]*)"/g, `«${NBSP}$1${NBSP}»`)
    .replace(/«[ \u00a0\u202f]*/g, `«${NBSP}`)
    .replace(/[ \u00a0\u202f]*»/g, `${NBSP}»`)
    .replace(/[ \u00a0\u202f]*([?!;])/g, `${NNBSP}$1`)
    .replace(/[ \u202f]+:/g, `${NBSP}:`)
    .replace(/(\d) (?=[\p{L}€%])/gu, `$1${NBSP}`)
    .replace(/ {2,}/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Conditions                                                           */
/* ------------------------------------------------------------------ */

/** Toutes les capacités demandées sont-elles livrées ? */
export function requirementMet(requirement: Requirement | undefined, shipped: ReadonlySet<Capability>): boolean {
  if (requirement === undefined) return true;
  const list: readonly Capability[] = typeof requirement === 'string' ? [requirement] : requirement;
  return list.every((capability) => shipped.has(capability));
}

/** Liste plate des capacités d'une condition (pour les tests et les contrôles). */
export function requirementList(requirement: Requirement | undefined): readonly Capability[] {
  if (requirement === undefined) return [];
  return typeof requirement === 'string' ? [requirement] : requirement;
}

function strip<T>(block: T & { requires?: unknown; fallback?: unknown }): T {
  // Le bloc retenu ne transporte plus sa condition ni son repli : la page
  // ne peut pas les afficher par erreur.
  const { requires: _requires, fallback: _fallback, ...content } = block;
  return content as unknown as T;
}

/** Bloc de liste : le contenu, son repli, ou rien. */
function pick<T>(block: Gated<T>, shipped: ReadonlySet<Capability>): T | null {
  if (block.requires === undefined) return strip<T>(block);
  if (requirementMet(block.requires, shipped)) return strip<T>(block);
  return block.fallback ?? null;
}

/** Emplacement fixe : le contenu ou son repli, jamais rien. */
function slot<T>(block: Slot<T>, shipped: ReadonlySet<Capability>): T {
  if (block.requires === undefined || requirementMet(block.requires, shipped)) return strip<T>(block);
  return block.fallback;
}

function list<T>(blocks: readonly Gated<T>[], shipped: ReadonlySet<Capability>): T[] {
  const out: T[] = [];
  for (const block of blocks) {
    const content = pick(block, shipped);
    if (content !== null) out.push(content);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Mise en forme de chaque bloc                                         */
/* ------------------------------------------------------------------ */

const row = (r: RowContent): RowContent => ({ key: fr(r.key), text: fr(r.text) });
const counter = (r: CounterContent): CounterContent => ({ key: fr(r.key), text: fr(r.text) });
const faq = (f: FaqContent): FaqContent => ({ q: fr(f.q), a: fr(f.a) });

function step(s: StepContent): StepContent {
  return {
    kicker: fr(s.kicker),
    title: fr(s.title),
    body: fr(s.body),
    benefit: fr(s.benefit),
    state: fr(s.state),
    ...(s.outline ? { outline: true } : {}),
  };
}

function scene(s: SceneContent): SceneContent {
  return {
    place: fr(s.place),
    seuil: fr(s.seuil),
    proKey: fr(s.proKey),
    proLabels: {
      current: fr(s.proLabels.current),
      currentName: fr(s.proLabels.currentName),
      next: fr(s.proLabels.next),
      nextName: fr(s.proLabels.nextName),
    },
    clientName: fr(s.clientName),
    slotHints: {
      self: fr(s.slotHints.self),
      kept: fr(s.slotHints.kept),
      back: fr(s.slotHints.back),
      turn: fr(s.slotHints.turn),
      ghost: fr(s.slotHints.ghost),
      next: fr(s.slotHints.next),
    },
  };
}

function story(content: StoryContent, shipped: ReadonlySet<Capability>): StoryCopy {
  const [a, b, c, d, e, f] = content.steps;
  return {
    scene: scene(content.scene),
    steps: [
      step(slot(a, shipped)),
      step(slot(b, shipped)),
      step(slot(c, shipped)),
      step(slot(d, shipped)),
      step(slot(e, shipped)),
      step(slot(f, shipped)),
    ],
  };
}

function signature(s: SignatureContent): SignatureContent {
  return {
    kind: s.kind,
    title: fr(s.title),
    caption: fr(s.caption),
    seuil: fr(s.seuil),
    lanes: s.lanes.map((lane) => ({ label: fr(lane.label), ...(lane.hint ? { hint: fr(lane.hint) } : {}) })),
  };
}

function setting(s: SettingContent): SettingContent {
  // La référence (table, colonne, valeur) reste telle quelle : ce n'est pas du texte affiché.
  return { label: fr(s.label), value: fr(s.value), text: fr(s.text), ref: s.ref };
}

function cta(c: CtaContent, activity: string): CtaContent & { href: string } {
  return {
    label: fr(c.label),
    title: fr(c.title),
    lead: fr(c.lead),
    // Liste blanche côté onboarding (lot P7) : seul ce code est repris de l'URL.
    href: `/inscription?activite=${encodeURIComponent(activity)}`,
  };
}

/* ------------------------------------------------------------------ */
/* La page                                                              */
/* ------------------------------------------------------------------ */

export function metierPath(slug: string): string {
  return `/pour/${slug}`;
}

/**
 * La page d'un métier pour un jeu de capacités donné. `all` sert au
 * maillage : seuls les voisins PUBLIÉS deviennent des liens.
 */
export function renderable(
  metier: Metier,
  shipped: ReadonlySet<Capability>,
  all: readonly Metier[] = METIERS,
): MetierPage {
  const [activity] = metier.activities;
  const related = metier.related
    .map((slug) => all.find((m) => m.slug === slug && m.published && m.slug !== metier.slug))
    .filter((m): m is Metier => m !== undefined)
    .map((m) => ({ slug: m.slug, label: fr(m.nav.label), short: fr(m.nav.short), href: metierPath(m.slug) }));

  const storyContent = metier.story ? slot(metier.story, shipped) : null;

  return {
    slug: metier.slug,
    path: metierPath(metier.slug),
    activities: metier.activities,
    profile: ACTIVITY_PROFILE[activity],
    updatedAt: metier.updatedAt,
    nav: { label: fr(metier.nav.label), short: fr(metier.nav.short) },
    seo: {
      title: fr(metier.seo.title),
      description: fr(metier.seo.description),
      ogTitle: fr(metier.seo.ogTitle),
      ogKicker: fr(metier.seo.ogKicker),
    },
    hero: { label: fr(metier.hero.label), title: fr(metier.hero.title), lead: fr(metier.hero.lead) },
    story: storyContent ? story(storyContent, shipped) : null,
    problem: metier.problem.map(row),
    signature: signature(slot(metier.signature, shipped)),
    counter: list(slot(metier.counter, shipped).rows, shipped).map(counter),
    settings: list(slot(metier.settings, shipped).rows, shipped).map(setting),
    arguments: list(metier.arguments, shipped).map(row),
    faq: list(metier.faq, shipped).map(faq),
    cta: cta(slot(metier.cta, shipped), activity),
    sections: metier.sections,
    related,
  };
}

/**
 * Tous les textes visibles d'une page, dans l'ordre de lecture. Sert aux
 * contrôles d'honnêteté, d'unicité et de vocabulaire, et aux scripts de
 * vérification du site.
 */
export function pageTexts(page: MetierPage): string[] {
  const out: string[] = [
    page.nav.label,
    page.seo.title,
    page.seo.description,
    page.seo.ogTitle,
    page.seo.ogKicker,
    page.hero.label,
    page.hero.title,
    page.hero.lead,
  ];
  if (page.story) {
    const { scene: s, steps } = page.story;
    out.push(
      s.place, s.seuil, s.proKey,
      s.proLabels.current, s.proLabels.currentName, s.proLabels.next, s.proLabels.nextName,
      s.clientName,
      s.slotHints.self, s.slotHints.kept, s.slotHints.back, s.slotHints.turn, s.slotHints.ghost, s.slotHints.next,
    );
    for (const st of steps) out.push(st.kicker, st.title, st.body, st.benefit, st.state);
  }
  for (const r of page.problem) out.push(r.key, r.text);
  out.push(page.signature.title, page.signature.caption, page.signature.seuil);
  for (const lane of page.signature.lanes) out.push(lane.label, ...(lane.hint ? [lane.hint] : []));
  for (const r of page.counter) out.push(r.key, r.text);
  for (const s of page.settings) out.push(s.label, s.value, s.text);
  for (const r of page.arguments) out.push(r.key, r.text);
  for (const f of page.faq) out.push(f.q, f.a);
  out.push(page.cta.label, page.cta.title, page.cta.lead);
  for (const r of page.related) out.push(r.label);
  return out;
}

/* ------------------------------------------------------------------ */
/* Accès des pages (serveur)                                            */
/* ------------------------------------------------------------------ */

/**
 * La page publiée d'un slug, avec les capacités réellement livrées ;
 * `null` pour un slug inconnu ou non publié (la route répond 404).
 */
export function selectMetier(slug: string): MetierPage | null {
  const metier = getMetier(slug);
  if (!metier || !metier.published) return null;
  return renderable(metier, shippedCapabilities());
}

/** Les pages publiées, dans l'ordre du registre (index /pour, maillage). */
export function selectPublishedMetiers(): MetierPage[] {
  const shipped = shippedCapabilities();
  return METIERS.filter((m) => m.published).map((m) => renderable(m, shipped));
}
