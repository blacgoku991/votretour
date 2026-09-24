import { describe, expect, it } from 'vitest';
import { decideAlertFor, decideWalletAlert, deliveredByOthers, type WalletAlertInput } from '../../src/server/wallet/alerts';
import type { AlertKind } from '../../src/server/wallet/types';
import { snapshot } from './fixtures';

/** Table de vérité des alertes (§ 5 du plan). */

const NOW = new Date('2026-09-24T12:30:00Z');

function input(kind: AlertKind | null, over: Partial<WalletAlertInput> = {}): WalletAlertInput {
  return {
    provider: 'google',
    view: { alertKind: kind, kind: 'queue' },
    eventMode: false,
    deliveredByOthers: [],
    ledger: {},
    notifyLog: [],
    now: NOW,
    ...over,
  };
}

describe('decideWalletAlert', () => {
  it('pas de moment clé : rien', () => {
    expect(decideWalletAlert(input(null))).toBeNull();
    expect(decideWalletAlert(input(null, { provider: 'apple' }))).toBeNull();
  });

  it('mode Événement : jamais d’alerte de position, mais l’accès sonne', () => {
    for (const kind of ['ahead_two', 'ahead_one', 'your_turn'] as const) {
      expect(decideWalletAlert(input(kind, { eventMode: true }))).toBeNull();
      expect(decideWalletAlert(input(kind, { eventMode: true, provider: 'apple' }))).toBeNull();
    }
    expect(decideWalletAlert(input('event_access', { eventMode: true }))).toEqual({ kind: 'event_access', notify: true });
    expect(decideWalletAlert(input('event_sold_out', { eventMode: true }))).toEqual({ kind: 'event_sold_out', notify: true });
  });

  it('Google : un moment déjà signalé, ou dépassé par un plus urgent, n’est jamais renvoyé', () => {
    expect(decideWalletAlert(input('ahead_two', { ledger: { ahead_two: '2026-09-24T12:00:00Z' } }))).toBeNull();
    expect(decideWalletAlert(input('ahead_two', { ledger: { ahead_one: '2026-09-24T12:00:00Z' } }))).toBeNull();
    expect(decideWalletAlert(input('ahead_one', { ledger: { your_turn: '2026-09-24T12:00:00Z' } }))).toBeNull();
    // Un moment moins urgent déjà signalé n'empêche pas le suivant.
    expect(decideWalletAlert(input('your_turn', { ledger: { ahead_one: '2026-09-24T12:00:00Z' } })))
      .toEqual({ kind: 'your_turn', notify: true });
  });

  it('Apple : le registre n’est pas consulté (une montre peut lire la version après coup)', () => {
    expect(decideWalletAlert(input('ahead_two', { provider: 'apple', ledger: { ahead_two: '2026-09-24T12:00:00Z', your_turn: 'x' } })))
      .toEqual({ kind: 'ahead_two', notify: true });
  });

  it('déjà livré par un autre canal : pas de sonnerie, sauf your_turn et event_access', () => {
    expect(decideWalletAlert(input('ahead_one', { deliveredByOthers: ['ahead_one'] }))).toEqual({ kind: 'ahead_one', notify: false });
    expect(decideWalletAlert(input('ahead_one', { provider: 'apple', deliveredByOthers: ['ahead_one'] })))
      .toEqual({ kind: 'ahead_one', notify: false });
    expect(decideWalletAlert(input('visit_completed', { deliveredByOthers: ['visit_completed'] }))!.notify).toBe(false);
    expect(decideWalletAlert(input('removed', { deliveredByOthers: ['ahead_one'] }))!.notify).toBe(true);
    expect(decideWalletAlert(input('your_turn', { deliveredByOthers: ['your_turn'] }))!.notify).toBe(true);
    expect(decideWalletAlert(input('event_access', { eventMode: true, deliveredByOthers: ['event_access'] }))!.notify).toBe(true);
  });

  it('Google : budget de 3 sonneries sur 24 h glissantes', () => {
    const recent = ['2026-09-24T08:00:00Z', '2026-09-24T10:00:00Z', '2026-09-24T12:00:00Z'];
    expect(decideWalletAlert(input('your_turn', { notifyLog: recent }))).toEqual({ kind: 'your_turn', notify: false });
    // Un horodatage de plus de 24 h ne compte plus.
    const old = ['2026-09-23T12:29:00Z', '2026-09-24T10:00:00Z', '2026-09-24T12:00:00Z'];
    expect(decideWalletAlert(input('your_turn', { notifyLog: old }))).toEqual({ kind: 'your_turn', notify: true });
    // Apple n'a pas ce budget.
    expect(decideWalletAlert(input('your_turn', { provider: 'apple', notifyLog: recent }))!.notify).toBe(true);
  });
});

describe('lecture de l’instantané', () => {
  it('« autres canaux » exclut le canal du fournisseur lui-même', () => {
    const snap = snapshot({
      deliveredKinds: { web_push: ['ahead_two'], apple_wallet: ['ahead_one'], google_wallet: ['your_turn', 'inconnu'] },
    });
    expect(deliveredByOthers(snap, 'apple').sort()).toEqual(['ahead_two', 'your_turn']);
    expect(deliveredByOthers(snap, 'google').sort()).toEqual(['ahead_one', 'ahead_two']);
  });

  it('decideAlertFor : mode Événement déduit de la vue', () => {
    const snap = snapshot();
    expect(decideAlertFor('google', snap, { alertKind: 'ahead_one', kind: 'event' }, NOW)).toBeNull();
    expect(decideAlertFor('google', snap, { alertKind: 'ahead_one', kind: 'queue' }, NOW)).toEqual({ kind: 'ahead_one', notify: true });
  });
});
