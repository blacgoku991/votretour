import { describe, expect, it } from 'vitest';
import {
  laneOf,
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
