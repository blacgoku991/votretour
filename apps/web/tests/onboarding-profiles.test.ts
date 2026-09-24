import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ONBOARDING PAR MÉTIER (lot P7).
 *
 *  - activité → profil : le profil du métier s'il est OUVERT, sinon walkin ;
 *  - `?activite=` : liste blanche, une valeur inconnue est ignorée ;
 *  - `completeOnboarding` : un garage avant l'ouverture de `vehicle`
 *    s'inscrit en walkin, sous l'activité neutre `other` que l'organisation
 *    GARDE (ses établissements suivants naissent donc en walkin, sans
 *    motif) ; après l'ouverture — SIMULÉE ici par injection, sans toucher à
 *    `lib/profiles/capabilities.ts` — il naît directement en `vehicle` ;
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
  /** Activité de l'organisation telle que la base la garde. */
  orgActivity: null as ActivityType | null,
  /** Fait échouer l'écriture des réglages de la file (panne simulée). */
  failQueueUpdate: false,
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
          if (table === 'queues' && state.failQueueUpdate) {
            return { data: null, error: { message: 'panne simulée', code: '08006' } };
          }
          if (table === 'organizations' && typeof values.activity === 'string') state.orgActivity = values.activity as ActivityType;
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
        state.orgActivity = activity;
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
  previewInvitation,
  quoted,
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
  state.orgActivity = null;
  state.failQueueUpdate = false;
});

/**
 * Miroir de `create_location` (0037) appelé par « Ajouter un établissement »
 * (`settings.ts`, `p_activity: null`) : l'activité est relue sur
 * l'organisation, le profil en découle, et des motifs sont semés hors walkin.
 */
function secondLocation(orgActivity: ActivityType): { profile: QueueProfile; seedsServices: boolean } {
  const profile = ACTIVITY_PROFILE[orgActivity];
  return { profile, seedsServices: profile !== 'walkin' };
}

/* ------------------------------------------------------------------ */
describe('activité → profil', () => {
  it('donne le profil du métier quand il est ouvert', () => {
    for (const activity of ACTIVITIES) {
      const choice = onboardingProfile(activity, ALL_OPEN);
      expect(choice.target).toBe(ACTIVITY_PROFILE[activity]);
      expect(choice.profile).toBe(ACTIVITY_PROFILE[activity]);
      expect(choice.open).toBe(true);
      expect(choice.provisionActivity).toBe(activity);
    }
  });

  it('retombe sur walkin tant que le profil n’est pas ouvert, en provisionnant comme un barbier', () => {
    for (const activity of ACTIVITIES) {
      const target = ACTIVITY_PROFILE[activity];
      const choice = onboardingProfile(activity, TODAY);
      if (target === 'walkin' || target === 'event') {
        expect(choice.profile).toBe(target);
        expect(choice.provisionActivity).toBe(activity);
      } else {
        expect(choice.profile).toBe('walkin');
        expect(choice.open).toBe(false);
        // `other` est walkin côté SQL : aucun réglage ni motif de profil posé.
        expect(choice.provisionActivity).toBe('other');
        expect(ACTIVITY_PROFILE.other).toBe('walkin');
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

  it('n’invite à l’aperçu qu’avec des métiers dont le profil est ouvert', () => {
    // Aujourd'hui : aucun profil à aperçu ouvert, donc ni invitation ni
    // colonne d'aperçu — la page reste celle d'avant.
    expect(previewInvitation(TODAY)).toBeNull();
    expect(previewInvitation()).toBeNull();
    const garageOnly = previewInvitation(new Set<QueueProfile>(['walkin', 'event', 'vehicle']));
    expect(garageOnly).toMatch(/^Garage\u00a0: /);
    expect(garageOnly).not.toMatch(/restaurant|guichet|boutique|réparation/);
    expect(previewInvitation(ALL_OPEN)).toMatch(/^Garage, réparation, restaurant, guichet, boutique\u00a0: /);
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
    // Le texte de l'étape Avis d'avant les profils, mot pour mot.
    expect(copy.reviewLead).toBe(
      'À la fin de chaque passage, le client reçoit un remerciement avec un bouton qui ouvre directement ce lien. C’est proposé à tout le monde, sans filtrage.',
    );
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
      expect(copy.trial.join(" ")).toContain(quoted(vocab.call));
      expect(quoted(vocab.call).replace(/\u00a0/g, ' ')).toBe(`« ${vocab.call.replace(/\u00a0/g, ' ')} »`);
      for (const line of [copy.teamTitle, copy.teamLead, copy.readyTitle, copy.reviewLead, ...copy.trial]) {
        expect(line).not.toMatch(/'/);
      }
      // L'étape Avis parle du moment du métier, pas du passage au fauteuil.
      expect(copy.reviewLead).not.toMatch(/^À la fin de chaque passage,/);
      expect(copy.reviewLead).toMatch(/, le client reçoit un remerciement avec un bouton qui ouvre directement ce lien\./);
    }
    expect(onboardingCopy('vehicle').reviewLead).toMatch(/^À la remise du véhicule,/);
    expect(onboardingCopy('table').reviewLead).toMatch(/^Un peu après le repas,/);
  });

  it('ne coupe jamais une touche citée : toutes ses espaces sont insécables', () => {
    expect(quoted('Table prête\u00a0· appeler')).toBe('«\u00a0Table\u00a0prête\u00a0·\u00a0appeler\u00a0»');
    for (const profile of ['vehicle', 'device', 'table', 'desk', 'retail'] as const) {
      for (const line of onboardingCopy(profile).trial) {
        for (const [inner] of line.matchAll(/«[^»]*»/g)) expect(inner).not.toMatch(/ /);
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

  it('activite=garage avant l’ouverture de vehicle : walkin, l’organisation garde « other »', async () => {
    const response = await completeOnboarding(baseInput('garage'));
    expect(response.ok).toBe(true);
    expect(provision().p_activity).toBe('other');
    // Le mode de file choisi est conservé, comme pour un barbier.
    expect(provision().p_queue_mode).toBe('per_staff');
    expect(orgActivityUpdate()).toBeUndefined();
    expect(state.orgActivity).toBe('other');
    if (response.ok) {
      expect(response.data.profile).toBe('walkin');
      expect(response.data.activity).toBe('garage');
    }
    // Le métier choisi reste lisible dans le journal.
    expect(state.audits[0]?.metadata).toMatchObject({ activity: 'garage', profile: 'walkin', targetProfile: 'vehicle' });
  });

  it('garage non ouvert : son deuxième établissement naît en walkin, sans motif', async () => {
    for (const activity of ['garage', 'restaurant', 'health', 'phone_repair', 'shop', 'counter'] as const) {
      state.orgActivity = null;
      await completeOnboarding(baseInput(activity));
      // « Ajouter un établissement » : create_location relit l'activité de l'organisation.
      const orgActivity = state.orgActivity;
      if (orgActivity === null) throw new Error('organisation non provisionnée');
      expect(orgActivity).toBe('other');
      expect(secondLocation(orgActivity)).toEqual({ profile: 'walkin', seedsServices: false });
    }
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

  it('guichet ouvert, avis demandé mais écriture en échec : l’inscription aboutit quand même', async () => {
    state.open.add('desk');
    state.failQueueUpdate = true;
    state.queueOptions = { numbering: true, sensitive: true, review: false, reviewDelayMinutes: null };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await completeOnboarding({ ...baseInput('health'), requestReviews: true });
    // L'organisation existe : renvoyer une erreur ferait recommencer, donc créer un doublon.
    expect(response.ok).toBe(true);
    expect(errors).toHaveBeenCalledWith('[onboarding] avis non activé sur la file', expect.any(String));
    errors.mockRestore();
    // La suite de l'inscription s'est déroulée.
    expect(state.updates.some((u) => u.table === 'organizations' && u.values.onboarding_step === 'done')).toBe(true);
  });

  it('guichet ouvert, avis non demandé : les réglages du profil ne sont pas touchés', async () => {
    state.open.add('desk');
    await completeOnboarding(baseInput('admin_service'));
    expect(state.updates.find((u) => u.table === 'queues')).toBeUndefined();
    expect(locationUpdate().google_review_url).toBeNull();
  });
});
