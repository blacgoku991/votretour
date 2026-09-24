import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Story, seuilLabelTransform } from '@/components/home/story/Story';
import {
  HOME_STORY_COPY,
  buildHomeStoryCopy,
  cssString,
  storyCssVars,
  type StoryText,
} from '@/components/home/story/copy';
import { TURN_HINT, metierStoryCopy, reviewButton, splitTurn } from '@/components/metiers/story-copy';
import { profileOpenOnPages } from '@/components/metiers/model';
import { CORE } from '@/lib/metiers/capabilities';
import { METIERS } from '@/lib/metiers/registry';
import { renderable } from '@/lib/metiers/select';
import type { Capability, MetierPage } from '@/lib/metiers/types';
import { notificationCopy } from '@/lib/copy';
import { CAPABILITY_PROFILE, type ProfileCapability } from '@/lib/profiles/capabilities';

/**
 * LA SÉQUENCE PARAMÉTRÉE — `Story` reçoit ses mots en props.
 *
 *  1. L'accueil ne change pas d'un caractère : la copie par défaut est
 *     celle d'avant le paramétrage (textes littéraux ci-dessous, relevés
 *     dans l'ancien Story.tsx), aucune variable CSS n'est posée, et les
 *     valeurs de repli du CSS sont les textes de l'accueil.
 *  2. Chaque page métier a six étapes, une scène sans caractère qui casse
 *     une chaîne CSS, une notification qui est un VRAI texte du produit.
 *  3. Pas d'App Clip tant qu'il n'est pas publié ; pas d'avis Google là
 *     où le produit n'en demande pas par défaut.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (path: string) => readFileSync(`${SRC}${path}`, 'utf8');

const NBSP = ' ';
const PROFILE_CAPS = Object.keys(CAPABILITY_PROFILE) as ProfileCapability[];
const TODAY = new Set<Capability>(CORE);
const ALL = new Set<Capability>([...CORE, ...PROFILE_CAPS]);

const published = METIERS.filter((m) => m.published);
const pagesFor = (shipped: ReadonlySet<Capability>): MetierPage[] => published.map((m) => renderable(m, shipped));

/** Tous les textes d'une copie de séquence, pour les recherches. */
function copyTexts(copy: StoryText): string[] {
  return [
    copy.hero.label, copy.hero.title, copy.hero.lead, copy.hero.primary.label, copy.hero.secondary.label,
    ...copy.hero.micro, copy.hero.scrollHint, copy.place, copy.seuil, copy.proKey,
    copy.proLabels.current, copy.proLabels.currentName, copy.proLabels.next, copy.proLabels.nextName,
    copy.proTime, copy.clientName, ...Object.values(copy.slotHints), copy.notif.title, copy.notif.body,
    copy.turn.lead, copy.turn.main, copy.turn.line, copy.merci.title, copy.merci.button ?? '',
    ...copy.steps.flatMap((s) => [s.kicker, s.title, s.body, s.benefit, s.state]),
  ];
}

describe('accueil : la copie par défaut est celle d’avant', () => {
  it('héros, scène et panneau pro, mot pour mot', () => {
    expect(HOME_STORY_COPY.hero).toEqual({
      label: `File d’attente virtuelle${NBSP}· barbiers, garages, ongleries, réparateurs`,
      title: 'Vos clients n’attendent plus debout.',
      lead: 'Ils approchent leur téléphone de la plaque, prennent leur place dans la file et s’en vont. On les prévient quand c’est leur tour.',
      primary: { label: 'Ouvrir ma file', href: '/inscription' },
      secondary: { label: 'Voir la file avancer', href: '#comment' },
      micro: [`Sans compte client${NBSP}·`, `Sans application à installer${NBSP}·`, 'Sans SMS payant'],
      scrollHint: 'Faites défiler : la file avance avec vous.',
    });
    expect(HOME_STORY_COPY.place).toBe('Barber House');
    expect(HOME_STORY_COPY.seuil).toBe('Comptoir');
    expect(HOME_STORY_COPY.proKey).toBe('Terminer');
    expect(HOME_STORY_COPY.proTime).toBe('18 min');
    expect(HOME_STORY_COPY.clientName).toBe('Camille');
    expect(HOME_STORY_COPY.proLabels).toEqual({
      current: 'En cours · avec Karim',
      currentName: 'Léa',
      next: 'Suivant',
      nextName: 'Camille',
    });
    expect(HOME_STORY_COPY.notif).toEqual(notificationCopy('ahead_one', { locationName: 'Barber House' }));
    expect(HOME_STORY_COPY.turn).toEqual({ lead: 'C’est', main: 'votre tour', line: 'Présentez-vous au comptoir' });
    expect(HOME_STORY_COPY.merci).toEqual({ title: 'Merci pour votre visite', button: 'Laisser un avis Google' });
  });

  it('les six étapes, mot pour mot', () => {
    expect(HOME_STORY_COPY.steps).toEqual([
      {
        kicker: 'Il arrive',
        title: 'Un geste pour prendre sa place.',
        body: 'Il approche son téléphone de votre plaque NFC ou scanne le QR code. Sur iPhone, l’App Clip s’ouvre tout seul ; sur Android, le navigateur suffit. Rien à installer, aucun compte.',
        benefit: 'Inscrit en trois secondes, sans vous déranger.',
        state: '3 personnes devant vous',
      },
      {
        kicker: 'Il sort',
        title: 'Sa place reste. Lui, il part.',
        body: 'Café, course, coup de fil : il attend où il veut. Votre salon ne ressemble plus à une salle d’attente.',
        benefit: 'Plus personne ne repart en voyant la queue.',
        state: 'Place gardée · vous pouvez partir',
        outline: true,
      },
      {
        kicker: 'Il suit',
        title: 'Un seul chiffre. Aucune question au comptoir.',
        body: 'Son écran n’affiche qu’une chose : combien de personnes sont devant lui. Pas de numéro de ticket, pas d’heure promise qu’on ne tiendra pas.',
        benefit: 'Fini les « c’est encore long ? ».',
        state: '2 personnes devant vous',
      },
      {
        kicker: 'Il revient',
        title: 'Prévenu au bon moment.',
        body: '« Plus qu’une personne devant vous. Commencez à revenir. » La notification arrive toute seule, sur iPhone comme sur Android. Sans SMS payant.',
        benefit: 'Il revient pile quand il faut.',
        state: 'Plus qu’une personne devant vous',
      },
      {
        kicker: 'Vous',
        title: 'Vous appuyez sur Terminer. C’est tout.',
        body: 'Un seul geste entre deux clients : la file avance, chacun voit sa place bouger, le suivant est prévenu.',
        benefit: 'Un bouton. Même avec les mains prises.',
        state: 'C’est votre tour',
      },
      {
        kicker: 'Après',
        title: 'Et l’avis Google suit.',
        body: 'À la fin du passage, votre client voit « Merci pour votre visite » et un bouton qui ouvre directement votre fiche Google.',
        benefit: 'Plus d’avis, sans y penser.',
        state: 'Merci pour votre visite',
      },
    ]);
  });

  it('sans copie, Story ne pose aucune variable CSS ni cran de titre', () => {
    const html = renderToStaticMarkup(createElement(Story));
    expect(html).not.toContain('--story-');
    expect(html).not.toContain('data-length');
    expect(html).toContain('href="#apres-histoire"');
    expect(html).toContain('Vos clients n’attendent plus debout.');
    // Un seul H1, celui du héros.
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it('la copie de l’accueil reconstruite et passée explicitement rend le même DOM', () => {
    // L'accueil passera `buildHomeStoryCopy({ appClip })` : un NOUVEL objet.
    // Le mode « métier » dépend du drapeau `kind`, pas de l'identité de
    // l'objet : aucune variable CSS, aucun titre réduit, DOM identique.
    const byDefault = renderToStaticMarkup(createElement(Story));
    const explicit = renderToStaticMarkup(createElement(Story, { copy: buildHomeStoryCopy({ appClip: true }) }));
    expect(explicit).toBe(byDefault);
    const withoutClip = renderToStaticMarkup(createElement(Story, { copy: buildHomeStoryCopy({ appClip: false }) }));
    expect(withoutClip).not.toContain('--story-');
    expect(withoutClip).not.toContain('data-length');
    // Seul le texte de l'étape 1 diffère.
    const body = (copy: StoryText) => copy.steps[0].body;
    expect(withoutClip.replace(body(buildHomeStoryCopy({ appClip: false })), '')).toBe(
      byDefault.replace(body(HOME_STORY_COPY), ''),
    );
  });

  it('une page métier, elle, pose ses variables', () => {
    const page = pagesFor(TODAY).find((p) => p.story)!;
    const copy = metierStoryCopy(page, { enriched: false })!;
    expect(copy.kind).toBe('metier');
    expect(renderToStaticMarkup(createElement(Story, { copy }))).toContain('--story-');
  });

  it('les replis du CSS sont les textes de l’accueil', () => {
    const css = read('components/home/story/Story.module.css');
    const fallbacks = Object.fromEntries(
      [...css.matchAll(/var\((--story-[a-z-]+), '([^']*)'\)/g)].map((m) => [m[1]!, m[2]!]),
    );
    const vars = storyCssVars(HOME_STORY_COPY);
    expect(Object.keys(fallbacks).sort()).toEqual(Object.keys(vars).sort());
    for (const [name, value] of Object.entries(vars)) {
      expect(JSON.parse(value), name).toBe(fallbacks[name]);
    }
  });

  it('App Clip : la variante « non publiée » dit le vrai, sans le citer', () => {
    const without = buildHomeStoryCopy({ appClip: false });
    expect(copyTexts(without).join('\n')).not.toMatch(/App\s*Clip/i);
    expect(without.steps[0].body).toContain('navigateur');
    // Seule l'étape 1 change.
    expect({ ...without, steps: without.steps.slice(1) }).toEqual({
      ...HOME_STORY_COPY,
      steps: HOME_STORY_COPY.steps.slice(1),
    });
  });
});

describe('pages métier : la séquence de chaque métier', () => {
  for (const [label, shipped] of [['aujourd’hui', TODAY], ['profils ouverts', ALL]] as const) {
    describe(label, () => {
      for (const page of pagesFor(shipped)) {
        const open = profileOpenOnPages(page.profile, shipped);
        const copy = metierStoryCopy(page, { enriched: open });

        it(`${page.slug} : six étapes et une scène cohérente`, () => {
          if (!page.story) {
            // Les événements n'ont pas de séquence (héros statique).
            expect(copy).toBeNull();
            return;
          }
          expect(copy).not.toBeNull();
          const c = copy!;
          expect(c.steps).toHaveLength(6);
          expect(c.hero.title).toBe(page.hero.title);
          expect(c.hero.primary.href).toBe(page.cta.href);
          expect(c.hero.primary.href).toMatch(/^\/inscription\?activite=[a-z_]+$/);
          expect(c.seuil).toBe(page.story.scene.seuil);
          expect(c.turn.main.length).toBeGreaterThan(0);
          // Le rideau reprend l'état de l'étape 5, coupé en deux lignes (le « · » tombe à la coupe).
          const words = (t: string) => t.replace(/·/g, ' ').trim().split(/\s+/);
          expect(words(`${c.turn.lead} ${c.turn.main}`)).toEqual(words(page.story.steps[4].state));
          expect(c.merci.title).toBe(page.story.steps[5].state);
          // Toujours un texte réel : ni vide, ni « undefined ».
          for (const text of copyTexts(c)) expect(text).not.toMatch(/undefined|null|\[object/);
        });

        it(`${page.slug} : variables CSS sûres`, () => {
          if (!copy) return;
          for (const [name, value] of Object.entries(storyCssVars(copy))) {
            // Une chaîne CSS entre guillemets doubles, sans fin de ligne ni
            // barre oblique inverse orpheline, ni point-virgule qui fermerait la déclaration.
            expect(value, name).toMatch(/^"(?:[^"\\\n\r;]|\\.)*"$/);
          }
        });

        it(`${page.slug} : pas d’App Clip tant qu’il n’est pas publié`, () => {
          if (!copy) return;
          expect(copyTexts(copy).join('\n')).not.toMatch(/App\s*Clip/i);
        });
      }
    });
  }

  it('au comptoir d’aujourd’hui, le rideau dit la phrase exacte de l’écran du client', () => {
    // La phrase est relue DANS l'élément de l'écran client, pas n'importe où dans le fichier.
    const curtain = read('app/e/[slug]/TurnCurtain.tsx');
    // Texte en dur, ou défaut d'une consigne passée en props (« {subtitle ?? '…'} »).
    const m = /className=\{styles\.turnHint\}>(?:\{\s*\w+\s*\?\?\s*'([^']+)'\s*\}|([^<{]+))</.exec(curtain);
    const hint = (m?.[1] ?? m?.[2])?.trim();
    expect(hint).toBe(TURN_HINT);
    expect(HOME_STORY_COPY.turn.line).toBe(TURN_HINT);
    for (const page of pagesFor(TODAY)) {
      const copy = metierStoryCopy(page, { enriched: profileOpenOnPages(page.profile, TODAY) });
      if (copy) expect(copy.turn.line, page.slug).toBe(TURN_HINT);
    }
  });
});

describe('avis Google en fin de scène', () => {
  const today = new Map(pagesFor(TODAY).map((p) => [p.slug, p]));

  it('proposé quand la scène finit sur la fin de visite', () => {
    for (const slug of ['barbiers', 'salons-de-coiffure', 'garages', 'reparation-telephone']) {
      expect(reviewButton(today.get(slug)!), slug).toBe('Laisser un avis Google');
    }
  });

  it('jamais sur une liste en pause (restaurants)', () => {
    const page = today.get('restaurants')!;
    expect(page.story?.steps[5].state).not.toBe('Merci pour votre visite');
    expect(reviewButton(page)).toBeNull();
  });

  it('jamais pour une activité sans demande d’avis par défaut (services administratifs, santé)', () => {
    expect(reviewButton(today.get('guichets-et-services')!)).toBeNull();
    const barbiers = today.get('barbiers')!;
    expect(reviewButton({ ...barbiers, activities: ['health'] })).toBeNull();
  });

  it('sans bouton, la scène n’en dessine pas', () => {
    const copy = metierStoryCopy(today.get('restaurants')!, { enriched: false })!;
    expect(copy.merci.button).toBeNull();
    const html = renderToStaticMarkup(createElement(Story, { copy }));
    expect(html).not.toContain('Laisser un avis Google');
  });
});

describe('outils', () => {
  it('splitTurn coupe le rideau en deux lignes lisibles', () => {
    expect(splitTurn('C’est votre tour')).toEqual({ lead: 'C’est', main: 'votre tour' });
    expect(splitTurn('Vous êtes le prochain')).toEqual({ lead: 'Vous êtes', main: 'le prochain' });
    expect(splitTurn(`Votre véhicule est${NBSP}prêt`)).toEqual({ lead: 'Votre véhicule', main: `est${NBSP}prêt` });
    expect(splitTurn('A-042 · Guichet 3')).toEqual({ lead: 'A-042', main: 'Guichet 3' });
    expect(splitTurn('Prêt')).toEqual({ lead: '', main: 'Prêt' });
  });

  it('le libellé du seuil ne s’écrase pas quand la caméra se relève', () => {
    // Inclinaisons de la séquence (52° téléphone, 56-58° ordinateur) : rendu d'origine.
    for (const tilt of [52, 56, 58]) expect(seuilLabelTransform(tilt)).toBe('');
    // Rideau (34°) : rallongé pour garder la hauteur apparente de la séquence.
    const k = Number(/scaleY\(([\d.]+)\)/.exec(seuilLabelTransform(34))?.[1]);
    expect(k * Math.sin((34 * Math.PI) / 180)).toBeCloseTo(Math.sin((52 * Math.PI) / 180), 2);
    // Borné, et sûr pour une valeur absurde.
    expect(seuilLabelTransform(1)).toBe('scaleY(1.600)');
    expect(seuilLabelTransform(Number.NaN)).toBe('scaleY(1.600)');
  });

  it('cssString produit une chaîne CSS valide, même avec des caractères hostiles', () => {
    expect(cssString('Place gardée')).toBe('"Place gardée"');
    expect(cssString('a"b')).toBe('"a\\"b"');
    expect(cssString('ligne\nsuivante\\fin')).toBe('"ligne suivante fin"');
  });
});
