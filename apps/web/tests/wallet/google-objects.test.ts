import { describe, expect, it } from 'vitest';
import { walletAlertText } from '../../src/lib/wallet-copy';
import { verifyWalletProof, walletTotpKey } from '../../src/lib/wallet/scan-proof';
import { googleNaming } from '../../src/server/wallet/google/config';
import {
  ISSUER_NAME_MAX, MESSAGE_DISPLAY_MS, buildAlertMessage, eventClassBody, isoInZone, messageId, prunedMessages,
  queueClassBody, renderGoogleObject, renderHash, renderScrubPatch, type EventClassInput, type GoogleRenderOptions,
} from '../../src/server/wallet/google/objects';
import { bestInkOrBone, contrastRatio, eventPalette } from '../../src/server/wallet/palette';
import { buildWalletView } from '../../src/server/wallet/view';
import type { WalletSnapshot } from '../../src/server/wallet/types';
import { SITE, TRAP_NAME, eventSnapshot, snapshot, type Overrides } from './fixtures';

/**
 * WalletView → objets et classes Google : textes exacts (apostrophes
 * typographiques), états Google, empreinte stable, QR, minimisation.
 * Fonctions pures : aucun réseau, aucune base.
 */

const NOW = new Date('2026-09-24T12:30:00Z');
const OPTIONS: GoogleRenderOptions = { siteUrl: SITE, rotatingBarcode: false, now: NOW };

function render(snap: WalletSnapshot, now = NOW, options: Partial<GoogleRenderOptions> = {}) {
  const view = buildWalletView(snap, now, { siteUrl: SITE });
  return { view, out: renderGoogleObject(snap, view, { ...OPTIONS, now, ...options }) };
}

function queue(overrides: Overrides = {}) {
  return snapshot({ ...overrides, pass: { provider: 'google', externalId: '3388000000012345678.rangvia_q_' + 'a'.repeat(32), classRef: '3388000000012345678.rangvia_file_v1', ...(overrides.pass ?? {}) } });
}

function drop(overrides: Overrides = {}) {
  return eventSnapshot({
    ...overrides,
    pass: {
      provider: 'google',
      externalId: '3388000000012345678.rangvia_e_' + 'b'.repeat(32),
      classRef: '3388000000012345678.rangvia_evt_44444444444444448444444444444444',
      ...(overrides.pass ?? {}),
    },
  });
}

type Module = { id: string; header: string; body: string };
const modules = (patch: Record<string, unknown>) => patch.textModulesData as Module[];
const moduleBody = (patch: Record<string, unknown>, id: string) => modules(patch).find((m) => m.id === id)?.body;
const text = (value: unknown) => (value as { defaultValue: { value: string } } | null)?.defaultValue.value;

/** Toutes les clés d'un objet JSON, à toute profondeur. */
function deepKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      deepKeys(v, out);
    }
  }
  return out;
}

const ACCESS = {
  publicId: 'Acc3ssPubl1cId42',
  tokenHash: 'f'.repeat(64),
  status: 'issued' as const,
  issuedAt: '2026-10-03T08:42:00Z',
  validUntil: '2026-10-03T08:52:00Z',
  graceUntil: '2026-10-03T08:57:00Z',
  redeemedAt: null,
  revokedAt: null,
  wave: 3,
};
const DROP_NOW = new Date('2026-10-03T08:45:00Z');

describe('Ticket de file (Generic)', () => {
  it('6 devant : titre, cases de la carte, lattes, couleurs de la charte', () => {
    const { out } = render(queue());
    expect(out.type).toBe('genericObject');
    const p = out.patch;
    expect(p.genericType).toBe('GENERIC_OTHER');
    expect(p.state).toBe('ACTIVE');
    expect(text(p.cardTitle)).toBe('Barber House Bastille');
    expect(text(p.header)).toBe('6 personnes devant vous');
    expect(p.hexBackgroundColor).toBe('#0B0E13');
    expect(moduleBody(p, 'devant')).toBe('6');
    expect(moduleBody(p, 'statut')).toBe('Dans la file');
    expect(moduleBody(p, 'arrivee')).toBe('14:05');
    expect(moduleBody(p, 'maj')).toBe('14:30');
    expect(modules(p).find((m) => m.id === 'devant')?.header).toBe('Devant vous');
    expect(modules(p).find((m) => m.id === 'statut')?.header).toBe('Où en êtes-vous');
    expect(moduleBody(p, 'avec')).toBe('Karim');
    expect(moduleBody(p, 'quitter')).toMatch(/Supprimer ce pass de Wallet ne vous retire pas de la file\./);
    expect((p.heroImage as { sourceUri: { uri: string } }).sourceUri.uri).toBe(`${SITE}/api/wallet/art/rang-r2-6-signal.png`);
    expect((p.logo as { sourceUri: { uri: string } }).sourceUri.uri).toBe(`${SITE}/media/org/logo.png`);
    expect((p.linksModuleData as { uris: { uri: string; description: string }[] }).uris).toEqual([
      { id: 'ticket', uri: `${SITE}/e/barber-house-bastille`, description: 'Ouvrir mon ticket' },
    ]);
  });

  it.each([
    [{ entry: { peopleAhead: 2 } }, '2 personnes devant vous', 'Bientôt votre tour', '2', 'ACTIVE', 'rang-r2-2-signal'],
    [{ entry: { peopleAhead: 1 } }, '1 personne devant vous', 'Plus qu’une personne devant vous', '1', 'ACTIVE', 'rang-r2-1-signal'],
    [{ entry: { peopleAhead: 0 } }, 'C’est votre tour', 'Présentez-vous', '0', 'ACTIVE', 'rang-r2-0-signal'],
    [{ entry: { status: 'next', peopleAhead: 0 } }, 'C’est votre tour', 'Présentez-vous', '0', 'ACTIVE', 'rang-r2-0-signal'],
    [{ entry: { status: 'serving', peopleAhead: 0 } }, 'C’est votre tour', 'En cours', '0', 'ACTIVE', 'rang-r2-0-signal'],
    [{ entry: { peopleAhead: 25 } }, 'Plus de 20 personnes devant vous', 'Dans la file', 'Plus de 20', 'ACTIVE', 'rang-r2-plus-signal'],
    [{ entry: { status: 'cancelled', statusActor: 'client', statusEvent: 'client_leave' } }, 'Vous avez quitté la file', 'Ticket clos', '—', 'EXPIRED', null],
    [{ entry: { status: 'cancelled', statusActor: 'staff', statusEvent: 'cancel' } }, 'Vous avez été retiré de la file', 'Ticket clos', '—', 'EXPIRED', null],
    [{ entry: { status: 'skipped', statusActor: 'staff' } }, 'Vous avez été retiré de la file', 'Ticket clos', '—', 'EXPIRED', null],
    [{ entry: { status: 'expired' } }, 'Ticket expiré', 'Ticket clos', '—', 'EXPIRED', null],
    [{ entry: { status: 'absent' } }, 'Appel manqué', 'Marqué absent : présentez-vous à l’accueil', '—', 'ACTIVE', null],
    [{ queue: { status: 'paused' } }, '6 personnes devant vous', 'File en pause : votre place est conservée', '6', 'ACTIVE', 'rang-r2-6-signal'],
    [{ queue: { status: 'closed' } }, '6 personnes devant vous', 'File fermée pour le moment', '6', 'ACTIVE', 'rang-r2-6-signal'],
  ] as const)('phase %# : titre, statut, case, état, image', (overrides, header, status, ahead, state, hero) => {
    const { out } = render(queue(overrides as Overrides));
    expect(text(out.patch.header)).toBe(header);
    expect(moduleBody(out.patch, 'statut')).toBe(status);
    expect(moduleBody(out.patch, 'devant')).toBe(ahead);
    expect(out.patch.state).toBe(state);
    if (hero) expect((out.patch.heroImage as { sourceUri: { uri: string } }).sourceUri.uri).toContain(`/${hero}.png`);
    else expect(out.patch.heroImage).toBeNull();
  });

  it('« Merci » : actif 2 h avec le lien d’avis mesuré (source=wallet), puis COMPLETED', () => {
    const done = queue({ entry: { status: 'completed', completedAt: '2026-09-24T12:00:00Z', statusChangedAt: '2026-09-24T12:00:00Z' } });
    const soon = render(done, new Date('2026-09-24T13:00:00Z')).out;
    expect(text(soon.patch.header)).toBe('Merci de votre visite');
    expect(soon.patch.state).toBe('ACTIVE');
    const links = (soon.patch.linksModuleData as { uris: { id: string; uri: string; description: string }[] }).uris;
    expect(links.find((l) => l.id === 'avis')).toEqual({
      id: 'avis', uri: `${SITE}/api/client/review/click?entry=Tk42abcdEFGH&source=wallet`, description: 'Donner mon avis',
    });
    expect(moduleBody(soon.patch, 'quitter')).toBeUndefined();
    expect(render(done, new Date('2026-09-24T14:00:00Z')).out.patch.state).toBe('COMPLETED');
  });

  it('pas de lien d’avis sans URL d’avis, ni pour un profil de santé', () => {
    const base = { entry: { status: 'completed' as const, completedAt: '2026-09-24T12:00:00Z' } };
    const links = (s: WalletSnapshot) => (render(s).out.patch.linksModuleData as { uris: { id: string }[] }).uris.map((u) => u.id);
    expect(links(queue({ ...base, location: { hasReviewUrl: false } }))).toEqual(['ticket']);
    expect(links(queue({ ...base, organization: { sendCompletionReview: false } }))).toEqual(['ticket']);
  });

  it('empreinte identique de 25 à 40 devant (aucun PATCH pendant un drop lointain)', () => {
    const hashes = new Set([21, 25, 33, 40].map((n) => render(queue({ entry: { peopleAhead: n } })).out.hash));
    expect(hashes.size).toBe(1);
    expect(render(queue({ entry: { peopleAhead: 20 } })).out.hash).not.toBe(render(queue({ entry: { peopleAhead: 21 } })).out.hash);
  });

  it('module « Mis à jour » hors empreinte', () => {
    const a = render(queue(), new Date('2026-09-24T12:30:00Z')).out;
    const b = render(queue(), new Date('2026-09-24T12:47:00Z')).out;
    expect(moduleBody(a.patch, 'maj')).not.toBe(moduleBody(b.patch, 'maj'));
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(renderHash(a.patch));
  });

  it('insertion : identifiants, et aucun champ nul', () => {
    const { out } = render(queue({ entry: { status: 'expired' } }));
    expect(out.insert.id).toBe(out.id);
    expect(out.insert.classId).toBe('3388000000012345678.rangvia_file_v1');
    expect(Object.values(out.insert).some((v) => v === null)).toBe(false);
    expect(out.patch.heroImage).toBeNull();
    expect('heroImage' in out.insert).toBe(false);
  });

  it('logo en HTTP : remplacé par le logo Rangvia (Google refuserait l’objet)', () => {
    const { out } = render(queue({ location: { logoUrl: 'http://example.com/logo.png' } }));
    expect((out.patch.logo as { sourceUri: { uri: string } }).sourceUri.uri).toBe(`${SITE}/api/wallet/art/rangvia-660.png`);
  });

  it('accent de l’établissement repris par les lattes', () => {
    const { out } = render(queue({ organization: { brandAccent: 'jade' } }));
    expect((out.patch.heroImage as { sourceUri: { uri: string } }).sourceUri.uri).toContain('rang-r2-6-jade.png');
    expect(out.patch.hexBackgroundColor).toBe('#0B0E13');
  });
});

describe('Minimisation', () => {
  const renders = [
    render(queue()).out,
    render(queue({ entry: { status: 'completed', completedAt: '2026-09-24T12:00:00Z' } })).out,
    render(drop({ access: ACCESS }), DROP_NOW).out,
    render(drop({ access: ACCESS }), DROP_NOW, { rotatingBarcode: true }).out,
  ];

  it('prénom piège « Zébulon » absent de tout rendu', () => {
    for (const out of renders) {
      expect(JSON.stringify(out.patch)).not.toContain(TRAP_NAME);
      expect(JSON.stringify(out.insert)).not.toContain(TRAP_NAME);
    }
  });

  it('ni merchantLocations, ni notifications, ni ticketHolderName, ni jeton du laisser-passer', () => {
    for (const out of renders) {
      const keys = deepKeys(out.insert);
      for (const forbidden of ['merchantLocations', 'notifications', 'ticketHolderName', 'notifyPreference', 'locations']) {
        expect(keys.has(forbidden)).toBe(false);
      }
      expect(JSON.stringify(out.insert)).not.toContain(ACCESS.tokenHash);
    }
  });
});

describe('Billet de drop (Event ticket)', () => {
  it('en attente : pas de QR, type « En attente de votre vague », numéro humain', () => {
    const { out } = render(drop({ entry: { peopleAhead: 8 } }), DROP_NOW);
    expect(out.type).toBe('eventTicketObject');
    expect(out.patch.ticketNumber).toBe('A-042');
    expect(text(out.patch.ticketType)).toBe('En attente de votre vague');
    expect(out.patch.barcode).toBeNull();
    expect(out.patch.rotatingBarcode).toBeNull();
    expect(out.patch.validTimeInterval).toBeNull();
    expect(moduleBody(out.patch, 'devant')).toBe('8');
    expect(out.patch.passConstraints).toEqual({ screenshotEligibility: 'INELIGIBLE' });
    expect(out.patch.state).toBe('ACTIVE');
  });

  it('accès ouvert : QR statique signé, lié au pass, accepté par le contrôle', () => {
    const snap = drop({ access: ACCESS });
    const { out } = render(snap, DROP_NOW);
    expect(text(out.patch.ticketType)).toBe('Vague 3');
    const barcode = out.patch.barcode as { type: string; value: string; alternateText: string };
    expect(barcode.type).toBe('QR_CODE');
    expect(barcode.alternateText).toBe('A-042 · Vague 3');
    expect(barcode.value.startsWith(`${SITE}/scan/${ACCESS.publicId}?w=`)).toBe(true);
    const w = new URL(barcode.value).searchParams.get('w')!;
    expect(verifyWalletProof({ tokenHash: ACCESS.tokenHash, walletPassIds: [snap.pass.id], proof: { kind: 'wallet', w } })).toBe(snap.pass.id);
    expect(verifyWalletProof({ tokenHash: ACCESS.tokenHash, walletPassIds: ['autre-pass'], proof: { kind: 'wallet', w } })).toBeNull();
    expect(out.patch.rotatingBarcode).toBeNull();
    // Fenêtre de validité avec le décalage de Paris en octobre (heure d'été).
    expect(out.patch.validTimeInterval).toEqual({
      start: { date: '2026-10-03T10:42:00+02:00' },
      end: { date: '2026-10-03T10:57:00+02:00' },
    });
    expect(moduleBody(out.patch, 'limite')).toBe('10:52');
    expect(moduleBody(out.patch, 'tolerance')).toBe('10:57');
    expect(moduleBody(out.patch, 'statut')).toBe('Présentez-vous avant 10:52');
  });

  it('QR tournant TOTP (après recette) : motif et clé propres au pass', () => {
    const snap = drop({ access: ACCESS });
    const { out } = render(snap, DROP_NOW, { rotatingBarcode: true });
    const rotating = out.patch.rotatingBarcode as {
      type: string; valuePattern: string; alternateText: string;
      totpDetails: { algorithm: string; periodMillis: string; parameters: { key: string; valueLength: number }[] };
    };
    expect(out.patch.barcode).toBeNull();
    expect(rotating.type).toBe('QR_CODE');
    expect(rotating.valuePattern).toBe(`${SITE}/scan/${ACCESS.publicId}?t={totp_timestamp_seconds}&otp={totp_value_0}`);
    expect(rotating.totpDetails.algorithm).toBe('TOTP_SHA1');
    expect(rotating.totpDetails.periodMillis).toBe('30000');
    expect(rotating.totpDetails.parameters).toEqual([{ key: walletTotpKey(ACCESS.tokenHash, snap.pass.id), valueLength: 8 }]);
    expect(rotating.totpDetails.parameters[0]!.key).toMatch(/^[0-9a-f]{40}$/);
    expect(rotating.alternateText).toBe('A-042 · Vague 3');
  });

  it('QR Wallet refusé par l’événement : aucun code, une consigne', () => {
    const { out } = render(drop({ access: ACCESS, event: { walletQrEnabled: false } }), DROP_NOW);
    expect(out.patch.barcode).toBeNull();
    expect(out.patch.rotatingBarcode).toBeNull();
    expect(moduleBody(out.patch, 'controle')).toBe('Le QR Wallet n’est pas accepté pour cet événement : présentez cette page.');
  });

  it.each([
    [{ status: 'redeemed' as const, redeemedAt: '2026-10-03T08:47:00Z' }, 'COMPLETED', 'Utilisé', 'Billet utilisé à 10:47'],
    [{ status: 'expired' as const }, 'EXPIRED', 'Accès expiré', 'Accès expiré'],
    [{ status: 'revoked' as const, revokedAt: '2026-10-03T08:50:00Z' }, 'EXPIRED', 'Événement terminé', null],
  ])('fin de billet %# : QR retiré, état final', (access, state, ticketType, status) => {
    const { out } = render(drop({ access: { ...ACCESS, ...access }, event: { status: 'ended' } }), DROP_NOW);
    expect(out.patch.state).toBe(state);
    expect(text(out.patch.ticketType)).toBe(ticketType);
    expect(out.patch.barcode).toBeNull();
    expect(out.patch.rotatingBarcode).toBeNull();
    expect(out.patch.validTimeInterval).toBeNull();
    if (status) expect(moduleBody(out.patch, 'statut')).toBe(status);
  });

  it('tolérance dépassée avant le cron : pas de QR que le contrôle refuserait', () => {
    const { out } = render(drop({ access: ACCESS }), new Date('2026-10-03T09:00:00Z'));
    expect(out.patch.state).toBe('EXPIRED');
    expect(out.patch.barcode).toBeNull();
  });
});

describe('Classes', () => {
  const naming = googleNaming('3388000000012345678', 'rangvia');

  it('file : Generic, ONE_USER_ALL_DEVICES, deux lignes de cases', () => {
    const body = queueClassBody(naming);
    expect(body.id).toBe('3388000000012345678.rangvia_file_v1');
    expect(body.multipleDevicesAndHoldersAllowedStatus).toBe('ONE_USER_ALL_DEVICES');
    const rows = (body.classTemplateInfo as { cardTemplateOverride: { cardRowTemplateInfos: unknown[] } }).cardTemplateOverride.cardRowTemplateInfos;
    expect(JSON.stringify(rows)).toBe(JSON.stringify([
      { twoItems: { startItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['devant']" }] } }, endItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['statut']" }] } } } },
      { twoItems: { startItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['arrivee']" }] } }, endItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['maj']" }] } } } },
    ]));
    expect(deepKeys(body).has('merchantLocations')).toBe(false);
  });

  const EVENT: EventClassInput = {
    eventId: '44444444-4444-4444-8444-444444444444',
    name: 'Drop Aurore',
    logoUrl: null,
    coverUrl: 'https://cdn.example.com/aurore.jpg',
    accentHex: '#18143C',
    rulesText: 'Une paire par personne.',
    startedAt: '2026-10-03T08:00:00Z',
    location: {
      name: 'Sneaker Lab République Paris Onze',
      addressLine1: '12 rue du Faubourg', addressLine2: null, postalCode: '75011', city: 'Paris', countryCode: 'FR',
      timezone: 'Europe/Paris', logoUrl: `${SITE}/media/org/logo.png`,
    },
    organization: { name: 'Sneaker Lab', logoUrl: null, brandAccent: 'signal' },
  };
  const CLASS_ID = '3388000000012345678.rangvia_evt_44444444444444448444444444444444';

  it('événement : nom, lieu complet, visuel, couleur, règles, date avec fuseau', () => {
    const body = eventClassBody(CLASS_ID, EVENT, SITE);
    expect(body.id).toBe(CLASS_ID);
    expect((body.issuerName as string).length).toBeLessThanOrEqual(ISSUER_NAME_MAX);
    expect(body.issuerName).toBe('Sneaker Lab Républi…');
    expect(text(body.eventName)).toBe('Drop Aurore');
    expect(body.eventId).toBe('44444444444444448444444444444444');
    expect(body.venue).toEqual({
      name: { defaultValue: { language: 'fr', value: 'Sneaker Lab République Paris Onze' } },
      address: { defaultValue: { language: 'fr', value: '12 rue du Faubourg\n75011 Paris' } },
    });
    expect((body.heroImage as { sourceUri: { uri: string } }).sourceUri.uri).toBe('https://cdn.example.com/aurore.jpg');
    expect((body.logo as { sourceUri: { uri: string } }).sourceUri.uri).toBe(`${SITE}/media/org/logo.png`);
    expect(body.hexBackgroundColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(text(body.finePrint)).toBe('Une paire par personne.');
    expect(body.dateTime).toEqual({ start: '2026-10-03T10:00:00+02:00' });
    expect(body.reviewStatus).toBe('UNDER_REVIEW');
    expect(body.multipleDevicesAndHoldersAllowedStatus).toBe('ONE_USER_ALL_DEVICES');
    expect(deepKeys(body).has('merchantLocations')).toBe(false);
  });

  it('adresse incomplète : pas de lieu inventé ; visuel en HTTP : retiré', () => {
    const body = eventClassBody(CLASS_ID, {
      ...EVENT,
      coverUrl: 'http://cdn.example.com/aurore.jpg',
      location: { ...EVENT.location, addressLine1: null, logoUrl: null },
    }, SITE);
    expect(body.venue).toBeNull();
    expect(body.heroImage).toBeNull();
    expect((body.logo as { sourceUri: { uri: string } }).sourceUri.uri).toBe(`${SITE}/api/wallet/art/rangvia-660.png`);
  });

  it('couleur de marque quelconque : fond lisible (≥ 4,5:1), format #RRGGBB, même palette qu’Apple', () => {
    for (const accentHex of ['#777777', '#FFE7DF', '#18143C', '#FF4B1F', '#1FA97A', '#8A8A8A']) {
      const body = eventClassBody(CLASS_ID, { ...EVENT, accentHex }, SITE);
      const background = body.hexBackgroundColor as string;
      expect(background).toMatch(/^#[0-9A-F]{6}$/);
      expect(background).toBe(eventPalette(accentHex).google.hexBackgroundColor);
      expect(contrastRatio(bestInkOrBone(background), background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('Effacement', () => {
  it('file finie : titre « Ticket clos », tout vidé, état final gardé', () => {
    const snap = queue({ entry: { status: 'expired' } });
    const scrub = renderScrubPatch(snap, buildWalletView(snap, NOW, { siteUrl: SITE }));
    expect(scrub.type).toBe('genericObject');
    expect(scrub.patch).toEqual({
      state: 'EXPIRED',
      header: { defaultValue: { language: 'fr', value: 'Ticket clos' } },
      heroImage: null,
      textModulesData: [],
      linksModuleData: { uris: [] },
      messages: [],
    });
  });

  it('billet : QR, numéro et fenêtre vidés ; pass encore actif → INACTIVE', () => {
    const snap = drop({ access: ACCESS });
    const scrub = renderScrubPatch(snap, { googleState: 'ACTIVE' });
    expect(scrub.patch).toMatchObject({
      state: 'INACTIVE', ticketNumber: null, barcode: null, rotatingBarcode: null, validTimeInterval: null, messages: [],
    });
    expect(JSON.stringify(scrub.patch)).not.toContain('A-042');
  });
});

describe('Messages', () => {
  it('textes de walletAlertText, sonnerie selon la décision, 12 h au dos', () => {
    const snap = queue({ entry: { peopleAhead: 0 } });
    const view = buildWalletView(snap, NOW, { siteUrl: SITE });
    const notify = buildAlertMessage('your_turn', true, snap, view, NOW);
    const expected = walletAlertText('your_turn', { placeName: 'Barber House Bastille', peopleAhead: 0 });
    expect(notify).toMatchObject({ id: 'your_turn', header: expected.header, body: expected.body, messageType: 'TEXT_AND_NOTIFY' });
    expect(notify.header).toBe('C’est votre tour');
    expect(Date.parse(notify.displayInterval!.end!.date) - Date.parse(notify.displayInterval!.start!.date)).toBe(MESSAGE_DISPLAY_MS);
    expect(buildAlertMessage('your_turn', false, snap, view, NOW).messageType).toBe('TEXT');
  });

  it('identifiant stable, et nouveau quand le moteur rouvre le moment', () => {
    const snap = queue();
    expect(messageId('ahead_one', snap)).toBe('ahead_one');
    const reset = queue({ entry: { rankResetAt: '2026-09-24T12:20:00Z' } });
    expect(messageId('ahead_one', reset)).toMatch(/^ahead_one-[0-9a-z]+$/);
    expect(messageId('ahead_one', reset)).toBe(messageId('ahead_one', queue({ entry: { rankResetAt: '2026-09-24T12:20:00Z' } })));
    const wave1 = drop({ access: ACCESS });
    const wave2 = drop({ access: { ...ACCESS, issuedAt: '2026-10-03T09:10:00Z' } });
    expect(messageId('event_access', wave1)).not.toBe(messageId('event_access', wave2));
    expect(messageId('event_sold_out', wave1)).toBe('event_sold_out');
  });

  it('au-delà de 6 messages : les 5 plus récents, rétrogradés en TEXT', () => {
    const at = (h: number) => ({ start: { date: `2026-09-24T${String(h).padStart(2, '0')}:00:00Z` } });
    const seven = [3, 1, 7, 2, 6, 4, 5].map((h) => ({ id: `m${h}`, header: 'h', body: 'b', messageType: 'TEXT_AND_NOTIFY', displayInterval: at(h) }));
    const kept = prunedMessages(seven)!;
    expect(kept.map((m) => m.id)).toEqual(['m3', 'm7', 'm6', 'm4', 'm5']);
    expect(kept.every((m) => m.messageType === 'TEXT')).toBe(true);
    expect(prunedMessages(seven.slice(0, 6))).toBeNull();
    expect(prunedMessages(undefined)).toBeNull();
  });
});

describe('Dates avec fuseau', () => {
  it('heure d’été et d’hiver de Paris, fuseau inconnu → Paris', () => {
    expect(isoInZone('2026-10-03T08:42:00Z', 'Europe/Paris')).toBe('2026-10-03T10:42:00+02:00');
    expect(isoInZone('2026-11-03T08:42:00.500Z', 'Europe/Paris')).toBe('2026-11-03T09:42:00+01:00');
    expect(isoInZone('2026-10-03T08:42:00Z', 'Pas/UnFuseau')).toBe('2026-10-03T10:42:00+02:00');
    expect(isoInZone('2026-10-03T08:42:00Z', 'UTC')).toBe('2026-10-03T08:42:00+00:00');
    expect(isoInZone('2026-10-03T08:42:00Z', 'Asia/Kolkata')).toBe('2026-10-03T14:12:00+05:30');
  });
});
