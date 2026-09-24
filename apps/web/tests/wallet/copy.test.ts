import { describe, expect, it } from 'vitest';
import * as copy from '../../src/lib/wallet-copy';
import { buildWalletView } from '../../src/server/wallet/view';
import { SITE, eventSnapshot, snapshot } from './fixtures';

/**
 * Textes des passes : source unique, typographie française, et mêmes mots
 * que la page web et les notifications existantes.
 */

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, out));
  return out;
}

describe('wallet-copy', () => {
  it('aucune apostrophe droite dans les textes', () => {
    const texts = allStrings([
      copy.WALLET_HEADLINE, copy.WALLET_STATUS, copy.WALLET_LABEL, copy.WALLET_BACK, copy.WALLET_OFFER_COPY,
      copy.eventOverCopy('sold_out', 'Chez Lou'), copy.eventOverCopy('ended', 'Chez Lou'),
      copy.walletIssuerText('Lou'), copy.walletDescription('queue', 'Lou'), copy.walletRelevantText('turn', 'Lou'),
    ]);
    expect(texts.length).toBeGreaterThan(40);
    for (const text of texts) expect(text, text).not.toMatch(/'/);
  });

  it('palier « Plus de 20 »', () => {
    expect(copy.walletPositionLabel(20)).toBe('20');
    expect(copy.walletPositionLabel(21)).toBe('Plus de 20');
    expect(copy.walletAheadHeadline(1)).toBe('1 personne devant vous');
    expect(copy.walletAheadHeadline(7)).toBe('7 personnes devant vous');
    expect(copy.walletAheadHeadline(99)).toBe('Plus de 20 personnes devant vous');
    expect(copy.eventAheadHeadline(0)).toBe('Personne devant vous');
  });

  it('numéro humain de drop', () => {
    expect(copy.formatEventTicketNumber(42)).toBe('A-042');
    expect(copy.formatEventTicketNumber(1234)).toBe('A-1234');
    expect(copy.formatEventTicketNumber(0)).toBeNull();
    expect(copy.formatEventTicketNumber(null)).toBeNull();
    expect(copy.eventQrAltText('A-042', 3)).toBe('A-042 · Vague 3');
    expect(copy.eventQrAltText(null, null)).toBe('Billet');
  });

  it('valeur principale : un mot aux moments clés, sinon le chiffre', () => {
    const at = new Date('2026-09-24T12:30:00Z');
    const v = (o: Parameters<typeof snapshot>[0]) => buildWalletView(snapshot(o), at, { siteUrl: SITE });
    expect(copy.walletPrimaryValue(v({ entry: { peopleAhead: 6 } }))).toBe('6');
    expect(copy.walletPrimaryValue(v({ entry: { peopleAhead: 33 } }))).toBe('Plus de 20');
    expect(copy.walletPrimaryValue(v({ entry: { peopleAhead: 0 } }))).toBe('À vous');
    expect(copy.walletPrimaryValue(v({ entry: { status: 'completed', completedAt: '2026-09-24T12:00:00Z' } }))).toBe('Merci');
    expect(copy.walletPrimaryValue(v({ entry: { status: 'expired' } }))).toBe('—');
    const over = buildWalletView(eventSnapshot({ event: { status: 'sold_out' } }), at, { siteUrl: SITE });
    expect(copy.walletPrimaryValue(over)).toBe('Complet');
  });

  it('les textes de la vue viennent tous de wallet-copy (pas de texte en dur ailleurs)', () => {
    const known = new Set(allStrings([copy.WALLET_HEADLINE, copy.WALLET_STATUS]));
    const at = new Date('2026-09-24T12:30:00Z');
    for (const entry of [
      { status: 'next' as const }, { status: 'serving' as const }, { status: 'completed' as const, completedAt: '2026-09-24T12:00:00Z' },
      { status: 'cancelled' as const, statusActor: 'client' as const }, { status: 'skipped' as const }, { status: 'expired' as const },
    ]) {
      const v = buildWalletView(snapshot({ entry }), at, { siteUrl: SITE });
      expect(known.has(v.headline), v.headline).toBe(true);
      expect(known.has(v.statusText), v.statusText).toBe(true);
    }
  });

  it('heure dans le fuseau demandé, repli sur Paris si le fuseau est inconnu', () => {
    expect(copy.walletTime('2026-09-24T12:32:00Z', 'Europe/Paris')).toBe('14:32');
    expect(copy.walletTime('2026-09-24T12:32:00Z', 'Pas/UnFuseau')).toBe('14:32');
  });
});
