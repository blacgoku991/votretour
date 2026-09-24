import { describe, expect, it } from 'vitest';
import { cleanText, detailsSchemaFor } from '@/lib/profiles/details';

/**
 * Premier contrôle des détails d'un ticket (le second est en SQL) : liste
 * blanche stricte, textes nettoyés et tronqués, clés réservées au pro.
 */

const vehicle = (actor: 'client' | 'staff' = 'client', options = {}) => detailsSchemaFor('vehicle', { actor, options });

describe('liste blanche', () => {
  it('refuse une clé inconnue (un « code » ajouté par erreur)', () => {
    expect(vehicle().safeParse({ registration: 'AB-123-CD', code: '1234' }).success).toBe(false);
    expect(detailsSchemaFor('device').safeParse({ model: 'iPhone 13', unlockCode: '0000' }).success).toBe(false);
    expect(detailsSchemaFor('desk').safeParse({ reasonText: 'x' }).success).toBe(false);
    expect(detailsSchemaFor('walkin').safeParse({ anything: 1 }).success).toBe(false);
    expect(detailsSchemaFor('walkin').safeParse({}).success).toBe(true);
  });

  it('le client ne peut poser ni devis, ni clés, ni promesse, ni accessoires', () => {
    const quote = { amountCents: 100, label: 'x', sentAt: '2026-09-24T10:00:00Z', decision: null, decidedAt: null };
    expect(vehicle().safeParse({ registration: 'AB-123-CD', quote }).success).toBe(false);
    expect(vehicle().safeParse({ registration: 'AB-123-CD', keys: true }).success).toBe(false);
    expect(vehicle().safeParse({ registration: 'AB-123-CD', readyEta: '2026-09-25T15:00:00Z' }).success).toBe(false);
    expect(detailsSchemaFor('device').safeParse({ accessories: ['charger'] }).success).toBe(false);
  });

  it('le pro pose clés, promesse et accessoires, mais jamais le devis par ce chemin', () => {
    const ok = vehicle('staff').safeParse({ registration: 'ab123cd', keys: true, readyEta: '2026-09-25T15:00:00+02:00' });
    expect(ok.success).toBe(true);
    const quote = { amountCents: 100, label: 'x', sentAt: '2026-09-24T10:00:00Z', decision: null, decidedAt: null };
    expect(vehicle('staff').safeParse({ quote }).success).toBe(false);
    const device = detailsSchemaFor('device', { actor: 'staff' }).safeParse({ accessories: ['charger', 'charger', 'case'] });
    expect(device.success && device.data.accessories).toEqual(['charger', 'case']);
    expect(vehicle('staff').safeParse({ readyEta: 'demain' }).success).toBe(false);
  });
});

describe('immatriculation', () => {
  it('obligatoire pour le client, par défaut ; facultative pour le pro', () => {
    expect(vehicle().safeParse({ model: 'Clio' }).success).toBe(false);
    expect(vehicle('client', { registrationRequired: false }).safeParse({ model: 'Clio' }).success).toBe(true);
    expect(vehicle('staff').safeParse({ model: 'Clio' }).success).toBe(true);
  });

  it('stockée sous sa forme canonique', () => {
    const r = vehicle().safeParse({ registration: 'ab 123 cd', model: '  Peugeot   208 ' });
    expect(r.success && r.data).toEqual({ registration: 'AB-123-CD', country: 'FR', model: 'Peugeot 208' });
  });

  it('refuse une plaque française invalide, accepte une étrangère', () => {
    expect(vehicle().safeParse({ registration: 'IO-123-UU' }).success).toBe(false);
    const foreign = vehicle().safeParse({ registration: 'm-ab 1234', country: 'other' });
    expect(foreign.success && foreign.data.registration).toBe('M-AB 1234');
  });
});

describe('textes libres', () => {
  it('nettoie les caractères de contrôle et resserre les espaces', () => {
    expect(cleanText('  bruit\u0000 au\t\tfreinage\u200b  ', 80)).toBe('bruit au freinage');
  });

  it('tronque plutôt que refuser, sans couper un émoji', () => {
    const long = 'a'.repeat(120);
    const r = vehicle().safeParse({ registration: 'AB-123-CD', reasonText: long });
    expect(r.success && r.data.reasonText).toHaveLength(80);
    expect(cleanText('😀😀😀', 2)).toBe('😀😀');
  });

  it('refuse un texte vide après nettoyage, et une entrée démesurée', () => {
    expect(vehicle().safeParse({ registration: 'AB-123-CD', model: '   ' }).success).toBe(false);
    expect(vehicle().safeParse({ registration: 'AB-123-CD', model: 'x'.repeat(10_000) }).success).toBe(false);
  });

  it('file sensible (santé) : aucun texte libre, quel que soit le profil', () => {
    const r = detailsSchemaFor('device', { options: { sensitive: true } }).safeParse({ model: 'iPhone' });
    expect(r.success).toBe(false);
    expect(detailsSchemaFor('desk', { options: { sensitive: true } }).safeParse({ reasonText: 'prise de sang' }).success).toBe(false);
    expect(detailsSchemaFor('desk', { options: { sensitive: true } }).safeParse({}).success).toBe(true);
  });
});

describe('table', () => {
  const table = (actor: 'client' | 'staff' = 'client', partyMax = 12) =>
    detailsSchemaFor('table', { actor, options: { partyMax } });

  it('couverts entre 1 et le plafond en ligne ; le pro va jusqu’à 20', () => {
    expect(table().safeParse({ partySize: 0 }).success).toBe(false);
    expect(table().safeParse({ partySize: 13 }).success).toBe(false);
    expect(table().safeParse({ partySize: 4.5 }).success).toBe(false);
    expect(table().safeParse({ partySize: 12 }).success).toBe(true);
    expect(table('staff').safeParse({ partySize: 20 }).success).toBe(true);
    expect(table('staff').safeParse({ partySize: 21 }).success).toBe(false);
  });

  it('préférences sur liste, besoins sans doublon, jamais d’allergie', () => {
    const r = table().safeParse({ partySize: 4, seating: 'terrace', needs: ['highchair', 'highchair'] });
    expect(r.success && r.data.needs).toEqual(['highchair']);
    expect(table().safeParse({ partySize: 4, seating: 'bar' }).success).toBe(false);
    expect(table().safeParse({ partySize: 4, allergies: 'arachide' }).success).toBe(false);
  });
});

describe('boutique', () => {
  it('numéro de commande nettoyé, en majuscules, 24 caractères', () => {
    const r = detailsSchemaFor('retail').safeParse({ orderRef: ' cmd-1234 ' });
    expect(r.success && r.data.orderRef).toBe('CMD-1234');
    expect(detailsSchemaFor('retail').safeParse({ orderRef: '<script>' }).success).toBe(false);
  });
});

describe('taille', () => {
  it('reste sous 2 Ko une fois validé', () => {
    const r = vehicle('staff').safeParse({
      registration: 'AB-123-CD',
      model: 'm'.repeat(40),
      reasonText: 'r'.repeat(80),
      stay: 'away',
      keys: true,
    });
    expect(r.success).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(r.success ? r.data : {})).length).toBeLessThanOrEqual(2048);
  });
});
