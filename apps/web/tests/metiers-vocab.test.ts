import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLIENT_STATUS_LABEL, QUEUE_STATUS_LABEL, STAFF_STATUS_LABEL, notificationCopy } from '@/lib/copy';
import { CORE } from '@/lib/metiers/capabilities';
import { METIERS, PRODUCT_TEXT, SPOKEN } from '@/lib/metiers/registry';
import { pageTexts, renderable } from '@/lib/metiers/select';
import type { Capability, MetierPage } from '@/lib/metiers/types';
import { PROFILES } from '@/lib/profiles';
import { CAPABILITY_PROFILE, type ProfileCapability } from '@/lib/profiles/capabilities';
import { profileNotificationCopy } from '@/lib/profiles/copy';
import { formatTicketNo } from '@/lib/profiles/ticket';
import { QUEUE_PROFILES, type ProfileDefinition, type QueueProfile } from '@/lib/profiles/types';
import { BASE_NOTIFICATION_KINDS } from '@/lib/profiles/types';

/**
 * VOCABULAIRE (plan § 0.8) — les mots des pages sont ceux du produit.
 *
 * Une page qui écrit « Véhicule prêt » alors que la touche du poste dit
 * « Prêt · prévenir » ment un peu : le garagiste cherchera un bouton qui
 * n'existe pas. Chaque touche, chaque état, chaque texte cité entre
 * guillemets vient donc du vocabulaire des profils (`lib/profiles`) ou du
 * produit d'aujourd'hui (`PRODUCT_TEXT`, relu dans les fichiers qui
 * l'affichent), et il y est IMPORTÉ, jamais recopié.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (path: string) => readFileSync(`${SRC}${path}`, 'utf8');
/** Le code du registre, sans ses commentaires (qui citent les touches pour les expliquer). */
const REGISTRY = read('lib/metiers/registry.ts')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

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

/** Comparaison insensible aux espaces insécables posées au rendu. */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ').trim();

/** Les touches d'un profil : ce que le pro lit sur ses boutons. */
function touches(profile: ProfileDefinition): string[] {
  const v = profile.vocab;
  return [
    v.complete, v.start, v.call, v.openQueue,
    ...profile.stages.map((s) => s.staff),
  ].filter((t): t is string => typeof t === 'string').map(plain);
}

const PRODUCT = Object.values(PRODUCT_TEXT).map((entry) => plain(entry.text));

/** Tout texte que le produit affiche et qu'une page peut citer entre guillemets. */
function productStrings(): Set<string> {
  const out = new Set<string>(PRODUCT);
  for (const profile of Object.values(PROFILES)) {
    for (const value of Object.values(profile.vocab)) if (typeof value === 'string') out.add(plain(value));
    for (const stage of profile.stages) out.add(plain(stage.short)).add(plain(stage.client)).add(plain(stage.staff));
  }
  for (const label of [
    ...Object.values(CLIENT_STATUS_LABEL),
    ...Object.values(STAFF_STATUS_LABEL),
    ...Object.values(QUEUE_STATUS_LABEL),
  ]) {
    out.add(plain(label));
  }
  // Textes de notification, tels qu'ils partent (lieu vide : jamais cité).
  for (const kind of BASE_NOTIFICATION_KINDS) {
    const copy = notificationCopy(kind, { locationName: '' });
    out.add(plain(copy.title)).add(plain(copy.body));
  }
  for (const profile of QUEUE_PROFILES) {
    for (const kind of BASE_NOTIFICATION_KINDS) {
      try {
        const copy = profileNotificationCopy(kind, { profile, locationName: '' });
        out.add(plain(copy.title)).add(plain(copy.body));
        // Au guichet, le texte porte le numéro et le guichet : l'exemple
        // d'écran du registre (ticket 42, guichet 3).
        const desk = profileNotificationCopy(kind, {
          profile,
          locationName: '',
          ticketNo: formatTicketNo(profile, 42),
          deskLabel: 'Guichet 3',
        });
        out.add(plain(desk.title)).add(plain(desk.body));
      } catch {
        // Un genre sans texte pour ce profil : rien à citer.
      }
    }
  }
  return out;
}

const KNOWN = productStrings();
const SPOKEN_PLAIN = new Set<string>(SPOKEN.map(plain));

/** Les passages entre guillemets français d'un texte. */
function quotations(text: string): string[] {
  return [...text.matchAll(/«([^»]*)»/g)].map((m) => plain(m[1] ?? ''));
}

const PROFILE_OF = (page: MetierPage): QueueProfile => page.profile;

describe('les libellés du produit d’aujourd’hui existent encore, mot pour mot', () => {
  it.each(Object.entries(PRODUCT_TEXT))('%s', (_key, { text, file }) => {
    expect(read(file), `${file} n’affiche plus « ${text} »`).toContain(text);
  });
});

describe('les touches citées sont les touches du produit', () => {
  it.each(SETS)('côté comptoir (%s)', (_label, shipped) => {
    for (const m of METIERS) {
      const page = renderable(m, shipped);
      // Le profil du métier s'il est ouvert, le passage au fauteuil
      // (le poste d'aujourd'hui) sinon, et les libellés relus du produit.
      const allowed = new Set<string>([
        ...touches(PROFILES[PROFILE_OF(page)]),
        ...touches(PROFILES.walkin),
        ...PRODUCT,
      ]);
      for (const row of page.counter) {
        expect(allowed.has(plain(row.key)), `${m.slug} : touche « ${row.key} » inconnue du produit`).toBe(true);
      }
      if (page.story) {
        expect(allowed.has(plain(page.story.scene.proKey)), `${m.slug} : « ${page.story.scene.proKey} »`).toBe(true);
      }
    }
  });

  it('une page enrichie parle la langue de SON profil, pas celle des barbiers', () => {
    const expected: Partial<Record<QueueProfile, string>> = {
      vehicle: PROFILES.vehicle.vocab.call,
      device: PROFILES.device.vocab.call,
      table: PROFILES.table.vocab.call,
      desk: PROFILES.desk.vocab.call,
    };
    for (const m of METIERS) {
      const page = renderable(m, ALL);
      const key = expected[page.profile];
      if (!key) continue;
      expect(page.story?.scene.proKey, m.slug).toBe(key);
      expect(page.counter.map((r) => r.key), m.slug).toContain(key);
    }
  });

  it('aujourd’hui, chaque page parle la langue du poste d’aujourd’hui', () => {
    const today = new Set<string>([...touches(PROFILES.walkin), ...PRODUCT]);
    for (const m of METIERS) {
      const page = renderable(m, TODAY);
      for (const row of page.counter) expect(today.has(plain(row.key)), `${m.slug} : « ${row.key} »`).toBe(true);
    }
  });
});

describe('ce qui est cité entre guillemets existe dans le produit', () => {
  it.each(SETS)('chaque citation est un texte du produit ou une parole de client (%s)', (_label, shipped) => {
    for (const m of METIERS) {
      for (const text of pageTexts(renderable(m, shipped))) {
        for (const quoted of quotations(text)) {
          // Une parole de client commence par une minuscule ; un libellé, jamais.
          const spoken = /^\p{Ll}/u.test(quoted);
          const known = spoken ? SPOKEN_PLAIN.has(quoted) : KNOWN.has(quoted);
          expect(known, `${m.slug} : « ${quoted} » n’existe pas dans le produit`).toBe(true);
        }
      }
    }
  });

  it.each(SETS)('les états montrés dans la séquence sont des textes d’écran (%s)', (_label, shipped) => {
    // États de latte (« 3 personnes devant vous ») : produits par les
    // fonctions du produit, ou un de ses libellés.
    const positions = /^\d+ (?:personnes?|groupes?) (?:devant|avant) vous$|^Vous êtes les prochains$|^Ticket [A-Z]{1,2}-\d{3}$/;
    for (const m of METIERS) {
      for (const step of renderable(m, shipped).story?.steps ?? []) {
        const state = plain(step.state);
        expect(KNOWN.has(state) || positions.test(state), `${m.slug} : état « ${step.state} »`).toBe(true);
      }
    }
  });
});

describe('importé, jamais recopié', () => {
  it('le registre n’écrit en dur aucune touche ni aucun état des profils', () => {
    // Les expressions propres au produit (au moins deux mots, pour ne pas
    // confondre « Diagnostic » avec le mot de tous les jours).
    const phrases = new Set<string>();
    for (const profile of Object.values(PROFILES)) {
      if (profile.id === 'walkin' || profile.id === 'event') continue;
      const v = profile.vocab;
      for (const value of [v.complete, v.start, v.call, v.openQueue, v.clientTurn, v.todayCounter]) {
        if (value && /\s/.test(value)) phrases.add(value);
      }
      for (const stage of profile.stages) {
        for (const label of [stage.client, stage.staff]) if (/\s/.test(label)) phrases.add(label);
      }
    }
    // « Installer », la touche du restaurant, est un seul mot mais n'a pas d'autre sens ici.
    phrases.add(PROFILES.table.vocab.complete);
    for (const phrase of phrases) {
      const variants = [phrase, phrase.replace(/\u00a0/g, ' ')];
      for (const variant of variants) {
        expect(REGISTRY.includes(variant), `« ${phrase} » recopié dans registry.ts : importez-le`).toBe(false);
      }
    }
  });

  it('les mots périmés de la première conception n’apparaissent nulle part', () => {
    // [SEO] écrivait « Véhicule prêt » et « Table prête » : les touches
    // réelles sont « Prêt · prévenir » et « Table prête · appeler ».
    for (const m of METIERS) {
      for (const shipped of [TODAY, ALL]) {
        for (const text of pageTexts(renderable(m, shipped))) {
          for (const quoted of quotations(text)) {
            expect(['Véhicule prêt', 'Table prête', 'Appareil prêt', 'Terminé'], `${m.slug} : « ${quoted} »`).not.toContain(quoted);
          }
          expect(plain(text), m.slug).not.toMatch(/touche(?:z)? « ?Véhicule prêt/i);
        }
      }
    }
  });

  it('les paroles de clients sont des paroles, pas des libellés', () => {
    for (const phrase of SPOKEN) {
      expect(phrase, phrase).toMatch(/^\p{Ll}/u);
      expect(KNOWN.has(plain(phrase)), phrase).toBe(false);
    }
  });
});
