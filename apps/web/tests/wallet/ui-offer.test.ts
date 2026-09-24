import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletOffer } from '../../src/components/wallet/WalletOffer';
import {
  eventIdOfTicket, eventOnlyOffer, ticketIsActive, walletUnavailableNotice,
} from '../../src/components/wallet/offer';
import {
  defaultEventWalletDeps, eventWalletForPass, eventWalletForTicket, type EventWalletDeps,
} from '../../src/components/wallet/server';
import { ClientExperience, ClosedPanel, DonePanel } from '../../src/app/e/[slug]/ClientExperience';
import { WALLET_OFFER_COPY as COPY } from '../../src/lib/wallet-copy';
import {
  computeWalletOffer, resetWalletStatusCache, type WalletOffer as Offer, type WalletOfferInput,
} from '../../src/server/wallet/providers';
import type { EntryPoint, TicketState } from '../../src/lib/types';

/**
 * Interface client du Wallet (lot W4).
 *
 * Décision du propriétaire : le Wallet ne sert QU'AUX BILLETS D'ÉVÉNEMENT
 * (drops), pour le contrôle d'entrée. Ces tests verrouillent :
 *  - aucune offre hors billet d'événement, sans même une lecture en base ;
 *  - aucune offre tant que le Wallet n'est pas configuré ;
 *  - le navigateur intégré (indice Safari, jamais de badge) ;
 *  - l'encart ?wallet=indisponible, seulement dans un contexte d'événement ;
 *  - wallet_qr_enabled = false : une phrase, pas de badge ;
 *  - jamais rien dans l'écran de fin (DonePanel) ni de fermeture.
 * Le « fournisseur prêt » n'existe ici que sous forme simulée.
 */

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 [FBAN/EMA;FBAV/400.0]',
};

const READY = { ready: true, reason: null };
const NOT_READY = { ready: false, reason: 'non configuré' };
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const ORG_ID = '33333333-3333-4333-8333-333333333333';

const APPLE_OFFER: Offer = {
  apple: { href: '/api/client/wallet/apple?entry=Tk42abcdEFGH', badgeSrc: '/wallet/apple/ajouter-a-apple-wallet-fr.svg' },
};
const GOOGLE_OFFER: Offer = {
  google: { href: '/api/client/wallet/google?entry=Tk42abcdEFGH', badgeSrc: '/wallet/google/ajouter-a-google-wallet-fr.svg' },
};

function ticket(over: { status?: TicketState['entry']['status']; eventId?: string | null; profile?: string } = {}): TicketState {
  return {
    entry: {
      id: 'Tk42abcdEFGH',
      name: 'Zoé',
      status: over.status ?? 'waiting',
      peopleAhead: 4,
      joinedAt: '2026-09-24T12:00:00Z',
      calledAt: null,
      returningAt: null,
      serviceStartedAt: null,
      completedAt: over.status === 'completed' ? '2026-09-24T12:40:00Z' : null,
      staffName: null,
      eventId: over.eventId === undefined ? EVENT_ID : over.eventId,
      eventTicketNumber: over.eventId === null ? null : 42,
    },
    queue: {
      id: '11111111-1111-4111-8111-111111111111', status: 'open', mode: 'shared', name: 'File',
      pauseReason: null, waiting: 5,
      ...(over.profile ? { profile: over.profile } : {}),
    } as TicketState['queue'],
    location: {
      id: '22222222-2222-4222-8222-222222222222', name: 'Barber House Bastille', slug: 'barber-house-bastille',
      city: 'Paris', addressLine1: '12 rue de la Roquette', postalCode: '75011', phone: null,
      latitude: null, longitude: null, mapsUrl: null, logoUrl: null, googleReviewUrl: null,
    },
    organization: { name: 'Barber House', logoUrl: null },
    at: '2026-09-24T12:30:00Z',
  };
}

/** Dépendances simulées : tout est espionné, rien ne touche la base. */
function deps(over: Partial<EventWalletDeps> = {}) {
  const d = {
    statuses: vi.fn(async () => ({ apple: READY, google: READY })),
    runningEvent: vi.fn(async () => ({ id: EVENT_ID, walletQrEnabled: true })),
    offer: vi.fn(async () => APPLE_OFFER as Offer | null),
    appleSaved: vi.fn(async () => false),
    ...over,
  };
  return d as typeof d & EventWalletDeps;
}

function offerInput(over: Partial<WalletOfferInput> = {}): WalletOfferInput {
  return {
    statuses: { apple: READY, google: READY },
    badges: { apple: true, google: true },
    userAgent: UA.iphone,
    ticket: { active: true, identified: true },
    walletEnabled: true,
    from: 'entry',
    entryPublicId: 'Tk42abcdEFGH',
    google: { mode: 'production', viewerIsTester: false },
    event: { walletQrEnabled: true, googleClass: 'ok' },
    ...over,
  };
}

const render = (offer: Offer | null, context: 'event' | 'pass' = 'event', appleSaved = false) =>
  renderToStaticMarkup(createElement(WalletOffer, { offer, context, appleSaved }));

beforeEach(() => resetWalletStatusCache());

/* ==================================================================== */

describe('offre null hors billet d’événement', () => {
  it('ticket de file (barbiers) : rien, sans aucune lecture', async () => {
    const d = deps();
    const result = await eventWalletForTicket({ ticket: ticket({ eventId: null }), organizationId: ORG_ID, userAgent: UA.iphone }, d);
    expect(result).toEqual({ offer: null, wallet: null });
    expect(d.statuses).not.toHaveBeenCalled();
    expect(d.runningEvent).not.toHaveBeenCalled();
    expect(d.offer).not.toHaveBeenCalled();
  });

  it('files à métier (atelier, table, guichet, boutique) : rien non plus', async () => {
    for (const profile of ['vehicle', 'table', 'desk', 'retail', 'device']) {
      const d = deps();
      const result = await eventWalletForTicket({ ticket: ticket({ eventId: null, profile }), organizationId: ORG_ID, userAgent: UA.android }, d);
      expect(result.offer).toBeNull();
      expect(d.offer).not.toHaveBeenCalled();
    }
  });

  it('billet d’un drop terminé ou d’un événement arrêté : rien', async () => {
    const done = deps();
    expect((await eventWalletForTicket({ ticket: ticket({ status: 'completed' }), organizationId: ORG_ID, userAgent: UA.iphone }, done)).offer).toBeNull();
    expect(done.statuses).not.toHaveBeenCalled();
    const ended = deps({ runningEvent: vi.fn(async () => null) });
    expect((await eventWalletForTicket({ ticket: ticket(), organizationId: ORG_ID, userAgent: UA.iphone }, ended)).offer).toBeNull();
    expect(ended.offer).not.toHaveBeenCalled();
  });

  it('billet d’événement actif : l’offre de walletOffer, et l’état « ajouté »', async () => {
    const d = deps({ appleSaved: vi.fn(async () => true) });
    const result = await eventWalletForTicket({ ticket: ticket(), organizationId: ORG_ID, userAgent: UA.iphone }, d);
    expect(result).toEqual({ offer: APPLE_OFFER, wallet: { appleSaved: true } });
    expect(d.runningEvent).toHaveBeenCalledWith(EVENT_ID, '11111111-1111-4111-8111-111111111111');
    expect(d.offer).toHaveBeenCalledWith(expect.objectContaining({
      from: 'entry', entryPublicId: 'Tk42abcdEFGH', event: { id: EVENT_ID, walletQrEnabled: true },
    }));
  });

  it('aides pures', () => {
    expect(eventIdOfTicket(ticket())).toBe(EVENT_ID);
    expect(eventIdOfTicket(ticket({ eventId: null }))).toBeNull();
    expect(eventIdOfTicket(ticket({ eventId: 'pas-un-uuid' }))).toBeNull();
    expect(ticketIsActive(ticket({ status: 'completed' }))).toBe(false);
    expect(ticketIsActive(ticket({ status: 'next' }))).toBe(true);
    expect(eventOnlyOffer(APPLE_OFFER, false)).toBeNull();
    expect(eventOnlyOffer(APPLE_OFFER, true)).toBe(APPLE_OFFER);
  });

  it('la route du ticket passe par cette porte, la page de file ne reçoit jamais d’offre', () => {
    const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../src/${p}`, import.meta.url)), 'utf8');
    expect(read('app/api/client/ticket/route.ts')).toContain('eventWalletForTicket');
    const page = read('app/e/[slug]/page.tsx');
    // Profils métier : aucun emplacement Wallet.
    expect(page).toContain('walletSlot={null}');
    // L'offre n'est calculée que dans un contexte d'événement.
    expect(page).toMatch(/const eventWallet = eventId\s*\?/);
  });
});

describe('offre null tant que le Wallet n’est pas configuré', () => {
  it('fournisseurs réels, sans variables : rien, et aucune lecture en base', async () => {
    const d = deps({ statuses: defaultEventWalletDeps.statuses });
    const result = await eventWalletForTicket({ ticket: ticket(), organizationId: ORG_ID, userAgent: UA.iphone }, d);
    expect(result).toEqual({ offer: null, wallet: null });
    expect(d.runningEvent).not.toHaveBeenCalled();
    expect(d.offer).not.toHaveBeenCalled();
  });

  it('laisser-passer : pareil', async () => {
    const d = deps({ statuses: vi.fn(async () => ({ apple: NOT_READY, google: NOT_READY })) });
    const result = await eventWalletForPass({
      userAgent: UA.iphone, organizationId: ORG_ID, queueEntryId: 'x', eventId: EVENT_ID, active: true,
    }, d);
    expect(result.offer).toBeNull();
    expect(d.runningEvent).not.toHaveBeenCalled();
  });

  it('laisser-passer utilisé ou expiré : rien, même prêt', async () => {
    const d = deps();
    expect((await eventWalletForPass({
      userAgent: UA.iphone, organizationId: ORG_ID, queueEntryId: 'x', eventId: EVENT_ID, active: false,
    }, d)).offer).toBeNull();
    expect(d.statuses).not.toHaveBeenCalled();
  });

  it('badge officiel absent du disque : rien (jamais de faux badge)', () => {
    expect(computeWalletOffer(offerInput({ badges: { apple: false, google: false } }))).toBeNull();
  });

  it('sans offre, le composant ne rend rien du tout', () => {
    expect(render(null)).toBe('');
    expect(render({})).toBe('');
  });
});

describe('badge officiel', () => {
  it('Apple : lien GET, badge tel quel, texte d’accompagnement', () => {
    const html = render(APPLE_OFFER);
    expect(html).toContain('href="/api/client/wallet/apple?entry=Tk42abcdEFGH"');
    expect(html).toContain('rel="nofollow"');
    expect(html).toContain('src="/wallet/apple/ajouter-a-apple-wallet-fr.svg"');
    expect(html).toContain(`alt="${COPY.appleBadgeAlt}"`);
    expect(html).toContain(COPY.eventTitle);
    expect(html).toContain(COPY.eventCard.replace(/’/g, '’'));
    // Aucun bouton désactivé, aucun style posé sur le badge lui-même.
    expect(html).not.toMatch(/disabled|aria-disabled|<button/);
    expect(html).not.toMatch(/<img[^>]*style=/);
  });

  it('Google : texte honnête, sans coche « ajouté »', () => {
    const html = render(GOOGLE_OFFER, 'pass');
    expect(html).toContain('src="/wallet/google/ajouter-a-google-wallet-fr.svg"');
    expect(html).toContain(COPY.passGoogleAfter);
    expect(render(GOOGLE_OFFER, 'event', true)).toContain(COPY.eventGoogleAfter);
  });

  it('Apple déjà inscrit : « Dans votre Apple Wallet », plus de badge', () => {
    const html = render(APPLE_OFFER, 'event', true);
    expect(html).toContain(COPY.eventAppleSavedTitle);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<img');
  });
});

describe('navigateur intégré', () => {
  it('iPhone dans Instagram : l’indice Safari, sans badge ni lien', () => {
    const offer = computeWalletOffer(offerInput({ userAgent: UA.iphoneInstagram }));
    expect(offer).toEqual({ safariHint: true });
    const html = render(offer);
    expect(html).toContain(COPY.eventSafariHint);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<img');
    expect(render(offer, 'pass')).toContain(COPY.passSafariHint);
  });

  it('Android dans Facebook : rien', () => {
    expect(computeWalletOffer(offerInput({ userAgent: UA.androidFacebook }))).toBeNull();
  });
});

describe('?wallet=indisponible', () => {
  it('dans un contexte d’événement : l’encart, par fournisseur', () => {
    expect(walletUnavailableNotice({ wallet: 'indisponible', wp: 'google' }, { eventContext: true, where: 'event' }))
      .toBe('Google Wallet ne répond pas pour l’instant. Votre billet reste suivi ici.');
    expect(walletUnavailableNotice({ wallet: 'indisponible', wp: 'apple' }, { eventContext: true, where: 'pass' }))
      .toBe('Apple Wallet ne répond pas pour l’instant. Votre laisser-passer reste valable ici.');
    expect(walletUnavailableNotice({ wallet: ['indisponible'], wp: 'samsung' }, { eventContext: true, where: 'event' }))
      .toBe('Wallet ne répond pas pour l’instant. Votre billet reste suivi ici.');
  });

  it('hors événement, ou sans le paramètre : rien', () => {
    expect(walletUnavailableNotice({ wallet: 'indisponible', wp: 'apple' }, { eventContext: false, where: 'event' })).toBeNull();
    expect(walletUnavailableNotice({}, { eventContext: true, where: 'event' })).toBeNull();
    expect(walletUnavailableNotice({ wallet: 'oui' }, { eventContext: true, where: 'pass' })).toBeNull();
  });

  it('rendu dans l’écran client seulement avec l’accueil de l’événement', () => {
    const notice = 'Apple Wallet ne répond pas pour l’instant. Votre billet reste suivi ici.';
    const withEvent = renderClient({ walletNotice: notice, eventTheme: THEME });
    expect(withEvent).toContain(notice);
    expect(withEvent).toContain('Wallet indisponible');
    const withoutEvent = renderClient({ walletNotice: notice, eventTheme: null });
    expect(withoutEvent).not.toContain('Wallet');
  });
});

describe('wallet_qr_enabled = false', () => {
  it('une phrase, pas de badge', () => {
    const offer = computeWalletOffer(offerInput({ event: { walletQrEnabled: false, googleClass: 'ok' } }));
    expect(offer).toEqual({ qrNotAccepted: true });
    const html = render(offer);
    expect(html).toContain('Le QR Wallet n’est pas accepté pour cet événement : présentez cette page.');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<img');
  });

  it('le réglage de l’événement est transmis à walletOffer', async () => {
    const d = deps({
      runningEvent: vi.fn(async () => ({ id: EVENT_ID, walletQrEnabled: false })),
      offer: vi.fn(async () => ({ qrNotAccepted: true }) as Offer),
    });
    const result = await eventWalletForTicket({ ticket: ticket(), organizationId: ORG_ID, userAgent: UA.iphone }, d);
    expect(d.offer).toHaveBeenCalledWith(expect.objectContaining({ event: { id: EVENT_ID, walletQrEnabled: false } }));
    expect(result.offer).toEqual({ qrNotAccepted: true });
  });
});

/* ==================================================================== */

const THEME = {
  name: 'Drop Aurore', heroTitle: null, logoUrl: null, coverUrl: null,
  accentHex: '#3A63D8', rulesText: null, qrLabel: null,
};

const ENTRY_POINT = {
  slug: 'barber-house-bastille',
  organization: { id: ORG_ID, name: 'Barber House', activity: 'barber' },
  location: {
    id: '22222222-2222-4222-8222-222222222222', name: 'Barber House Bastille', slug: 'barber-house-bastille',
    city: 'Paris', addressLine1: null, postalCode: null, phone: null, latitude: null, longitude: null,
    mapsUrl: null, logoUrl: null,
  },
  queue: {
    id: '11111111-1111-4111-8111-111111111111', name: 'File', mode: 'shared', status: 'open',
    askClientName: true, clientNameRequired: false, allowStaffChoice: false, allowServiceChoice: false,
    pauseReason: null, waitingCount: 5,
  },
  staff: [], services: [], plate: null,
  settings: { brandAccent: 'signal', allowClientLeave: true },
  status: 'ok',
} as unknown as EntryPoint;

function renderClient(over: {
  walletNotice?: string | null;
  eventTheme?: typeof THEME | null;
  initialTicket?: TicketState | null;
  walletOffer?: Offer | null;
}): string {
  return renderToStaticMarkup(createElement(ClientExperience, {
    entryPoint: ENTRY_POINT,
    initialTicket: over.initialTicket ?? null,
    source: 'qr',
    vapidPublicKey: null,
    activityLabel: null,
    eventId: over.eventTheme ? EVENT_ID : null,
    eventTheme: over.eventTheme ?? null,
    walletOffer: over.walletOffer ?? null,
    walletNotice: over.walletNotice ?? null,
  }));
}

describe('emplacements', () => {
  it('accueil de l’événement, après l’inscription : l’offre est là', () => {
    const html = renderClient({ eventTheme: THEME, initialTicket: ticket(), walletOffer: APPLE_OFFER });
    expect(html).toContain(COPY.eventTitle);
    expect(html).toContain('/api/client/wallet/apple?entry=Tk42abcdEFGH');
  });

  it('avant l’inscription : pas d’offre (elle n’a pas de ticket)', () => {
    const html = renderClient({ eventTheme: THEME, walletOffer: APPLE_OFFER });
    expect(html).not.toContain(COPY.eventTitle);
  });

  it('jamais dans l’écran de fin (DonePanel) ni de fermeture', () => {
    const done = { ...ticket({ status: 'completed' }), wallet: { appleSaved: true } };
    const noop = () => undefined;
    for (const html of [
      renderToStaticMarkup(createElement(DonePanel, { ticket: done, onRejoin: noop })),
      renderToStaticMarkup(createElement(ClosedPanel, { ticket: { ...done, entry: { ...done.entry, status: 'cancelled' } }, onRejoin: noop })),
      // Même si une offre traînait encore dans l'état de l'écran.
      renderClient({ eventTheme: THEME, initialTicket: done, walletOffer: APPLE_OFFER }),
    ]) {
      expect(html).not.toMatch(/Wallet/);
      expect(html).not.toContain('/api/client/wallet/');
    }
  });

  it('file classique : aucune mention Wallet, même avec une offre transmise par erreur', () => {
    const html = renderClient({ initialTicket: ticket({ eventId: null }), walletOffer: APPLE_OFFER });
    expect(html).not.toMatch(/Wallet/);
  });
});

describe('App Clip (S2)', () => {
  it('l’écran iPhone ne cite l’App Clip que s’il est publié', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/app/e/[slug]/ClientExperience.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("reason === 'ios_needs_pwa' && appClip");
    const page = readFileSync(fileURLToPath(new URL('../../src/app/e/[slug]/page.tsx', import.meta.url)), 'utf8');
    expect(page).toContain('appClip={appClipPublished()}');
  });
});
