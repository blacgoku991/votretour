import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatRate,
  formatSpan,
  parseProfileStats,
  partySizeLabel,
  pendingQuotes,
  stageDurationRows,
} from '@/app/app/[org]/statistiques/profileStatsModel';
import { ProfileStats } from '@/app/app/[org]/statistiques/ProfileStats';

/**
 * STATISTIQUES PAR MÉTIER — lecture de `profile_stats` (0036) et rendu.
 *
 *  - la sortie SQL est relue défensivement : une valeur absente reste
 *    absente (« — »), jamais inventée ; walkin et event n'y sont jamais ;
 *  - les durées d'atelier ne sont PAS plafonnées à 24 h (une réparation
 *    dure des jours, c'est ce que le garage veut lire) ;
 *  - les étapes se lisent dans l'ordre du rail, une seule mise en avant ;
 *  - sans file à métier, rien n'est rendu (un barbier ne voit rien).
 */

/** Forme exacte relevée sur la base de banc (profile_stats, 30 jours). */
const SAMPLE = {
  range: { from: '2026-08-25T10:26:00+00:00', to: '2026-09-24T10:26:00+00:00' },
  byProfile: {
    vehicle: {
      dropped: 46,
      handedOver: 40,
      medianDropToReadySeconds: 22_920,
      medianReadyToPickupSeconds: 33_120,
      quote: { sent: 22, accepted: 17, declined: 2, acceptanceRate: 89.5, medianDecisionSeconds: 7500 },
      medianSecondsByStage: { received: 3600, diagnosis: 3000, quote_pending: 8160, waiting_parts: 134_280, in_repair: 9720, ready: 33_120 },
      readyNotCollected24h: 3,
      reachableRate: 76.1,
      byReason: [{ serviceId: 's1', name: 'Freins', count: 8 }, { serviceId: 's2', name: 'Pneus', count: 0 }],
    },
    table: {
      groupsSeated: 117,
      coversSeated: 400,
      medianWaitByPartySize: [
        { size: '1-2', groups: 48, medianWaitSeconds: 1260 },
        { size: '3-4', groups: 45, medianWaitSeconds: 1620 },
        { size: '5-6', groups: 16, medianWaitSeconds: 1710 },
        { size: '7+', groups: 8, medianWaitSeconds: null },
      ],
      noShowAfterCallRate: '10.7',
      byHour: [{ hour: 12, groups: 33, covers: 113 }, { hour: 25, groups: 1, covers: 1 }],
      reachableRate: 84.7,
    },
    desk: {
      joined: 168,
      completed: 155,
      medianWaitSeconds: 930,
      medianDeskSeconds: 480,
      byDesk: [{ staffId: 'x', label: 'Guichet 1', served: 72, medianDeskSeconds: 360 }],
      recalls: 42,
      absentRate: 7.7,
      reachableRate: 79.2,
    },
    walkin: { dropped: 999 },
  },
};

describe('parseProfileStats', () => {
  const view = parseProfileStats(SAMPLE);

  it('relit chaque métier présent, et seulement eux', () => {
    expect(Object.keys(view).sort()).toEqual(['desk', 'table', 'vehicle']);
    expect(view).not.toHaveProperty('walkin');
  });

  it('garde les nombres, lit un numeric renvoyé en chaîne, écarte les heures impossibles', () => {
    expect(view.vehicle?.quote).toEqual({ sent: 22, accepted: 17, declined: 2, acceptanceRate: 89.5, medianDecisionSeconds: 7500 });
    expect(view.table?.noShowAfterCallRate).toBe(10.7);
    expect(view.table?.byHour).toEqual([{ hour: 12, groups: 33, covers: 113 }]);
    expect(view.table?.medianWaitByPartySize[3]).toEqual({ size: '7+', groups: 8, medianWaitSeconds: null });
  });

  it('écarte les motifs sans passage', () => {
    expect(view.vehicle?.byReason).toEqual([{ name: 'Freins', count: 8 }]);
  });

  it('ne plante pas sur une sortie vide ou inattendue', () => {
    expect(parseProfileStats(null)).toEqual({});
    expect(parseProfileStats({ byProfile: { vehicle: 'n’importe quoi' } }).vehicle).toMatchObject({
      dropped: 0, medianDropToReadySeconds: null, quote: { sent: 0, acceptanceRate: null }, byReason: [],
    });
  });
});

describe('mises en forme', () => {
  it('ne plafonne pas une durée d’atelier à 24 h', () => {
    expect(formatSpan(null)).toBe('—');
    expect(formatSpan(0)).toBe('—');
    expect(formatSpan(42)).toBe('42 s');
    expect(formatSpan(3000)).toBe('50 min');
    expect(formatSpan(7500)).toBe('2 h 05');
    expect(formatSpan(134_280)).toBe('1 j 13 h');
    expect(formatSpan(3 * 86_400)).toBe('3 j');
  });

  it('écrit les taux à la française', () => {
    expect(formatRate(89.5)).toBe('89,5 %');
    expect(formatRate(null)).toBe('—');
  });

  it('nomme les tailles de groupe', () => {
    expect(partySizeLabel('1-2')).toBe('1 à 2');
    expect(partySizeLabel('7+')).toBe('7 et plus');
  });

  it('compte les devis sans réponse, jamais en négatif', () => {
    expect(pendingQuotes({ sent: 22, accepted: 17, declined: 2, acceptanceRate: null, medianDecisionSeconds: null })).toBe(3);
    expect(pendingQuotes({ sent: 1, accepted: 2, declined: 0, acceptanceRate: null, medianDecisionSeconds: null })).toBe(0);
  });
});

describe('temps par étape', () => {
  it('suit l’ordre du rail d’atelier et met en avant la seule étape la plus longue', () => {
    const rows = stageDurationRows('vehicle', { ready: 100, received: 50, waiting_parts: 900, in_repair: 900, unknown: 5000 });
    expect(rows.map((r) => r.stage)).toEqual(['received', 'waiting_parts', 'in_repair', 'ready']);
    expect(rows.filter((r) => r.longest).map((r) => r.stage)).toEqual(['waiting_parts']);
    expect(rows[0]?.label).toBe('À prendre en charge');
  });

  it('ne met rien en avant quand il n’y a qu’une étape', () => {
    expect(stageDurationRows('vehicle', { diagnosis: 60 })).toEqual([
      { stage: 'diagnosis', label: 'Diagnostic', seconds: 60, longest: false },
    ]);
  });
});

describe('ProfileStats (rendu)', () => {
  it('ne rend rien sans file à métier', () => {
    const html = renderToStaticMarkup(createElement(ProfileStats, { view: {}, queueNames: {}, rangeLabel: '30 jours' }));
    expect(html).toBe('');
  });

  it('rend les chiffres de l’atelier, du restaurant et du guichet', () => {
    const html = renderToStaticMarkup(createElement(ProfileStats, {
      view: parseProfileStats(SAMPLE),
      queueNames: { vehicle: ['Atelier'], table: ['Salle'], desk: ['Accueil'] },
      rangeLabel: '30 jours',
    }));
    expect(html).toContain('Atelier véhicule');
    expect(html).toContain('6 h 22');
    expect(html).toContain('89,5 %');
    expect(html).toContain('Couverts servis');
    expect(html).toContain('Appels par guichet');
    expect(html).toContain('Guichet 1');
    // Aucun identifiant de fiche ni prénom : ce sont des agrégats.
    expect(html).not.toMatch(/Karim|Sofia/);
  });
});
