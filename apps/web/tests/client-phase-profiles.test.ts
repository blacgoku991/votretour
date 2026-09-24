import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  graceRemaining,
  hoursLine,
  intakeAhead,
  placeLabel,
  profilePhase,
  promiseLabel,
  queueStatusLabel,
  quoteOf,
  quoteRailOverride,
  spokenHour,
  type PhaseInput,
} from '@/app/e/[slug]/profiles/phase';
import {
  buildDetails,
  INITIAL_JOIN_VALUES,
  isPickupService,
  partyMaxOf,
} from '@/app/e/[slug]/profiles/JoinFields';
import type { ProfileStage, QueueProfile } from '@/lib/profiles/types';
import type { EntryStatus } from '@/lib/types';

/**
 * Écran client des profils métier (lot P4) : quelle phase pour quel
 * ticket, le décompte « véhicules avant le vôtre », la promesse du garage
 * (jamais une estimation), le délai de la table, le devis, la saisie. Et
 * les garanties de non-régression des barbiers, lues dans le source.
 */

const t = (
  profile: QueueProfile,
  status: EntryStatus,
  stage: ProfileStage | null = null,
  calledAt: string | null = null,
): PhaseInput => ({ entry: { status, stage, calledAt }, queue: { profile } });

describe('phase par profil et par statut', () => {
  it('sans ticket : inscription', () => {
    expect(profilePhase(null)).toBe('join');
  });

  it('terminé et fermé, pour tous les profils', () => {
    for (const p of ['vehicle', 'device', 'table', 'desk', 'retail'] as const) {
      expect(profilePhase(t(p, 'completed'))).toBe('done');
      for (const s of ['cancelled', 'expired', 'skipped', 'absent'] as const) {
        expect(profilePhase(t(p, s))).toBe('closed');
      }
    }
  });

  it('atelier : une étape de travail (`serving`) n’est jamais « à vous »', () => {
    for (const p of ['vehicle', 'device'] as const) {
      expect(profilePhase(t(p, 'waiting', 'received'))).toBe('tracking');
      for (const s of ['diagnosis', 'quote_pending', 'waiting_parts', 'in_repair'] as const) {
        expect(profilePhase(t(p, 'serving', s))).toBe('tracking');
      }
      expect(profilePhase(t(p, 'next', 'ready'))).toBe('ready');
      // « J'arrive » après « prêt » : le rideau reste, et le confirme.
      expect(profilePhase(t(p, 'present', 'ready', '2026-09-24T10:00:00Z'))).toBe('ready');
    }
  });

  it('table et guichet : personne devant ne veut PAS dire « c’est votre tour »', () => {
    // À l'inverse des barbiers (auto_serve), c'est l'hôte ou le guichet qui appelle.
    expect(profilePhase(t('table', 'waiting'))).toBe('tracking');
    expect(profilePhase(t('desk', 'waiting'))).toBe('tracking');
    expect(profilePhase(t('table', 'next', null, '2026-09-24T10:00:00Z'))).toBe('ready');
    expect(profilePhase(t('desk', 'next', null, '2026-09-24T10:00:00Z'))).toBe('ready');
    // Au guichet, « servi » : vous êtes au guichet.
    expect(profilePhase(t('desk', 'serving'))).toBe('ready');
  });

  it('présent avant tout appel : on reste dans la file', () => {
    expect(profilePhase(t('table', 'present'))).toBe('tracking');
    expect(profilePhase(t('table', 'present', null, '2026-09-24T10:00:00Z'))).toBe('ready');
  });

  it('boutique : la commande suit ses étapes, le conseil suit la file', () => {
    expect(profilePhase(t('retail', 'serving', 'preparing'))).toBe('tracking');
    expect(profilePhase(t('retail', 'next', 'ready'))).toBe('ready');
    expect(profilePhase(t('retail', 'waiting'))).toBe('tracking');
    expect(profilePhase(t('retail', 'serving'))).toBe('ready');
  });
});

describe('« 3 véhicules avant le vôtre » (étape Reçu)', () => {
  const entries = [
    { id: 'pret', ahead: 0, status: 'next' as const },
    { id: 'a', ahead: 1, status: 'waiting' as const },
    { id: 'b', ahead: 2, status: 'waiting' as const },
    { id: 'atelier', ahead: 0, status: 'serving' as const },
    { id: 'moi', ahead: 3, status: 'waiting' as const },
    { id: 'apres', ahead: 4, status: 'waiting' as const },
  ];

  it('ne compte que les véhicules reçus avant le mien, pas ceux prêts ni en atelier', () => {
    expect(intakeAhead(entries, 'moi')).toBe(2);
    expect(intakeAhead(entries, 'a')).toBe(0);
  });

  it('sans diffusion, ou hors de l’étape Reçu : rien, jamais un chiffre inventé', () => {
    expect(intakeAhead(null, 'moi')).toBeNull();
    expect(intakeAhead(entries, 'inconnu')).toBeNull();
    expect(intakeAhead(entries, 'atelier')).toBeNull();
  });
});

describe('la promesse du garage, dite comme lui', () => {
  const now = new Date('2026-09-24T08:00:00Z'); // jeudi 10 h à Paris
  const tz = 'Europe/Paris';

  it('aucune promesse : aucun texte (pas d’estimation de Rangvia)', () => {
    expect(promiseLabel(null, tz, now)).toBeNull();
    expect(promiseLabel(undefined, tz, now)).toBeNull();
    expect(promiseLabel('pas une date', tz, now)).toBeNull();
  });

  it('aujourd’hui, demain, un jour de la semaine, puis la date', () => {
    expect(promiseLabel('2026-09-24T15:00:00Z', tz, now)).toBe('aujourd’hui vers 17 h');
    expect(promiseLabel('2026-09-25T07:30:00Z', tz, now)).toBe('demain vers 9 h 30');
    expect(promiseLabel('2026-09-28T15:00:00Z', tz, now)).toBe('lundi vers 17 h');
    expect(promiseLabel('2026-10-15T15:00:00Z', tz, now)).toBe('jeudi 15 octobre vers 17 h');
  });

  it('dans le fuseau de l’établissement', () => {
    expect(promiseLabel('2026-09-24T15:00:00Z', 'America/Guadeloupe', now)).toBe('aujourd’hui vers 11 h');
    expect(spokenHour('09:05')).toBe('9 h 05');
  });

  it('horaires du jour : ouvert, pas encore ouvert, fermé, inconnus', () => {
    const hours = { opensAt: '08:00', closesAt: '19:00' };
    expect(hoursLine(hours, tz, now)).toBe('Ouvert jusqu’à 19 h 00');
    expect(hoursLine(hours, tz, new Date('2026-09-24T05:00:00Z'))).toBe('Ouverture à 08 h 00');
    expect(hoursLine(hours, tz, new Date('2026-09-24T18:00:00Z'))).toBe('Fermé pour aujourd’hui');
    expect(hoursLine({ opensAt: null, closesAt: null }, tz, now)).toBe('Fermé aujourd’hui');
    expect(hoursLine(null, tz, now)).toBeNull();
  });
});

describe('table : le délai réel pour se présenter', () => {
  it('appelé + délai de grâce du moteur', () => {
    const called = '2026-09-24T10:00:00Z';
    const at = (s: number) => Date.parse(called) + s * 1000;
    expect(graceRemaining(called, 5, at(0))).toBe(300);
    expect(graceRemaining(called, 5, at(53))).toBe(247);
    expect(graceRemaining(called, 5, at(400))).toBe(0);
    expect(formatCountdown(247)).toBe('4:07');
  });

  it('sans appel ou sans réglage : pas de compte à rebours inventé', () => {
    expect(graceRemaining(null, 5)).toBeNull();
    expect(graceRemaining('2026-09-24T10:00:00Z', null)).toBeNull();
    expect(graceRemaining('2026-09-24T10:00:00Z', 0)).toBeNull();
  });
});

describe('devis reçu par le client', () => {
  it('garde son numéro (renvoyé comme quoteN) et sa décision', () => {
    const q = quoteOf({ quote: { n: 2, amountCents: 18400, label: 'Plaquettes', sentAt: '2026-09-24T10:00:00Z', decision: null } });
    expect(q).toEqual({ n: 2, amountCents: 18400, label: 'Plaquettes', sentAt: '2026-09-24T10:00:00Z', decision: null });
    expect(quoteOf({ quote: { n: 1, amountCents: 100, label: 'x', decision: 'accepted' } })?.decision).toBe('accepted');
  });

  it('pas de devis, ou devis illisible : rien à valider', () => {
    expect(quoteOf({})).toBeNull();
    expect(quoteOf(null)).toBeNull();
    expect(quoteOf({ quote: { label: 'sans montant' } })).toBeNull();
    // Un numéro absent n'est pas inventé : la décision sera refusée proprement.
    expect(quoteOf({ quote: { amountCents: 100, label: 'x' } })?.n).toBeNull();
  });
});

describe('devis tranché, étape pas encore changée par l’atelier', () => {
  it('la latte courante dit la décision, en ardoise, jamais « Devis à valider »', () => {
    expect(quoteRailOverride('vehicle', 'quote_pending', { decision: 'accepted' })).toEqual({
      label: 'Devis accepté · le garage reprend la main',
      tone: 'ardoise',
    });
    expect(quoteRailOverride('device', 'quote_pending', { decision: 'accepted' })?.label).toBe(
      'Devis accepté · l’atelier reprend la main',
    );
    expect(quoteRailOverride('vehicle', 'quote_pending', { decision: 'declined' })).toEqual({
      label: 'Devis refusé',
      tone: 'ardoise',
    });
  });

  it('devis en attente, ou étape déjà changée : le rail garde le nom de l’étape', () => {
    expect(quoteRailOverride('vehicle', 'quote_pending', { decision: null })).toBeNull();
    expect(quoteRailOverride('vehicle', 'quote_pending', null)).toBeNull();
    expect(quoteRailOverride('vehicle', 'in_repair', { decision: 'accepted' })).toBeNull();
  });
});

describe('en-tête : le mot du lieu et de la file, par métier', () => {
  it('l’activité de l’organisation seulement si elle parle le métier de la file', () => {
    expect(placeLabel('vehicle', 'garage')).toBe('Garage');
    expect(placeLabel('desk', 'health')).toBe('Santé');
    // Une organisation « Garage » qui tient aussi un guichet ou une table.
    expect(placeLabel('desk', 'garage')).toBe('Accueil du public');
    expect(placeLabel('table', 'garage')).toBe('Restaurant');
    expect(placeLabel('retail', 'garage')).toBe('Boutique');
    expect(placeLabel('device', null)).toBe('Atelier de réparation');
  });

  it('pastille avant l’inscription : « Liste fermée » à table, comme le titre', () => {
    expect(queueStatusLabel('table', 'closed')).toBe('Liste fermée');
    expect(queueStatusLabel('table', 'open')).toBe('Liste ouverte');
    expect(queueStatusLabel('vehicle', 'paused')).toBe('Dépôts en pause');
    expect(queueStatusLabel('desk', 'closed')).toBe('Guichets fermés');
    expect(queueStatusLabel('retail', 'open')).toBe('File ouverte');
    expect(queueStatusLabel('table', 'no_staff')).toBe('Personne de disponible');
  });
});

describe('saisie : les informations qui partent au serveur', () => {
  it('véhicule : immatriculation mise en forme, clés du profil seulement', () => {
    const r = buildDetails('vehicle', { ...INITIAL_JOIN_VALUES, registration: 'ab-123-cd', model: ' Peugeot 208 ' }, { stayChoice: true }, null);
    expect(r).toEqual({ ok: true, details: { registration: 'AB-123-CD', country: 'FR', model: 'Peugeot 208', stay: 'away' } });
  });

  it('véhicule : immatriculation exigée, lettres I/O/U refusées, en français', () => {
    const empty = buildDetails('vehicle', INITIAL_JOIN_VALUES, {}, null);
    expect(empty).toMatchObject({ ok: false, field: 'registration', message: 'Saisissez l’immatriculation.' });
    const siv = buildDetails('vehicle', { ...INITIAL_JOIN_VALUES, registration: 'HO-123-AB' }, {}, null);
    expect(siv).toMatchObject({ ok: false, field: 'registration' });
    if (!siv.ok) expect(siv.message).toMatch(/I, O et U/);
    // Sans exigence de la file, on peut déposer sans plaque.
    expect(buildDetails('vehicle', INITIAL_JOIN_VALUES, { registrationRequired: false }, null).ok).toBe(true);
  });

  it('appareil : le type est demandé, jamais un code', () => {
    expect(buildDetails('device', INITIAL_JOIN_VALUES, {}, null)).toMatchObject({ ok: false, field: 'deviceKind' });
    const r = buildDetails('device', { ...INITIAL_JOIN_VALUES, deviceKind: 'phone', model: 'iPhone 13' }, {}, null);
    expect(r).toEqual({ ok: true, details: { deviceKind: 'phone', model: 'iPhone 13' } });
  });

  it('table : couverts bornés au plafond en ligne', () => {
    expect(partyMaxOf({})).toBe(12);
    expect(partyMaxOf({ partyMax: 8 })).toBe(8);
    expect(buildDetails('table', { ...INITIAL_JOIN_VALUES, partySize: 4, seating: 'terrace' }, {}, null))
      .toEqual({ ok: true, details: { partySize: 4, seating: 'terrace' } });
    expect(buildDetails('table', { ...INITIAL_JOIN_VALUES, partySize: 9 }, { partyMax: 8 }, null))
      .toMatchObject({ ok: false, field: 'partySize' });
  });

  it('guichet : aucune information libre ne part', () => {
    expect(buildDetails('desk', { ...INITIAL_JOIN_VALUES, model: 'x', orderRef: 'y' }, { sensitive: true }, null))
      .toEqual({ ok: true, details: {} });
  });

  it('boutique : le numéro de commande seulement pour un retrait', () => {
    expect(isPickupService('Retirer une commande')).toBe(true);
    expect(isPickupService('Être conseillé')).toBe(false);
    const v = { ...INITIAL_JOIN_VALUES, orderRef: 'cmd-1234' };
    expect(buildDetails('retail', v, {}, 'Retirer une commande')).toEqual({ ok: true, details: { orderRef: 'CMD-1234' } });
    expect(buildDetails('retail', v, {}, 'Être conseillé')).toEqual({ ok: true, details: {} });
  });
});

describe('non-régression des barbiers (lecture du source)', () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(`../src/app/e/[slug]/${p}`, import.meta.url)), 'utf8');

  it('page.tsx : walkin, event et les campagnes gardent ClientExperience', () => {
    const page = read('page.tsx');
    expect(page).toMatch(/if \(profile !== 'walkin' && profile !== 'event' && !eventId\)/);
    expect(page).toContain('walletSlot={null}');
    // L'aiguillage précède le rendu historique, qui reste le dernier return.
    expect(page.indexOf('<ProfileExperience')).toBeLessThan(page.lastIndexOf('<ClientExperience'));
  });

  it('ClientExperience : quatre exports, rien d’autre', () => {
    const src = read('ClientExperience.tsx');
    for (const name of ['Header', 'NotificationPanel', 'DonePanel', 'ClosedPanel']) {
      expect(src).toMatch(new RegExp(`^export function ${name}\\(`, 'm'));
    }
    expect(src).toMatch(/^function QueuedPanel\(/m);
    expect(src).toMatch(/^function LeaveControl\(/m);
  });

  it('TurnCurtain : sans titre, exactement « C’est votre tour » et « Présentez-vous au comptoir »', () => {
    const src = read('TurnCurtain.tsx');
    expect(src).toContain("{title === undefined && <p className={styles.turnKicker}>C’est</p>}");
    expect(src).toContain("{title ?? 'votre tour'}");
    expect(src).toContain("{subtitle ?? 'Présentez-vous au comptoir'}");
  });

  it('TurnCurtain : le linteau dit « Comptoir » par défaut ; les métiers passent le leur', () => {
    const src = read('TurnCurtain.tsx');
    expect(src).toContain("thresholdLabel = 'Comptoir',");
    expect(src).toContain('label={thresholdLabel}');
    // Plus aucun « Comptoir » écrit en dur dans le Seuil.
    expect(src).not.toContain('label="Comptoir"');
    const ready = read('profiles/ReadyCurtain.tsx');
    expect(ready).toContain('thresholdLabel={getProfile(profile).vocab.counter}');
  });

  it('page.tsx : un ticket métier repris décide avant la file de la page', () => {
    const page = read('page.tsx');
    // La session vaut pour toute l'organisation : une fiche d'atelier
    // ouverte depuis la page d'une file de barbiers reste une fiche.
    expect(page).toMatch(/const resumedProfile = \(initialTicket as ProfileTicketState \| null\)\?\.queue\.profile;/);
    expect(page).toMatch(/resumedProfile && resumedProfile !== 'walkin' && resumedProfile !== 'event'\s*\? resumedProfile/);
    // Un seul bloc d'aiguillage, placé avant le rendu historique.
    expect(page.match(/<ProfileExperience/g)).toHaveLength(1);
  });

  it('ProfileShell : jamais deux abonnements au même canal quand il rend les barbiers', () => {
    const shell = read('profiles/ProfileShell.tsx');
    expect(shell).toContain('enabled: Boolean(queueId) && !delegated,');
    expect(shell).toMatch(/if \(delegated\) \{\s*return \(\s*<ClientExperience/);
  });

  it('écrans de fin des métiers : ni « Comptoir » ni « Revenir dans la file » au guichet', () => {
    const shell = read('profiles/ProfileShell.tsx');
    expect(shell).not.toContain('<DonePanel');
    expect(shell).not.toContain('<ClosedPanel');
    const end = read('profiles/EndScreens.tsx');
    expect(end).toContain('<Threshold label={vocab.counter} />');
    expect(end).toContain("desk ? 'Reprendre un numéro' : 'Revenir dans la file'");
  });

  it('inscription : de vrais radios pour les choix exclusifs, des bascules pour les motifs', () => {
    const src = read('profiles/JoinFields.tsx');
    // Plus de faux radios (bouton + role) : ni arrêt par option ni flèches mortes.
    expect(src).not.toContain('role="radio"');
    expect(src).not.toContain('aria-checked');
    expect(src.match(/type="radio"/g)?.length).toBe(2);
    expect(src).toContain('aria-pressed={on}');
  });
});
