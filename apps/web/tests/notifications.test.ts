import { describe, it, expect } from 'vitest';
import { notificationCopy, peopleAheadLabel, peopleAheadUnit } from '@/lib/copy';
import { buildApnsBody } from '@/server/notifications/apns';

/**
 * Les textes de notification sont un CONTRAT avec l'utilisateur : ils
 * ont été spécifiés mot pour mot. Un test les verrouille, pour qu'une
 * reformulation involontaire se voie tout de suite.
 */
describe('textes de notification', () => {
  it('annonce le palier à deux personnes', () => {
    const copy = notificationCopy('ahead_two', { locationName: 'Barber House', peopleAhead: 2 });
    expect(copy.body).toBe('Plus que 2 personnes devant vous.');
    expect(copy.title).toBe('Barber House');
  });

  it("annonce qu'il ne reste qu'une personne et invite à revenir", () => {
    const copy = notificationCopy('ahead_one', { locationName: 'Barber House', peopleAhead: 1 });
    expect(copy.body).toBe("Plus qu'une personne devant vous. Commencez à revenir.");
  });

  it("annonce le tour du client", () => {
    const copy = notificationCopy('your_turn', { locationName: 'Barber House' });
    expect(copy.title).toBe("C'est votre tour");
    expect(copy.body).toContain('Présentez-vous maintenant');
  });

  it('remercie en fin de visite', () => {
    const copy = notificationCopy('visit_completed', { locationName: 'Barber House' });
    expect(copy.title).toBe('Merci pour votre visite');
    expect(copy.body).toContain('Barber House');
  });
});

describe('affichage de la position', () => {
  it("n'affiche jamais de numéro de ticket, seulement des personnes", () => {
    expect(peopleAheadLabel(4)).toBe('4 personnes devant vous');
    expect(peopleAheadLabel(1)).toBe('1 personne devant vous');
    expect(peopleAheadLabel(0)).toBe("C'est votre tour");
    expect(peopleAheadLabel(-3)).toBe("C'est votre tour");
  });

  it('accorde le singulier', () => {
    expect(peopleAheadUnit(1)).toBe('personne devant vous');
    expect(peopleAheadUnit(2)).toBe('personnes devant vous');
  });
});

/**
 * Apple impose `target-content-id` pour un App Clip servant plusieurs
 * commerces : c'est lui qui route la notification vers la bonne
 * instance. Sans ce champ, un client peut recevoir la notification d'un
 * commerce dans l'App Clip d'un autre.
 */
describe('charge utile APNs', () => {
  const base = {
    title: "C'est votre tour",
    body: 'Présentez-vous maintenant chez Barber House.',
    targetContentId: 'https://votretour.app/e/barber-house',
  };

  it("porte l'URL d'invocation en target-content-id", () => {
    const { aps } = buildApnsBody(base);
    expect(aps['target-content-id']).toBe('https://votretour.app/e/barber-house');
  });

  it('ne fabrique pas de target-content-id quand il est absent', () => {
    const { aps } = buildApnsBody({ title: 'x', body: 'y' });
    expect(aps).not.toHaveProperty('target-content-id');
  });

  it("marque « c'est votre tour » comme sensible au temps", () => {
    const { aps } = buildApnsBody({ ...base, interruptionLevel: 'time-sensitive' });
    expect(aps['interruption-level']).toBe('time-sensitive');
  });

  it('regroupe les mises à jour d’un même ticket par fil', () => {
    const { aps } = buildApnsBody({ ...base, threadId: 'ticket-abc' });
    expect(aps['thread-id']).toBe('ticket-abc');
  });

  it("transporte le lien d'avis Google en données applicatives", () => {
    const { vt } = buildApnsBody({
      ...base,
      data: { kind: 'visit_completed', reviewUrl: 'https://g.page/r/xyz' },
    });
    expect(vt.reviewUrl).toBe('https://g.page/r/xyz');
  });

  it('permet de couper le son sans le remplacer par le son par défaut', () => {
    const { aps } = buildApnsBody({ ...base, sound: null });
    expect(aps).not.toHaveProperty('sound');
  });
});
