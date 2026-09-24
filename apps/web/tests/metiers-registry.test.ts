import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CORE } from '@/lib/metiers/capabilities';
import { METIERS, getMetier, publishedMetiers } from '@/lib/metiers/registry';
import { fr, metierPath, renderable, selectMetier, selectPublishedMetiers } from '@/lib/metiers/select';
import type { Capability, MetierPage, SectionId, SettingContent } from '@/lib/metiers/types';
import { ACTIVITY_PROFILE, isActivityType } from '@/lib/profiles';
import { CAPABILITY_PROFILE, type ProfileCapability } from '@/lib/profiles/capabilities';
import { profileOptionsSchema } from '@/lib/profiles/options';
import { TICKET_PREFIX_RE } from '@/lib/profiles/ticket';
import { buildSitemap } from '@/lib/seo/crawl';

/**
 * FORME DU REGISTRE — ce que le gabarit (lot S3), le sitemap et
 * l'onboarding supposent sans le revérifier : des slugs sûrs, six étapes,
 * des voisins qui existent, et des réglages conseillés qui sont de VRAIS
 * réglages, avec des valeurs que l'écran Réglages propose vraiment.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (path: string) => readFileSync(`${SRC}${path}`, 'utf8');
const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

const TODAY = new Set<Capability>(CORE);
const ALL = new Set<Capability>([
  ...CORE,
  ...(Object.keys(CAPABILITY_PROFILE) as ProfileCapability[]),
  'channel.app_clip',
]);
/** Les deux extrêmes : ce qu'on publie aujourd'hui, et tout ouvert. */
const SETS = [
  ['aujourd’hui', TODAY],
  ['tout livré', ALL],
] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTIONS: readonly SectionId[] = [
  'story', 'problem', 'signature', 'counter', 'video', 'settings', 'arguments', 'plans', 'faq', 'cta', 'related',
];

describe('slugs et publication', () => {
  it('chaque slug est un segment d’URL sûr, unique, sans accent', () => {
    const slugs = METIERS.map((m) => m.slug);
    for (const slug of slugs) expect(slug).toMatch(SLUG);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('publie les sept pages de la phase 1, et seulement elles', () => {
    expect(publishedMetiers().map((m) => m.slug)).toEqual([
      'barbiers',
      'salons-de-coiffure',
      'garages',
      'reparation-telephone',
      'restaurants',
      'guichets-et-services',
      'evenements-et-drops',
    ]);
    // Rédigée et testée, mais pas de page `retail` en phase 1 (plan § 1).
    expect(getMetier('boutiques')?.published).toBe(false);
  });

  it('getMetier et selectMetier : un slug inconnu ou non publié ne donne rien', () => {
    expect(getMetier('garages')?.slug).toBe('garages');
    expect(getMetier('inconnu')).toBeUndefined();
    expect(selectMetier('inconnu')).toBeNull();
    expect(selectMetier('boutiques')).toBeNull();
    expect(selectMetier('../garages')).toBeNull();
    const page = selectMetier('garages');
    expect(page?.path).toBe('/pour/garages');
    expect(metierPath('garages')).toBe('/pour/garages');
  });

  it('publishedMetiers ne rend que { slug, updatedAt } : aucune condition, aucun repli à afficher par erreur', () => {
    for (const entry of publishedMetiers()) {
      expect(Object.keys(entry).sort()).toEqual(['slug', 'updatedAt']);
      expect(entry.updatedAt).toBe(getMetier(entry.slug)?.updatedAt);
    }
  });

  it('selectPublishedMetiers suit publishedMetiers, dans le même ordre', () => {
    expect(selectPublishedMetiers().map((p) => p.slug)).toEqual(publishedMetiers().map((m) => m.slug));
  });

  it('nourrit le sitemap tel quel : une URL /pour/<slug> par page publiée, datée', () => {
    const map = buildSitemap({
      siteUrl: 'https://rangvia.test',
      indexable: true,
      legalNotice: false,
      metiers: publishedMetiers(),
    });
    for (const m of publishedMetiers()) {
      expect(map).toContainEqual({ url: `https://rangvia.test/pour/${m.slug}`, lastModified: m.updatedAt });
    }
    expect(map.some((entry) => entry.url.endsWith('/pour/boutiques'))).toBe(false);
  });

  it('updatedAt est une vraie date AAAA-MM-JJ, jamais dans le futur', () => {
    for (const m of METIERS) {
      expect(m.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const at = Date.parse(`${m.updatedAt}T00:00:00Z`);
      expect(new Date(at).toISOString().slice(0, 10)).toBe(m.updatedAt);
      expect(at).toBeLessThanOrEqual(Date.now());
    }
  });
});

describe('activités', () => {
  it('chaque code existe, et une activité n’a qu’une page', () => {
    const seen = new Map<string, string>();
    for (const m of METIERS) {
      for (const activity of m.activities) {
        expect(isActivityType(activity), `${m.slug} : ${activity}`).toBe(true);
        expect(seen.get(activity), `${activity} déjà couverte`).toBeUndefined();
        seen.set(activity, m.slug);
      }
    }
  });

  it('pas de page santé ; la page guichets couvre comptoirs et services administratifs, pas les boutiques', () => {
    expect(METIERS.flatMap((m) => m.activities)).not.toContain('health');
    expect(getMetier('guichets-et-services')?.activities).toEqual(['counter', 'admin_service']);
  });

  it('les activités d’une page partagent un même profil, celui de la page', () => {
    for (const m of METIERS) {
      const profiles = new Set(m.activities.map((a) => ACTIVITY_PROFILE[a]));
      expect(profiles.size, m.slug).toBe(1);
      expect(renderable(m, TODAY).profile).toBe(ACTIVITY_PROFILE[m.activities[0]]);
    }
  });

  it('l’appel final mène à l’inscription avec la première activité', () => {
    for (const m of METIERS) {
      expect(renderable(m, TODAY).cta.href).toBe(`/inscription?activite=${m.activities[0]}`);
    }
  });
});

describe('sections et maillage', () => {
  it('sections connues, sans doublon, avec l’essentiel', () => {
    for (const m of METIERS) {
      expect(new Set(m.sections).size, m.slug).toBe(m.sections.length);
      for (const id of m.sections) expect(SECTIONS).toContain(id);
      for (const id of ['problem', 'signature', 'counter', 'settings', 'plans', 'faq', 'cta'] as const) {
        expect(m.sections, `${m.slug} : ${id}`).toContain(id);
      }
      // La séquence 3D n'est annoncée que si le métier en a une.
      expect(m.sections.includes('story'), m.slug).toBe(m.story !== null);
    }
  });

  it('les voisins existent, ne sont pas la page elle-même et ne se répètent pas', () => {
    const slugs = new Set(METIERS.map((m) => m.slug));
    for (const m of METIERS) {
      expect(new Set(m.related).size).toBe(m.related.length);
      for (const slug of m.related) {
        expect(slugs.has(slug), `${m.slug} → ${slug}`).toBe(true);
        expect(slug).not.toBe(m.slug);
      }
    }
  });

  it('une page publiée a au moins un voisin publié, et ne lie jamais une page non publiée', () => {
    for (const m of METIERS.filter((metier) => metier.published)) {
      const page = renderable(m, TODAY);
      expect(page.related.length, m.slug).toBeGreaterThan(0);
      for (const link of page.related) {
        expect(getMetier(link.slug)?.published).toBe(true);
        expect(link.href).toBe(`/pour/${link.slug}`);
      }
    }
  });
});

describe('contenu rendu', () => {
  it.each(SETS)('six étapes, trois scènes, des listes non vides (%s)', (_label, shipped) => {
    for (const m of METIERS) {
      const page = renderable(m, shipped);
      if (m.story) expect(page.story?.steps).toHaveLength(6);
      else expect(page.story).toBeNull();
      expect(page.problem, m.slug).toHaveLength(3);
      expect(page.counter.length, m.slug).toBeGreaterThanOrEqual(3);
      expect(page.settings.length, m.slug).toBeGreaterThanOrEqual(2);
      expect(page.arguments.length, m.slug).toBeGreaterThanOrEqual(3);
      expect(page.faq.length, m.slug).toBeGreaterThanOrEqual(4);
      expect(page.signature.lanes.length, m.slug).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(SETS)('la page rendue ne transporte plus aucune condition (%s)', (_label, shipped) => {
    for (const m of METIERS) {
      const json = JSON.stringify(renderable(m, shipped));
      expect(json).not.toContain('"requires"');
      expect(json).not.toContain('"fallback"');
    }
  });

  it.each(SETS)('les textes de la scène tiennent dans une variable CSS (%s)', (_label, shipped) => {
    for (const m of METIERS) {
      const scene = renderable(m, shipped).story?.scene;
      if (!scene) continue;
      const texts = [
        scene.place, scene.seuil, scene.proKey, scene.clientName,
        ...Object.values(scene.proLabels), ...Object.values(scene.slotHints),
      ];
      for (const text of texts) {
        expect(text.trim(), m.slug).not.toBe('');
        // `content: var(--story-…)` : ni échappement, ni fin de déclaration, ni guillemet droit.
        expect(text, `${m.slug} : ${text}`).not.toMatch(/[\\\n\r;"'{}<>]/);
        expect(text.length, `${m.slug} : ${text}`).toBeLessThanOrEqual(32);
      }
    }
  });

  it('la typographie est idempotente : repasser fr() ne change rien', () => {
    for (const m of METIERS) {
      for (const shipped of [TODAY, ALL]) {
        const page: MetierPage = renderable(m, shipped);
        for (const f of page.faq) {
          expect(fr(f.q)).toBe(f.q);
          expect(fr(f.a)).toBe(f.a);
        }
        expect(fr(page.hero.title)).toBe(page.hero.title);
      }
    }
  });

  it('fr() pose les espaces insécables et les apostrophes courbes', () => {
    expect(fr('C\'est "prêt" : 2 personnes ?')).toBe('C’est «\u00a0prêt\u00a0»\u00a0: 2\u00a0personnes\u202f?');
    expect(fr('« A-042 »')).toBe('«\u00a0A-042\u00a0»');
    expect(fr('14:32')).toBe('14:32');
  });
});

/* ------------------------------------------------------------------ */
/* Réglages conseillés : de vrais réglages, de vraies valeurs          */
/* ------------------------------------------------------------------ */

const settingsSource = read('app/app/[org]/reglages/SettingsManager.tsx');
const thresholdSource = read('app/app/[org]/reglages/ThresholdRang.tsx');
const eventsSql = readFileSync(`${MIGRATIONS}20260101000015_events.sql`, 'utf8');

/** Choix proposés par l'écran Réglages, relus dans sa source (si l'écran change, ce test le voit). */
function choices(literal: string): number[] {
  expect(settingsSource, `choix introuvables : ${literal}`).toContain(literal);
  return JSON.parse(literal) as number[];
}

const TTL = choices('[60, 120, 180, 240, 360, 480, 720]');
const RETENTION = choices('[7, 14, 30, 60, 90, 180, 365]');
const MOVE_BACK = choices('[1, 2, 3, 4, 5, 8, 10]');

function thresholdRange(): number[] {
  const m = /const POSITIONS = \[([\d,\s]+)\]/.exec(thresholdSource);
  expect(m).not.toBeNull();
  return (m?.[1] ?? '').split(',').map((n) => Number(n.trim()));
}

function eventRange(column: string): [number, number] {
  const m = new RegExp(`${column}[^\\n]*check \\(${column} between (\\d+) and (\\d+)\\)`).exec(eventsSql);
  expect(m, column).not.toBeNull();
  return [Number(m?.[1]), Number(m?.[2])];
}

function assertSetting(slug: string, profile: string, s: SettingContent): void {
  const { ref } = s;
  const where = `${slug} · ${s.label}`;
  expect(s.value.trim(), where).not.toBe('');
  expect(s.text.trim(), where).not.toBe('');
  switch (ref.source) {
    case 'queues': {
      const v = ref.value;
      switch (ref.column) {
        case 'mode':
          expect(['shared', 'per_staff'], where).toContain(v);
          expect(settingsSource).toContain(`<option value="${String(v)}">`);
          break;
        case 'advance_mode':
          expect(['auto_serve', 'call_next'], where).toContain(v);
          expect(settingsSource).toContain(`<option value="${String(v)}">`);
          break;
        case 'absent_policy':
          expect(['move_back', 'hold', 'remove'], where).toContain(v);
          expect(settingsSource).toContain(`<option value="${String(v)}">`);
          break;
        case 'notify_ahead_threshold':
          expect(thresholdRange(), where).toContain(v);
          expect(s.value, where).toContain(String(v));
          break;
        case 'entry_ttl_minutes':
          expect(TTL, where).toContain(v);
          expect(s.value, where).toBe(fr(`${Number(v) / 60} h`));
          break;
        case 'absent_move_back_by':
          expect(MOVE_BACK, where).toContain(v);
          break;
        case 'ticket_prefix':
          expect(String(v), where).toMatch(TICKET_PREFIX_RE);
          break;
        default:
          // Interrupteurs : ask_client_name, client_name_required, allow_*.
          expect(typeof v, where).toBe('boolean');
      }
      break;
    }
    case 'organization_settings':
      if (ref.column === 'data_retention_days') {
        expect(RETENTION, where).toContain(ref.value);
        expect(s.value, where).toBe(fr(`${String(ref.value)} jours`));
      } else {
        expect(typeof ref.value, where).toBe('boolean');
      }
      break;
    case 'event_campaigns': {
      const [min, max] = eventRange(ref.column);
      expect(ref.value as number, where).toBeGreaterThanOrEqual(min);
      expect(ref.value as number, where).toBeLessThanOrEqual(max);
      // La plage citée dans le texte est celle de la base.
      expect(s.text, where).toContain(fr(`De ${min} à ${max}`));
      break;
    }
    case 'staff':
      expect(String(ref.value).trim().length, where).toBeGreaterThanOrEqual(1);
      expect(String(ref.value).trim().length, where).toBeLessThanOrEqual(24);
      break;
    case 'locations':
      break;
    case 'profile_options': {
      // Une clé de CE profil, avec une valeur que le schéma strict accepte.
      expect(ref.profile, where).toBe(profile);
      const parsed = profileOptionsSchema(ref.profile).safeParse({ [ref.key]: ref.value });
      expect(parsed.success, `${where} : ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      break;
    }
  }
}

describe('réglages conseillés', () => {
  it.each(SETS)('chaque réglage cité existe, avec une valeur que l’écran ou le schéma accepte (%s)', (_label, shipped) => {
    for (const m of METIERS) {
      const page = renderable(m, shipped);
      for (const s of page.settings) assertSetting(m.slug, page.profile, s);
    }
  });

  it('les réglages de profil conseillés citent les vraies clés de profile_options', () => {
    const keys = new Set<string>();
    for (const m of METIERS) {
      for (const s of renderable(m, ALL).settings) {
        if (s.ref.source === 'profile_options') keys.add(s.ref.key);
        if (s.ref.source === 'queues' && s.ref.column === 'ticket_prefix') keys.add('ticket_prefix');
        if (s.ref.source === 'staff') keys.add(s.ref.column);
      }
    }
    for (const key of ['partyMax', 'tableSizes', 'reviewDelayMinutes', 'numbering', 'ticket_prefix', 'desk_label']) {
      expect(keys, key).toContain(key);
    }
  });

  it('un même réglage n’est pas conseillé deux fois sur une page', () => {
    for (const m of METIERS) {
      for (const shipped of [TODAY, ALL]) {
        const refs = renderable(m, shipped).settings.map((s) => {
          const r = s.ref;
          return r.source === 'profile_options' ? `${r.source}.${r.key}` : `${r.source}.${r.column}`;
        });
        expect(new Set(refs).size, m.slug).toBe(refs.length);
      }
    }
  });
});
