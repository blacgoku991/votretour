import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * RATTACHEMENT PAR QR DE SUIVI — le jeton de l'étiquette de clé.
 *
 * Le jeton est la seule chose qui relie un inconnu à une fiche : il se
 * traite comme un mot de passe à usage unique. On vérifie sa fabrication
 * (32 octets, base64url, seul le SHA-256 est stocké), la route
 * `POST /api/client/claim` (limite de débit par IP, message unique pour
 * tout refus, en-têtes privés, cookie de session) et la page `/s/[jeton]`
 * (noindex, no-referrer, aperçu masqué sans prénom).
 */

const calls = vi.hoisted(() => ({
  rate: [] as { key: string; max: number; window: number }[],
  rateAllowed: true,
  peek: [] as string[],
  claim: [] as { hash: string; session: string }[],
  peekResult: null as unknown,
  claimResult: null as unknown,
  sessions: [] as string[],
}));

vi.mock('@/server/ratelimit', async () => {
  const { AppError } = await import('@/lib/errors');
  return {
    enforceRateLimit: async (key: string, max: number, window: number, message?: string) => {
      calls.rate.push({ key, max, window });
      if (!calls.rateAllowed) throw new AppError('rate_limited', message ?? 'Trop de tentatives.', 429);
    },
  };
});

vi.mock('@/server/client-session', () => ({
  requestFingerprint: async () => ({ ip: '203.0.113.9', ipHash: 'ip-anonymisee', uaHash: null }),
  detectPlatform: async () => 'web',
  getOrCreateClientSession: async (organizationId: string) => {
    calls.sessions.push(organizationId);
    return { id: 'session-1', issuedToken: 'jeton-de-session' };
  },
  sessionCookieName: (organizationId: string) => `vts_${organizationId.slice(0, 8)}`,
  sessionCookieOptions: () => ({ httpOnly: true, sameSite: 'lax' as const, path: '/' }),
}));

vi.mock('@/server/profiles/queue', () => ({
  peekClaim: async (hash: string) => {
    calls.peek.push(hash);
    return calls.peekResult;
  },
  claimEntry: async (hash: string, session: string) => {
    calls.claim.push({ hash, session });
    return calls.claimResult;
  },
}));

const {
  TRACKING_TOKEN_BYTES, TRACKING_TOKEN_RE, generateTrackingToken, hashTrackingToken, isTrackingToken,
  trackingTokenMatches, trackingUrl,
} = await import('@/server/profiles/tracking-link');
const { PROFILE_LIMITS } = await import('@/server/profiles/limits');
const { POST } = await import('@/app/api/client/claim/route');

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PREVIEW = {
  organization: { id: ORG, name: 'Garage des Tilleuls', logoUrl: null },
  location: { name: 'Garage des Tilleuls — Lyon 7', slug: 'garage-des-tilleuls-lyon-7' },
  profile: 'vehicle',
  stage: 'in_repair',
  model: 'Peugeot 208',
  deviceKind: null,
  registrationMasked: '••-••3-CD',
  ticketNo: null,
  expiresAt: '2026-09-25T08:00:00Z',
};

beforeEach(() => {
  calls.rate.length = 0;
  calls.peek.length = 0;
  calls.claim.length = 0;
  calls.sessions.length = 0;
  calls.rateAllowed = true;
  calls.peekResult = PREVIEW;
  calls.claimResult = {
    entry: { id: 'Tk7pQ2xWm9Ra' },
    queueId: 'q',
    organizationId: ORG,
    locationSlug: 'garage-des-tilleuls-lyon-7',
  };
});

/* ------------------------------------------------------------------ */
/* Le jeton                                                              */
/* ------------------------------------------------------------------ */

describe('jeton de suivi', () => {
  it('fait 32 octets aléatoires, en base64url sans remplissage (43 caractères)', () => {
    const { token } = generateTrackingToken();
    expect(TRACKING_TOKEN_BYTES).toBe(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(isTrackingToken(token)).toBe(true);
  });

  it('ne se répète pas', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateTrackingToken().token));
    expect(seen.size).toBe(200);
  });

  it('n’est stocké que sous son SHA-256 hexadécimal, stable', () => {
    const { token, hash } = generateTrackingToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // le motif exigé par set_claim et claim_entry
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hashTrackingToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
    // Vecteur fixe : une évolution de l'algorithme rendrait orphelines
    // toutes les étiquettes déjà imprimées.
    expect(hashTrackingToken('A'.repeat(43))).toBe(createHash('sha256').update('A'.repeat(43)).digest('hex'));
  });

  it('se vérifie à temps constant, et refuse les formes invalides', () => {
    const { token, hash } = generateTrackingToken();
    expect(trackingTokenMatches(token, hash)).toBe(true);
    expect(trackingTokenMatches(generateTrackingToken().token, hash)).toBe(false);
    expect(trackingTokenMatches(`${token}x`, hash)).toBe(false);
    expect(trackingTokenMatches(token, hash.toUpperCase())).toBe(false);
    expect(trackingTokenMatches(token, 'abc')).toBe(false);
    const source = readFileSync(fileURLToPath(new URL('../src/server/profiles/tracking-link.ts', import.meta.url)), 'utf8');
    expect(source).toContain('timingSafeEqual(actual, expected)');
  });

  it('refuse avant toute lecture ce qui n’a pas la forme d’un jeton', () => {
    for (const bad of ['', 'court', `${'A'.repeat(42)}=`, `${'A'.repeat(42)}/`, 'A'.repeat(44), 42, null]) {
      expect(isTrackingToken(bad)).toBe(false);
    }
    expect(TRACKING_TOKEN_RE.test('A'.repeat(43))).toBe(true);
  });

  it('donne une adresse /s/<jeton> sur le site', () => {
    expect(trackingUrl('A'.repeat(43), 'https://rangvia.fr/')).toBe(`https://rangvia.fr/s/${'A'.repeat(43)}`);
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/client/claim                                                */
/* ------------------------------------------------------------------ */

function jsonRequest(body: unknown): Request {
  return new Request('https://rangvia.test/api/client/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formRequest(token: string, headers: Record<string, string> = {}): Request {
  return new Request('https://rangvia.test/api/client/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ token }).toString(),
  });
}

function expectPrivate(response: Response) {
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-robots-tag')).toContain('noindex');
}

describe('POST /api/client/claim', () => {
  it('limite à 10 tentatives par minute et par IP, avant toute lecture', async () => {
    expect(PROFILE_LIMITS.claim).toEqual({ max: 10, window: 60 });
    calls.rateAllowed = false;
    const response = await POST(jsonRequest({ token: 'A'.repeat(43) }));
    expect(response.status).toBe(429);
    expect(calls.rate).toEqual([{ key: 'claim:ip:ip-anonymisee', max: 10, window: 60 }]);
    expect(calls.peek).toEqual([]);
    expectPrivate(response);
  });

  it('rattache la fiche : session du commerce, cookie, puis direction le suivi', async () => {
    const { token, hash } = generateTrackingToken();
    const response = await POST(jsonRequest({ token }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { redirect: '/e/garage-des-tilleuls-lyon-7?src=link', entryId: 'Tk7pQ2xWm9Ra' },
    });
    // Seul le hash voyage vers la base.
    expect(calls.peek).toEqual([hash]);
    expect(calls.claim).toEqual([{ hash, session: 'session-1' }]);
    expect(calls.sessions).toEqual([ORG]);
    expect(response.headers.get('set-cookie')).toContain('vts_aaaaaaaa=jeton-de-session');
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expectPrivate(response);
  });

  it('répond le même message pour un jeton inconnu, expiré ou déjà servi', async () => {
    const messages = new Set<string>();
    // Mal formé : aucune lecture.
    let response = await POST(jsonRequest({ token: 'pas-un-jeton' }));
    expect(response.status).toBe(410);
    messages.add((await response.json()).error);
    expect(calls.peek).toEqual([]);
    // Inconnu ou expiré : l'aperçu est vide.
    calls.peekResult = null;
    response = await POST(jsonRequest({ token: generateTrackingToken().token }));
    expect(response.status).toBe(410);
    messages.add((await response.json()).error);
    // Déjà servi entre l'aperçu et le rattachement.
    calls.peekResult = PREVIEW;
    calls.claimResult = null;
    response = await POST(jsonRequest({ token: generateTrackingToken().token }));
    expect(response.status).toBe(410);
    messages.add((await response.json()).error);
    expectPrivate(response);

    expect([...messages]).toEqual(['Ce lien de suivi a déjà servi ou a expiré. Demandez-en un nouveau à l’accueil.']);
  });

  it('refuse une clé inattendue dans le corps', async () => {
    const response = await POST(jsonRequest({ token: generateTrackingToken().token, sessionId: 'volée' }));
    expect(response.status).toBe(410);
    expect(calls.peek).toEqual([]);
  });

  it('marche sans JavaScript : formulaire, redirection 303 relative', async () => {
    const { token } = generateTrackingToken();
    let response = await POST(formRequest(token));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/e/garage-des-tilleuls-lyon-7?src=link');
    expectPrivate(response);

    // Refus : retour à la page du jeton, qui relit l'état réel en base.
    calls.claimResult = null;
    response = await POST(formRequest(token));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`/s/${token}`);
  });
});

describe('POST /api/client/claim venu d’un autre site', () => {
  it('ne consomme pas le jeton et ne touche pas au cookie de l’appareil', async () => {
    const { token } = generateTrackingToken();
    // Formulaire forgé ailleurs : retour à la page du lien, sur notre origine.
    let response = await POST(formRequest(token, { 'sec-fetch-site': 'cross-site' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`/s/${token}`);
    expect(response.headers.get('set-cookie')).toBeNull();
    expectPrivate(response);
    // Appel JSON d'un autre site : 403.
    response = await POST(new Request('https://rangvia.test/api/client/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ token }),
    }));
    expect(response.status).toBe(403);
    expect(calls.peek).toEqual([]);
    expect(calls.claim).toEqual([]);
    expect(calls.sessions).toEqual([]);
  });

  it('laisse passer la page elle-même (même origine) et les navigateurs sans l’en-tête', async () => {
    const { token } = generateTrackingToken();
    expect((await POST(formRequest(token, { 'sec-fetch-site': 'same-origin' }))).status).toBe(303);
    expect((await POST(formRequest(token))).headers.get('location')).toBe('/e/garage-des-tilleuls-lyon-7?src=link');
    expect(calls.claim).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* La page /s/[jeton]                                                    */
/* ------------------------------------------------------------------ */

describe('page /s/[jeton]', () => {
  const page = readFileSync(fileURLToPath(new URL('../src/app/s/[token]/page.tsx', import.meta.url)), 'utf8');
  const middleware = readFileSync(fileURLToPath(new URL('../src/middleware.ts', import.meta.url)), 'utf8');

  it('ne s’indexe pas et ne transmet pas son adresse', () => {
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
    expect(page).toContain("referrer: 'no-referrer'");
  });

  it('échappe au middleware : le jeton brut ne traverse ni l’authentification ni ses journaux', () => {
    const pattern = /'\/\(\(\?!([^']*)\)\.\*\)'/.exec(middleware)?.[1] ?? '';
    const excluded = pattern.split('|');
    expect(excluded).toContain('s/');
    expect(excluded).toContain('api/client/');
  });

  it('montre un aperçu masqué, jamais de prénom, avant tout rattachement', () => {
    expect(page).toContain('peekClaim(hashTrackingToken(token))');
    expect(page).not.toMatch(/clientName|client_name|preview\.name/);
    expect(page).toContain('asMaskedRegistration(preview.registrationMasked)');
    // Le rattachement n'est jamais fait par la page : seulement par le bouton.
    expect(page).not.toContain('claimEntry');
  });

  it('ne promet « arrêter le suivi » qu’en atelier, où « Ne plus suivre » existe', () => {
    const fn = page.slice(page.indexOf('function exitNote'), page.indexOf('/** Sous le bouton'));
    expect(fn).toContain("profile === 'vehicle' || profile === 'device'");
    expect(fn).toContain('Vous pouvez quitter la file à tout moment.');
    expect(page).toContain('{exitNote(profile)}');
  });

  it('dit l’heure d’expiration dans le fuseau de l’établissement', () => {
    expect(page).toContain("from('locations').select('timezone').eq('slug', slug)");
    expect(page).toContain('expiryLabel(preview.expiresAt, new Date(), timeZone)');
  });
});
