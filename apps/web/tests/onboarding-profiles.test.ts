import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ONBOARDING PAR MÉTIER (lot P7).
 *
 *  - activité → profil : le profil du métier s'il est OUVERT, sinon walkin ;
 *  - `?activite=` : liste blanche, une valeur inconnue est ignorée ;
 *  - `completeOnboarding` : un garage avant l'ouverture de `vehicle`
 *    s'inscrit en walkin (la base suit le chemin d'un barbier, puis
 *    l'activité réelle est inscrite) ; après l'ouverture — SIMULÉE ici par
 *    injection, sans toucher à `lib/profiles/capabilities.ts` — il naît
 *    directement en `vehicle` ;
 *  - un barbier envoie et obtient exactement ce qu'il obtenait avant.
 */

const state = vi.hoisted(() => ({
  /** Profils ouverts, partagés avec le module simulé des capacités. */
  open: new Set<string>(['walkin', 'event']),
  rpc: [] as { fn: string; params: Record<string, unknown> }[],
  updates: [] as { table: string; values: Record<string, unknown>; eq: [string, unknown] }[],
  inserts: [] as { table: string; rows: Record<string, unknown>[] }[],
  audits: [] as Record<string, unknown>[],
  queueOptions: {} as Record<string, unknown>,
}));

vi.mock('@/lib/profiles/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/profiles/capabilities')>();
  return { ...actual, OPEN_PROFILES: state.open };
});

vi.mock('@/server/auth', () => ({
  requireUser: async () => ({ id: 'user-1', email: 'pro@exemple.test', fullName: 'Camille Martin' }),
  getMyOrganizations: async () => [],
}));

vi.mock('@/server/ratelimit', () => ({
  enforceRateLimit: async () => undefined,
  LIMITS: { signup: { max: 5, window: 3600 } },
}));

vi.mock('@/server/audit', () => ({
  audit: async (entry: Record<string, unknown>) => { state.audits.push(entry); },
}));

/**
 * Base simulée : `provision_organization` pose le profil comme 0037
 * (`internal.default_profile` de l'activité reçue, miroir d'ACTIVITY_PROFILE).
 */
vi.mock('@/lib/supabase/admin', async () => {
  const { ACTIVITY_PROFILE } = await import('@/lib/profiles');
  const chain = (table: string) => ({
    update(values: Record<string, unknown>) {
      return {
        eq: async (column: string, value: unknown) => {
          state.updates.push({ table, values, eq: [column, value] });
          return { data: null, error: null };
        },
      };
    },
    insert: async (rows: Record<string, unknown>[]) => {
      state.inserts.push({ table, rows });
      return { data: null, error: null };
    },
    delete() {
      return { eq: async () => ({ data: null, error: null }) };
    },
    select() {
      return {
        eq() {
          return { maybeSingle: async () => ({ data: { profile_options: state.queueOptions }, error: null }) };
        },
      };
    },
  });
  return {
    supabaseAdmin: () => ({
      from: chain,
      rpc: async (fn: string, params: Record<string, unknown>) => {
        state.rpc.push({ fn, params });
        const activity = params.p_activity as keyof typeof ACTIVITY_PROFILE;
        return {
          data: {
            organization: { id: 'org-1', slug: 'garage-martin', name: params.p_org_name },
            location: { id: 'loc-1', name: params.p_location_name },
            queue: { id: 'queue-1', profile: ACTIVITY_PROFILE[activity] },
            plate: { code: 'garage-martin-comptoir' },
          },
          error: null,
        };
      },
    }),
  };
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
}));

// La page n'a besoin que des props transmises au parcours.
vi.mock('@/app/bienvenue/OnboardingFlow', () => ({ OnboardingFlow: () => null }));

import { ACTIVITY_LABEL } from '@/lib/copy';
import { ACTIVITY_PROFILE, getProfile } from '@/lib/profiles';
import type { ActivityType, QueueProfile } from '@/lib/profiles/types';
import { QUEUE_PROFILES } from '@/lib/profiles/types';
import {
  METIER_FAMILIES,
  hasProfilePreview,
  onboardingCopy,
  onboardingProfile,
  parseActivityParam,
  reviewOffByDefault,
  samplePlaceholders,
} from '@/app/bienvenue/metiers';
import { completeOnboarding } from '@/server/actions/onboarding';
import WelcomePage from '@/app/bienvenue/page';

const ACTIVITIES = Object.keys(ACTIVITY_PROFILE) as ActivityType[];
const ALL_OPEN: ReadonlySet<QueueProfile> = new Set(QUEUE_PROFILES);
const TODAY: ReadonlySet<QueueProfile> = new Set<QueueProfile>(['walkin', 'event']);

function baseInput(activity: ActivityType) {
  return {
    organizationName: 'Garage Martin',
    activity,
    locationName: 'Garage Martin — Lyon 7',
    queueMode: 'per_staff' as const,
    googleReviewUrl: 'https://g.page/r/exemple',
    staffNames: ['Karim', 'Léa'],
    openingHours: [],
  };
}

beforeEach(() => {
  state.open.clear();
  state.open.add('walkin');
  state.open.add('event');
  state.rpc.length = 0;
  state.updates.length = 0;
  state.inserts.length = 0;
  state.audits.length = 0;
  state.queueOptions = {};
});

/* ------------------------------------------------------------------ */
describe('activité → profil', () => {
  it('donne le profil du métier quand il est ouvert', () => {
    for (const activity of ACTIVITIES) {
      const choice = onboardingProfile(activity, ALL_OPEN);
      expect(choice.target).toBe(ACTIVITY_PROFILE[activity]);
      expect(choice.profile).toBe(ACTIVITY_PROFILE[activity]);
      expect(choice.open).toBe(true);
      expect(choice.provisionActivity).toBe(activity);
      expect(choice.restoreActivity).toBe(false);
    }
  });

  it('retombe sur walkin tant que le profil n’est pas ouvert, en provisionnant comme un barbier', () => {
    for (const activity of ACTIVITIES) {
      const target = ACTIVITY_PROFILE[activity];
      const choice = onboardingProfile(activity, TODAY);
      if (target === 'walkin' || target === 'event') {
        expect(choice.profile).toBe(target);
        expect(choice.provisionActivity).toBe(activity);
        expect(choice.restoreActivity).toBe(false);
      } else {
        expect(choice.profile).toBe('walkin');
        expect(choice.open).toBe(false);
        // `other` est walkin côté SQL : aucun réglage ni motif de profil posé.
        expect(choice.provisionActivity).toBe('other');
        expect(ACTIVITY_PROFILE.other).toBe('walkin');
        expect(choice.restoreActivity).toBe(true);
      }
    }
  });

  it('suit OPEN_PROFILES par défaut (aujourd’hui : walkin et event seulement)', () => {
    expect(onboardingProfile('garage').profile).toBe('walkin');
    state.open.add('vehicle');
    expect(onboardingProfile('garage').profile).toBe('vehicle');
    expect(onboardingProfile('restaurant').profile).toBe('walkin');
  });

  it('n’offre un aperçu qu’aux profils différents du parcours d’aujourd’hui', () => {
    expect(hasProfilePreview('walkin')).toBe(false);
    expect(hasProfilePreview('event')).toBe(false);
    for (const p of ['vehicle', 'device', 'table', 'desk', 'retail'] as const) expect(hasProfilePreview(p)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
describe('?activite= (liste blanche)', () => {
  it('accepte chaque code de ACTIVITY_LABEL', () => {
    for (const code of Object.keys(ACTIVITY_LABEL)) expect(parseActivityParam(code)).toBe(code);
    expect(parseActivityParam(' garage ')).toBe('garage');
  });

  it('ignore tout le reste', () => {
    for (const value of ['inconnu', '', 'GARAGE', 'garage;', '__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
      expect(parseActivityParam(value)).toBeNull();
    }
    expect(parseActivityParam(undefined)).toBeNull();
    expect(parseActivityParam(null)).toBeNull();
    expect(parseActivityParam(['garage', 'restaurant'])).toBeNull();
  });

  it('la page transmet le métier valide, et ignore activite=inconnu', async () => {
    const props = async (activite?: string | string[]) => {
      const element = (await WelcomePage({ searchParams: Promise.resolve({ activite }) })) as {
        props: { initialActivity: ActivityType; openProfiles: QueueProfile[] };
      };
      return element.props;
    };
    expect((await props('garage')).initialActivity).toBe('garage');
    expect((await props('inconnu')).initialActivity).toBe('barber');
    expect((await props(undefined)).initialActivity).toBe('barber');
    expect((await props(['restaurant', 'garage'])).initialActivity).toBe('barber');
    // Les profils ouverts viennent du serveur, jamais de l'URL.
    expect(new Set((await props('garage')).openProfiles)).toEqual(new Set(['walkin', 'event']));
  });
});

/* ------------------------------------------------------------------ */
describe('grille de métiers et textes', () => {
  it('chaque métier figure exactement une fois dans la grille', () => {
    const listed = METIER_FAMILIES.flatMap((f) => f.activities);
    expect(listed).toHaveLength(new Set(listed).size);
    expect(new Set(listed)).toEqual(new Set(Object.keys(ACTIVITY_LABEL)));
    expect(new Set(listed)).toEqual(new Set(ACTIVITIES));
  });

  it('garde au barbier ses textes d’aujourd’hui', () => {
    const copy = onboardingCopy('walkin');
    expect(copy.readyTitle).toBe('Votre file est prête');
    expect(copy.openNow).toBe('Ouvrir la file maintenant');
    expect(copy.createCta).toBe('Créer ma file');
    expect(copy.remainingTarget).toBe('avant votre file');
    expect(copy.teamTitle).toBe('Qui travaille ici ?');
    expect(copy.teamPlaceholder(0)).toBe('Vous');
    expect(copy.teamPlaceholder(1)).toBe('Professionnel 2');
    expect(copy.teamRemoveLabel(1)).toBe('Retirer le professionnel 2');
    expect(copy.asksQueueMode).toBe(true);
    expect(copy.trial).toEqual([]);
    expect(onboardingCopy('event')).toEqual(copy);
    expect(samplePlaceholders('barber')).toEqual({ organization: 'Barber House', location: 'Barber House — Paris 11' });
  });

  it('parle le métier ailleurs, avec les touches réelles du profil', () => {
    expect(onboardingCopy('vehicle').readyTitle).toBe('Votre atelier est prêt');
    expect(onboardingCopy('table').readyTitle).toBe('Votre salle est prête');
    expect(onboardingCopy('desk').readyTitle).toBe('Vos guichets sont prêts');
    for (const profile of ['vehicle', 'device', 'table', 'desk', 'retail'] as const) {
      const copy = onboardingCopy(profile);
      const { vocab } = getProfile(profile);
      expect(copy.asksQueueMode).toBe(false);
      expect(copy.openNow).toBe(`${vocab.openQueue} maintenant`);
      // La touche citée dans l'essai est celle du vocabulaire du profil (plan § 0.8).
      expect(copy.trial.join(" ")).toContain(`«\u00a0${vocab.call}\u00a0»`);
      for (const line of [copy.teamTitle, copy.teamLead, copy.readyTitle, ...copy.trial]) {
        expect(line).not.toMatch(/'/);
      }
    }
  });

  it('coupe l’avis par défaut en santé et en administration seulement', () => {
    expect(ACTIVITIES.filter(reviewOffByDefault).sort()).toEqual(['admin_service', 'health']);
  });
});

/* ------------------------------------------------------------------ */
describe('completeOnboarding', () => {
  const provision = () => state.rpc.find((c) => c.fn === 'provision_organization')?.params ?? {};
  const orgActivityUpdate = () =>
    state.updates.find((u) => u.table === 'organizations' && 'activity' in u.values);
  const locationUpdate = () => state.updates.find((u) => u.table === 'locations')?.values ?? {};
  const staffRows = () => state.inserts.find((i) => i.table === 'staff')?.rows ?? [];

  it('barbier : même appel qu’avant les profils, file walkin', async () => {
    const response = await completeOnboarding(baseInput('barber'));
    expect(response.ok).toBe(true);
    expect(provision()).toEqual({
      p_user_id: 'user-1',
      p_org_name: 'Garage Martin',
      p_activity: 'barber',
      p_location_name: 'Garage Martin — Lyon 7',
      p_queue_mode: 'per_staff',
      p_plan_code: 'pro',
    });
    expect(orgActivityUpdate()).toBeUndefined();
    expect(locationUpdate().google_review_url).toBe('https://g.page/r/exemple');
    expect(staffRows().every((r) => !('desk_label' in r))).toBe(true);
    if (response.ok) {
      expect(response.data.profile).toBe('walkin');
      expect(response.data.activity).toBe('barber');
    }
  });

  it('activite=garage avant l’ouverture de vehicle : walkin, activité réelle inscrite ensuite', async () => {
    const response = await completeOnboarding(baseInput('garage'));
    expect(response.ok).toBe(true);
    expect(provision().p_activity).toBe('other');
    // Le mode de file choisi est conservé, comme pour un barbier.
    expect(provision().p_queue_mode).toBe('per_staff');
    expect(orgActivityUpdate()).toEqual({ table: 'organizations', values: { activity: 'garage' }, eq: ['id', 'org-1'] });
    if (response.ok) expect(response.data.profile).toBe('walkin');
    expect(state.audits[0]?.metadata).toMatchObject({ activity: 'garage', profile: 'walkin' });
  });

  it('activite=garage après l’ouverture (simulée) : provisionné directement en vehicle', async () => {
    state.open.add('vehicle');
    const response = await completeOnboarding({ ...baseInput('garage'), queueMode: 'shared' });
    expect(response.ok).toBe(true);
    expect(provision().p_activity).toBe('garage');
    expect(orgActivityUpdate()).toBeUndefined();
    if (response.ok) expect(response.data.profile).toBe('vehicle');
  });

  it('accepte « Événement / Drop », proposé par la grille', async () => {
    const response = await completeOnboarding(baseInput('event'));
    expect(response.ok).toBe(true);
    expect(provision().p_activity).toBe('event');
    if (response.ok) expect(response.data.profile).toBe('event');
  });

  it('refuse une activité hors liste', async () => {
    const response = await completeOnboarding({ ...baseInput('garage'), activity: 'inconnu' as ActivityType });
    expect(response.ok).toBe(false);
    expect(state.rpc).toHaveLength(0);
  });

  it('santé : aucune demande d’avis par défaut, même avec un lien saisi', async () => {
    await completeOnboarding(baseInput('health'));
    expect(locationUpdate().google_review_url).toBeNull();
  });

  it('santé : l’avis s’active seulement sur demande explicite', async () => {
    await completeOnboarding({ ...baseInput('health'), requestReviews: true });
    expect(locationUpdate().google_review_url).toBe('https://g.page/r/exemple');
  });

  it('guichet ouvert : chaque fiche porte son guichet ; l’avis demandé l’emporte sur le défaut du profil', async () => {
    state.open.add('desk');
    state.queueOptions = { numbering: true, sensitive: true, review: false, reviewDelayMinutes: null };
    const response = await completeOnboarding({
      ...baseInput('health'),
      staffNames: ['Guichet 1', 'Box 2'],
      requestReviews: true,
    });
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.data.profile).toBe('desk');
    expect(staffRows().map((r) => r.desk_label)).toEqual(['Guichet 1', 'Box 2']);
    const options = state.updates.find((u) => u.table === 'queues')?.values.profile_options;
    expect(options).toEqual({ numbering: true, sensitive: true, review: true });
  });

  it('guichet ouvert, avis non demandé : les réglages du profil ne sont pas touchés', async () => {
    state.open.add('desk');
    await completeOnboarding(baseInput('admin_service'));
    expect(state.updates.find((u) => u.table === 'queues')).toBeUndefined();
    expect(locationUpdate().google_review_url).toBeNull();
  });
});
