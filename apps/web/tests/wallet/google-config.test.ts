import { describe, expect, it } from 'vitest';
import { exportPKCS8, generateKeyPair } from 'jose';
import { integrationStatus } from '../../src/lib/env';
import {
  eventClassId, googleNaming, parseGoogleWalletConfig, publicConfigDetails, type GoogleWalletEnvInput,
} from '../../src/server/wallet/google/config';
import { googleProvider, googleWalletConfig } from '../../src/server/wallet/google/provider';

/**
 * Configuration Google Wallet : sans elle (cas actuel), TOUT reste masqué ;
 * avec une valeur fausse, le fournisseur le dit en une phrase lisible, et
 * l'application ne plante jamais. Aucun appel réseau.
 */

const { privateKey } = await generateKeyPair('RS256', { extractable: true });
const PEM = await exportPKCS8(privateKey);

function account(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'rangvia-test',
    private_key_id: 'abc123def456',
    private_key: PEM,
    client_email: 'wallet@rangvia-test.iam.gserviceaccount.com',
    client_id: '1234567890',
    token_uri: 'https://oauth2.googleapis.com/token',
    ...overrides,
  });
}

function input(overrides: Partial<GoogleWalletEnvInput> = {}): GoogleWalletEnvInput {
  return {
    issuerId: '3388000000012345678',
    serviceAccountJson: account(),
    mode: 'demo',
    classPrefix: 'rangvia',
    rotatingBarcode: false,
    siteUrl: 'https://rangvia.test',
    sessionSecretPresent: true,
    ...overrides,
  };
}

describe('Configuration Google Wallet', () => {
  it('complète et valide : prête, avec les identifiants dérivés', () => {
    const result = parseGoogleWalletConfig(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.naming).toEqual({
      queueClassId: '3388000000012345678.rangvia_file_v1',
      eventClassPrefix: '3388000000012345678.rangvia_evt_',
      objectPrefix: '3388000000012345678.rangvia_',
    });
    expect(result.config.origin).toBe('https://rangvia.test');
    expect(result.config.serviceAccount).toEqual({
      clientEmail: 'wallet@rangvia-test.iam.gserviceaccount.com',
      privateKey: PEM.trim(),
      privateKeyId: 'abc123def456',
      tokenUri: 'https://oauth2.googleapis.com/token',
    });
  });

  it('absente : non configurée, pas une erreur, et elle le dit', () => {
    const result = parseGoogleWalletConfig(input({ issuerId: null, serviceAccountJson: null }));
    expect(result).toMatchObject({ ok: false, configured: false, mode: 'demo' });
    if (result.ok) return;
    expect(result.reason).toBe('Variables manquantes : GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_JSON');
  });

  it('commencée à moitié : erreur de configuration nommée', () => {
    const result = parseGoogleWalletConfig(input({ serviceAccountJson: null }));
    expect(result).toMatchObject({ ok: false, configured: true, reason: 'Variables manquantes : GOOGLE_WALLET_SERVICE_ACCOUNT_JSON' });
  });

  it('JSON invalide → non prête, raison lisible', () => {
    const result = parseGoogleWalletConfig(input({ serviceAccountJson: '{pas du json' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/n’est pas un JSON valide/);
  });

  it.each([
    [{ private_key: undefined }, /private_key manquante/],
    [{ private_key: 'pas une clé' }, /PKCS#8/],
    [{ client_email: 'personne' }, /client_email invalide/],
    [{ private_key_id: undefined }, /private_key_id manquant/],
    [{ token_uri: 'https://evil.example.com/token' }, /token_uri/],
    [{ type: 'authorized_user' }, /service_account/],
  ])('compte de service incomplet ou faux %# → refusé', (overrides, reason) => {
    const result = parseGoogleWalletConfig(input({ serviceAccountJson: account(overrides) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(reason);
    // Jamais la clé elle-même dans la raison.
    expect(result.reason).not.toContain(PEM.split('\n')[1]!);
  });

  it('clé collée avec des « \\n » littéraux (ligne .env) : acceptée', () => {
    const oneLine = account({ private_key: PEM.replace(/\n/g, '\\n') });
    const result = parseGoogleWalletConfig(input({ serviceAccountJson: oneLine }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.serviceAccount.privateKey).toContain('\n');
  });

  it('token_uri absent : serveur de jetons de Google par défaut', () => {
    const result = parseGoogleWalletConfig(input({ serviceAccountJson: account({ token_uri: undefined }) }));
    expect(result.ok && result.config.serviceAccount.tokenUri).toBe('https://oauth2.googleapis.com/token');
  });

  it('identifiant d’émetteur, préfixe, site en clair, secret : refusés proprement', () => {
    expect(parseGoogleWalletConfig(input({ issuerId: 'mon-emetteur' })).ok).toBe(false);
    expect(parseGoogleWalletConfig(input({ classPrefix: 'rangvia.prod' })).ok).toBe(false);
    expect(parseGoogleWalletConfig(input({ classPrefix: '_x' })).ok).toBe(false);
    const http = parseGoogleWalletConfig(input({ siteUrl: 'http://localhost:3000' }));
    expect(http.ok).toBe(false);
    if (!http.ok) expect(http.reason).toMatch(/HTTPS/);
    expect(parseGoogleWalletConfig(input({ sessionSecretPresent: false })).ok).toBe(false);
  });

  it('mode : tout ce qui n’est pas exactement « production » vaut démo', () => {
    for (const mode of [null, '', 'demo', 'prod', 'PRODUCTIONS']) {
      const result = parseGoogleWalletConfig(input({ mode }));
      expect(result.ok && result.config.mode).toBe('demo');
    }
    const prod = parseGoogleWalletConfig(input({ mode: ' Production ' }));
    expect(prod.ok && prod.config.mode).toBe('production');
    // Même non configurée, la carte super-admin connaît le mode.
    expect(parseGoogleWalletConfig(input({ issuerId: null, mode: 'production' }))).toMatchObject({ mode: 'production' });
  });

  it('classe d’événement : même règle que wallet_issue_pass (uuid sans tirets)', () => {
    const naming = googleNaming('3388000000012345678', 'rangvia_staging');
    expect(eventClassId(naming, '44444444-4444-4444-8444-44444444ABCD'))
      .toBe('3388000000012345678.rangvia_staging_evt_' + '4444444444444444' + '8444' + '44444444abcd');
    expect(eventClassId(naming, '44444444-4444-4444-8444-44444444ABCD')).toMatch(/^[0-9]+\.[A-Za-z0-9._-]+$/);
  });

  it('détails publiables : ni clé, ni e-mail du compte de service', () => {
    const details = publicConfigDetails(parseGoogleWalletConfig(input({ mode: 'production' })));
    expect(details).toMatchObject({ mode: 'production', configured: true, queueClassId: '3388000000012345678.rangvia_file_v1' });
    const text = JSON.stringify(details);
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain('gserviceaccount');
    expect(text).not.toContain('abc123def456');
  });
});

describe('Sans configuration (environnement de test) : tout reste masqué', () => {
  it('l’environnement ne déclare pas Google Wallet', () => {
    expect(integrationStatus().googleWalletConfigured).toBe(false);
    expect(googleWalletConfig()).toMatchObject({ ok: false, configured: false });
  });

  it('status() : non prêt, raison exacte, mode démo pour la carte super-admin', async () => {
    const status = await googleProvider.status();
    expect(status.ready).toBe(false);
    expect(status.reason).toMatch(/Variables manquantes/);
    expect(status.details).toMatchObject({ mode: 'demo' });
  });

  it('distribute() : 404, rien d’émis', async () => {
    const response = await googleProvider.distribute({
      request: new Request('https://rangvia.test/api/client/wallet/google?entry=Tk42abcdEFGH'),
      provider: 'google',
      entryPublicId: 'Tk42abcdEFGH',
      organizationId: '33333333-3333-4333-8333-333333333333',
      clientSessionId: null,
      eventPassPublicId: null,
      from: 'entry',
      returnTo: '/e/barber-house-bastille',
      now: new Date(),
      issue: () => { throw new Error('ne doit pas être appelé'); },
      snapshot: () => { throw new Error('ne doit pas être appelé'); },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('process() : refuse et arrête le tour, sans rien envoyer', async () => {
    const result = await googleProvider.process(
      { id: 1, walletPassId: 'p', provider: 'google', queueId: 'q', job: 'sync', reasons: [], priority: 0, attempts: 1, runAfter: '', createdAt: '' },
      {} as never, new Date(), {} as never, new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, haltProvider: true, dead: false });
  });

  it('maintain() : rien à faire, aucun appel', async () => {
    expect(await googleProvider.maintain?.(new Date())).toEqual({ skipped: 'non configuré' });
  });
});
