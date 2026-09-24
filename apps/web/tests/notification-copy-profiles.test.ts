import { describe, expect, it } from 'vitest';
import { notificationCopy } from '@/lib/copy';
import {
  clientAheadLabel,
  deskDestination,
  formatAmount,
  formatClock,
  profileNotificationCopy,
  type ProfileCopyContext,
} from '@/lib/profiles/copy';
import {
  BASE_NOTIFICATION_KINDS,
  PROFILE_NOTIFICATION_KINDS,
  QUEUE_PROFILES,
  type ProfileNotificationKind,
} from '@/lib/profiles';

/**
 * Les textes de notification sont un CONTRAT : en walkin et en event, ce
 * sont exactement ceux d'aujourd'hui ; ailleurs, ceux du métier, sans
 * jamais d'immatriculation complète ni de prénom sur l'écran verrouillé.
 */

const NBSP = String.fromCharCode(0xa0);
const nb = (s: string) => s.replace(/ /g, NBSP);

const WALKIN_CONTEXTS = [
  { locationName: 'Barber House' },
  { locationName: 'Barber House', peopleAhead: 2 },
  { locationName: 'Salon Lumière', peopleAhead: 5, clientName: 'Camille' },
  { locationName: 'L’Atelier', peopleAhead: 0, clientName: null },
];

describe('walkin et event : strictement les textes d’aujourd’hui', () => {
  for (const profile of ['walkin', 'event'] as const) {
    it(`${profile} : identique à notificationCopy pour chaque genre`, () => {
      for (const ctx of WALKIN_CONTEXTS) {
        for (const kind of BASE_NOTIFICATION_KINDS) {
          expect(profileNotificationCopy(kind, { ...ctx, profile }), `${profile}/${kind}`).toStrictEqual(
            notificationCopy(kind, ctx),
          );
        }
      }
    });
  }

  it('sans profil, c’est walkin', () => {
    for (const kind of BASE_NOTIFICATION_KINDS) {
      expect(profileNotificationCopy(kind, { locationName: 'Barber House', peopleAhead: 2 })).toStrictEqual(
        notificationCopy(kind, { locationName: 'Barber House', peopleAhead: 2 }),
      );
    }
  });

  it('les genres nouveaux retombent sur le texte par défaut d’aujourd’hui', () => {
    for (const kind of ['stage_update', 'quote_ready', 'recall'] as const) {
      expect(profileNotificationCopy(kind, { profile: 'walkin', locationName: 'Barber House' })).toStrictEqual(
        notificationCopy('custom', { locationName: 'Barber House' }),
      );
    }
  });

  it('ignore les champs métier (un détail égaré ne change rien)', () => {
    const ctx: ProfileCopyContext = {
      profile: 'walkin',
      locationName: 'Barber House',
      details: { registration: 'AB-123-CD' },
      ticketNo: 'A-042',
      deskLabel: 'Guichet 3',
    };
    expect(profileNotificationCopy('your_turn', ctx)).toStrictEqual(notificationCopy('your_turn', ctx));
  });

  it('les textes littéraux des barbiers', () => {
    expect(profileNotificationCopy('ahead_two', { locationName: 'Barber House', peopleAhead: 2 })).toEqual({
      title: 'Barber House',
      body: 'Plus que 2 personnes devant vous.',
    });
    expect(profileNotificationCopy('your_turn', { locationName: 'Barber House' })).toEqual({
      title: 'C’est votre tour',
      body: 'Présentez-vous maintenant chez Barber House.',
    });
  });
});

const GARAGE: ProfileCopyContext = {
  profile: 'vehicle',
  locationName: 'Garage des Tilleuls',
  details: { registration: 'AB-123-CD', model: 'Peugeot 208' },
  hours: { status: 'open', closesAt: '19:00' },
};

describe('atelier véhicule', () => {
  it('prêt : immatriculation masquée et heure de fermeture réelle', () => {
    expect(profileNotificationCopy('your_turn', GARAGE)).toEqual({
      title: 'Votre véhicule est prêt',
      body: `Votre Peugeot 208 ••-••3-CD vous attend chez Garage des Tilleuls. Ouvert jusqu’à ${nb('19 h 00')}.`,
    });
  });

  it('sans horaires connus, rien n’est inventé', () => {
    const { body } = profileNotificationCopy('your_turn', { ...GARAGE, hours: null });
    expect(body).toBe('Votre Peugeot 208 ••-••3-CD vous attend chez Garage des Tilleuls.');
  });

  it('fermé : annonce la réouverture', () => {
    const { body } = profileNotificationCopy('your_turn', {
      ...GARAGE,
      hours: { status: 'closed', reopensAt: '08:30', reopensDay: 'tomorrow' },
    });
    expect(body).toMatch(new RegExp(`Réouverture demain à ${nb('08 h 30')}\\.$`));
  });

  it('devis : montant avec centimes et libellé', () => {
    const t = profileNotificationCopy('quote_ready', {
      ...GARAGE,
      quote: { amountCents: 18400, label: 'Plaquettes + disques AV.' },
    });
    expect(t.title).toBe(`Devis à valider · ${formatAmount(18400)}`);
    expect(formatAmount(18400)).toMatch(/^184,00\s€$/u);
    expect(t.body).toBe('Plaquettes + disques AV. Touchez pour accepter ou refuser.');
  });

  it('étapes : pièce, réparation', () => {
    expect(profileNotificationCopy('stage_update', { ...GARAGE, stage: 'waiting_parts' }).body).toBe(
      'Une pièce est commandée pour votre Peugeot 208. Nous vous prévenons dès sa réception.',
    );
    expect(profileNotificationCopy('stage_update', { ...GARAGE, stage: 'in_repair' }).body).toBe(
      'C’est parti : votre Peugeot 208 est en réparation.',
    );
  });

  it('rappel et remerciement', () => {
    expect(profileNotificationCopy('recall', GARAGE).body).toBe(
      `Votre Peugeot 208 vous attend toujours. Nous fermons à ${nb('19 h 00')}.`,
    );
    expect(profileNotificationCopy('visit_completed', GARAGE).title).toBe('Merci pour votre confiance');
  });

  it('sans modèle : « votre véhicule »', () => {
    const { body } = profileNotificationCopy('your_turn', { profile: 'vehicle', locationName: 'G', details: { registration: 'AB-123-CD' } });
    expect(body).toBe('Votre véhicule ••-••3-CD vous attend chez G.');
  });

  it('jamais l’immatriculation complète, ni le prénom, quel que soit le genre', () => {
    const ctx = { ...GARAGE, clientName: 'Camille', body: 'Votre AB 123 CD est prête', quote: { amountCents: 100, label: 'x' } };
    for (const kind of PROFILE_NOTIFICATION_KINDS) {
      for (const stage of [null, 'received', 'diagnosis', 'quote_pending', 'waiting_parts', 'in_repair', 'ready'] as const) {
        const t = profileNotificationCopy(kind, { ...ctx, stage });
        const all = `${t.title} ${t.body}`;
        expect(all.replace(/[^A-Z0-9]/gi, '').toUpperCase(), `${kind}/${stage}`).not.toContain('AB123CD');
        expect(all, `${kind}/${stage}`).not.toContain('Camille');
      }
    }
    // Le message libre du pro est lui aussi masqué.
    expect(profileNotificationCopy('custom', ctx).body).toBe('Votre ••-••3-CD est prête');
  });
});

describe('atelier appareil', () => {
  const PHONE: ProfileCopyContext = {
    profile: 'device',
    locationName: 'Répar’Express',
    details: { deviceKind: 'phone', model: 'iPhone 13' },
    ticketNo: '0042',
    hours: { status: 'open', closesAt: '19:00' },
  };

  it('prêt : le dossier, sans accord grammatical hasardeux', () => {
    expect(profileNotificationCopy('your_turn', PHONE)).toEqual({
      title: 'Votre appareil est prêt',
      body: `Réparation terminée : votre iPhone 13 (dossier 0042) vous attend chez Répar’Express. Ouvert jusqu’à ${nb('19 h 00')}.`,
    });
  });

  it('sans modèle : le type d’appareil', () => {
    const { body } = profileNotificationCopy('stage_update', {
      profile: 'device',
      locationName: 'X',
      details: { deviceKind: 'tablet' },
      stage: 'waiting_parts',
    });
    expect(body).toBe('Une pièce est commandée pour votre tablette. Nous vous prévenons dès sa réception.');
  });
});

describe('table', () => {
  const RESTO: ProfileCopyContext = { profile: 'table', locationName: 'Chez Margaux', graceMinutes: 5 };

  it('groupes, table prête et délai réel', () => {
    expect(profileNotificationCopy('ahead_two', { ...RESTO, peopleAhead: 2 }).body).toBe(
      'Plus que 2 tables avant la vôtre. Restez dans les parages.',
    );
    expect(profileNotificationCopy('ahead_one', RESTO).body).toBe('Vous êtes les prochains. Rapprochez-vous de l’entrée.');
    expect(profileNotificationCopy('your_turn', RESTO)).toEqual({
      title: 'Votre table est prête',
      body: `Présentez-vous à l’accueil de Chez Margaux dans les 5${NBSP}minutes.`,
    });
    expect(profileNotificationCopy('your_turn', { ...RESTO, graceMinutes: 1 }).body).toMatch(/dans la minute\.$/);
    expect(profileNotificationCopy('your_turn', { ...RESTO, graceMinutes: 0 }).body).toBe('Présentez-vous à l’accueil de Chez Margaux.');
  });

  it('rappel : les minutes qui restent, accordées', () => {
    expect(profileNotificationCopy('recall', { ...RESTO, remainingMinutes: 2 }).body).toBe(`Votre table vous attend encore 2${NBSP}minutes.`);
    expect(profileNotificationCopy('recall', { ...RESTO, remainingMinutes: 1 }).body).toBe(`Votre table vous attend encore 1${NBSP}minute.`);
    expect(profileNotificationCopy('recall', { ...RESTO, remainingMinutes: 0 }).body).toMatch(/vite/);
  });

  it('jamais de prénom', () => {
    for (const kind of PROFILE_NOTIFICATION_KINDS) {
      const t = profileNotificationCopy(kind, { ...RESTO, clientName: 'Karim' });
      expect(`${t.title} ${t.body}`, kind).not.toContain('Karim');
    }
  });
});

describe('guichet', () => {
  const DESK: ProfileCopyContext = { profile: 'desk', locationName: 'Maison des services', ticketNo: 'A-042', deskLabel: 'Guichet 3' };

  it('le numéro et le guichet, sur l’écran verrouillé', () => {
    expect(profileNotificationCopy('your_turn', DESK)).toEqual({
      title: 'A-042 · Guichet 3',
      body: 'Présentez-vous maintenant au guichet 3.',
    });
    expect(profileNotificationCopy('recall', DESK).body).toBe('Dernier appel : ticket A-042, guichet 3.');
    expect(profileNotificationCopy('ahead_two', { ...DESK, peopleAhead: 2 }).body).toBe(
      'Plus que 2 personnes avant vous. Ticket A-042.',
    );
  });

  it('destinations accordées, libellé inconnu cité tel quel', () => {
    expect(deskDestination('Salle 1')).toBe('en salle 1');
    expect(deskDestination('Box 2')).toBe('au box 2');
    expect(deskDestination('Caisse 4')).toBe('à la caisse 4');
    expect(deskDestination('Accueil B')).toBe(`à «${NBSP}Accueil B${NBSP}»`);
  });

  it('sans guichet ni numéro, un texte neutre', () => {
    expect(profileNotificationCopy('your_turn', { profile: 'desk', locationName: 'X' })).toEqual({
      title: 'C’est votre tour',
      body: 'Présentez-vous maintenant.',
    });
  });

  it('santé : ni prénom, ni motif', () => {
    for (const kind of PROFILE_NOTIFICATION_KINDS) {
      const t = profileNotificationCopy(kind, { ...DESK, clientName: 'Mme Durand', details: { reasonText: 'Prise de sang' } });
      const all = `${t.title} ${t.body}`;
      expect(all, kind).not.toContain('Durand');
      expect(all, kind).not.toContain('Prise de sang');
    }
  });
});

describe('boutique', () => {
  it('retrait : la commande ; conseil : le texte des barbiers', () => {
    expect(
      profileNotificationCopy('your_turn', { profile: 'retail', locationName: 'La Mercerie', stage: 'ready', details: { orderRef: '1234' } }),
    ).toEqual({ title: 'Votre commande est prête', body: `Votre commande n°${NBSP}1234 est prête à la caisse de La Mercerie.` });
    expect(profileNotificationCopy('your_turn', { profile: 'retail', locationName: 'La Mercerie' })).toEqual(
      notificationCopy('your_turn', { locationName: 'La Mercerie' }),
    );
  });
});

describe('tous profils', () => {
  it('chaque genre a un titre et un corps non vides, avec l’apostrophe typographique', () => {
    for (const profile of QUEUE_PROFILES) {
      for (const kind of PROFILE_NOTIFICATION_KINDS as readonly ProfileNotificationKind[]) {
        const t = profileNotificationCopy(kind, { ...GARAGE, profile, ticketNo: 'A-042', deskLabel: 'Guichet 3', stage: 'ready' });
        expect(t.title.trim().length, `${profile}/${kind}`).toBeGreaterThan(0);
        expect(t.body.trim().length, `${profile}/${kind}`).toBeGreaterThan(0);
        if (profile !== 'walkin' && profile !== 'event') {
          expect(`${t.title} ${t.body}`, `${profile}/${kind}`).not.toMatch(/\p{L}'\p{L}/u);
        }
      }
    }
  });

  it('heures au format « 19 h 00 », insécables', () => {
    expect(formatClock('19:00')).toBe(nb('19 h 00'));
    expect(formatClock('8:30')).toBe(nb('08 h 30'));
    expect(formatClock('bientôt')).toBe('bientôt');
  });

  it('libellés d’attente du client', () => {
    expect(clientAheadLabel('walkin', 3)).toBe('3 personnes devant vous');
    expect(clientAheadLabel('table', 2)).toBe('2 groupes avant vous');
    expect(clientAheadLabel('table', 1)).toBe('1 groupe avant vous');
    expect(clientAheadLabel('table', 0)).toBe('Vous êtes les prochains');
    expect(clientAheadLabel('vehicle', 3)).toBe('3 véhicules avant le vôtre');
    expect(clientAheadLabel('desk', 12)).toBe('12 personnes devant vous');
  });
});
