import { describe, expect, it } from 'vitest';
import {
  decideAlertFor, decideWalletAlert, deliveredByOthers, liveLedger, parseLedgerTime, reachedBeforePass,
  type WalletAlertInput,
} from '../../src/server/wallet/alerts';
import { buildWalletView } from '../../src/server/wallet/view';
import type { AlertKind, WalletPhase, WalletProviderId } from '../../src/server/wallet/types';
import { SITE, snapshot, type Overrides } from './fixtures';

/** Table de vérité des alertes (§ 5 du plan). */

const NOW = new Date('2026-09-24T12:30:00Z');

function input(kind: AlertKind | null, over: Partial<WalletAlertInput> = {}): WalletAlertInput {
  return {
    provider: 'google',
    view: { alertKind: kind, kind: 'queue', phase: 'waiting' as WalletPhase, turnAnnounced: false },
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

  it('Google : la troisième sonnerie est gardée pour « C’est votre tour » et l’accès', () => {
    const two = ['2026-09-24T10:00:00Z', '2026-09-24T12:00:00Z'];
    expect(decideWalletAlert(input('ahead_two', { notifyLog: two }))).toEqual({ kind: 'ahead_two', notify: false });
    expect(decideWalletAlert(input('ahead_one', { notifyLog: two }))).toEqual({ kind: 'ahead_one', notify: false });
    expect(decideWalletAlert(input('removed', { notifyLog: two }))).toEqual({ kind: 'removed', notify: false });
    expect(decideWalletAlert(input('your_turn', { notifyLog: two }))).toEqual({ kind: 'your_turn', notify: true });
    expect(decideWalletAlert(input('event_access', { eventMode: true, notifyLog: two }))).toEqual({ kind: 'event_access', notify: true });
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
    const one = { alertKind: 'ahead_one' as const, phase: 'one' as const, turnAnnounced: false };
    expect(decideAlertFor('google', snap, { ...one, kind: 'event' }, NOW)).toBeNull();
    expect(decideAlertFor('google', snap, { ...one, kind: 'queue' }, NOW)).toEqual({ kind: 'ahead_one', notify: true });
  });
});

/* ====================================================================
   Séquences réelles : vue + décision, comme le vidage les enchaîne
   ==================================================================== */

/**
 * Rejoue un ticket étape par étape, pour un fournisseur : à chaque étape,
 * la vue est construite, la décision prise, et (comme complete_wallet_outbox)
 * le moment décidé est inscrit au registre du pass. Renvoie les décisions.
 */
function replay(provider: WalletProviderId, steps: { at: string; o: Overrides }[]) {
  let alerts: Record<string, string> = {};
  let notifyLog: string[] = [];
  const out: ({ kind: AlertKind; notify: boolean } | null)[] = [];
  for (const step of steps) {
    const snap = snapshot({ ...step.o, pass: { provider, alerts, notifyLog, ...(step.o.pass ?? {}) } });
    const now = new Date(step.at);
    const decision = decideAlertFor(provider, snap, buildWalletView(snap, now, { siteUrl: SITE }), now);
    if (decision) alerts = { ...alerts, [decision.kind]: now.toISOString() };
    if (decision?.notify) notifyLog = [...notifyLog, now.toISOString()];
    out.push(decision);
  }
  return out;
}

describe('auto_serve (réglage par défaut) : 1 personne devant → en cours', () => {
  const steps = [
    { at: '2026-09-24T12:20:00Z', o: { entry: { peopleAhead: 1 } } },
    // TERMINER du client précédent : promotion directe, called_at = service_started_at.
    { at: '2026-09-24T12:28:00Z', o: { entry: { status: 'serving' as const, peopleAhead: 0, calledAt: '2026-09-24T12:28:00Z', serviceStartedAt: '2026-09-24T12:28:00Z' } } },
  ];

  it.each(['apple', 'google'] as const)('%s : « C’est votre tour » sonne à la promotion', (provider) => {
    expect(replay(provider, steps)).toEqual([
      { kind: 'ahead_one', notify: true },
      { kind: 'your_turn', notify: true },
    ]);
  });
});

describe('call_next : appelé → en cours', () => {
  const steps = [
    { at: '2026-09-24T12:20:00Z', o: { entry: { status: 'next' as const, peopleAhead: 0, calledAt: '2026-09-24T12:20:00Z' } } },
    { at: '2026-09-24T12:24:00Z', o: { entry: { status: 'serving' as const, peopleAhead: 0, calledAt: '2026-09-24T12:20:00Z', serviceStartedAt: '2026-09-24T12:24:00Z' } } },
  ];

  it.each(['apple', 'google'] as const)('%s : une seule sonnerie, à l’appel', (provider) => {
    expect(replay(provider, steps)).toEqual([{ kind: 'your_turn', notify: true }, null]);
  });
});

describe('drop lancé après l’ajout au Wallet', () => {
  it.each(['apple', 'google'] as const)('%s : plus aucune alerte de rang, la vague sonne', (provider) => {
    const running = { runningEventId: '44444444-4444-4444-8444-444444444444' };
    const decisions = replay(provider, [
      { at: '2026-09-24T12:10:00Z', o: { queue: running, entry: { peopleAhead: 2 } } },
      { at: '2026-09-24T12:12:00Z', o: { queue: running, entry: { peopleAhead: 1 } } },
      { at: '2026-09-24T12:14:00Z', o: { queue: running, entry: { peopleAhead: 0 } } },
      { at: '2026-09-24T12:15:00Z', o: { queue: running, entry: { status: 'next', peopleAhead: 0 } } },
      {
        at: '2026-09-24T12:16:00Z',
        o: {
          queue: running,
          access: {
            publicId: 'Kp3AccessPublic01', tokenHash: 'e'.repeat(64), status: 'issued', issuedAt: '2026-09-24T12:16:00Z',
            validUntil: '2026-09-24T12:26:00Z', graceUntil: '2026-09-24T12:31:00Z', redeemedAt: null, revokedAt: null, wave: 1,
          },
        },
      },
    ]);
    expect(decisions).toEqual([null, null, null, null, { kind: 'event_access', notify: true }]);
  });

  it('decideAlertFor lit aussi l’instantané, même avec une vue partielle', () => {
    const snap = snapshot({ queue: { runningEventId: 'ev' }, entry: { peopleAhead: 0 } });
    expect(decideAlertFor('google', snap, { alertKind: 'your_turn', kind: 'queue', phase: 'turn', turnAnnounced: false }, NOW)).toBeNull();
  });
});

describe('report, retour après absence, restauration : le registre repart de zéro', () => {
  it('Google : appelé, reporté, rappelé → prévenu deux fois', () => {
    const decisions = replay('google', [
      { at: '2026-09-24T12:00:00Z', o: { entry: { peopleAhead: 1 } } },
      { at: '2026-09-24T12:05:00Z', o: { entry: { status: 'next', peopleAhead: 0, calledAt: '2026-09-24T12:05:00Z' } } },
      // REPORTER par le pro à 12:06 : le moteur vide ses paliers.
      { at: '2026-09-24T12:07:00Z', o: { entry: { peopleAhead: 2, rankResetAt: '2026-09-24T12:06:00+00' } } },
      { at: '2026-09-24T12:12:00Z', o: { entry: { peopleAhead: 1, rankResetAt: '2026-09-24T12:06:00+00' } } },
      { at: '2026-09-24T12:15:00Z', o: { entry: { status: 'next', peopleAhead: 0, calledAt: '2026-09-24T12:15:00Z', rankResetAt: '2026-09-24T12:06:00+00' } } },
      // Même état relu : aucune nouvelle sonnerie.
      { at: '2026-09-24T12:16:00Z', o: { entry: { status: 'next', peopleAhead: 0, calledAt: '2026-09-24T12:15:00Z', rankResetAt: '2026-09-24T12:06:00+00' } } },
    ]);
    expect(decisions).toEqual([
      { kind: 'ahead_one', notify: true },
      { kind: 'your_turn', notify: true },
      // Budget Google : deux sonneries déjà faites, la troisième est gardée
      // pour le rappel. Les paliers s'inscrivent au dos, sans sonner.
      { kind: 'ahead_two', notify: false },
      { kind: 'ahead_one', notify: false },
      { kind: 'your_turn', notify: true },
      null,
    ]);
  });

  it('liveLedger : seuls les paliers antérieurs à la remise à zéro sont oubliés', () => {
    const ledger = { ahead_one: '2026-09-24T12:00:00.000Z', your_turn: '2026-09-24T12:05:00.000Z', removed: '2026-09-24T11:00:00.000Z' };
    expect(liveLedger(ledger, '2026-09-24T12:03:00+00')).toEqual({ your_turn: '2026-09-24T12:05:00.000Z', removed: '2026-09-24T11:00:00.000Z' });
    expect(liveLedger(ledger, null)).toBe(ledger);
    // Horodatage illisible : gardé (mieux vaut ne pas renvoyer).
    expect(liveLedger({ ahead_one: 'superseded' }, '2026-09-24T12:03:00Z')).toEqual({ ahead_one: 'superseded' });
  });

  it('horodatages du moteur : « +00 » comme « +05:30 »', () => {
    expect(parseLedgerTime('2026-09-24T12:03:00+00')).toBe(Date.parse('2026-09-24T12:03:00Z'));
    expect(parseLedgerTime('2026-09-24T17:33:00+05:30')).toBe(Date.parse('2026-09-24T12:03:00Z'));
    expect(parseLedgerTime('2026-09-24T12:03:00.123456+00:00')).toBe(Date.parse('2026-09-24T12:03:00.123Z'));
    expect(Number.isNaN(parseLedgerTime(null))).toBe(true);
  });
});

describe('premier envoi Google : amorce du registre', () => {
  it('palier déjà atteint avant le pass : inscrit sans sonnerie ; atteint après : sonne', () => {
    const at = new Date('2026-09-24T12:30:00Z');
    const decide = (engineLedger: Record<string, string>, provider: WalletProviderId = 'google') => {
      const snap = snapshot({ pass: { provider, createdAt: '2026-09-24T12:05:00Z' }, entry: { peopleAhead: 1, engineLedger } });
      return decideAlertFor(provider, snap, buildWalletView(snap, at, { siteUrl: SITE }), at);
    };
    // Inscrit à n = 1 : le client voit déjà « 1 personne devant vous ».
    expect(decide({ ahead_one: 'at_join', ahead_two: 'superseded' })).toEqual({ kind: 'ahead_one', notify: false });
    // Atteint à 12:01, pass ajouté à 12:05.
    expect(decide({ ahead_one: '2026-09-24T12:01:00+00' })).toEqual({ kind: 'ahead_one', notify: false });
    // Atteint après l'ajout du pass : sonne.
    expect(decide({ ahead_one: '2026-09-24T12:20:00+00' })).toEqual({ kind: 'ahead_one', notify: true });
    // Pas encore traité par le moteur : sonne.
    expect(decide({})).toEqual({ kind: 'ahead_one', notify: true });
    // Apple n'a pas d'amorce : le pass rendu à l'ajout porte déjà l'état.
    expect(decide({ ahead_one: 'at_join' }, 'apple')).toEqual({ kind: 'ahead_one', notify: true });
  });

  it('reachedBeforePass : même seconde que l’ajout du pass = ambigu, on sonne', () => {
    // Le moteur tronque à la seconde : 12:05:00+00 peut être 12:05:00.900,
    // après un pass créé à 12:05:00.700.
    expect(reachedBeforePass('your_turn', { your_turn: '2026-09-24T12:05:00+00' }, '2026-09-24T12:05:00.700+00:00')).toBe(false);
    expect(reachedBeforePass('your_turn', { your_turn: '2026-09-24T12:04:59+00' }, '2026-09-24T12:05:00.700+00:00')).toBe(true);
  });

  it('reachedBeforePass : « superseded » ne date rien', () => {
    expect(reachedBeforePass('ahead_two', { ahead_two: 'superseded' }, '2026-09-24T12:05:00Z')).toBe(false);
    expect(reachedBeforePass('ahead_two', undefined, '2026-09-24T12:05:00Z')).toBe(false);
  });
});
