import { describe, it, expect } from 'vitest';
import {
  formatDuration, formatPercent, formatNumber, initials, directionsUrl, WEEKDAYS,
} from '@/lib/format';
import { slugSchema, clientNameSchema, publicIdSchema } from '@/lib/api';

describe('formatage', () => {
  it('formate les durées en français', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(725)).toBe('12 min');
    expect(formatDuration(3660)).toBe('1 h 01');
    expect(formatDuration(null)).toBe('—');
  });

  it('formate les pourcentages et les nombres', () => {
    expect(formatPercent(87.5)).toBe('87,5 %');
    expect(formatPercent(null)).toBe('—');
    expect(formatNumber(12345)).toMatch(/12\s?345/);
  });

  it('produit des initiales lisibles', () => {
    expect(initials('Karim Benali')).toBe('KB');
    expect(initials('Sofia')).toBe('S');
    expect(initials(null)).toBe('?');
    expect(initials('  ')).toBe('?');
  });

  it('couvre les sept jours de la semaine, lundi en premier', () => {
    expect(WEEKDAYS).toHaveLength(7);
    expect(WEEKDAYS[0]).toBe('Lundi');
    expect(WEEKDAYS[6]).toBe('Dimanche');
  });
});

describe("lien d'itinéraire", () => {
  it('privilégie le lien fourni par le commerce', () => {
    expect(directionsUrl({ mapsUrl: 'https://maps.app.goo.gl/x' })).toBe('https://maps.app.goo.gl/x');
  });

  it('utilise les coordonnées exactes quand elles existent', () => {
    expect(directionsUrl({ latitude: 48.8649, longitude: 2.3765 }))
      .toContain('destination=48.8649,2.3765');
  });

  it("retombe sur l'adresse postale", () => {
    const url = directionsUrl({ name: 'Barber House', city: 'Paris', postalCode: '75011' });
    expect(url).toContain('Barber%20House');
    expect(url).toContain('Paris');
  });
});

/**
 * Les schémas de validation sont la première barrière des routes
 * publiques : /e/{slug} est accessible sans aucune authentification.
 */
describe('validation des entrées publiques', () => {
  it('accepte un slug de plaque normal', () => {
    expect(slugSchema.safeParse('barber-house-paris-11').success).toBe(true);
    expect(slugSchema.parse('  Barber-House  ')).toBe('barber-house');
  });

  it('rejette les slugs dangereux ou malformés', () => {
    for (const bad of [
      '../../etc/passwd', 'a', '-abc', 'abc-', 'ABC DEF', 'abc/def',
      'abc?x=1', "abc'--", 'a'.repeat(80), '',
    ]) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('rejette un prénom contenant du balisage', () => {
    expect(clientNameSchema.safeParse('<script>').success).toBe(false);
    expect(clientNameSchema.safeParse('Jean-Éric').success).toBe(true);
    expect(clientNameSchema.safeParse('a'.repeat(41)).success).toBe(false);
    expect(clientNameSchema.safeParse('   ').success).toBe(false);
  });

  it("n'accepte que des identifiants de ticket alphanumériques", () => {
    expect(publicIdSchema.safeParse('3x7dKgTEvi4TDDRdrxAdEs').success).toBe(true);
    expect(publicIdSchema.safeParse('abc-def').success).toBe(false);
    expect(publicIdSchema.safeParse('short').success).toBe(false);
  });
});
