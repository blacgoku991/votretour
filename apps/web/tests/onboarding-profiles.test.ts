import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ONBOARDING PAR MÉTIER (lots P7 et P10).
 *
 * Décision du propriétaire : le commerçant DÉCLARE son activité, il ne
 * choisit pas son métier ; l'équipe Rangvia l'active à l'installation.
 *  - activité → la file naît TOUJOURS au passage (walkin), l'activité est
 *    enregistrée telle quelle ; même si tous les métiers étaient ouverts
 *    à tous (`OPEN_PROFILES` simulé plein ici) ;
 *  - `?activite=` : liste blanche, une valeur inconnue est ignorée ;
 *  - aucun aperçu de métier : une phrase honnête, « L'équipe Rangvia
 *    active l'interface de votre métier lors de l'installation. », pour
 *    une activité qui a un métier propre, et rien pour un barbier ;
 *  - un barbier envoie et obtient exactement ce qu'il obtenait avant.
 */

const state = vi.hoisted(() => ({
  /** Profils « ouverts », partagés avec le module simulé des capacités : sans effet ici. */
  open: new Set<string>(['walkin', 'event', 'vehicle', 'device', 'table', 'desk', 'retail']),
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
 * Base simulée : `provision_organization` comme depuis 0042 — la file naît
 * au passage, l'activité reçue est gardée sur l'organisation.
 */
vi.mock('@/lib/supabase/admin', async () => {
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
        state.orgActivity = params.p_activity as ActivityType;
        return {
          data: {
            organization: { id: 'org-1', slug: 'garage-martin', name: params.p_org_name },
            location: { id: 'loc-1', name: params.p_location_name },
            queue: { id: 'queue-1', profile: 'walkin' },
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
import { ACTIVITY_PROFILE, isLegacyProfile } from '@/lib/profiles';
import type { ActivityType } from '@/lib/profiles/types';
import {
  INSTALL_NOTE,
  METIER_FAMILIES,
  ONBOARDING_COPY,
  metierInstallNote,
  onboardingProfile,
  parseActivityParam,
  reviewOffByDefault,
  samplePlaceholders,
} from '@/app/bienvenue/metiers';
import { completeOnboarding } from '@/server/actions/onboarding';
import WelcomePage from '@/app/bienvenue/page';

const ACTIVITIES = Object.keys(ACTIVITY_PROFILE) as ActivityType[];

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
  state.rpc.length = 0;
  state.updates.length = 0;
  state.inserts.length = 0;
  state.audits.length = 0;
  state.queueOptions = {};
  state.orgActivity = null;
  state.failQueueUpdate = false;
});

/* ------------------------------------------------------------------ */
describe('activité déclarée → file au passage', () => {
  it('toujours walkin, l’activité transmise telle quelle, même avec tous les métiers « ouverts »', () => {
    for (const activity of ACTIVITIES) {
      const choice = onboardingProfile(activity);
      expect(choice.profile).toBe('walkin');
      expect(choice.provisionActivity).toBe(activity);
      expect(choice.target).toBe(ACTIVITY_PROFILE[activity]);
      expect(choice.installedByTeam).toBe(!isLegacyProfile(ACTIVITY_PROFILE[activity]));
    }
  });

  it('la phrase honnête pour un métier propre, rien pour un barbier, un salon, un événement ou « Autre »', () => {
    expect(INSTALL_NOTE).toBe('L’équipe Rangvia active l’interface de votre métier lors de l’installation.');
    for (const activity of ['garage', 'auto_center', 'phone_repair', 'aftersales', 'restaurant', 'counter', 'admin_service', 'health', 'shop'] as const) {
      expect(metierInstallNote(activity)).toBe(INSTALL_NOTE);
    }
    for (const activity of ['barber', 'hair_salon', 'nail_bar', 'beauty', 'event', 'other'] as const) {
      expect(metierInstallNote(activity)).toBeNull();
    }
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

  it('la page transmet l’activité valide, et ignore activite=inconnu ; aucun métier ne vient de l’URL', async () => {
    const props = async (activite?: string | string[]) => {
      const element = (await WelcomePage({ searchParams: Promise.resolve({ activite }) })) as {
        props: Record<string, unknown>;
      };
      return element.props;
    };
    expect((await props('garage')).initialActivity).toBe('garage');
    expect((await props('inconnu')).initialActivity).toBe('barber');
    expect((await props(undefined)).initialActivity).toBe('barber');
    expect((await props(['restaurant', 'garage'])).initialActivity).toBe('barber');
    expect(Object.keys(await props('garage')).sort()).toEqual(['initialActivity', 'userName']);
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

  it('garde les textes d’avant les profils, pour tous : aucune promesse d’interface de métier', () => {
    const copy = ONBOARDING_COPY;
    expect(copy.readyTitle).toBe('Votre file est prête');
    expect(copy.openNow).toBe('Ouvrir la file maintenant');
    expect(copy.createCta).toBe('Créer ma file');
    expect(copy.remainingTarget).toBe('avant votre file');
    expect(copy.teamTitle).toBe('Qui travaille ici ?');
    expect(copy.teamPlaceholder(0)).toBe('Vous');
    expect(copy.teamPlaceholder(1)).toBe('Professionnel 2');
    expect(copy.teamRemoveLabel(1)).toBe('Retirer le professionnel 2');
    expect(copy.asksQueueMode).toBe(true);
    expect(copy.reviewLead).toBe(
      'À la fin de chaque passage, le client reçoit un remerciement avec un bouton qui ouvre directement ce lien. C’est proposé à tout le monde, sans filtrage.',
    );
    const all = Object.values(copy).filter((v): v is string => typeof v === 'string').join(' ');
    expect(all).not.toMatch(/atelier|salle|guichet|boutique/i);
    expect(samplePlaceholders('barber')).toEqual({ organization: 'Barber House', location: 'Barber House — Paris 11' });
  });

  it('coupe l’avis par défaut en santé et en administration seulement', () => {
    expect(ACTIVITIES.filter(reviewOffByDefault).sort()).toEqual(['admin_service', 'health']);
  });
});

/* ------------------------------------------------------------------ */
describe('le parcours rendu (OnboardingFlow, premier écran)', () => {
  const render = async (activity: ActivityType) => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const actual = await vi.importActual<typeof import('@/app/bienvenue/OnboardingFlow')>('@/app/bienvenue/OnboardingFlow');
    return renderToStaticMarkup(createElement(actual.OnboardingFlow, { userName: 'Camille Martin', initialActivity: activity }))
      .replace(/<[^>]+>/g, ' ');
  };

  it('garage : la phrase honnête, ni aperçu ni « Voir ce que verront vos clients »', async () => {
    const html = await render('garage');
    expect(html).toContain(INSTALL_NOTE);
    expect(html).not.toMatch(/Aperçu|Voir ce que verront vos clients|Créons votre atelier/);
    expect(html).toContain('Créons votre file.');
  });

  it('barbier : l’écran d’avant, sans la phrase', async () => {
    const html = await render('barber');
    expect(html).not.toContain(INSTALL_NOTE);
    expect(html).toContain('Créons votre file.');
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

  it('activite=garage : l’activité est enregistrée telle quelle, la file naît au passage', async () => {
    const response = await completeOnboarding(baseInput('garage'));
    expect(response.ok).toBe(true);
    expect(provision().p_activity).toBe('garage');
    // Le mode de file choisi est conservé, comme pour un barbier.
    expect(provision().p_queue_mode).toBe('per_staff');
    expect(orgActivityUpdate()).toBeUndefined();
    expect(state.orgActivity).toBe('garage');
    if (response.ok) {
      expect(response.data.profile).toBe('walkin');
      expect(response.data.activity).toBe('garage');
    }
    // Le métier que l'équipe activera reste lisible dans le journal.
    expect(state.audits[0]?.metadata).toMatchObject({ activity: 'garage', profile: 'walkin', targetProfile: 'vehicle' });
  });

  it('toutes les activités : walkin, activité gardée, fiches sans libellé de guichet', async () => {
    for (const activity of ACTIVITIES) {
      state.rpc.length = 0;
      state.inserts.length = 0;
      const response = await completeOnboarding(baseInput(activity));
      expect(response.ok).toBe(true);
      expect(provision().p_activity).toBe(activity);
      if (response.ok) expect(response.data.profile).toBe('walkin');
      expect(staffRows().every((r) => !('desk_label' in r))).toBe(true);
    }
    // Aucune retouche des réglages d'une file : il n'y a pas de métier à régler.
    expect(state.updates.find((u) => u.table === 'queues')).toBeUndefined();
  });

  it('accepte « Événement / Drop », proposé par la grille', async () => {
    const response = await completeOnboarding(baseInput('event'));
    expect(response.ok).toBe(true);
    expect(provision().p_activity).toBe('event');
    if (response.ok) expect(response.data.profile).toBe('walkin');
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
});
