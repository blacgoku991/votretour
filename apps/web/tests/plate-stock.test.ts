import { describe, it, expect } from 'vitest';
import {
  buildSupplierCsv, buildSupplierUrlList, formatSerial, formatStockCode,
  isStockCode, normalizeStockCode, stockPlateUrl,
} from '../src/lib/plate-stock';

/**
 * Ces codes sont gravés dans du métal et imprimés en QR. Une erreur de
 * normalisation empêcherait de retrouver une plaque livrée ; une erreur
 * d'export enverrait de mauvais liens au fabricant.
 */

describe('normalizeStockCode', () => {
  const canonical = 'rv-k7m3q-9xp2d';

  it('accepte le code tel qu’imprimé sur la plaque', () => {
    expect(normalizeStockCode('RV-K7M3Q-9XP2D')).toBe(canonical);
  });

  it('accepte le code tapé sans tirets, avec espaces ou sans préfixe', () => {
    expect(normalizeStockCode('rvk7m3q9xp2d')).toBe(canonical);
    expect(normalizeStockCode('  RV K7M3Q 9XP2D ')).toBe(canonical);
    expect(normalizeStockCode('K7M3Q-9XP2D')).toBe(canonical);
    expect(normalizeStockCode('k7m3q9xp2d')).toBe(canonical);
  });

  it('accepte l’URL complète lue dans une puce NFC ou un QR', () => {
    expect(normalizeStockCode('https://rangvia.com/e/rv-k7m3q-9xp2d')).toBe(canonical);
    expect(normalizeStockCode('https://rangvia.com/e/rv-k7m3q-9xp2d/?src=nfc')).toBe(canonical);
  });

  it('corrige les confusions de recopie de Crockford (O→0, I et L→1)', () => {
    expect(normalizeStockCode('RV-K7M3Q-9XP2O')).toBe('rv-k7m3q-9xp20');
    expect(normalizeStockCode('RV-K7M3Q-9XPIL')).toBe('rv-k7m3q-9xp11');
  });

  it('ne retire pas un « rv » qui fait partie d’un code nu', () => {
    expect(normalizeStockCode('rv3k29xp2d')).toBe('rv-rv3k2-9xp2d');
  });

  it('refuse ce qui n’est pas un code de stock', () => {
    expect(normalizeStockCode('')).toBeNull();
    expect(normalizeStockCode('barber-house-comptoir')).toBeNull();
    expect(normalizeStockCode('RV-K7M3Q-9XP2')).toBeNull();      // trop court
    expect(normalizeStockCode('RV-K7M3Q-9XP2DD')).toBeNull();    // trop long
    expect(normalizeStockCode('RV-K7M3Q-9XP2U')).toBeNull();     // U hors alphabet
  });
});

describe('isStockCode', () => {
  it('ne reconnaît que la forme canonique d’URL', () => {
    expect(isStockCode('rv-k7m3q-9xp2d')).toBe(true);
    expect(isStockCode('RV-K7M3Q-9XP2D')).toBe(false);
    expect(isStockCode('rv-k7m3q-9xp2u')).toBe(false);
    expect(isStockCode('rv-k7m3q-9xp2d"><script>')).toBe(false);
  });
});

describe('formatage', () => {
  it('affiche le code comme sur la plaque et le numéro sur six chiffres', () => {
    expect(formatStockCode('rv-k7m3q-9xp2d')).toBe('RV-K7M3Q-9XP2D');
    expect(formatSerial(42)).toBe('000042');
  });

  it('construit l’URL gravée sans double barre oblique', () => {
    expect(stockPlateUrl('https://rangvia.com/', 'rv-k7m3q-9xp2d')).toBe('https://rangvia.com/e/rv-k7m3q-9xp2d');
  });
});

describe('export fabricant', () => {
  const rows = [{ serial: 1, code: 'rv-aaaaa-bbbbb' }, { serial: 2, code: 'rv-ccccc-ddddd' }];

  it('produit un CSV qu’Excel ouvre en France : BOM, point-virgule, CRLF', () => {
    const csv = buildSupplierCsv(rows, 'https://rangvia.com', 'Commande n° 1');
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('"Numéro";"Code imprimé";"URL à graver (NFC et QR)";"Lot"');
    expect(lines[1]).toBe('"000001";"RV-AAAAA-BBBBB";"https://rangvia.com/e/rv-aaaaa-bbbbb";"Commande n° 1"');
  });

  it('neutralise un nom de lot qui serait exécuté comme une formule', () => {
    const csv = buildSupplierCsv(rows, 'https://rangvia.com', '=HYPERLINK("http://x")');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it('liste une URL par ligne pour les encodeurs NFC', () => {
    expect(buildSupplierUrlList(rows, 'https://rangvia.com')).toBe(
      'https://rangvia.com/e/rv-aaaaa-bbbbb\nhttps://rangvia.com/e/rv-ccccc-ddddd\n',
    );
  });
});
