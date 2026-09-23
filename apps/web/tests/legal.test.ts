import { describe, it, expect, afterEach } from 'vitest';
import { hasLegalNotice, legalInfo } from '../src/lib/legal';

/**
 * Les mentions légales ne se publient jamais à trous : tant que
 * l'éditeur n'est pas identifié en entier, la page n'existe pas.
 */

const KEYS = ['LEGAL_COMPANY', 'LEGAL_ADDRESS', 'LEGAL_SIRET', 'LEGAL_EMAIL', 'LEGAL_HOST_NAME', 'LEGAL_HOST_ADDRESS'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('mentions légales', () => {
  it('rien de renseigné : pas de page', () => {
    for (const k of KEYS) delete process.env[k];
    expect(hasLegalNotice()).toBe(false);
    expect(legalInfo().company).toBeNull();
  });

  it('une seule information manquante suffit à ne rien publier', () => {
    for (const k of KEYS) process.env[k] = 'x';
    process.env.LEGAL_SIRET = '   ';
    expect(hasLegalNotice()).toBe(false);
  });

  it('éditeur complet : la page existe', () => {
    for (const k of KEYS) process.env[k] = 'valeur';
    expect(hasLegalNotice()).toBe(true);
  });
});
