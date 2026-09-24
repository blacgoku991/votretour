import { describe, expect, it } from 'vitest';
import { buildWalletView, passLifecycle } from '../../src/server/wallet/view';
import type { WalletSnapshot, WalletView } from '../../src/server/wallet/types';
import { SITE, TRAP_NAME, eventSnapshot, snapshot, type Overrides } from './fixtures';
import snapshotsFromSql from './snapshots-0021.json';

/**
 * Tableaux du § 4 du plan Wallet, ligne à ligne. Ces tests verrouillent
 * ce que voit le client sur l'écran verrouillé : si l'un casse, c'est un
 * texte, une alerte ou un état de pass qui change pour de vrai.
 */

const NOW = new Date('2026-09-24T12:30:00Z');
const view = (o: Overrides = {}, now = NOW) => buildWalletView(snapshot(o), now, { siteUrl: SITE });
const eventView = (o: Overrides = {}, now = NOW) => buildWalletView(eventSnapshot(o), now, { siteUrl: SITE });

function expectRow(v: WalletView, row: Partial<WalletView>) {
  for (const [key, value] of Object.entries(row)) {
    expect(v[key as keyof WalletView], key).toEqual(value);
  }
}

describe('ticket de file : phases du § 4.1', () => {
  it('attente loin du seuil : chiffre exact, mise à jour silencieuse', () => {
    expectRow(view({ entry: { peopleAhead: 6 } }), {
      kind: 'queue', phase: 'waiting',
      headline: '6 personnes devant vous', statusText: 'Dans la file',
      position: { value: 6, label: '6' },
      alertKind: null, final: false, voided: false, googleState: 'ACTIVE', archiveAt: null,
    });
  });

  it('retour signalé et sur place changent seulement le statut', () => {
    expect(view({ entry: { status: 'returning', peopleAhead: 5 } }).statusText).toBe('Retour signalé');
    expect(view({ entry: { status: 'present', peopleAhead: 5 } }).statusText).toBe('Sur place');
  });

  it('au-delà de 20 : palier « Plus de 20 » partout', () => {
    const v = view({ entry: { peopleAhead: 21 } });
    expect(v.headline).toBe('Plus de 20 personnes devant vous');
    expect(v.position).toEqual({ value: null, label: 'Plus de 20' });
    expect(view({ entry: { peopleAhead: 20 } }).position).toEqual({ value: 20, label: '20' });
    // 25 et 40 : même rendu, donc aucun envoi pendant une longue file.
    const a = view({ entry: { peopleAhead: 25 } });
    const b = view({ entry: { peopleAhead: 40 } });
    expect({ ...a }).toEqual({ ...b });
  });

  it('bientôt votre tour (2 ≤ n ≤ seuil)', () => {
    expectRow(view({ entry: { peopleAhead: 2 } }), {
      phase: 'soon', headline: '2 personnes devant vous', statusText: 'Bientôt votre tour', alertKind: 'ahead_two',
    });
    // Seuil réglé à 4 par l'établissement.
    expect(view({ entry: { peopleAhead: 4 }, queue: { notifyAheadThreshold: 4 } }).phase).toBe('soon');
    expect(view({ entry: { peopleAhead: 5 }, queue: { notifyAheadThreshold: 4 } }).phase).toBe('waiting');
  });

  it('plus qu’une personne', () => {
    expectRow(view({ entry: { peopleAhead: 1 } }), {
      phase: 'one', headline: '1 personne devant vous', statusText: 'Plus qu’une personne devant vous', alertKind: 'ahead_one',
    });
  });

  it('c’est votre tour : appelé, ou personne devant', () => {
    for (const v of [view({ entry: { status: 'next', peopleAhead: 0 } }), view({ entry: { peopleAhead: 0 } })]) {
      expectRow(v, {
        phase: 'turn', headline: 'C’est votre tour', statusText: 'Présentez-vous', alertKind: 'your_turn',
        position: null, final: false, googleState: 'ACTIVE',
      });
    }
  });

  it('en cours : aucune nouvelle alerte', () => {
    expectRow(view({ entry: { status: 'serving', peopleAhead: 0 } }), {
      phase: 'serving', headline: 'C’est votre tour', statusText: 'En cours', alertKind: null,
    });
  });

  it('absent : titre inchangé, pas final (restaurable)', () => {
    expectRow(view({ entry: { status: 'absent', peopleAhead: 3 } }), {
      phase: 'absent', headline: '3 personnes devant vous',
      statusText: 'Marqué absent : présentez-vous à l’accueil', alertKind: null, final: false, voided: false,
    });
  });

  it('file en pause ou fermée : place conservée, pas un état final', () => {
    expectRow(view({ queue: { status: 'paused' }, entry: { peopleAhead: 4 } }), {
      phase: 'paused', headline: '4 personnes devant vous',
      statusText: 'File en pause : votre place est conservée', alertKind: null, final: false,
    });
    expectRow(view({ queue: { status: 'closed' }, entry: { peopleAhead: 0 } }), {
      phase: 'closed', headline: 'Vous êtes le prochain', statusText: 'File fermée pour le moment', final: false,
    });
  });

  it('merci : actif 2 h avec le lien d’avis, puis COMPLETED', () => {
    const o: Overrides = { entry: { status: 'completed', peopleAhead: 0, completedAt: '2026-09-24T12:20:00Z' } };
    const v = view(o);
    expectRow(v, {
      phase: 'done', headline: 'Merci de votre visite', statusText: 'Terminé', alertKind: 'visit_completed',
      final: true, voided: false, googleState: 'ACTIVE', archiveAt: '2026-09-24T14:20:00.000Z',
    });
    expect(v.links.review).toBe(`${SITE}/api/client/review/click?entry=Tk42abcdEFGH&source=wallet`);
    expect(view(o, new Date('2026-09-24T14:20:00Z')).googleState).toBe('COMPLETED');
  });

  it('merci sans avis : pas de lien d’avis (établissement sans lien, ou santé)', () => {
    const done: Overrides['entry'] = { status: 'completed', completedAt: '2026-09-24T12:20:00Z' };
    expect(view({ entry: done, location: { hasReviewUrl: false } }).links.review).toBeNull();
    expect(view({ entry: done, organization: { sendCompletionReview: false } }).links.review).toBeNull();
    // Jamais de lien d'avis avant la fin du passage.
    expect(view().links.review).toBeNull();
  });

  it('quitté par le client : annulé, sans alerte', () => {
    expectRow(view({ entry: { status: 'cancelled', statusActor: 'client', statusEvent: 'client_leave' } }), {
      phase: 'left', headline: 'Vous avez quitté la file', statusText: 'Clos', alertKind: null,
      final: true, voided: true, googleState: 'EXPIRED', position: null,
    });
  });

  it('retiré par le pro (retrait ou annulation) : annulé, avec alerte', () => {
    for (const entry of [
      { status: 'skipped' as const, statusActor: 'staff' as const, statusEvent: 'remove' },
      { status: 'cancelled' as const, statusActor: 'staff' as const, statusEvent: 'cancel' },
    ]) {
      expectRow(view({ entry }), {
        phase: 'removed', headline: 'Vous avez été retiré de la file', statusText: 'Clos', alertKind: 'removed',
        final: true, voided: true, googleState: 'EXPIRED',
      });
    }
  });

  it('expiré', () => {
    expectRow(view({ entry: { status: 'expired', statusActor: 'system' } }), {
      phase: 'expired', headline: 'Ticket expiré', statusText: 'Clos', alertKind: null,
      final: true, voided: true, googleState: 'EXPIRED',
    });
  });
});

describe('billet de drop : phases du § 4.2', () => {
  const issued = {
    publicId: 'Kp3AccessPublic01',
    tokenHash: 'a'.repeat(64),
    status: 'issued' as const,
    issuedAt: '2026-09-24T12:22:00Z',
    validUntil: '2026-09-24T12:32:00Z',
    graceUntil: '2026-09-24T12:37:00Z',
    redeemedAt: null,
    revokedAt: null,
    wave: 3,
  };

  it('en attente de sa vague : jamais d’alerte de position', () => {
    for (const n of [2, 1, 0]) {
      const v = eventView({ entry: { peopleAhead: n } });
      expect(v.phase).toBe('event_waiting');
      expect(v.alertKind).toBeNull();
      expect(v.statusText).toBe('En attente de votre vague');
    }
    expect(eventView({ entry: { peopleAhead: 12 } }).headline).toBe('12 personnes devant vous');
    expect(eventView({ entry: { peopleAhead: 0 } }).headline).toBe('Personne devant vous');
    expect(eventView({ entry: { peopleAhead: 30 } }).position).toEqual({ value: null, label: 'Plus de 20' });
  });

  it('accès ouvert : QR, heure limite, vague, numéro humain', () => {
    const v = eventView({ access: issued });
    expectRow(v, {
      kind: 'event', phase: 'event_access', headline: 'Accès ouvert',
      statusText: 'Présentez-vous avant 14:32', alertKind: 'event_access',
      final: false, voided: false, googleState: 'ACTIVE', archiveAt: '2026-09-24T12:37:00Z',
    });
    expect(v.qr).toEqual({ publicId: issued.publicId, tokenHash: issued.tokenHash, allowWallet: true });
    expect(v.event).toEqual({ name: 'Drop Aurore', ticketNumber: 'A-042', wave: 3, rules: 'Une paire par personne.' });
    expect(v.times).toMatchObject({ limitAt: issued.validUntil, graceUntil: issued.graceUntil, tz: 'Europe/Paris' });
    expect(v.brand.accentHex).toBe('#18143C');
    expect(v.links.ticket).toBe(`${SITE}/e/barber-house-bastille?event=44444444-4444-4444-8444-444444444444`);
  });

  it('QR Wallet refusé par l’événement : signalé, jamais masqué en silence', () => {
    expect(eventView({ access: issued, event: { walletQrEnabled: false } }).qr?.allowWallet).toBe(false);
  });

  it('tolérance dépassée avant le passage du cron : plus de QR', () => {
    const v = eventView({ access: issued }, new Date('2026-09-24T12:37:01Z'));
    expect(v.phase).toBe('event_expired');
    expect(v.qr).toBeNull();
  });

  it('utilisé : COMPLETED, QR retiré', () => {
    expectRow(eventView({ access: { ...issued, status: 'redeemed', redeemedAt: '2026-09-24T12:28:00Z' } }), {
      phase: 'event_used', headline: 'Utilisé', statusText: 'Billet utilisé à 14:28', alertKind: null,
      qr: null, final: true, voided: true, googleState: 'COMPLETED',
    });
  });

  it('accès expiré', () => {
    expectRow(eventView({ access: { ...issued, status: 'expired' } }), {
      phase: 'event_expired', headline: 'Accès expiré', statusText: 'Accès expiré', alertKind: null,
      qr: null, final: true, voided: true, googleState: 'EXPIRED',
    });
  });

  it('complet ou terminé : textes des notifications existantes', () => {
    expectRow(eventView({ event: { status: 'sold_out' }, entry: { status: 'cancelled', statusActor: 'staff', statusEvent: 'event_sold_out' } }), {
      phase: 'event_over', headline: 'Complet',
      statusText: 'Désolé, le stock disponible chez Barber House Bastille est désormais épuisé.',
      alertKind: 'event_sold_out', final: true, voided: true, googleState: 'EXPIRED',
    });
    expectRow(eventView({ access: { ...issued, status: 'revoked', revokedAt: '2026-09-24T12:25:00Z' }, event: { status: 'ended' } }), {
      phase: 'event_over', headline: 'Événement terminé',
      statusText: 'L’événement chez Barber House Bastille est maintenant terminé. Merci d’avoir participé.',
      alertKind: 'event_ended', qr: null,
    });
  });

  it('billet quitté hors vague : mêmes mots qu’en file', () => {
    expect(eventView({ entry: { status: 'cancelled', statusActor: 'client', statusEvent: 'client_leave' } }).phase).toBe('left');
  });
});

describe('fuseau horaire : heure du lieu, pas du serveur', () => {
  const access = (validUntil: string) => ({
    publicId: 'Kp3AccessPublic01', tokenHash: 'b'.repeat(64), status: 'issued' as const,
    issuedAt: validUntil, validUntil, graceUntil: validUntil, redeemedAt: null, revokedAt: null, wave: 1,
  });

  it('octobre : heure d’été (+02:00) puis d’hiver (+01:00)', () => {
    expect(eventView({ access: access('2026-10-24T12:32:00Z') }, new Date('2026-10-24T12:00:00Z')).statusText)
      .toBe('Présentez-vous avant 14:32');
    expect(eventView({ access: access('2026-10-26T12:32:00Z') }, new Date('2026-10-26T12:00:00Z')).statusText)
      .toBe('Présentez-vous avant 13:32');
  });

  it('autre fuseau : Nouméa', () => {
    const v = eventView({ access: access('2026-10-24T12:32:00Z'), location: { timezone: 'Pacific/Noumea' } }, new Date('2026-10-24T12:00:00Z'));
    expect(v.statusText).toBe('Présentez-vous avant 23:32');
  });
});

describe('cycle de vie du pass', () => {
  it('final, réouverture, archivage différé du « Merci »', () => {
    const done = view({ entry: { status: 'completed', completedAt: '2026-09-24T12:20:00Z' } });
    expect(passLifecycle(done, { state: 'active' }, NOW)).toEqual({ final: true, nextRunAfter: '2026-09-24T14:20:00.000Z' });
    // Déjà final : on ne le redit pas ; à +2 h, plus rien à programmer.
    expect(passLifecycle(done, { state: 'final' }, new Date('2026-09-24T14:21:00Z'))).toEqual({});
    // Restauration par le pro : le pass redevient actif.
    expect(passLifecycle(view(), { state: 'final' }, NOW)).toEqual({ reopen: true });
    expect(passLifecycle(view(), { state: 'active' }, NOW)).toEqual({});
  });
});

describe('instantanés réels (migration 0021, lot W0)', () => {
  /*
   * Produits par wallet_pass_snapshot() sur une base de vérification :
   * même ticket joint sous le prénom « Zébulon », puis quitté, terminé,
   * retiré, drop en attente, vague émise, drop complet. Ils verrouillent
   * le contrat entre la fonction SQL et la vue : un champ renommé d'un
   * côté casse ce test.
   */
  const real = snapshotsFromSql as unknown as Record<string, WalletSnapshot>;
  const build = (label: string) => buildWalletView(real[label]!, new Date(real[label]!.at), { siteUrl: SITE });

  it('la fonction SQL ne livre aucun prénom', () => {
    expect(JSON.stringify(real)).not.toContain(TRAP_NAME);
  });

  it.each([
    ['queue-waiting', 'waiting', '3 personnes devant vous', null],
    ['queue-left', 'left', 'Vous avez quitté la file', null],
    ['queue-done', 'done', 'Merci de votre visite', 'visit_completed'],
    ['queue-removed', 'removed', 'Vous avez été retiré de la file', 'removed'],
    ['event-waiting', 'event_waiting', '2 personnes devant vous', null],
    ['event-access', 'event_access', 'Accès ouvert', 'event_access'],
    ['event-over', 'event_over', 'Complet', 'event_sold_out'],
  ] as const)('%s → %s', (label, phase, headline, alertKind) => {
    const v = build(label);
    expect(v.phase).toBe(phase);
    expect(v.headline).toBe(headline);
    expect(v.alertKind).toBe(alertKind);
    expect(JSON.stringify(v)).not.toContain(TRAP_NAME);
  });

  it('détails : avis mesuré, numéro humain, QR et vague', () => {
    expect(build('queue-done').links.review).toMatch(/\/api\/client\/review\/click\?entry=[0-9A-Za-z]+&source=wallet$/);
    const access = build('event-access');
    expect(access.event).toMatchObject({ name: 'Drop Sonde', ticketNumber: 'A-002', wave: 1 });
    expect(access.qr?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(access.brand.accentHex).toBe('#18143C');
    expect(build('event-over').qr).toBeNull();
  });
});

describe('minimisation et marque', () => {
  it('aucun prénom dans aucune sortie', () => {
    const all = [
      view(), view({ entry: { status: 'completed', completedAt: '2026-09-24T12:20:00Z' } }),
      eventView(), eventView({ access: {
        publicId: 'Kp3AccessPublic01', tokenHash: 'c'.repeat(64), status: 'issued', issuedAt: '2026-09-24T12:22:00Z',
        validUntil: '2026-09-24T12:32:00Z', graceUntil: '2026-09-24T12:37:00Z', redeemedAt: null, revokedAt: null, wave: 2,
      } }),
    ];
    for (const v of all) expect(JSON.stringify(v)).not.toContain(TRAP_NAME);
  });

  it('logo : fichier local de MEDIA_ROOT, URL HTTP refusée', () => {
    expect(view().brand.logo).toEqual({ kind: 'local', relativePath: 'org/logo.png', publicUrl: `${SITE}/media/org/logo.png` });
    expect(view({ location: { logoUrl: 'http://example.com/logo.png' } }).brand.logo).toBeNull();
    expect(view({ location: { logoUrl: 'https://cdn.example.com/l.png' } }).brand.logo).toEqual({ kind: 'url', url: 'https://cdn.example.com/l.png' });
    expect(view({ location: { logoUrl: `${SITE}/media/../etc/passwd.png` } }).brand.logo).toBeNull();
  });

  it('accent inconnu → signal ; adresse complète', () => {
    const v = view({ organization: { brandAccent: 'fuchsia' } });
    expect(v.brand.accent).toBe('signal');
    expect(v.brand.accentHex).toBe('#FF4B1F');
    expect(v.brand.address).toBe('12 rue de la Roquette, 75011 Paris');
    expect(v.staffName).toBe('Karim');
    expect(v.links.ticket).toBe(`${SITE}/e/barber-house-bastille`);
  });
});
