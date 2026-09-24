import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  boardKindFor,
  currentCallAt,
  deskDisplayName,
  desksOf,
  isRetailPickup,
  noticeLabel,
  profileCounters,
  resolveDesk,
  statusTitle,
  tableCountdown,
  type Reach,
} from '@/app/app/[org]/file/boards/logic';
import { QUEUE_PROFILES, type ProfileQueueSnapshot, type ProfileStaffEntry } from '@/lib/profiles/types';

/**
 * Les postes du pro par métier : l'aiguillage (les barbiers gardent leur
 * poste), les libellés HONNÊTES de l'envoi, et les règles du guichet.
 */

describe('aiguillage du poste', () => {
  it('walkin et event gardent le poste d’aujourd’hui', () => {
    expect(boardKindFor('walkin')).toBe('queue');
    expect(boardKindFor('event')).toBe('queue');
  });

  it('un profil inconnu ou absent retombe sur le poste d’aujourd’hui', () => {
    expect(boardKindFor(undefined)).toBe('queue');
    expect(boardKindFor(null)).toBe('queue');
    expect(boardKindFor('boulangerie')).toBe('queue');
  });

  it('chaque métier a son poste : atelier, salle, guichet', () => {
    expect(boardKindFor('vehicle')).toBe('workshop');
    expect(boardKindFor('device')).toBe('workshop');
    expect(boardKindFor('table')).toBe('table');
    expect(boardKindFor('desk')).toBe('desk');
    expect(boardKindFor('retail')).toBe('desk');
  });

  it('tous les profils du registre sont aiguillés', () => {
    for (const p of QUEUE_PROFILES) expect(['queue', 'workshop', 'table', 'desk']).toContain(boardKindFor(p));
  });

  it('le fichier des barbiers ne reçoit que des « export » (mêmes pixels)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/app/app/[org]/file/QueueBoard.tsx', import.meta.url)), 'utf8');
    for (const name of ['StatusHeader', 'StatusChip', 'useNow', 'useLiveElapsed']) {
      expect(src).toMatch(new RegExp(`^export function ${name}\\(`, 'm'));
    }
    // Aucune trace des profils dans le poste des barbiers.
    expect(src).not.toMatch(/profile|boards\//);
  });

  it('la page garde exactement les props du poste des barbiers', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/app/app/[org]/file/page.tsx', import.meta.url)), 'utf8');
    expect(src).toContain('getQueueSnapshot(selected.id)');
    expect(src).toMatch(/<QueueBoard\s+orgSlug=\{org\}\s+initialSnapshot=\{snapshot\}/);
  });
});

describe('libellés d’envoi', () => {
  const at = '2026-09-24T12:32:00Z'; // 14:32 à Paris

  it('« Prévenu 14:32 ✓ » seulement si un fournisseur a accepté l’envoi', () => {
    expect(noticeLabel('sent', at)).toEqual({ text: 'Prévenu 14:32 ✓', hint: null, tone: 'ok' });
  });

  it('« Envoi indisponible » quand aucun canal n’est configuré : le pro ne croit pas le client prévenu', () => {
    const l = noticeLabel('unavailable', at);
    expect(l.text).toBe('Envoi indisponible');
    expect(l.tone).toBe('error');
    expect(l.hint).toMatch(/prévenez le client vous-même/);
    expect(l.text).not.toMatch(/Prévenu/);
  });

  it('« Non joignable » quand le client n’a pas activé les notifications', () => {
    const l = noticeLabel('unreachable', at);
    expect(l.text).toBe('Non joignable');
    expect(l.hint).toMatch(/appelez le client/);
  });

  it('un échec et l’absence d’envoi ne sont jamais présentés comme un succès', () => {
    const reaches: Reach[] = ['failed', 'none', 'unreachable', 'unavailable'];
    for (const r of reaches) {
      const l = noticeLabel(r, at);
      expect(l.tone).not.toBe('ok');
      expect(l.text).not.toMatch(/✓|Prévenu/);
    }
    expect(noticeLabel('failed', at).text).toBe('Échec de l’envoi');
  });

  it('l’heure suit le fuseau de l’établissement', () => {
    expect(noticeLabel('sent', at, 'America/Martinique').text).toBe('Prévenu 08:32 ✓');
  });
});

describe('en-tête dans le vocabulaire du métier', () => {
  it('accorde le titre d’état', () => {
    expect(statusTitle('vehicle', 'open')).toBe('Dépôts ouverts');
    expect(statusTitle('device', 'closed')).toBe('Dépôts fermés');
    expect(statusTitle('table', 'open')).toBe('Liste ouverte');
    expect(statusTitle('table', 'paused')).toBe('Liste en pause');
    expect(statusTitle('desk', 'open')).toBe('Guichets ouverts');
    expect(statusTitle('retail', 'closed')).toBe('File fermée');
  });

  function snap(profile: ProfileQueueSnapshot['queue']['profile'], counts: Partial<ProfileQueueSnapshot['counts']>, called = 0): ProfileQueueSnapshot {
    return {
      queue: { profile } as ProfileQueueSnapshot['queue'],
      called: Array.from({ length: called }, () => ({}) as ProfileStaffEntry),
      serving: [],
      counts: { active: 0, waiting: 0, serving: 0, completedToday: 0, ...counts },
    } as unknown as ProfileQueueSnapshot;
  }

  it('atelier : à prendre en charge, en atelier, prêts, rendus aujourd’hui', () => {
    const c = profileCounters(snap('vehicle', { completedToday: 3, byStage: { received: 2, diagnosis: 1, quote_pending: 1, waiting_parts: 1, in_repair: 2, ready: 1 } }));
    expect(c.map((x) => [x.label, x.value])).toEqual([
      ['à prendre en charge', 2], ['en atelier', 5], ['prêts', 1], ['rendus aujourd’hui', 3],
    ]);
  });

  it('salle : groupes et couverts', () => {
    const c = profileCounters(snap('table', { waiting: 5, coversWaiting: 21, coversSeatedToday: 40 }, 1));
    expect(c.map((x) => [x.label, x.value])).toEqual([
      ['groupes en attente', 6], ['couverts en attente', 21], ['couverts installés', 40],
    ]);
  });
});

describe('guichet et boutique', () => {
  const staff = [
    { id: 's1', name: 'Agent 1', deskLabel: 'Guichet 1' },
    { id: 's2', name: 'Agent 2', deskLabel: '  ' },
  ] as unknown as ProfileQueueSnapshot['staff'];

  it('un guichet sans libellé prend le nom de la fiche', () => {
    expect(desksOf({ staff })).toEqual([{ id: 's1', label: 'Guichet 1' }, { id: 's2', label: 'Agent 2' }]);
  });

  it('le guichet mémorisé l’emporte s’il existe encore ; disparu, il est oublié (jamais d’appel « invalid_desk »)', () => {
    const desks = desksOf({ staff });
    expect(resolveDesk(desks, 's2', 's1')).toBe('s2');
    expect(resolveDesk(desks, 'supprimé', 's1')).toBe('s1');
    expect(resolveDesk(desks, 'supprimé', null)).toBeNull();
    expect(resolveDesk([{ id: 'x', label: 'Caisse' }], null, null)).toBe('x');
  });

  it('jamais de prénom dans une file de santé, même quand la base en a un', () => {
    expect(deskDisplayName({ name: 'Albert' }, { sensitive: true })).toBeNull();
    expect(deskDisplayName({ name: 'Albert' }, { sensitive: false })).toBe('Albert');
    expect(deskDisplayName({ name: '  ' }, {})).toBeNull();
  });

  it('l’appel en cours d’un guichet : commencé d’abord, sinon appelé', () => {
    const e = (id: string, staffId: string) => ({ id, staffId }) as ProfileStaffEntry;
    const s = { called: [e('a', 's1'), e('b', 's2')], serving: [e('c', 's2')] };
    expect(currentCallAt(s, 's1')?.id).toBe('a');
    expect(currentCallAt(s, 's2')?.id).toBe('c');
    expect(currentCallAt(s, null)).toBeNull();
  });

  it('boutique : un retrait se reconnaît à son étape, son numéro ou son motif', () => {
    const services = [{ id: 'c', name: 'Être conseillé' }, { id: 'r', name: 'Retirer une commande' }];
    const e = (p: Partial<ProfileStaffEntry>) => ({ stage: null, details: {}, serviceId: null, ...p }) as ProfileStaffEntry;
    expect(isRetailPickup(e({ serviceId: 'c' }), services)).toBe(false);
    expect(isRetailPickup(e({ serviceId: 'r' }), services)).toBe(true);
    expect(isRetailPickup(e({ details: { orderRef: 'ML-1' } }), services)).toBe(true);
    expect(isRetailPickup(e({ stage: 'preparing' }), services)).toBe(true);
  });

  it('salle : compte à rebours réel de présentation, négatif une fois dépassé', () => {
    const called = '2026-09-24T12:00:00Z';
    expect(tableCountdown(called, 5, Date.parse('2026-09-24T12:02:00Z'))).toBe(180);
    expect(tableCountdown(called, 5, Date.parse('2026-09-24T12:06:00Z'))).toBe(-60);
    expect(tableCountdown(null, 5, Date.now())).toBeNull();
  });
});
