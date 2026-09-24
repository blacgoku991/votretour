import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * RÉGLAGES — LE SOMMAIRE SUIT LA SECTION MÉTIER (lot P10).
 *
 * Décision du propriétaire : le métier est attribué par l'équipe Rangvia.
 * La section « Métier de la file » ne rend rien pour un barbier
 * (`showsMetier`). Le jour où les métiers seront ouverts à tous
 * (`OPEN_PROFILES` rempli à l'ouverture), le sommaire d'un barbier ne doit
 * pas gagner une entrée « Métier de la file » qui ne mène nulle part, ni
 * son bandeau des files : il reste identique à la référence.
 *
 * Et aucune page publique ne dit au commerçant qu'il choisit son métier.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock('@/server/actions/settings', () => ({
  updateLocation: vi.fn(), updateQueueSettings: vi.fn(), updateOrganizationSettings: vi.fn(),
  updateOpeningHours: vi.fn(), upsertService: vi.fn(), deleteService: vi.fn(), createLocation: vi.fn(),
}));
vi.mock('@/server/actions/profiles', () => ({
  updateProfileOptions: vi.fn(), setDeskLabel: vi.fn(),
  upsertMessageTemplate: vi.fn(), deleteMessageTemplate: vi.fn(),
}));
vi.mock('@/server/actions/founders', () => ({ setFoundersShowcase: vi.fn() }));

const LOCATION = {
  id: 'loc-1', name: 'Barber House — Paris 11', address_line1: null, postal_code: null, city: 'Paris',
  phone: null, timezone: 'Europe/Paris', maps_url: null, google_review_url: null,
  latitude: null, longitude: null, is_active: true,
};
const queue = (id: string, name: string) => ({
  id, name, mode: 'per_staff', advance_mode: 'auto_serve', ask_client_name: true, client_name_required: false,
  allow_staff_choice: true, allow_service_choice: false, notify_ahead_threshold: 2, absent_policy: 'move_back',
  absent_move_back_by: 3, max_active_entries: null, entry_ttl_minutes: 240,
  profile: 'walkin', profile_options: {}, ticket_prefix: 'A',
});

/** Le sommaire et la présence du bandeau des files, pour un barbier à deux files. */
async function barberPage(open: readonly string[]): Promise<{ toc: string[]; html: string }> {
  vi.resetModules();
  vi.doMock('@/lib/profiles/capabilities', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/profiles/capabilities')>();
    return { ...actual, OPEN_PROFILES: new Set(open) };
  });
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SettingsManager } = await import('@/app/app/[org]/reglages/SettingsManager');
  const html = renderToStaticMarkup(createElement(SettingsManager, {
    orgSlug: 'barber-house',
    organizationId: 'org-1',
    canManage: true,
    activity: 'barber',
    locations: [LOCATION],
    currentLocation: LOCATION,
    settings: {
      data_retention_days: 30, show_people_ahead: true, allow_client_leave: true,
      send_completion_review: true, brand_accent: 'signal', support_email: null, features: {},
    },
    queues: [queue('q-1', 'File principale'), queue('q-2', 'Barbe')],
    selectedQueueId: null,
    hours: [],
    services: [],
  }));
  const nav = /<nav[^>]*aria-label="Sommaire des réglages"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  const toc = [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1] as string);
  return { toc, html };
}

afterEach(() => {
  vi.doUnmock('@/lib/profiles/capabilities');
});

describe('sommaire des Réglages d’un barbier', () => {
  it('identique à la référence quand des métiers sont ouverts à tous', async () => {
    const reference = await barberPage(['walkin', 'event']);
    const opened = await barberPage(['walkin', 'event', 'vehicle', 'device', 'table', 'desk', 'retail']);
    expect(reference.toc).not.toContain('metier');
    expect(opened.toc).toEqual(reference.toc);
    // Ni section Métier ni bandeau des files : la page d'avant.
    expect(opened.html).not.toContain('Métier de la file');
    expect(opened.html).toBe(reference.html);
  });
});

describe('aucune page publique ne fait choisir le métier', () => {
  it('l’inscription présélectionne une ACTIVITÉ', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/app/(auth)/inscription/page.tsx', import.meta.url)), 'utf8');
    expect(src).not.toContain('Métier présélectionné');
    expect(src).toContain('Activité présélectionnée, modifiable à l’étape suivante.');
  });
});
