import { describe, it, expect } from 'vitest';
import { safeRedirectPath } from '../src/lib/safe-redirect';

describe('safeRedirectPath', () => {
  it('garde un chemin interne, avec sa requête', () => {
    expect(safeRedirectPath('/bienvenue?activite=garage')).toBe('/bienvenue?activite=garage');
    expect(safeRedirectPath('/invitation/abc')).toBe('/invitation/abc');
  });

  it.each([
    ['//exemple.com'],
    ['/\\exemple.com'],
    ['\\\\exemple.com'],
    ['https://exemple.com'],
    ['javascript:alert(1)'],
    ['/\u0009/exemple.com'],
    ['exemple.com'],
  ])('refuse %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/app');
  });

  it('valeur absente : destination par défaut', () => {
    expect(safeRedirectPath(null)).toBe('/app');
    expect(safeRedirectPath('', '/bienvenue')).toBe('/bienvenue');
  });
});
