import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Les objets des métiers se rendent dans des composants SERVEUR (pages
 * métier, étiquette imprimable, planche de design) : aucun ne doit être
 * un composant client ni tenir un état. Seul `TicketNumberFlap`, qui
 * enveloppe le volet animé, est client, et il est à part.
 *
 * Le rendu réel côté serveur est prouvé par la planche `/design/metiers`,
 * un composant serveur qui les affiche tous ; la logique qu'ils portent
 * (masquage, états du rail, numéros) est testée dans `lib/profiles`.
 */

const OBJECTS = ['Immatriculation', 'StageRail', 'TicketNumber', 'PartySize', 'DeviceGlyph'];

const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../src/components/objects/${name}.tsx`, import.meta.url)), 'utf8');

describe('objets compatibles serveur', () => {
  for (const name of OBJECTS) {
    it(`${name} : ni 'use client', ni hook`, () => {
      const code = source(name);
      expect(code).not.toMatch(/['"]use client['"]/);
      expect(code).not.toMatch(/\buse(State|Effect|LayoutEffect|Ref|Reducer|Context|SyncExternalStore|Id|Memo|Callback)\b/);
      expect(code).not.toMatch(/from ['"]react['"]/);
      // Aucun import d'un module client (le volet animé, les hooks de mouvement).
      expect(code).not.toMatch(/import[^;]*(FlapNumber|useMotionPreference|TicketNumberFlap|\/motion\/)/);
    });
  }

  it('le volet animé est bien l’enveloppe client, et elle seule', () => {
    expect(source('TicketNumberFlap')).toMatch(/^'use client';/);
  });
});
