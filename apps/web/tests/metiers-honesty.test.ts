import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CORE, shippedCapabilities } from '@/lib/metiers/capabilities';
import { METIERS, PROFILE_SETTING_LABEL, getMetier } from '@/lib/metiers/registry';
import { pageTexts, renderable, requirementList } from '@/lib/metiers/select';
import type { Capability, MetierPage } from '@/lib/metiers/types';
import { PROFILES } from '@/lib/profiles';
import {
  CAPABILITY_PROFILE,
  OPEN_PROFILES,
  PROFILE_CAPABILITIES,
  type ProfileCapability,
} from '@/lib/profiles/capabilities';
import { PARTY_MAX_LIMIT, REVIEW_DELAY_MAX, REVIEW_DELAY_MIN, defaultProfileOptions } from '@/lib/profiles/options';
import { WORKSHOP_STAGES } from '@/lib/profiles/stages';

/**
 * HONNÊTETÉ — une page métier ne promet que ce qu'un commerçant qui
 * s'inscrit AUJOURD'HUI trouvera dans le produit.
 *
 *  1. Aucune affirmation sans capacité livrée : ce qui dépend d'un profil
 *     pas encore ouvert n'apparaît pas, et la page reste complète.
 *  2. Aucune fausse note, aucun faux avis, aucun chiffre inventé.
 *  3. Pas d'App Clip tant qu'il n'est pas publié.
 */

const PROFILE_CAPS = Object.keys(CAPABILITY_PROFILE) as ProfileCapability[];
const NONE = new Set<Capability>(CORE);
const ALL = new Set<Capability>([...CORE, ...PROFILE_CAPS]);
const ALL_WITH_CLIP = new Set<Capability>([...ALL, 'channel.app_clip']);

const texts = (page: MetierPage): string[] => pageTexts(page);
const joined = (page: MetierPage): string => texts(page).join('\n');
/** Espaces insécables ramenées à des espaces : les motifs restent lisibles. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ');

/** Toutes les conditions écrites dans un bloc du registre, à toute profondeur. */
function requirementsIn(value: unknown, out: Capability[] = []): Capability[] {
  if (Array.isArray(value)) {
    for (const item of value) requirementsIn(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'requires') out.push(...requirementList(child as Capability | Capability[]));
      else requirementsIn(child, out);
    }
  }
  return out;
}

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved.clip = process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE;
  delete process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE;
});
afterEach(() => {
  if (saved.clip === undefined) delete process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE;
  else process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE = saved.clip;
});

/* ------------------------------------------------------------------ */
/* 1. Les capacités                                                     */
/* ------------------------------------------------------------------ */

describe('capacités livrées', () => {
  it('ce sont exactement CORE + PROFILE_CAPABILITIES (importé des profils), App Clip à part', () => {
    const shipped = shippedCapabilities();
    expect([...shipped].sort()).toEqual([...new Set<Capability>([...CORE, ...PROFILE_CAPABILITIES])].sort());
    expect(shipped.has('channel.app_clip')).toBe(false);
  });

  it('CORE ne contient que le produit d’aujourd’hui : ni profil, ni canal', () => {
    for (const capability of CORE) expect(capability).toMatch(/^(core|events)\./);
    expect(new Set(CORE).size).toBe(CORE.length);
  });

  it('chaque capacité de profil livrée appartient à un profil ouvert à tous', () => {
    for (const capability of PROFILE_CAPABILITIES) {
      expect(OPEN_PROFILES.has(CAPABILITY_PROFILE[capability]), capability).toBe(true);
    }
  });

  it('chaque condition du registre nomme une capacité connue', () => {
    const known = new Set<string>([...CORE, ...PROFILE_CAPS, 'channel.app_clip',
      // Connues du moteur mais pas encore en libre-service (voir CORE) :
      'core.multi_queue', 'core.capacity_cap', 'core.service_on_board']);
    for (const m of METIERS) {
      for (const capability of requirementsIn(m)) expect(known.has(capability), `${m.slug} : ${capability}`).toBe(true);
    }
  });

  it('une capacité qui n’a pas encore d’écran ne sort pas une ligne', () => {
    // Plusieurs files par établissement, plafond, prestation au poste :
    // le moteur les connaît, aucun écran ne les offre encore au commerçant.
    for (const capability of ['core.multi_queue', 'core.capacity_cap', 'core.service_on_board'] as const) {
      expect(CORE).not.toContain(capability);
    }
    for (const m of METIERS) {
      const page = joined(renderable(m, shippedCapabilities()));
      expect(page).not.toMatch(/deux files séparées|plafond/i);
      expect(page).not.toMatch(/prestation de chaque cliente s’affiche/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. Aucune affirmation sans capacité                                  */
/* ------------------------------------------------------------------ */

const TABLE_DEFAULTS = defaultProfileOptions('table');

/**
 * Pour chaque capacité de profil : sur quelle page, et à quels mots on
 * reconnaît sa promesse. Présents quand tout est livré, absents dès que
 * CETTE capacité manque.
 */
const MARKERS: Record<ProfileCapability, { slug: string; marks: readonly (string | RegExp)[] }> = {
  'profile.garage.dropoff': { slug: 'garages', marks: [PROFILES.vehicle.vocab.start ?? '', PROFILES.vehicle.vocab.openQueue] },
  'profile.garage.vehicle_ready': {
    slug: 'garages',
    marks: [PROFILES.vehicle.vocab.clientTurn, PROFILES.vehicle.vocab.call],
  },
  'profile.garage.quote': { slug: 'garages', marks: [/devis/i] },
  'profile.garage.key_tag': { slug: 'garages', marks: [/étiquette/i] },
  'profile.repair.dropoff': { slug: 'reparation-telephone', marks: [/dossier/i, PROFILES.device.vocab.start ?? ''] },
  'profile.repair.device_ready': {
    slug: 'reparation-telephone',
    marks: [PROFILES.device.vocab.clientTurn, PROFILES.device.vocab.call],
  },
  'profile.restaurant.party_size': { slug: 'restaurants', marks: [/couverts/i] },
  'profile.restaurant.table_ready': { slug: 'restaurants', marks: [PROFILES.table.vocab.call, PROFILES.table.vocab.complete] },
  'profile.restaurant.delayed_review': {
    slug: 'restaurants',
    marks: [`${String(TABLE_DEFAULTS.reviewDelayMinutes)} minutes`, /après le repas/i],
  },
  'profile.counter.desk_number': { slug: 'guichets-et-services', marks: [/Guichet \d/, PROFILES.desk.vocab.call] },
  'profile.counter.ticket_number': { slug: 'guichets-et-services', marks: [/\b[A-Z]{1,2}-\d{3}\b/] },
};

function has(text: string, mark: string | RegExp): boolean {
  return typeof mark === 'string' ? text.includes(plain(mark)) : mark.test(text);
}

describe('aucune affirmation sans capacité livrée', () => {
  it.each(PROFILE_CAPS)('%s : la promesse paraît quand elle est livrée, disparaît sinon', (capability) => {
    const { slug, marks } = MARKERS[capability];
    const metier = getMetier(slug);
    expect(metier).toBeDefined();
    if (!metier) return;
    const withIt = plain(joined(renderable(metier, ALL)));
    const without = new Set<Capability>([...ALL].filter((c) => c !== capability));
    const withoutIt = plain(joined(renderable(metier, without)));
    for (const mark of marks) {
      expect(has(withIt, mark), `${capability} : « ${String(mark)} » attendu une fois livrée`).toBe(true);
      expect(has(withoutIt, mark), `${capability} : « ${String(mark)} » promis sans être livré`).toBe(false);
    }
  });

  it('sans aucun profil ouvert, aucune page ne parle le vocabulaire d’un profil fermé', () => {
    // Touches, étapes et réglages propres aux profils à venir.
    const closed: string[] = [];
    for (const profile of [PROFILES.vehicle, PROFILES.device, PROFILES.table, PROFILES.desk, PROFILES.retail]) {
      const v = profile.vocab;
      for (const word of [v.complete, v.start, v.call, v.openQueue, v.clientTurn, v.todayCounter]) {
        if (word && word !== PROFILES.walkin.vocab.complete && word !== PROFILES.walkin.vocab.start) closed.push(word);
      }
    }
    // Un libellé d'un seul mot (« Diagnostic ») est aussi un mot de la
    // langue : seules les expressions propres au produit comptent.
    for (const stage of WORKSHOP_STAGES) closed.push(...[stage.client, stage.staff].filter((l) => l.includes(' ')));
    closed.push(...Object.values(PROFILE_SETTING_LABEL));
    for (const m of METIERS) {
      const page = joined(renderable(m, NONE));
      for (const word of closed) expect(page.includes(word), `${m.slug} : « ${word} »`).toBe(false);
      expect(plain(page), m.slug).not.toMatch(/devis|couverts|immatriculation|numéro de dossier|\b[A-Z]-\d{3}\b/i);
    }
  });

  it('sans profil ouvert, aucun réglage conseillé n’est une option de profil', () => {
    for (const m of METIERS) {
      for (const s of renderable(m, NONE).settings) {
        expect(s.ref.source, `${m.slug} · ${s.label}`).not.toBe('profile_options');
        expect(s.ref.source).not.toBe('staff');
        expect(s.ref.source === 'queues' && s.ref.column === 'ticket_prefix').toBe(false);
      }
    }
  });

  it('le titre, la description, le H1 et l’URL ne dépendent d’aucune capacité', () => {
    for (const m of METIERS) {
      const a = renderable(m, NONE);
      const b = renderable(m, ALL_WITH_CLIP);
      expect(b.seo).toEqual(a.seo);
      expect(b.hero.title).toBe(a.hero.title);
      expect(b.path).toBe(a.path);
    }
  });

  it('la page d’aujourd’hui est celle sans aucun profil : rien ne fuit par PROFILE_CAPABILITIES', () => {
    // Tant qu'aucun profil n'est ouvert (lot P9), la vitrine est celle du
    // produit d'aujourd'hui, au caractère près.
    if (PROFILE_CAPABILITIES.length > 0) return;
    for (const m of METIERS) {
      expect(renderable(m, shippedCapabilities())).toEqual(renderable(m, NONE));
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Rien d'inventé                                                    */
/* ------------------------------------------------------------------ */

/** Ce qu'une page métier n'écrit jamais : notes, avis inventés, statistiques, superlatifs. */
const FORBIDDEN: readonly RegExp[] = [
  /%/,
  /pour\s?cent/i,
  /\bnotes?\b/i,
  /\bnotée? (?:par|\d)/i,
  /étoiles?/i,
  /[★☆⭐]/u,
  /avis (?:clients|vérifiés|positifs)/i,
  /\d+\s*avis/i,
  /témoignage/i,
  /font confiance/i,
  /satisfaits?/i,
  /\bleader\b/i,
  /\bn°\s?1\b/i,
  /numéro un/i,
  /le meilleur|la meilleure|les meilleurs/i,
  /\ben moyenne\b/i,
  /fois plus/i,
  /\b\d+\s?x\b|\bx\s?\d+\b/i,
  /jusqu’à \d+ ?(?:fois|minutes? gagnées?|heures? gagnées?)/i,
  /\d[\d\s]*(?:clients|commerces|établissements|utilisateurs|professionnels|salons|garages|restaurants|entreprises)\b(?! avant)/i,
  /garanti/i,
  /conforme au RGAA\b(?! \?)/i,
];

/**
 * Les SEULS chiffres qu'une page peut écrire hors des réglages conseillés
 * (dont chaque valeur est vérifiée contre l'écran Réglages par
 * `metiers-registry`) : des réglages réels importés du code, et des
 * exemples d'écran (ticket, plaque masquée, guichet, vague, position).
 */
const IMPORTED_NUMBERS = new Set<number>([
  TABLE_DEFAULTS.partyMax ?? -1,
  TABLE_DEFAULTS.reviewDelayMinutes ?? -1,
  PARTY_MAX_LIMIT,
  REVIEW_DELAY_MIN,
  REVIEW_DELAY_MAX,
  ...(TABLE_DEFAULTS.tableSizes ?? []),
]);

const SCREEN_EXAMPLES: readonly RegExp[] = [
  /\b[A-Z]{1,2}-\d{3}\b/g, // ticket « A-042 »
  /[•A-Z0-9]{2}-[•A-Z0-9]{3}-[•A-Z0-9]{2}/g, // plaque masquée
  /\b(?:Guichet|Vague) \d\b/g,
  /^\d+ (?:personnes?|groupes?) (?:devant|avant) vous$/g, // état d'une latte
];

function strayNumbers(text: string): number[] {
  let rest = plain(text);
  for (const pattern of SCREEN_EXAMPLES) rest = rest.replace(pattern, ' ');
  return (rest.match(/\d+/g) ?? []).map(Number).filter((n) => !IMPORTED_NUMBERS.has(n));
}

const SETS = [
  ['aujourd’hui', NONE],
  ['tout livré', ALL],
  ['tout livré, App Clip publié', ALL_WITH_CLIP],
] as const;

describe('rien d’inventé', () => {
  it.each(SETS)('ni note, ni avis inventé, ni statistique, ni superlatif (%s)', (_label, shipped) => {
    for (const m of METIERS) {
      for (const text of texts(renderable(m, shipped))) {
        for (const pattern of FORBIDDEN) {
          expect(pattern.test(plain(text)), `${m.slug} : ${String(pattern)} dans « ${text} »`).toBe(false);
        }
      }
    }
  });

  it.each(SETS)('aucun chiffre hors des réglages réels et des exemples d’écran (%s)', (_label, shipped) => {
    for (const m of METIERS) {
      const page = renderable(m, shipped);
      // Les réglages sont vérifiés un par un contre le produit (metiers-registry).
      const settings = new Set(page.settings.flatMap((s) => [s.label, s.value, s.text]));
      for (const text of texts(page)) {
        if (settings.has(text)) continue;
        expect(strayNumbers(text), `${m.slug} : « ${text} »`).toEqual([]);
      }
    }
  });

  it('la problématique se raconte sans aucun chiffre', () => {
    for (const m of METIERS) {
      for (const row of m.problem) {
        expect(`${row.key} ${row.text}`, m.slug).not.toMatch(/\d/);
      }
    }
  });

  it('les commerces des scènes sont fictifs et ne portent aucune marque réelle', () => {
    const REAL = /\b(?:Planity|Treatwell|Doctolib|Qless|Waitwhile|TheFork|LaFourchette|Zenchef|Norauto|Speedy|Midas|Feu Vert|Point S|Fnac|Darty|Apple Store|Samsung|Orange|SFR|Bouygues|Free|CAF|Pôle emploi|France Travail|Ameli)\b/;
    for (const m of METIERS) {
      const page = renderable(m, ALL_WITH_CLIP);
      for (const text of texts(page)) expect(text, m.slug).not.toMatch(REAL);
    }
  });

  it('aucun temps d’attente promis : le produit n’en affiche pas', () => {
    for (const m of METIERS) {
      for (const text of texts(renderable(m, ALL_WITH_CLIP))) {
        expect(plain(text), m.slug).not.toMatch(/(?:attente|attendre|patienter) (?:de |d’)?(?:moins de |environ )?\d+ ?min/i);
        expect(plain(text), m.slug).not.toMatch(/temps d’attente estimé|heure de passage estimée/i);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4. L'App Clip                                                        */
/* ------------------------------------------------------------------ */

const APP_CLIP = /app\s*clip/i;

describe('App Clip', () => {
  it('non publié (NEXT_PUBLIC_APP_CLIP_PUBLIE absent) : aucune page ne le cite', () => {
    expect(shippedCapabilities().has('channel.app_clip')).toBe(false);
    for (const m of METIERS) {
      for (const shipped of [shippedCapabilities(), ALL]) {
        expect(joined(renderable(m, shipped)), m.slug).not.toMatch(APP_CLIP);
      }
    }
  });

  it.each(['0', 'true', 'oui', ' ', ''])('NEXT_PUBLIC_APP_CLIP_PUBLIE=%j ne suffit pas', (value) => {
    process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE = value;
    expect(shippedCapabilities().has('channel.app_clip')).toBe(false);
    for (const m of METIERS) expect(joined(renderable(m, shippedCapabilities())), m.slug).not.toMatch(APP_CLIP);
  });

  it('publié (=1) : les réponses prévues le citent, et elles seules', () => {
    process.env.NEXT_PUBLIC_APP_CLIP_PUBLIE = '1';
    const shipped = shippedCapabilities();
    expect(shipped.has('channel.app_clip')).toBe(true);
    const citing = METIERS.filter((m) => APP_CLIP.test(joined(renderable(m, shipped))));
    expect(citing.length).toBeGreaterThan(0);
    // Hors des blocs conditionnés, la mention ne peut pas apparaître.
    for (const m of METIERS) {
      const withoutClip = new Set<Capability>([...shipped].filter((c) => c !== 'channel.app_clip'));
      expect(joined(renderable(m, withoutClip)), m.slug).not.toMatch(APP_CLIP);
    }
  });
});
