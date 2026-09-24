import { describe, expect, it } from 'vitest';
import { computeWalletOffer, deviceOf, type WalletOfferInput } from '../../src/server/wallet/providers';

/** Qui voit quel bouton (§ 11.1) : table de vérité de walletOffer. */

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 [FBAN/EMA;FBAV/400.0]',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
};

const READY = { ready: true, reason: null };
const NOT_READY = { ready: false, reason: 'non construit' };

function input(over: Partial<WalletOfferInput> = {}): WalletOfferInput {
  return {
    statuses: { apple: READY, google: READY },
    badges: { apple: true, google: true },
    userAgent: UA.iphone,
    ticket: { active: true, identified: true },
    walletEnabled: true,
    from: 'entry',
    entryPublicId: 'Tk42abcdEFGH',
    google: { mode: 'production', viewerIsTester: false },
    event: null,
    ...over,
  };
}

describe('computeWalletOffer', () => {
  it('iPhone, Apple prêt : badge Apple seulement, lien GET vers la route commune', () => {
    expect(computeWalletOffer(input())).toEqual({
      apple: { href: '/api/client/wallet/apple?entry=Tk42abcdEFGH', badgeSrc: '/wallet/apple/ajouter-a-apple-wallet-fr.svg' },
    });
  });

  it('Android, Google prêt : badge Google seulement', () => {
    expect(computeWalletOffer(input({ userAgent: UA.android }))).toEqual({
      google: { href: '/api/client/wallet/google?entry=Tk42abcdEFGH', badgeSrc: '/wallet/google/ajouter-a-google-wallet-fr.svg' },
    });
  });

  it('fournisseur non prêt, ou badge officiel absent : rien du tout', () => {
    expect(computeWalletOffer(input({ statuses: { apple: NOT_READY, google: READY } }))).toBeNull();
    expect(computeWalletOffer(input({ badges: { apple: false, google: true } }))).toBeNull();
    expect(computeWalletOffer(input({ userAgent: UA.android, statuses: { apple: READY, google: NOT_READY } }))).toBeNull();
    expect(computeWalletOffer(input({ statuses: {} }))).toBeNull();
  });

  it('iPad et ordinateur : rien (l’iPad n’a pas Wallet)', () => {
    expect(computeWalletOffer(input({ userAgent: UA.ipad }))).toBeNull();
    expect(computeWalletOffer(input({ userAgent: UA.ipadDesktop }))).toBeNull();
    expect(computeWalletOffer(input({ userAgent: UA.desktop }))).toBeNull();
    expect(computeWalletOffer(input({ userAgent: null }))).toBeNull();
  });

  it('navigateur intégré : indice Safari sur iPhone, rien sur Android', () => {
    expect(computeWalletOffer(input({ userAgent: UA.iphoneInstagram }))).toEqual({ safariHint: true });
    expect(computeWalletOffer(input({ userAgent: UA.androidFacebook }))).toBeNull();
    expect(deviceOf(UA.iphoneInstagram)).toEqual({ iphone: true, android: false, inApp: true });
  });

  it('client ajouté au comptoir, ticket terminé, Wallet coupé : rien', () => {
    expect(computeWalletOffer(input({ ticket: { active: true, identified: false } }))).toBeNull();
    expect(computeWalletOffer(input({ ticket: { active: false, identified: true } }))).toBeNull();
    expect(computeWalletOffer(input({ ticket: null }))).toBeNull();
    expect(computeWalletOffer(input({ walletEnabled: false }))).toBeNull();
  });

  it('Google en démo : seulement pour un testeur (membre ou super-admin)', () => {
    const demo = { mode: 'demo' as const, viewerIsTester: false };
    expect(computeWalletOffer(input({ userAgent: UA.android, google: demo }))).toBeNull();
    expect(computeWalletOffer(input({ userAgent: UA.android, google: { ...demo, viewerIsTester: true } }))?.google).toBeDefined();
    // Le mode démo Google ne concerne pas Apple.
    expect(computeWalletOffer(input({ google: demo }))?.apple).toBeDefined();
  });

  it('événement : classe Google synchronisée et non refusée', () => {
    const android = { userAgent: UA.android };
    expect(computeWalletOffer(input({ ...android, event: { walletQrEnabled: true, googleClass: 'ok' } }))?.google).toBeDefined();
    for (const googleClass of ['pending', 'rejected', 'missing'] as const) {
      expect(computeWalletOffer(input({ ...android, event: { walletQrEnabled: true, googleClass } }))).toBeNull();
    }
    // La classe Google ne conditionne pas Apple.
    expect(computeWalletOffer(input({ event: { walletQrEnabled: true, googleClass: 'rejected' } }))?.apple).toBeDefined();
  });

  it('QR Wallet refusé par l’événement : une phrase, pas de badge (et rien sur ordinateur)', () => {
    const event = { walletQrEnabled: false, googleClass: 'ok' as const };
    expect(computeWalletOffer(input({ event }))).toEqual({ qrNotAccepted: true });
    expect(computeWalletOffer(input({ event, userAgent: UA.desktop }))).toBeNull();
  });

  it('depuis /pass : lien sans identifiant de ticket (le cookie signé fait foi)', () => {
    expect(computeWalletOffer(input({ from: 'pass', entryPublicId: null }))?.apple?.href).toBe('/api/client/wallet/apple?from=pass');
    // Identifiant douteux : pas de lien fabriqué.
    expect(computeWalletOffer(input({ entryPublicId: '../x' }))).toBeNull();
  });
});
