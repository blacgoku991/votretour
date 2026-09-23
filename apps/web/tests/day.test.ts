import { describe, it, expect } from 'vitest';
import { startOfDayInZone } from '../src/lib/day';

/**
 * « Passages du jour » doit compter depuis minuit HEURE DU COMMERCE,
 * comme le compteur « aujourd'hui » de la File.
 */

describe('startOfDayInZone', () => {
  it('Paris, heure d’été (UTC+2)', () => {
    expect(startOfDayInZone(new Date('2026-07-15T10:00:00Z'), 'Europe/Paris').toISOString())
      .toBe('2026-07-14T22:00:00.000Z');
  });

  it('Paris, heure d’hiver (UTC+1)', () => {
    expect(startOfDayInZone(new Date('2026-01-15T10:00:00Z'), 'Europe/Paris').toISOString())
      .toBe('2026-01-14T23:00:00.000Z');
  });

  it('Paris juste après minuit : c’est déjà le lendemain', () => {
    expect(startOfDayInZone(new Date('2026-07-15T22:30:00Z'), 'Europe/Paris').toISOString())
      .toBe('2026-07-15T22:00:00.000Z');
  });

  it('Martinique (UTC−4) : minuit UTC tombe encore la veille', () => {
    expect(startOfDayInZone(new Date('2026-07-15T02:00:00Z'), 'America/Martinique').toISOString())
      .toBe('2026-07-14T04:00:00.000Z');
    expect(startOfDayInZone(new Date('2026-07-15T12:00:00Z'), 'America/Martinique').toISOString())
      .toBe('2026-07-15T04:00:00.000Z');
  });

  it('La Réunion (UTC+4)', () => {
    expect(startOfDayInZone(new Date('2026-07-15T12:00:00Z'), 'Indian/Reunion').toISOString())
      .toBe('2026-07-14T20:00:00.000Z');
  });

  it('jour de changement d’heure à Paris', () => {
    // 29 mars 2026 : passage à l'heure d'été à 2 h ; minuit était en UTC+1.
    expect(startOfDayInZone(new Date('2026-03-29T12:00:00Z'), 'Europe/Paris').toISOString())
      .toBe('2026-03-28T23:00:00.000Z');
  });

  it('fuseau invalide : repli sur Paris', () => {
    expect(startOfDayInZone(new Date('2026-07-15T10:00:00Z'), 'Pas/Un_Fuseau').toISOString())
      .toBe('2026-07-14T22:00:00.000Z');
  });
});
