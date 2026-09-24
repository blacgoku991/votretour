import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TVBoard } from '../src/app/app/[org]/ecran/TVBoard';
import {
  deskView,
  pickupView,
  sinceOf,
  statusLabelFor,
  tableView,
  tvScreenFor,
  workshopView,
} from '../src/app/app/[org]/ecran/tv/model';
import type {
  DeskDisplaySnapshot,
  DisplaySnapshot,
  RetailDisplaySnapshot,
  TableDisplaySnapshot,
  WalkinDisplaySnapshot,
  WorkshopDisplaySnapshot,
} from '../src/server/display';

/**
 * L'écran de salle par métier (lot P5). Le téléviseur est public : ce test
 * vérifie l'aiguillage par profil, puis ce que l'écran REND réellement
 * (balisage serveur de TVBoard), pas seulement ce qu'il reçoit :
 *  - une immatriculation n'est jamais rendue en clair, même si le serveur
 *    en envoyait une par erreur ;
 *  - au guichet, aucun prénom n'est rendu, même si le serveur en envoyait ;
 *  - l'écran des barbiers garde sa forme.
 */

const HEAD = {
  queue: { id: '11111111-1111-1111-1111-111111111111', status: 'open' as const },
  location: { name: 'Garage Martin — Lyon 7' },
  counts: { active: 9, waiting: 2, serving: 4, upcoming: 3, completedToday: 5 },
};
const EMPTY_LISTS = { staff: [] as [], serving: [] as [], upcoming: [] as [] };

const walkin: WalkinDisplaySnapshot = {
  ...HEAD,
  location: { name: 'Barber House — Paris 11' },
  staff: [{ id: 's1', name: 'Yanis', isOnBreak: false, isServing: true }],
  serving: [{ id: 'e1', name: 'Karim', staffName: 'Yanis' }],
  upcoming: [{ id: 'e2', called: false, initials: 'MB' }],
};

const vehicle: WorkshopDisplaySnapshot = {
  ...HEAD,
  ...EMPTY_LISTS,
  profile: 'vehicle',
  workshop: {
    counts: { intake: 2, workshop: 3, waiting: 1, ready: 3, inWorkshop: 6, receivedToday: 9, handedOverToday: 4 },
    ready: [
      { id: 'r1', registrationMasked: '••-••3-CD', ticketNo: null, deviceKind: null, readySince: '2026-09-24T12:32:00Z' },
      { id: 'r2', registrationMasked: '•••• •B 75', ticketNo: null, deviceKind: null, readySince: '2026-09-24T11:05:00Z' },
      // Un serveur défaillant qui enverrait la plaque en clair : refusée.
      { id: 'r3', registrationMasked: 'GH-907-TB', ticketNo: null, deviceKind: null, readySince: '2026-09-24T10:00:00Z' },
    ],
  },
};

const device: WorkshopDisplaySnapshot = {
  ...HEAD,
  ...EMPTY_LISTS,
  location: { name: 'PhoneFix — Nantes' },
  profile: 'device',
  workshop: {
    counts: { intake: 1, workshop: 1, waiting: 0, ready: 1, inWorkshop: 2, receivedToday: 3, handedOverToday: 0 },
    ready: [{ id: 'd1', registrationMasked: null, ticketNo: '0042', deviceKind: 'phone', readySince: '2026-09-24T12:00:00Z' }],
  },
};

const table: TableDisplaySnapshot = {
  ...HEAD,
  ...EMPTY_LISTS,
  location: { name: 'Chez Paul — Bordeaux' },
  profile: 'table',
  tables: {
    counts: { groupsWaiting: 6, coversWaiting: 18, groupsCalled: 2, groupsSeatedToday: 14, coversSeatedToday: 52 },
    ready: [
      { id: 't1', ticketNo: null, name: 'Karim', partySize: 4, calledAt: '2026-09-24T19:42:00Z' },
      { id: 't2', ticketNo: 'A-012', name: null, partySize: 2, calledAt: '2026-09-24T19:44:00Z' },
    ],
  },
};

const desk: DeskDisplaySnapshot = {
  ...HEAD,
  ...EMPTY_LISTS,
  location: { name: 'Maison des services — Lille' },
  profile: 'desk',
  desks: {
    counts: { waiting: 12, called: 2, servedToday: 48 },
    currentCalls: [
      { id: 'c1', ticketNo: 'A-042', deskLabel: 'Guichet 3', calledAt: '2026-09-24T14:32:00Z' },
      { id: 'c2', ticketNo: 'A-041', deskLabel: 'Guichet 1', calledAt: '2026-09-24T14:30:00Z' },
    ],
    recentCalls: [{ id: 'c3', ticketNo: 'A-040', deskLabel: null, calledAt: '2026-09-24T14:20:00Z' }],
  },
};

const retail: RetailDisplaySnapshot = {
  ...HEAD,
  ...EMPTY_LISTS,
  location: { name: 'Atelier Nomade — Rennes' },
  profile: 'retail',
  pickup: {
    counts: { waiting: 3, called: 1, preparing: 2, ready: 3 },
    ready: [
      { id: 'p1', orderRefTail: '8731', ticketNo: null, readySince: '2026-09-24T15:00:00Z' },
      { id: 'p2', orderRefTail: null, ticketNo: 'A-007', readySince: '2026-09-24T14:50:00Z' },
      // Ni fin de commande ni numéro : comptée, pas montrée.
      { id: 'p3', orderRefTail: null, ticketNo: null, readySince: '2026-09-24T14:40:00Z' },
    ],
    calls: [{ id: 'k1', ticketNo: 'A-014', calledAt: '2026-09-24T15:02:00Z' }],
  },
};

function render(snapshot: DisplaySnapshot, variant: 'full' | 'preview' = 'full'): string {
  return renderToStaticMarkup(createElement(TVBoard, {
    orgSlug: 'demo',
    organizationName: 'Démo',
    logoUrl: null,
    initialSnapshot: snapshot,
    queues: [{ id: snapshot.queue.id, name: 'File' }],
    variant,
  }));
}

/** Le texte lisible (et les attributs d'accessibilité), sans balises. */
function readable(html: string): string {
  const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]).join(' ');
  return `${html.replace(/<[^>]+>/g, ' ')} ${labels}`.replace(/\s+/g, ' ');
}

/** Même snapshot, avec des clés que le contrat n'a pas (serveur défaillant). */
function withLeaks<T extends object>(value: T, extra: Record<string, unknown>): T {
  return { ...value, ...extra };
}

describe('aiguillage de l’écran de salle', () => {
  it('choisit l’écran du métier selon le profil', () => {
    expect(tvScreenFor(walkin)).toBe('walkin');
    expect(tvScreenFor(vehicle)).toBe('workshop');
    expect(tvScreenFor(device)).toBe('workshop');
    expect(tvScreenFor(table)).toBe('table');
    expect(tvScreenFor(desk)).toBe('desk');
    expect(tvScreenFor(retail)).toBe('pickup');
  });

  it('retombe sur l’écran walkin si le bloc du métier manque (serveur d’avant 0036)', () => {
    const { desks: _desks, ...bare } = desk;
    expect(tvScreenFor(bare as unknown as DisplaySnapshot)).toBe('walkin');
    const broken = { ...table, tables: { counts: table.tables.counts } };
    expect(tvScreenFor(broken as unknown as DisplaySnapshot)).toBe('walkin');
  });

  it('rend le bon écran, marqué data-screen, et jamais le corps walkin hors walkin', () => {
    const cases: Array<[DisplaySnapshot, string, string]> = [
      [vehicle, 'workshop', 'Véhicules prêts'],
      [device, 'workshop', 'Appareils prêts'],
      [table, 'table', 'Tables prêtes'],
      [desk, 'desk', 'Appel en cours'],
      [retail, 'pickup', 'Commandes prêtes'],
    ];
    for (const [snapshot, screen, title] of cases) {
      for (const variant of ['full', 'preview'] as const) {
        const html = render(snapshot, variant);
        expect(html).toContain(`data-screen="${screen}"`);
        expect(html).toContain(title);
        // Les sections du corps walkin (prénoms au comptoir, initiales).
        expect(html).not.toContain('id="tv-comptoir"');
        expect(html).not.toContain('id="tv-suivre"');
      }
    }
  });

  it('garde l’écran walkin tel quel (aucun data-screen, mêmes libellés)', () => {
    const html = render(walkin);
    expect(html).not.toContain('data-screen');
    expect(html).toContain('Au comptoir');
    expect(html).toContain('À suivre');
    expect(html).toContain('File ouverte');
    expect(statusLabelFor('walkin', 'open')).toBe('File ouverte');
    expect(statusLabelFor('walkin', 'paused')).toBe('En pause');
    expect(statusLabelFor('walkin', 'closed')).toBe('File fermée');
  });

  it('dit l’état de la file dans les mots du métier', () => {
    expect(render(vehicle)).toContain('Dépôts ouverts');
    expect(render(table)).toContain('Liste ouverte');
    expect(render(desk)).toContain('Guichets ouverts');
    expect(statusLabelFor('desk', 'closed')).toBe('Guichets fermés');
  });
});

describe('atelier : immatriculation masquée', () => {
  it('refuse une plaque qui n’arrive pas masquée', () => {
    const view = workshopView(vehicle);
    expect(view.rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(view.rows.every((r) => r.plate?.includes('•'))).toBe(true);
    // La ligne refusée reste comptée : l'écran dit « 3 prêts ».
    expect(view.readyWithoutRow).toBe(1);
  });

  it('ne rend aucune immatriculation en clair, ni le modèle ou le prénom envoyés par erreur', () => {
    const leaky = withLeaks(vehicle, {
      workshop: {
        ...vehicle.workshop,
        ready: vehicle.workshop.ready.map((r) => ({ ...r, model: 'Peugeot 208', clientName: 'Camille', registration: 'AB-123-CD' })),
      },
    });
    const text = readable(render(leaky));
    for (const clear of ['AB-123-CD', 'AB123CD', 'GH-907-TB', 'GH907TB', '907', 'Peugeot', 'Camille']) {
      expect(text, `« ${clear} » rendu à l’écran`).not.toContain(clear);
    }
    // Ce qui se lit : les trois derniers caractères seulement.
    expect(text).toContain('Immatriculation masquée, se terminant par 3-CD');
    expect(text).toContain('Immatriculation masquée, se terminant par B 75');
    expect(text).not.toMatch(/\bAB\b/);
  });

  it('compteurs seulement quand la file n’envoie aucune ligne', () => {
    const countsOnly: WorkshopDisplaySnapshot = { ...vehicle, workshop: { ...vehicle.workshop, ready: [] } };
    const text = readable(render(countsOnly));
    expect(text).toContain('véhicules prêts');
    expect(text).not.toContain('Immatriculation');
  });

  it('atelier appareil : dossier et pictogramme, jamais de plaque', () => {
    const text = readable(render(device));
    expect(text).toContain('Dossier 0042');
    expect(text).toContain('Téléphone');
    expect(text).not.toContain('Immatriculation');
  });
});

describe('guichet : un numéro, jamais un nom', () => {
  it('ne recopie que numéro, guichet et heure', () => {
    const leaky = withLeaks(desk, {
      desks: {
        ...desk.desks,
        currentCalls: desk.desks.currentCalls.map((c) => ({ ...c, name: 'Camille', clientName: 'Camille', reason: 'Prise de sang' })),
        recentCalls: desk.desks.recentCalls.map((c) => ({ ...c, name: 'Bernard' })),
      },
    });
    const view = deskView(leaky);
    expect(view.current).toEqual({ id: 'c1', ticketNo: 'A-042', desk: 'Guichet 3', calledAt: '2026-09-24T14:32:00Z' });
    for (const call of [...view.others, ...view.recent]) {
      expect(Object.keys(call).sort()).toEqual(['calledAt', 'desk', 'id', 'ticketNo']);
    }
  });

  it('ne rend aucun prénom ni motif, même envoyés par erreur', () => {
    const leaky = withLeaks(desk, {
      staff: [{ id: 's1', name: 'Nadia', isOnBreak: false, isServing: true }],
      serving: [{ id: 'x', name: 'Camille', staffName: 'Nadia' }],
      upcoming: [{ id: 'y', called: true, initials: 'CB' }],
      desks: {
        ...desk.desks,
        currentCalls: desk.desks.currentCalls.map((c) => ({ ...c, name: 'Camille', reason: 'Prise de sang' })),
        recentCalls: desk.desks.recentCalls.map((c) => ({ ...c, name: 'Bernard' })),
      },
    });
    const text = readable(render(leaky));
    for (const personal of ['Camille', 'Bernard', 'Nadia', 'CB', 'Prise de sang']) {
      expect(text, `« ${personal} » rendu au guichet`).not.toContain(personal);
    }
    expect(text).toContain('Ticket A-042');
    expect(text).toContain('Guichet 3');
    expect(text).toContain('12 personnes en attente');
  });
});

describe('restaurant et boutique', () => {
  it('table : le numéro s’il existe, sinon le prénom en capitales (12 cases au plus)', () => {
    const view = tableView({
      ...table,
      tables: {
        ...table.tables,
        ready: [
          ...table.tables.ready,
          { id: 't3', ticketNo: null, name: 'Marie-Christine Élodie', partySize: null, calledAt: null },
        ],
      },
    });
    expect(view.rows.map((r) => r.call)).toEqual([
      { kind: 'name', value: 'KARIM' },
      { kind: 'ticket', value: 'A-012' },
      { kind: 'name', value: 'MARIE-CHRIST' },
    ]);
    expect(view.rows[2]?.partySize).toBeNull();
    const text = readable(render(table));
    expect(text).toContain('4 couverts');
    expect(text).toContain('Ticket A-012');
  });

  it('boutique : fin de commande ou numéro de ticket, rien d’autre', () => {
    const view = pickupView(retail);
    expect(view.rows.map((r) => r.ref)).toEqual([
      { kind: 'order', value: '8731' },
      { kind: 'ticket', value: 'A-007' },
    ]);
    expect(view.readyWithoutRow).toBe(1);
    const text = readable(render(retail));
    expect(text).toContain('Commande se terminant par 8731');
    expect(text).toContain('Ticket A-014');
  });
});

describe('heures relatives', () => {
  it('« 14:32 », « hier 17:40 », puis la date', () => {
    const now = new Date(2026, 8, 24, 16, 0);
    expect(sinceOf(new Date(2026, 8, 24, 14, 32).toISOString(), now)).toBe('14:32');
    expect(sinceOf(new Date(2026, 8, 23, 17, 40).toISOString(), now)).toBe('hier 17:40');
    expect(sinceOf(new Date(2026, 8, 21, 9, 0).toISOString(), now)).toBe('le 21/09');
    expect(sinceOf(null, now)).toBeNull();
    expect(sinceOf('pas une date', now)).toBeNull();
  });

  it('aucune heure au rendu serveur (fuseau du téléviseur, pas d’écart d’hydratation)', () => {
    const text = readable(render(vehicle));
    expect(text).not.toMatch(/depuis \d/);
  });
});
