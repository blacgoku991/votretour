import { describe, expect, it } from 'vitest';
import {
  columnOf,
  fromZonedInput,
  labelKind,
  laneOf,
  storedColumn,
  toZonedInput,
  WORKSHOP_COLUMNS,
  workshopColumns,
  matchesWorkshopQuery,
  parseAmountToCents,
  quoteStateOf,
  WORKSHOP_LANES,
  workshopLanes,
  workshopPrimary,
  formatEta,
} from '@/app/app/[org]/file/boards/logic';
import { WORKSHOP_STAGES } from '@/lib/profiles/stages';
import { PROFILES } from '@/lib/profiles';
import type { ProfileStaffEntry } from '@/lib/profiles/types';

/**
 * Le planning d'atelier : répartition pure des fiches par colonne, recherche
 * normalisée par immatriculation, touche principale selon l'étape.
 */

let seq = 0;
function fiche(partial: Partial<ProfileStaffEntry> & { at?: string }): ProfileStaffEntry {
  seq += 1;
  return {
    id: partial.id ?? `Fiche${String(seq).padStart(6, '0')}`,
    name: partial.name ?? null,
    status: partial.status ?? 'waiting',
    peopleAhead: 0,
    staffId: null,
    serviceId: null,
    source: 'staff',
    note: null,
    rejoinCount: 0,
    joinedAt: partial.joinedAt ?? partial.at ?? `2026-09-24T08:${String(seq).padStart(2, '0')}:00Z`,
    calledAt: null,
    returningAt: null,
    presentAt: null,
    serviceStartedAt: null,
    completedAt: null,
    absentAt: null,
    notified: {},
    stage: partial.stage ?? null,
    stageChangedAt: partial.stageChangedAt ?? null,
    details: partial.details ?? {},
    ticketNo: partial.ticketNo ?? null,
    registrationKey: partial.registrationKey ?? null,
    claimPending: false,
    deskLabel: null,
  };
}

describe('colonnes du planning', () => {
  it('sept colonnes : les six étapes du registre, dans l’ordre du rail, puis « Rendu »', () => {
    expect(WORKSHOP_LANES.map((l) => l.key)).toEqual([
      ...WORKSHOP_STAGES.map((s) => s.key),
      'handed_over',
    ]);
    expect(WORKSHOP_LANES.map((l) => l.label)).toEqual(['Reçu', 'Diagnostic', 'Devis', 'Pièce', 'Réparation', 'Prêt', 'Rendu']);
  });

  it('chaque colonne d’étape garde la famille du registre (réception, atelier, attente, prêt)', () => {
    for (const s of WORKSHOP_STAGES) {
      expect(WORKSHOP_LANES.find((l) => l.key === s.key)?.family).toBe(s.column);
    }
  });

  it('une seule colonne vermillon : « Prêt »', () => {
    expect(WORKSHOP_LANES.filter((l) => l.tone === 'signal').map((l) => l.key)).toEqual(['ready']);
  });

  it('range chaque fiche dans la colonne de son étape', () => {
    const entries = [
      fiche({ stage: 'received' }),
      fiche({ stage: 'diagnosis', status: 'serving' }),
      fiche({ stage: 'quote_pending', status: 'serving' }),
      fiche({ stage: 'waiting_parts', status: 'serving' }),
      fiche({ stage: 'in_repair', status: 'serving' }),
      fiche({ stage: 'in_repair', status: 'serving' }),
      fiche({ stage: 'ready', status: 'next' }),
    ];
    const lanes = workshopLanes('vehicle', entries);
    expect(lanes.get('received')).toHaveLength(1);
    expect(lanes.get('diagnosis')).toHaveLength(1);
    expect(lanes.get('quote_pending')).toHaveLength(1);
    expect(lanes.get('waiting_parts')).toHaveLength(1);
    expect(lanes.get('in_repair')).toHaveLength(2);
    expect(lanes.get('ready')).toHaveLength(1);
    expect(lanes.get('handed_over')).toHaveLength(0);
  });

  it('une fiche sans étape connue se range selon son statut, jamais nulle part', () => {
    expect(laneOf('vehicle', { stage: null, status: 'waiting' })).toBe('received');
    expect(laneOf('vehicle', { stage: null, status: 'serving' })).toBe('in_repair');
    expect(laneOf('vehicle', { stage: null, status: 'next' })).toBe('ready');
    // Une étape d'un autre profil (boutique) n'est pas une étape d'atelier.
    expect(laneOf('vehicle', { stage: 'preparing', status: 'serving' })).toBe('in_repair');
  });

  it('l’appareil suit exactement les mêmes colonnes que le véhicule', () => {
    const e = fiche({ stage: 'waiting_parts', status: 'serving' });
    expect(laneOf('device', e)).toBe(laneOf('vehicle', e));
  });

  it('trie par arrivée, par promesse de délai ou par ancienneté dans l’étape', () => {
    const a = fiche({ id: 'AAAAAAAA', stage: 'in_repair', status: 'serving', joinedAt: '2026-09-24T08:00:00Z', stageChangedAt: '2026-09-24T11:00:00Z', details: { readyEta: '2026-09-24T17:00:00Z' } });
    const b = fiche({ id: 'BBBBBBBB', stage: 'in_repair', status: 'serving', joinedAt: '2026-09-24T09:00:00Z', stageChangedAt: '2026-09-24T10:00:00Z', details: { readyEta: '2026-09-24T12:00:00Z' } });
    const c = fiche({ id: 'CCCCCCCC', stage: 'in_repair', status: 'serving', joinedAt: '2026-09-24T07:00:00Z', stageChangedAt: '2026-09-24T12:00:00Z' });
    const ids = (sort: 'arrival' | 'eta' | 'stage') => workshopLanes('vehicle', [a, b, c], { sort }).get('in_repair')!.map((e) => e.id);
    expect(ids('arrival')).toEqual(['CCCCCCCC', 'AAAAAAAA', 'BBBBBBBB']);
    // Les promesses les plus proches d'abord ; sans promesse, à la fin.
    expect(ids('eta')).toEqual(['BBBBBBBB', 'AAAAAAAA', 'CCCCCCCC']);
    expect(ids('stage')).toEqual(['BBBBBBBB', 'AAAAAAAA', 'CCCCCCCC']);
  });
});

describe('recherche par plaque', () => {
  const golf = fiche({ name: 'Nadia', registrationKey: 'AB123CD', details: { registration: 'AB-123-CD', model: 'Volkswagen Golf' } });
  const c3 = fiche({ name: 'Hugo', registrationKey: 'EZ311QA', details: { registration: 'EZ-311-QA', model: 'Citroën C3' } });
  const phone = fiche({ ticketNo: '0042', details: { model: 'iPhone 13', deviceKind: 'phone' } });

  it('normalise la saisie comme la clé : « ab 123-cd », « AB123CD » et « 123 » trouvent AB-123-CD', () => {
    for (const q of ['ab 123-cd', 'AB123CD', 'ab-123', '123', ' 3-cd ']) {
      expect(matchesWorkshopQuery(golf, q)).toBe(true);
    }
    expect(matchesWorkshopQuery(c3, 'ab 123')).toBe(false);
  });

  it('trouve aussi le prénom et le modèle, sans tenir compte des accents ni de la casse', () => {
    expect(matchesWorkshopQuery(c3, 'citroen')).toBe(true);
    expect(matchesWorkshopQuery(c3, 'HUGO')).toBe(true);
    expect(matchesWorkshopQuery(golf, 'hugo')).toBe(false);
  });

  it('un numéro de dossier se cherche avec ou sans ses zéros, mais un modèle ne passe pas pour un numéro', () => {
    expect(matchesWorkshopQuery(phone, '42')).toBe(true);
    expect(matchesWorkshopQuery(phone, '0042')).toBe(true);
    expect(matchesWorkshopQuery(phone, '7')).toBe(false);
    const other = fiche({ ticketNo: '0013', details: { model: 'Pixel 8' } });
    expect(matchesWorkshopQuery(other, 'iPhone 13')).toBe(false);
  });

  it('une recherche vide garde tout ; la répartition filtre colonne par colonne', () => {
    expect(matchesWorkshopQuery(golf, '   ')).toBe(true);
    const lanes = workshopLanes('vehicle', [golf, c3], { query: 'ez 311' });
    expect([...lanes.values()].flat().map((e) => e.name)).toEqual(['Hugo']);
  });
});

describe('touche principale de la fiche', () => {
  const vocab = PROFILES.vehicle.vocab;

  it('suit l’étape : prendre en charge, devis, réparation, Prêt · prévenir, rendu', () => {
    expect(workshopPrimary('vehicle', fiche({ stage: 'received' }))).toEqual({ kind: 'start', label: vocab.start });
    expect(workshopPrimary('vehicle', fiche({ stage: 'diagnosis', status: 'serving' })).kind).toBe('diagnosed');
    expect(workshopPrimary('vehicle', fiche({ stage: 'waiting_parts', status: 'serving' })).kind).toBe('repair');
    expect(workshopPrimary('vehicle', fiche({ stage: 'in_repair', status: 'serving' }))).toEqual({ kind: 'ready', label: vocab.call });
    expect(workshopPrimary('vehicle', fiche({ stage: 'ready', status: 'next' }))).toEqual({ kind: 'handover', label: vocab.complete });
  });

  it('sans devis en ligne, le diagnostic mène droit à la réparation', () => {
    expect(workshopPrimary('vehicle', fiche({ stage: 'diagnosis', status: 'serving' }), { quotes: false }).kind).toBe('repair');
  });

  it('un devis en attente n’a pas de touche : on attend le client ; accordé, il relance la réparation', () => {
    const quote = { amountCents: 18400, label: 'Plaquettes + disques AV', sentAt: '2026-09-24T10:00:00Z', decidedAt: null };
    expect(workshopPrimary('vehicle', fiche({ stage: 'quote_pending', status: 'serving', details: { quote: { ...quote, decision: null } } })).kind).toBe('quote_wait');
    expect(workshopPrimary('vehicle', fiche({ stage: 'quote_pending', status: 'serving', details: { quote: { ...quote, decision: 'declined', decidedAt: '2026-09-24T10:30:00Z' } } })).kind).toBe('quote_wait');
    expect(workshopPrimary('vehicle', fiche({ stage: 'quote_pending', status: 'serving', details: { quote: { ...quote, decision: 'accepted', decidedAt: '2026-09-24T10:30:00Z' } } })).kind).toBe('repair');
  });

  it('état du devis : montant avec centimes, décision et heure', () => {
    const q = quoteStateOf(fiche({ details: { quote: { amountCents: 41250, label: 'Embrayage', sentAt: '2026-09-24T10:00:00Z', decision: 'accepted', decidedAt: '2026-09-24T10:30:00Z' } } }));
    expect(q).toMatchObject({ status: 'accepted', at: '2026-09-24T10:30:00Z' });
    expect(q?.amount.replace(/\s/g, ' ')).toBe('412,50 €');
    expect(quoteStateOf(fiche({}))).toBeNull();
  });
});

describe('saisies du poste', () => {
  it('lit un montant à la française', () => {
    expect(parseAmountToCents('184,00')).toBe(18400);
    expect(parseAmountToCents('184.5')).toBe(18450);
    expect(parseAmountToCents('1 250 €')).toBe(125000);
    expect(parseAmountToCents('89')).toBe(8900);
    expect(parseAmountToCents('12,345')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('')).toBeNull();
  });

  it('dit la promesse du garage comme il la dirait : « prêt vers 17 h », « prévu demain 9 h 30 »', () => {
    const now = new Date('2026-09-24T08:00:00Z'); // 10 h à Paris
    expect(formatEta('2026-09-24T15:00:00Z', now)).toBe('prêt vers 17 h');
    expect(formatEta('2026-09-25T07:30:00Z', now)).toBe('prévu demain 9 h 30');
    expect(formatEta('2026-09-28T15:00:00Z', now)).toMatch(/^prévu lun\. 28 sept\. 17 h$/);
    expect(formatEta(null, now)).toBeNull();
  });
});

describe('les quatre colonnes du planning (conception, § 4.2)', () => {
  it('à prendre en charge | en atelier | en attente client / pièce | prêts à récupérer', () => {
    expect(WORKSHOP_COLUMNS.map((c) => c.label)).toEqual([
      'À prendre en charge', 'En atelier', 'En attente client / pièce', 'Prêts à récupérer',
    ]);
    expect(WORKSHOP_COLUMNS.map((c) => c.stages)).toEqual([
      ['received'], ['diagnosis', 'in_repair'], ['quote_pending', 'waiting_parts'], ['ready'],
    ]);
  });

  it('chaque étape du registre est dans exactement une colonne, et seule « Prêts » est vermillon', () => {
    const all = WORKSHOP_COLUMNS.flatMap((c) => c.stages);
    expect([...all].sort()).toEqual(WORKSHOP_STAGES.map((s) => s.key).sort());
    expect(WORKSHOP_COLUMNS.filter((c) => c.tone === 'signal').map((c) => c.key)).toEqual(['ready']);
  });

  it('noms courts du pupitre : quatre mots brefs, qui tiennent à 390 px', () => {
    for (const c of WORKSHOP_COLUMNS) expect(c.short.length).toBeLessThanOrEqual(8);
  });

  it('range chaque fiche dans la colonne de sa famille, triée comme les étapes', () => {
    const entries = [
      fiche({ stage: 'in_repair', status: 'serving', at: '2026-09-24T08:05:00Z' }),
      fiche({ stage: 'diagnosis', status: 'serving', at: '2026-09-24T08:01:00Z' }),
      fiche({ stage: 'waiting_parts', status: 'serving' }),
      fiche({ stage: 'quote_pending', status: 'serving' }),
      fiche({ stage: 'received' }),
      fiche({ stage: 'ready', status: 'next' }),
      fiche({ stage: null, status: 'serving' }),
    ];
    const cols = workshopColumns('vehicle', entries);
    expect(cols.get('intake')!.length).toBe(1);
    expect(cols.get('workshop')!.map((e) => e.stage)).toEqual(['diagnosis', 'in_repair', null]);
    expect(cols.get('waiting')!.length).toBe(2);
    expect(cols.get('ready')!.length).toBe(1);
    expect(columnOf('device', { stage: 'quote_pending', status: 'serving' })).toBe('waiting');
  });

  it('une colonne mémorisée par une version précédente (une étape) est ramenée à sa famille', () => {
    expect(storedColumn('ready')).toBe('ready');
    expect(storedColumn('waiting_parts')).toBe('waiting');
    expect(storedColumn('in_repair')).toBe('workshop');
    expect(storedColumn('handed_over')).toBeNull();
    expect(storedColumn(null)).toBeNull();
  });
});

describe('étiquette : de clé au garage, de dépôt pour un appareil', () => {
  it('un téléphone n’a pas de clé', () => {
    expect(labelKind('vehicle').title).toBe('Étiquette de clé');
    expect(labelKind('device').title).toBe('Étiquette de dépôt');
    expect(labelKind('device').print).not.toMatch(/clé/);
  });
});

describe('promesse de délai saisie à l’heure du lieu, pas du navigateur', () => {
  it('affiche la promesse à l’heure de l’établissement', () => {
    expect(toZonedInput('2026-09-24T15:00:00Z', 'Europe/Paris')).toBe('2026-09-24T17:00');
    expect(toZonedInput('2026-09-24T15:00:00Z', 'America/Guadeloupe')).toBe('2026-09-24T11:00');
  });

  it('sans promesse : dans deux heures, à l’heure pile, à l’heure du lieu', () => {
    expect(toZonedInput(null, 'Europe/Paris', Date.parse('2026-09-24T12:34:00Z'))).toBe('2026-09-24T16:00');
  });

  it('relit la saisie dans le fuseau du lieu, changements d’heure compris', () => {
    expect(fromZonedInput('2026-09-24T17:00', 'Europe/Paris')).toBe('2026-09-24T15:00:00.000Z');
    expect(fromZonedInput('2026-01-15T17:00', 'Europe/Paris')).toBe('2026-01-15T16:00:00.000Z');
    // 2 h 30 n'existe pas le 29 mars 2026 à Paris : l'heure avance.
    expect(fromZonedInput('2026-03-29T02:30', 'Europe/Paris')).toBe('2026-03-29T01:30:00.000Z');
    expect(fromZonedInput('pas une date', 'Europe/Paris')).toBeNull();
    for (const iso of ['2026-10-25T03:30:00.000Z', '2026-07-01T09:15:00.000Z']) {
      expect(fromZonedInput(toZonedInput(iso, 'Europe/Paris'), 'Europe/Paris')).toBe(iso);
    }
  });
});
