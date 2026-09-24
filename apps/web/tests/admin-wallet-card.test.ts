import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  WALLET_REGISTRY_WIRED,
  appleCertExpiry,
  classify,
  daysUntil,
  googleMode,
} from '@/app/admin/WalletStatusCard';

/*
 * Carte « Passes Wallet » de /admin : les fonctions pures qui décident de
 * ce que la carte affirme. L'environnement est passé en paramètre, jamais
 * lu dans process.env.
 */

// Certificat auto-signé de test (public, sans clé), valable un an.
const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBuDCCAV+gAwIBAgIUD2zBZobnPa++iCXP+iE6jTYdHzEwCgYIKoZIzj0EAwIw
MjEhMB8GCgmSJomT8ixkAQEMEXBhc3MudGVzdC5yYW5ndmlhMQ0wCwYDVQQDDARU
ZXN0MB4XDTI2MDkyNDAxNDgwM1oXDTI3MDkyNDAxNDgwM1owMjEhMB8GCgmSJomT
8ixkAQEMEXBhc3MudGVzdC5yYW5ndmlhMQ0wCwYDVQQDDARUZXN0MFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAELYOsRUe7ZEeO6Bm0enDZ2D+yBqwNwoGRqUluNx4K
D/SMGnShEdWhZtw/A2wzPVSj5rw28MswWMsdkAw06ngwu6NTMFEwHQYDVR0OBBYE
FEqAISIbKTq5bXbnJ4E9mq0YBHm3MB8GA1UdIwQYMBaAFEqAISIbKTq5bXbnJ4E9
mq0YBHm3MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDRwAwRAIgfVFtlAhL
jqCPCMUDTv4fimzEARVn2hHeLC9mx56MCswCIFh+VVZP29uo8tLeqGd0bC8vaJ0j
B0/vITz//S5I8lFx
-----END CERTIFICATE-----`;
const CERT_END = new Date('Sep 24 01:48:03 2027 GMT');

const APPLE_ALL = {
  APPLE_WALLET_PASS_TYPE_ID: 'pass.test.rangvia',
  APPLE_WALLET_CERT_PEM: 'x',
  APPLE_WALLET_KEY_PEM: 'x',
  APPLE_WALLET_WWDR_PEM: 'x',
};

describe('classify', () => {
  it('rien de renseigné : non configuré, variables manquantes listées', () => {
    const r = classify('google', undefined, {});
    expect(r.state).toBe('unconfigured');
    expect(r.awaitingCode).toBe(false);
    expect(r.missing).toEqual(['GOOGLE_WALLET_ISSUER_ID', 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON']);
  });

  it('rien de renseigné et fournisseur non prêt : pas une erreur, un choix', () => {
    const r = classify('apple', { ready: false, reason: 'non configuré' }, {});
    expect(r.state).toBe('unconfigured');
  });

  it('variables présentes mais registre absent : non configuré, en attente du code', () => {
    const r = classify('apple', undefined, APPLE_ALL);
    expect(r).toEqual({ state: 'unconfigured', reason: null, missing: [], awaitingCode: true });
  });

  it('prêt : le fournisseur l’a dit lui-même', () => {
    expect(classify('apple', { ready: true, reason: null }, APPLE_ALL).state).toBe('ready');
  });

  it('erreur : la raison du fournisseur, telle quelle', () => {
    const r = classify('google', { ready: false, reason: ' 403 : compte de service absent ' }, {
      GOOGLE_WALLET_ISSUER_ID: '338',
    });
    expect(r.state).toBe('error');
    expect(r.reason).toBe('403 : compte de service absent');
  });

  it('erreur sans raison : les variables manquantes en tiennent lieu', () => {
    const r = classify('google', { ready: false, reason: null }, { GOOGLE_WALLET_ISSUER_ID: '338' });
    expect(r.reason).toBe('Variables manquantes : GOOGLE_WALLET_SERVICE_ACCOUNT_JSON');
  });
});

describe('appleCertExpiry', () => {
  it('préfère la date donnée par le fournisseur', () => {
    const d = appleCertExpiry({ certExpiresAt: '2030-01-02T00:00:00Z' }, { APPLE_WALLET_CERT_PEM: CERT_PEM });
    expect(d?.toISOString()).toBe('2030-01-02T00:00:00.000Z');
  });

  it('lit un certificat PEM', () => {
    expect(appleCertExpiry(undefined, { APPLE_WALLET_CERT_PEM: CERT_PEM })?.getTime()).toBe(CERT_END.getTime());
  });

  it('lit un PEM sur une ligne, avec des \\n littéraux (forme .env)', () => {
    const oneLine = CERT_PEM.trim().replace(/\n/g, '\\n');
    expect(oneLine).not.toContain('\n');
    expect(appleCertExpiry(undefined, { APPLE_WALLET_CERT_PEM: oneLine })?.getTime()).toBe(CERT_END.getTime());
  });

  it('lit un PEM encodé en base64', () => {
    const b64 = Buffer.from(CERT_PEM).toString('base64');
    expect(appleCertExpiry(undefined, { APPLE_WALLET_CERT_PEM: b64 })?.getTime()).toBe(CERT_END.getTime());
  });

  it('certificat illisible ou absent : null, sans lever', () => {
    expect(appleCertExpiry(undefined, { APPLE_WALLET_CERT_PEM: 'pas un certificat' })).toBeNull();
    expect(appleCertExpiry(undefined, {
      APPLE_WALLET_CERT_PEM: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----',
    })).toBeNull();
    expect(appleCertExpiry(undefined, {})).toBeNull();
  });
});

describe('daysUntil (jauge du certificat)', () => {
  const day = 86_400_000;
  it('J-30 pile, et 19 jours', () => {
    expect(daysUntil(CERT_END, new Date(CERT_END.getTime() - 30 * day))).toBe(30);
    expect(daysUntil(CERT_END, new Date(CERT_END.getTime() - 19.5 * day))).toBe(19);
  });
  it('expiré : négatif', () => {
    expect(daysUntil(CERT_END, new Date(CERT_END.getTime() + 2 * day))).toBe(-2);
  });
});

describe('googleMode', () => {
  it('démo par défaut, et pour toute valeur inconnue', () => {
    expect(googleMode(undefined, {})).toBe('demo');
    expect(googleMode(undefined, { GOOGLE_WALLET_MODE: 'prod' })).toBe('demo');
  });
  it('production seulement si écrit tel quel (casse et espaces tolérés)', () => {
    expect(googleMode(undefined, { GOOGLE_WALLET_MODE: ' Production ' })).toBe('production');
  });
  it('le fournisseur a le dernier mot', () => {
    expect(googleMode({ mode: 'demo' }, { GOOGLE_WALLET_MODE: 'production' })).toBe('demo');
  });
});

describe('branchement au registre W1', () => {
  // Garde-fou d'intégration : tant que readWalletStatuses() renvoie null,
  // la carte dit « non configuré » même quand Wallet marche. Dès que le
  // registre existe, ce test exige qu'il soit branché.
  it('le registre existe ⇒ la carte est rebranchée', () => {
    const registry = fileURLToPath(new URL('../src/server/wallet/providers.ts', import.meta.url));
    if (existsSync(registry)) expect(WALLET_REGISTRY_WIRED).toBe(true);
  });
});
