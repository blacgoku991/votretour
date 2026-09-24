import { describe, it, expect } from 'vitest';
import {
  CLIENT_STATUS_LABEL,
  QUEUE_STATUS_LABEL,
  STAFF_STATUS_LABEL,
  notificationCopy,
  peopleAheadLabel,
  peopleAheadUnit,
  waitingCountLabel,
} from '@/lib/copy';
import type { EntryStatus, NotificationKind, QueueStatus } from '@/lib/types';

/**
 * Contrat de non-régression des textes vus par les barbiers et leurs
 * clients (lot R0 du chantier « profils métier »).
 *
 * Ce fichier est écrit AVANT le chantier, sur le code tel qu'il tourne
 * aujourd'hui. Chaque chaîne est recopiée littéralement, apostrophes
 * typographiques comprises : aucune expression régulière, aucun
 * `toContain`. Les profils métier ajoutent leurs propres textes dans de
 * nouveaux modules (`lib/profiles/copy.ts`) ; ceux-ci ne doivent JAMAIS
 * bouger. Si ce test casse, c'est qu'un texte déjà envoyé à des clients
 * a changé : la correction se fait dans le code, pas dans ce fichier
 * (sauf décision explicite de reformuler, à consigner dans la PR).
 */

type Context = Parameters<typeof notificationCopy>[1];
type Copy = { title: string; body: string };

/** Établissement ordinaire, sans apostrophe. */
const BARBER: Context = { locationName: 'Barber House' };
/** Nom avec apostrophes typographiques : il doit passer tel quel. */
const ANNA: Context = { locationName: 'L’Atelier d’Anna' };

/**
 * Une entrée par `NotificationKind`. Le type `Record` rend l'oubli d'un
 * genre impossible : ajouter une valeur à `NotificationKind` dans
 * `lib/types.ts` fait échouer `tsc` tant que son texte n'est pas figé ici.
 */
const EXPECTED: Record<NotificationKind, Array<{ ctx: Context; copy: Copy }>> = {
  ahead_two: [
    {
      ctx: { ...BARBER, peopleAhead: 2 },
      copy: { title: 'Barber House', body: 'Plus que 2 personnes devant vous.' },
    },
    {
      // Le seuil est réglable (notify_ahead_threshold) : le chiffre suit.
      ctx: { ...ANNA, peopleAhead: 3, clientName: 'Sarah' },
      copy: { title: 'L’Atelier d’Anna', body: 'Plus que 3 personnes devant vous.' },
    },
    {
      // Sans position connue, le texte retombe sur 2.
      ctx: BARBER,
      copy: { title: 'Barber House', body: 'Plus que 2 personnes devant vous.' },
    },
  ],
  ahead_one: [
    {
      ctx: { ...BARBER, peopleAhead: 1 },
      copy: { title: 'Barber House', body: 'Plus qu’une personne devant vous. Commencez à revenir.' },
    },
    {
      ctx: { ...ANNA, clientName: null },
      copy: { title: 'L’Atelier d’Anna', body: 'Plus qu’une personne devant vous. Commencez à revenir.' },
    },
  ],
  your_turn: [
    {
      ctx: { ...BARBER, peopleAhead: 0 },
      copy: { title: 'C’est votre tour', body: 'Présentez-vous maintenant chez Barber House.' },
    },
    {
      // Le prénom n'apparaît jamais sur l'écran verrouillé.
      ctx: { ...ANNA, clientName: 'Sarah' },
      copy: { title: 'C’est votre tour', body: 'Présentez-vous maintenant chez L’Atelier d’Anna.' },
    },
  ],
  visit_completed: [
    {
      ctx: BARBER,
      copy: { title: 'Merci pour votre visite', body: 'Merci d’être passé chez Barber House.' },
    },
    {
      ctx: { ...ANNA, clientName: 'Sarah' },
      copy: { title: 'Merci pour votre visite', body: 'Merci d’être passé chez L’Atelier d’Anna.' },
    },
  ],
  removed: [
    {
      ctx: BARBER,
      copy: { title: 'Barber House', body: 'Vous avez été retiré de la file.' },
    },
  ],
  queue_closed: [
    {
      ctx: ANNA,
      copy: { title: 'L’Atelier d’Anna', body: 'La file vient de fermer.' },
    },
  ],
  event_access: [
    {
      ctx: BARBER,
      copy: {
        title: 'Votre accès est prêt 🎟️',
        body: 'Présentez votre laisser-passer chez Barber House dans le délai indiqué.',
      },
    },
  ],
  event_sold_out: [
    {
      ctx: BARBER,
      copy: {
        title: 'Stock épuisé',
        body: 'Désolé, le stock disponible chez Barber House est désormais épuisé.',
      },
    },
  ],
  event_ended: [
    {
      ctx: ANNA,
      copy: {
        title: 'Événement terminé',
        body: 'L’événement chez L’Atelier d’Anna est maintenant terminé. Merci d’avoir participé.',
      },
    },
  ],
  custom: [
    {
      // Les messages libres du pro sont rédigés côté serveur ; le texte
      // de repli, lui, est fixe.
      ctx: BARBER,
      copy: { title: 'Barber House', body: 'Mise à jour de votre place.' },
    },
  ],
};

describe('contrat walkin : textes de notification', () => {
  const cases = (Object.keys(EXPECTED) as NotificationKind[]).flatMap((kind) =>
    EXPECTED[kind].map((c, i) => ({ kind, i, ...c })),
  );

  it.each(cases)('$kind (cas $i) : titre et corps exacts', ({ kind, ctx, copy }) => {
    expect(notificationCopy(kind, ctx)).toStrictEqual(copy);
  });

  it('aucun texte ne contient d’apostrophe droite', () => {
    for (const { kind, ctx } of cases) {
      const { title, body } = notificationCopy(kind, ctx);
      expect(`${title} ${body}`).not.toMatch(/'/);
    }
  });
});

describe('contrat walkin : libellés des écrans', () => {
  it('statuts vus par le client', () => {
    expect(CLIENT_STATUS_LABEL).toStrictEqual({
      waiting: 'Dans la file',
      notified: 'Votre tour approche',
      returning: 'Vous revenez',
      present: 'Vous êtes sur place',
      next: 'Vous êtes le prochain',
      serving: 'C’est votre tour',
      completed: 'Visite terminée',
      absent: 'Vous avez été noté absent',
      skipped: 'Vous avez été retiré de la file',
      cancelled: 'Vous avez quitté la file',
      expired: 'Votre place a expiré',
    } satisfies Record<EntryStatus, string>);
  });

  it('statuts vus par le pro', () => {
    expect(STAFF_STATUS_LABEL).toStrictEqual({
      waiting: 'En attente',
      notified: 'Prévenu',
      returning: 'Revient',
      present: 'Présent',
      next: 'Appelé',
      serving: 'En cours',
      completed: 'Terminé',
      absent: 'Absent',
      skipped: 'Retiré',
      cancelled: 'Parti',
      expired: 'Expiré',
    } satisfies Record<EntryStatus, string>);
  });

  it('état de la file', () => {
    expect(QUEUE_STATUS_LABEL).toStrictEqual({
      open: 'File ouverte',
      paused: 'File en pause',
      closed: 'File fermée',
    } satisfies Record<QueueStatus, string>);
  });

  it('position du client : jamais de numéro, seulement des personnes', () => {
    expect([-1, 0, 1, 2, 12].map(peopleAheadLabel)).toStrictEqual([
      'C’est votre tour',
      'C’est votre tour',
      '1 personne devant vous',
      '2 personnes devant vous',
      '12 personnes devant vous',
    ]);
    expect([0, 1, 5].map(peopleAheadUnit)).toStrictEqual([
      'à vous de jouer',
      'personne devant vous',
      'personnes devant vous',
    ]);
    expect([0, 1, 7].map(waitingCountLabel)).toStrictEqual([
      'Personne dans la file',
      '1 personne dans la file',
      '7 personnes dans la file',
    ]);
  });
});
