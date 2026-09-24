import { describe, expect, it } from 'vitest';
import { ACTIVITY_LABEL } from '@/lib/copy';
import {
  ACTIVITY_PROFILE,
  PROFILES,
  QUEUE_PROFILES,
  getProfile,
  isLegacyProfile,
  profileForActivity,
  stageStatus,
  type ProfileVocab,
} from '@/lib/profiles';
import {
  CAPABILITY_PROFILE,
  OPEN_PROFILES,
  PROFILE_CAPABILITIES,
  profileAvailable,
} from '@/lib/profiles/capabilities';
import { defaultProfileOptions, profileOptionsSchema, resolveProfileOptions, reviewPolicy } from '@/lib/profiles/options';
import { stageRailSteps } from '@/lib/profiles/stage-rail';
import { formatTicketNo, splitTicketNo } from '@/lib/profiles/ticket';
import { toAppError } from '@/lib/errors';

describe('activité → profil', () => {
  it('chaque activité connue a un profil', () => {
    for (const activity of Object.keys(ACTIVITY_LABEL)) {
      expect(ACTIVITY_PROFILE, activity).toHaveProperty(activity);
    }
    expect(Object.keys(ACTIVITY_PROFILE).sort()).toEqual(Object.keys(ACTIVITY_LABEL).sort());
  });

  it('les barbiers et les activités inconnues restent en walkin', () => {
    expect(profileForActivity('barber')).toBe('walkin');
    expect(profileForActivity('other')).toBe('walkin');
    expect(profileForActivity('inconnu')).toBe('walkin');
    expect(profileForActivity(null)).toBe('walkin');
    expect(getProfile('inconnu').id).toBe('walkin');
  });

  it('suit la correspondance de la conception', () => {
    expect(profileForActivity('garage')).toBe('vehicle');
    expect(profileForActivity('auto_center')).toBe('vehicle');
    expect(profileForActivity('phone_repair')).toBe('device');
    expect(profileForActivity('aftersales')).toBe('device');
    expect(profileForActivity('restaurant')).toBe('table');
    expect(profileForActivity('health')).toBe('desk');
    expect(profileForActivity('shop')).toBe('retail');
    expect(profileForActivity('event')).toBe('event');
  });

  it('walkin et event gardent les écrans d’aujourd’hui', () => {
    expect(isLegacyProfile('walkin')).toBe(true);
    expect(isLegacyProfile('event')).toBe(true);
    expect(isLegacyProfile('vehicle')).toBe(false);
  });
});

describe('registre', () => {
  const KEYS: (keyof ProfileVocab)[] = [
    'subject', 'subjectPlural', 'subjectGender', 'dossier', 'counter', 'professional', 'queue',
    'openQueue', 'complete', 'start', 'call', 'todayCounter', 'clientWaiting', 'clientTurn',
  ];

  it('chaque profil définit toutes les clés de vocabulaire', () => {
    for (const p of QUEUE_PROFILES) {
      const vocab = PROFILES[p].vocab;
      for (const key of KEYS) {
        expect(vocab, `${p}.${key}`).toHaveProperty(key);
        const value = vocab[key];
        if (key === 'dossier' || key === 'start') {
          expect(value === null || (typeof value === 'string' && value.length > 0), `${p}.${key}`).toBe(true);
        } else {
          expect(typeof value === 'string' && value.trim().length > 0, `${p}.${key}`).toBe(true);
        }
      }
      expect(PROFILES[p].id).toBe(p);
    }
  });

  it('le vocabulaire walkin est celui des écrans d’aujourd’hui', () => {
    expect(PROFILES.walkin.vocab.complete).toBe('Terminer');
    expect(PROFILES.walkin.vocab.clientTurn).toBe('C’est votre tour');
  });

  it('les touches citées par la conception existent', () => {
    expect(PROFILES.vehicle.vocab.call).toBe('Prêt · prévenir');
    expect(PROFILES.vehicle.vocab.complete).toBe('Rendu au client');
    expect(PROFILES.table.vocab.call).toBe('Table prête · appeler');
    expect(PROFILES.table.vocab.complete).toBe('Installer');
    expect(PROFILES.desk.vocab.call).toBe('Appeler au guichet');
  });

  it('les textes du registre emploient l’apostrophe typographique', () => {
    const text = JSON.stringify(PROFILES);
    expect(text).not.toMatch(/\p{L}'\p{L}/u);
  });

  it('les étapes ont chacune un statut, et seul « Prêt » est vermillon', () => {
    expect(stageStatus('vehicle', 'ready')).toBe('next');
    expect(stageStatus('vehicle', 'diagnosis')).toBe('serving');
    expect(stageStatus('vehicle', 'received')).toBe('waiting');
    expect(stageStatus('walkin', 'ready')).toBeNull();
    expect(stageStatus('vehicle', 'preparing')).toBeNull();
    for (const p of QUEUE_PROFILES) {
      for (const s of PROFILES[p].stages) expect(s.tone === 'signal', `${p}.${s.key}`).toBe(s.key === 'ready');
    }
  });

  it('prévenir par défaut : devis, pièce et prêt seulement', () => {
    const notify = PROFILES.vehicle.stages.filter((s) => s.notifyDefault).map((s) => s.key);
    expect(notify).toEqual(['quote_pending', 'waiting_parts', 'ready']);
    expect(PROFILES.vehicle.stages.find((s) => s.key === 'quote_pending')?.notifyKind).toBe('quote_ready');
    expect(PROFILES.vehicle.stages.find((s) => s.key === 'ready')?.notifyKind).toBe('your_turn');
  });

  it('walkin : aucun réglage imposé, aucune prestation, aucune option', () => {
    expect(PROFILES.walkin.queueDefaults).toEqual({});
    expect(PROFILES.walkin.defaultServices).toEqual([]);
    expect(defaultProfileOptions('walkin', 'barber')).toEqual({});
    expect(defaultProfileOptions('event', 'event')).toEqual({});
  });

  it('prestations par défaut de la conception (§ 11.2)', () => {
    expect(PROFILES.vehicle.defaultServices).toHaveLength(7);
    expect(PROFILES.device.defaultServices).toHaveLength(6);
    expect(PROFILES.table.defaultServices).toEqual([]);
  });
});

describe('options', () => {
  it('santé : sensible, sans avis Google ni message de fin', () => {
    const health = defaultProfileOptions('desk', 'health');
    expect(health.sensitive).toBe(true);
    expect(health.review).toBe(false);
    expect(reviewPolicy(health)).toEqual({ kind: 'never' });
  });

  it('administration : pas d’avis par défaut ; comptoir : avis', () => {
    expect(defaultProfileOptions('desk', 'admin_service').review).toBe(false);
    expect(defaultProfileOptions('desk', 'counter').review).toBe(true);
    expect(defaultProfileOptions('desk', 'counter').sensitive).toBe(false);
  });

  it('restaurant : avis 75 min après « Installer »', () => {
    expect(reviewPolicy(defaultProfileOptions('table'))).toEqual({ kind: 'delayed', minutes: 75 });
    expect(reviewPolicy({ reviewDelayMinutes: 0 })).toEqual({ kind: 'immediate' });
    expect(reviewPolicy({})).toEqual({ kind: 'immediate' });
  });

  it('les défauts passent leur propre schéma, et le schéma est strict', () => {
    for (const p of QUEUE_PROFILES) {
      for (const activity of ['health', 'counter', 'garage', null]) {
        expect(profileOptionsSchema(p).safeParse(defaultProfileOptions(p, activity)).success, `${p}/${activity}`).toBe(true);
      }
    }
    expect(profileOptionsSchema('vehicle').safeParse({ partyMax: 4 }).success).toBe(false);
    expect(profileOptionsSchema('walkin').safeParse({ reviewDelayMinutes: 75 }).success).toBe(false);
    expect(profileOptionsSchema('table').safeParse({ reviewDelayMinutes: 10 }).success).toBe(false);
    expect(profileOptionsSchema('table').safeParse({ reviewDelayMinutes: null }).success).toBe(true);
    expect(profileOptionsSchema('table').safeParse({ tableSizes: [2, 2] }).success).toBe(false);
  });

  it('options stockées : clés valides retenues, clés invalides ignorées', () => {
    const r = resolveProfileOptions('table', { partyMax: 8, tableSizes: 'x', inconnu: 1 });
    expect(r.partyMax).toBe(8);
    expect(r.tableSizes).toEqual([2, 4, 6, 8]);
    expect(r).not.toHaveProperty('inconnu');
    expect(resolveProfileOptions('vehicle', null).tvRegistration).toBe('masked');
  });
});

describe('capacités', () => {
  it('rien n’est promis tant qu’aucun profil n’est ouvert', () => {
    expect(PROFILE_CAPABILITIES).toEqual([]);
    expect([...OPEN_PROFILES].sort()).toEqual(['event', 'walkin']);
  });

  it('chaque capacité livrée appartient à un profil ouvert', () => {
    for (const c of PROFILE_CAPABILITIES) expect(OPEN_PROFILES.has(CAPABILITY_PROFILE[c])).toBe(true);
  });

  it('un profil non ouvert reste disponible à une organisation qui l’a activé', () => {
    expect(profileAvailable('walkin')).toBe(true);
    expect(profileAvailable('vehicle')).toBe(false);
    expect(profileAvailable('vehicle', { profiles: true })).toBe(true);
    expect(profileAvailable('vehicle', { profiles: 'true' })).toBe(false);
  });
});

describe('rail d’étapes', () => {
  it('sans historique, tout ce qui précède l’étape courante est fait', () => {
    const steps = stageRailSteps('vehicle', 'in_repair');
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'current', 'upcoming']);
  });

  it('avec l’historique, un détour non emprunté est « sauté », jamais « fait »', () => {
    const steps = stageRailSteps('vehicle', 'in_repair', {
      history: [
        { stage: 'diagnosis', at: '2026-09-24T07:00:00Z' },
        { stage: 'in_repair', at: '2026-09-24T09:00:00Z' },
      ],
    });
    const state = Object.fromEntries(steps.map((s) => [s.def.key, s.state]));
    expect(state).toEqual({
      received: 'done', // posée à l'inscription, sans événement
      diagnosis: 'done',
      quote_pending: 'skipped',
      waiting_parts: 'skipped',
      in_repair: 'current',
      ready: 'upcoming',
    });
    expect(steps.find((s) => s.def.key === 'diagnosis')?.at).toBe('2026-09-24T07:00:00Z');
  });

  it('vue client (compacte) : ni étape sautée, ni détour annoncé à l’avance', () => {
    const early = stageRailSteps('vehicle', 'diagnosis', { compact: true });
    expect(early.map((s) => s.def.key)).toEqual(['received', 'diagnosis', 'in_repair', 'ready']);
    const quoted = stageRailSteps('vehicle', 'quote_pending', { compact: true });
    expect(quoted.map((s) => s.def.key)).toContain('quote_pending');
  });

  it('profil sans étapes : rail vide', () => {
    expect(stageRailSteps('walkin', null)).toEqual([]);
  });
});

describe('numéros de ticket', () => {
  it('guichet : préfixe et trois chiffres ; atelier appareil : quatre chiffres', () => {
    expect(formatTicketNo('desk', 42, 'A')).toBe('A-042');
    expect(formatTicketNo('desk', 7, 'BC')).toBe('BC-007');
    expect(formatTicketNo('desk', 42, 'a1')).toBe('A-042');
    expect(formatTicketNo('device', 42)).toBe('0042');
    expect(formatTicketNo('desk', null)).toBeNull();
    expect(formatTicketNo('desk', 0)).toBeNull();
    expect(splitTicketNo('A-042')).toEqual({ prefix: 'A', digits: '042' });
    expect(splitTicketNo('0042')).toEqual({ prefix: null, digits: '0042' });
  });
});

describe('erreurs des profils', () => {
  it('traduit les codes du moteur sans confondre avec les plaques', () => {
    expect(toAppError({ code: 'VT011', message: 'Informations invalides : stay' }).code).toBe('invalid_details');
    expect(toAppError({ code: 'VT011', message: 'Plaque de stock introuvable' }).code).toBe('plate_not_found');
    expect(toAppError({ code: 'VT012', message: 'Trop de messages pour ce ticket (10 au plus)' }).code).toBe('too_many_messages');
    expect(toAppError({ code: 'VT012', message: 'Ce tag a été verrouillé' }).code).toBe('plate_locked');
    const busy = toAppError({ code: 'VT013', message: 'Terminez ou videz la file avant de changer de profil' });
    expect(busy.code).toBe('queue_not_empty');
    expect(busy.message).toBe('Terminez ou videz la file avant de changer de profil.');
    expect(busy.status).toBe(409);
    expect(toAppError({ code: 'VT013', message: 'Cette plaque est déjà attribuée' }).code).toBe('plate_unavailable');
    expect(toAppError({ code: 'VT016', message: 'x' }).status).toBe(429);
  });
});
