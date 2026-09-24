import { describe, expect, it } from 'vitest';
import { decideAlertFor } from '../../src/server/wallet/alerts';
import { buildWalletView } from '../../src/server/wallet/view';
import type { AlertKind, WalletProviderId, WalletSnapshot } from '../../src/server/wallet/types';
import { SITE, TRAP_NAME } from './fixtures';
import sequences from './sequences-0021.json';

/**
 * Séquences RÉELLES du moteur, produites par sequences-0021.sql sur une base
 * de vérification (0021 de W0 appliquée) : horodatages du moteur à la
 * seconde (« +00 »), du pass à la microseconde, événements de file vrais.
 * Chaque étape est rejouée comme le vidage l'enchaîne : vue, décision, puis
 * inscription au registre et au budget, comme complete_wallet_outbox.
 *
 * Elles verrouillent les trois défauts relevés en relecture :
 *  - auto_serve (réglage par défaut) : « C’est votre tour » à la promotion ;
 *  - report puis rappel : le client est prévenu à nouveau ;
 *  - drop lancé après l'ajout du pass : plus aucune alerte de rang.
 */

const real = sequences as unknown as Record<string, WalletSnapshot>;

type Decision = { kind: AlertKind; notify: boolean } | null;

function replay(provider: WalletProviderId, labels: string[]): Decision[] {
  let alerts: Record<string, string> = {};
  let notifyLog: string[] = [];
  return labels.map((label) => {
    const base = real[label];
    if (!base) throw new Error(`instantané absent : ${label}`);
    const snap: WalletSnapshot = { ...base, pass: { ...base.pass, provider, alerts, notifyLog } };
    const now = new Date(base.at);
    const decision = decideAlertFor(provider, snap, buildWalletView(snap, now, { siteUrl: SITE }), now);
    // complete_wallet_outbox : registre en ISO milliseconde « Z », budget.
    if (decision) alerts = { ...alerts, [decision.kind]: now.toISOString() };
    if (decision?.notify) notifyLog = [...notifyLog, now.toISOString()];
    return decision;
  });
}

describe('séquences réelles (0021)', () => {
  it('aucun prénom, et le complément de l’instantané est bien présent', () => {
    expect(JSON.stringify(real)).not.toContain(TRAP_NAME);
    for (const snap of Object.values(real)) {
      expect(snap.queue).toHaveProperty('runningEventId');
      expect(snap.entry).toHaveProperty('rankResetAt');
      expect(snap.entry).toHaveProperty('engineLedger');
    }
  });

  const auto = ['auto-1-waiting-one', 'auto-2-serving', 'auto-3-deferred', 'auto-4-recalled'];

  it('auto_serve : la promotion directe est bien « en cours » sans passage par « appelé »', () => {
    expect(real['auto-1-waiting-one']!.entry).toMatchObject({ status: 'waiting', peopleAhead: 1 });
    expect(real['auto-2-serving']!.entry.status).toBe('serving');
    const v = buildWalletView(real['auto-2-serving']!, new Date(real['auto-2-serving']!.at), { siteUrl: SITE });
    expect(v).toMatchObject({ phase: 'serving', alertKind: 'your_turn', turnAnnounced: false });
  });

  it('Google : amorce silencieuse, appel, report, rappel', () => {
    expect(replay('google', auto)).toEqual([
      // Déjà à 1 à l'inscription, avant l'ajout du pass : inscrit sans sonner.
      { kind: 'ahead_one', notify: false },
      // TERMINER du client précédent : promu, c'est l'appel.
      { kind: 'your_turn', notify: true },
      // REPORTER : le moteur a vidé ses paliers, le registre Wallet aussi.
      { kind: 'ahead_one', notify: true },
      // Rappelé : prévenu une seconde fois.
      { kind: 'your_turn', notify: true },
    ]);
  });

  it('Apple : mêmes moments (Apple n’a ni registre ni amorce)', () => {
    expect(replay('apple', auto)).toEqual([
      { kind: 'ahead_one', notify: true },
      { kind: 'your_turn', notify: true },
      { kind: 'ahead_one', notify: true },
      { kind: 'your_turn', notify: true },
    ]);
  });

  it('call_next : une seule sonnerie Apple, à l’appel ; « en cours » passe en silence', () => {
    const called = real['call-2-serving']!;
    expect(buildWalletView(called, new Date(called.at), { siteUrl: SITE }).turnAnnounced).toBe(true);
    expect(replay('apple', ['call-1-called', 'call-2-serving'])).toEqual([{ kind: 'your_turn', notify: true }, null]);
    // Google suit le moteur : seul en file dès l'inscription, « your_turn »
    // y est déjà marqué at_join (pas de sonnerie Web Push non plus).
    expect(replay('google', ['call-1-called', 'call-2-serving'])).toEqual([{ kind: 'your_turn', notify: false }, null]);
  });

  it('drop lancé après l’ajout du pass : plus aucune alerte de rang', () => {
    const running = real['drop-1-running']!;
    expect(running.pass.kind).toBe('queue');
    expect(running.queue.runningEventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(buildWalletView(running, new Date(running.at), { siteUrl: SITE }).phase).toBe('event_waiting');
    for (const provider of ['apple', 'google'] as const) {
      expect(replay(provider, ['drop-1-running'])).toEqual([null]);
    }
  });
});
