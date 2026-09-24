import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WALLET_OFFER_COPY } from '../../src/lib/wallet-copy';
import { signWalletQrCode } from '../../src/lib/wallet/scan-proof';
import { decideAlertFor } from '../../src/server/wallet/alerts';
import { checkAppleConfig, type AppleWalletConfig } from '../../src/server/wallet/apple/config';
import { buildApplePass, packApplePass } from '../../src/server/wallet/apple/pass';
import { readZip, sha1Hex } from '../../src/server/wallet/apple/pkpass';
import {
  FRONT_LIMITS, renderApplePassJson, type AppleField, type ApplePassContext, type ApplePassJson,
} from '../../src/server/wallet/apple/render';
import { applePassToken } from '../../src/server/wallet/apple/tokens';
import { buildWalletView } from '../../src/server/wallet/view';
import type { WalletSnapshot, WalletView } from '../../src/server/wallet/types';
import { configInput, makePki, TEST_SECRET } from './apple-fixtures';
import { SITE, TRAP_NAME, eventSnapshot, snapshot, type Overrides } from './fixtures';

/**
 * Rendu du pass Apple : les mots viennent de la vue (wallet-copy), la mise
 * en page respecte les limites de Wallet, et l'alerte de l'écran
 * verrouillé ne porte QUE sur le champ `etat`, seulement quand elle doit
 * sonner. Puis un .pkpass complet, signé par l'AC de test, relu et
 * vérifié par OpenSSL comme le ferait un iPhone (hors chaîne Apple).
 */

const NOW = new Date('2026-09-24T12:30:00Z');
const work = mkdtempSync(path.join(tmpdir(), 'rangvia-pkpass-'));
let config: AppleWalletConfig;
let rootPem: string;

beforeAll(() => {
  const pki = makePki();
  rootPem = pki.root.certPem;
  const check = checkAppleConfig(configInput(pki), new Date());
  if (!check.ok) throw new Error(check.reason);
  config = check.config;
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

function viewOf(snap: WalletSnapshot, now = NOW): WalletView {
  return buildWalletView(snap, now, { siteUrl: SITE });
}

function render(snap: WalletSnapshot, extra: Partial<ApplePassContext> = {}, now = NOW): ApplePassJson {
  const view = viewOf(snap, now);
  return renderApplePassJson(view, snap, {
    passTypeId: 'pass.test.rangvia',
    teamId: 'TESTTEAM01',
    serial: snap.pass.externalId,
    authenticationToken: applePassToken(snap.pass.externalId, TEST_SECRET),
    webServiceUrl: `${SITE}/api/wallet/apple`,
    alert: decideAlertFor('apple', snap, view, now),
    qrMessage: null,
    hasBrandLogo: false,
    ...extra,
  });
}

function fieldsOf(pass: ApplePassJson) {
  const set = pass.generic ?? pass.eventTicket!;
  return set;
}

function allFields(pass: ApplePassJson): AppleField[] {
  const set = fieldsOf(pass);
  return [...set.headerFields, ...set.primaryFields, ...set.secondaryFields, ...set.auxiliaryFields, ...set.backFields];
}

function field(pass: ApplePassJson, key: string): AppleField | undefined {
  return allFields(pass).find((f) => f.key === key);
}

const queue = (overrides: Overrides = {}) => snapshot(overrides);
const issued = {
  publicId: 'Acc3ssPubl1cId',
  tokenHash: 'a'.repeat(64),
  status: 'issued' as const,
  issuedAt: '2026-09-24T12:22:00Z',
  validUntil: '2026-09-24T12:32:00Z',
  graceUntil: '2026-09-24T12:37:00Z',
  redeemedAt: null,
  revokedAt: null,
  wave: 3,
};

describe('ticket de file (generic)', () => {
  it('6 personnes devant : le chiffre en grand, « Dans la file », aucune alerte', () => {
    const pass = render(queue());
    expect(pass.generic).toBeDefined();
    expect(pass.eventTicket).toBeUndefined();
    expect(fieldsOf(pass).primaryFields[0]).toMatchObject({ key: 'devant', label: 'DEVANT VOUS', value: 6 });
    expect(field(pass, 'etat')).toMatchObject({ label: 'OÙ EN ÊTES-VOUS', value: 'Dans la file' });
    expect(allFields(pass).some((f) => f.changeMessage)).toBe(false);
    expect(pass.voided).toBeUndefined();
    expect(pass.sharingProhibited).toBe(true);
  });

  it('6 → 5 : même valeur de `etat` (Wallet ne sonne pas)', () => {
    const a = field(render(queue({ entry: { peopleAhead: 6 } })), 'etat');
    const b = field(render(queue({ entry: { peopleAhead: 5 } })), 'etat');
    expect(a?.value).toBe(b?.value);
  });

  it('palier « Plus de 20 » au-delà de 20 personnes', () => {
    const pass = render(queue({ entry: { peopleAhead: 34 } }));
    expect(fieldsOf(pass).primaryFields[0]?.value).toBe('Plus de 20');
  });

  it('Bientôt votre tour : changeMessage %@ sur `etat`, et seulement là', () => {
    const pass = render(queue({ entry: { peopleAhead: 2 } }));
    const etat = field(pass, 'etat');
    expect(etat?.value).toBe('Bientôt votre tour');
    expect(etat?.changeMessage).toBe('%@ : plus que 2 personnes devant vous.');
    expect(allFields(pass).filter((f) => f.changeMessage).map((f) => f.key)).toEqual(['etat']);
  });

  it('déjà livré par un autre canal : pas de changeMessage (sauf « C’est votre tour »)', () => {
    const delivered = { deliveredKinds: { web_push: ['ahead_two', 'your_turn'] } };
    expect(field(render(queue({ entry: { peopleAhead: 2 }, ...delivered })), 'etat')?.changeMessage).toBeUndefined();
    const turn = render(queue({ entry: { peopleAhead: 0, status: 'next' }, ...delivered }));
    expect(field(turn, 'etat')?.changeMessage).toBe('%@ : c’est votre tour chez Barber House Bastille.');
    expect(fieldsOf(turn).primaryFields[0]).toMatchObject({ value: 'À vous', label: 'BARBER HOUSE BASTILLE' });
  });

  it('mode Événement : jamais de changeMessage de rang', () => {
    const pass = render(queue({ entry: { peopleAhead: 1 }, queue: { runningEventId: '44444444-4444-4444-8444-444444444444' } }));
    expect(allFields(pass).some((f) => f.changeMessage)).toBe(false);
  });

  it('retiré par le pro : annulé, alerte ; quitté par le client : annulé, sans alerte', () => {
    const removed = render(queue({ entry: { status: 'skipped', statusActor: 'staff' } }));
    expect(removed.voided).toBe(true);
    expect(field(removed, 'etat')?.changeMessage).toMatch(/retiré de la file/);
    const left = render(queue({ entry: { status: 'cancelled', statusActor: 'client' } }));
    expect(left.voided).toBe(true);
    expect(allFields(left).some((f) => f.changeMessage)).toBe(false);
    // Plus de lien « suivre » ni de consigne « quitter » sur un ticket clos.
    expect(field(left, 'suivre')).toBeUndefined();
    expect(field(left, 'quitter')).toBeUndefined();
    expect(left.relevantDates).toBeUndefined();
    expect(left.locations).toBeUndefined();
  });

  it('Merci : expiration à +2 h, lien d’avis mesuré au verso', () => {
    const pass = render(queue({ entry: { status: 'completed', completedAt: '2026-09-24T12:20:00Z', statusActor: 'staff' } }));
    expect(pass.expirationDate).toBe('2026-09-24T14:20:00Z');
    expect(pass.voided).toBeUndefined();
    const avis = field(pass, 'avis');
    expect(avis?.value).toBe(`${SITE}/api/client/review/click?entry=Tk42abcdEFGH&source=wallet`);
    expect(avis?.attributedValue).toBe(`<a href='${SITE}/api/client/review/click?entry=Tk42abcdEFGH&amp;source=wallet'>Donner mon avis</a>`);
  });

  it('profil de santé : aucune demande d’avis', () => {
    const pass = render(queue({
      entry: { status: 'completed', completedAt: '2026-09-24T12:20:00Z' },
      organization: { sendCompletionReview: false },
    }));
    expect(field(pass, 'avis')).toBeUndefined();
  });

  it('pertinence : fenêtre d’attente, position du lieu, 200 m', () => {
    const pass = render(queue());
    expect(pass.relevantDates).toEqual([{ startDate: '2026-09-24T12:05:00Z', endDate: '2026-09-24T16:05:00Z' }]);
    expect(pass.relevantDate).toBe('2026-09-24T12:05:00Z');
    expect(pass.locations).toEqual([{ latitude: 48.853, longitude: 2.369, relevantText: 'Votre place chez Barber House Bastille' }]);
    expect(pass.maxDistance).toBe(200);
    expect(pass.expirationDate).toBe('2026-09-24T16:05:00Z');
  });

  it('en-tête : heure d’arrivée ; le pro assigné (déjà public) ; jamais le prénom du client', () => {
    const pass = render(queue());
    expect(fieldsOf(pass).headerFields[0]).toMatchObject({ key: 'arrivee', value: '2026-09-24T12:05:00Z', timeStyle: 'PKDateStyleShort' });
    expect(field(pass, 'avec')?.value).toBe('Karim');
    expect(JSON.stringify(pass)).not.toContain(TRAP_NAME);
  });

  it('logo téléversé : pas de logoText ; sinon le nom écrit à côté du signe', () => {
    expect(render(queue(), { hasBrandLogo: true }).logoText).toBeUndefined();
    expect(render(queue()).logoText).toBe('Barber House');
  });

  it('couleurs Apple rgb(), encre et os, étiquettes lisibles', () => {
    const pass = render(queue({ organization: { brandAccent: 'cobalt' } }));
    expect(pass.backgroundColor).toBe('rgb(11, 14, 19)');
    expect(pass.foregroundColor).toBe('rgb(250, 249, 246)');
    expect(pass.labelColor).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
  });
});

describe('billet de drop (eventTicket)', () => {
  it('en attente de la vague : numéro humain, pas de QR, pas d’alerte', () => {
    const pass = render(eventSnapshot({ entry: { peopleAhead: 12 } }));
    expect(pass.eventTicket).toBeDefined();
    expect(fieldsOf(pass).headerFields[0]).toMatchObject({ key: 'numero', value: 'A-042' });
    expect(fieldsOf(pass).primaryFields[0]).toMatchObject({ label: 'DROP AURORE', value: 12 });
    expect(pass.barcodes).toBeUndefined();
    expect(allFields(pass).some((f) => f.changeMessage)).toBe(false);
    expect(pass.groupingIdentifier).toBe('event.44444444-4444-4444-8444-444444444444');
    expect(pass.semantics).toEqual({ eventName: 'Drop Aurore', venueName: 'Barber House Bastille' });
  });

  it('accès ouvert : QR signé lié au pass, alerte, heure limite, tolérance, vague', () => {
    const snap = eventSnapshot({ access: issued });
    const view = viewOf(snap);
    const qrMessage = `${SITE}/scan/${issued.publicId}?w=${signWalletQrCode(issued.tokenHash, snap.pass.id)}`;
    const pass = render(snap, { qrMessage });
    expect(pass.barcodes).toEqual([{ format: 'PKBarcodeFormatQR', message: qrMessage, messageEncoding: 'iso-8859-1', altText: 'A-042 · Vague 3' }]);
    expect(field(pass, 'etat')).toMatchObject({ label: 'À FAIRE', value: view.statusText, changeMessage: 'Votre accès est prêt. %@.' });
    expect(field(pass, 'limite')).toMatchObject({ value: '2026-09-24T12:32:00Z', timeStyle: 'PKDateStyleShort' });
    expect(field(pass, 'tolerance')?.value).toBe('+5 min');
    expect(field(pass, 'vague')?.value).toBe('3');
    expect(pass.expirationDate).toBe('2026-09-24T12:37:00Z');
    expect(pass.relevantDates).toEqual([{ startDate: '2026-09-24T12:22:00Z', endDate: '2026-09-24T12:37:00Z' }]);
  });

  it('QR Wallet refusé au contrôle pour cet événement : pas de code-barres, une consigne', () => {
    const snap = eventSnapshot({ access: issued, event: { walletQrEnabled: false } });
    const pass = render(snap, { qrMessage: 'https://ne-doit-pas-apparaitre' });
    expect(pass.barcodes).toBeUndefined();
    expect(field(pass, 'controle')?.value).toBe(WALLET_OFFER_COPY.qrNotAccepted);
  });

  it('utilisé : annulé, QR retiré', () => {
    const pass = render(eventSnapshot({ access: { ...issued, status: 'redeemed', redeemedAt: '2026-09-24T12:25:00Z' } }), { qrMessage: 'x' });
    expect(pass.voided).toBe(true);
    expect(pass.barcodes).toBeUndefined();
    expect(fieldsOf(pass).primaryFields[0]?.value).toBe('Utilisé');
  });

  it('couleur de la marque en fond, texte au meilleur contraste', () => {
    const pass = render(eventSnapshot());
    expect(pass.backgroundColor).toBe('rgb(24, 20, 60)');
    expect(pass.foregroundColor).toBe('rgb(250, 249, 246)');
  });
});

describe('contraintes Wallet, sur tous les états', () => {
  const states: [string, WalletSnapshot, Partial<ApplePassContext>?][] = [
    ['attente', queue()],
    ['bientôt', queue({ entry: { peopleAhead: 2 } })],
    ['un', queue({ entry: { peopleAhead: 1 } })],
    ['tour', queue({ entry: { peopleAhead: 0, status: 'next' } })],
    ['en cours', queue({ entry: { status: 'serving', calledAt: '2026-09-24T12:25:00Z', serviceStartedAt: '2026-09-24T12:26:00Z' } })],
    ['absent', queue({ entry: { status: 'absent' } })],
    ['pause', queue({ queue: { status: 'paused' } })],
    ['fermée', queue({ queue: { status: 'closed' } })],
    ['merci', queue({ entry: { status: 'completed', completedAt: '2026-09-24T12:20:00Z' } })],
    ['retiré', queue({ entry: { status: 'skipped' } })],
    ['expiré', queue({ entry: { status: 'expired' } })],
    ['drop attente', eventSnapshot()],
    ['drop accès', eventSnapshot({ access: issued }), { qrMessage: `${SITE}/scan/x?w=y` }],
    ['drop expiré', eventSnapshot({ access: { ...issued, status: 'expired' } })],
    ['drop complet', eventSnapshot({ event: { status: 'sold_out' } })],
  ];

  for (const [name, snap, extra] of states) {
    it(name, () => {
      const pass = render(snap, extra);
      const set = fieldsOf(pass);
      expect(set.headerFields.length).toBeLessThanOrEqual(FRONT_LIMITS.header);
      expect(set.primaryFields).toHaveLength(1);
      expect(set.secondaryFields.length).toBeLessThanOrEqual(FRONT_LIMITS.secondary);
      expect(set.auxiliaryFields.length).toBeLessThanOrEqual(FRONT_LIMITS.auxiliary);
      expect(set.backFields.length).toBeLessThanOrEqual(FRONT_LIMITS.back);
      const keys = allFields(pass).map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const f of [...set.headerFields, ...set.primaryFields, ...set.secondaryFields, ...set.auxiliaryFields]) {
        // `etat` porte la phrase complète de l'alerte (écran verrouillé) :
        // seule sur sa ligne, Wallet la tronque au recto s'il le faut.
        expect(String(f.value).length).toBeLessThanOrEqual(f.key === 'etat' ? FRONT_LIMITS.statusChars : FRONT_LIMITS.valueChars);
        expect((f.label ?? '').length).toBeLessThanOrEqual(FRONT_LIMITS.labelChars);
        // Libellés du recto en capitales, accents gardés.
        if (f.label && f.key !== 'numero') expect(f.label).toBe(f.label.toLocaleUpperCase('fr-FR'));
      }
      expect(allFields(pass).filter((f) => f.changeMessage).every((f) => f.key === 'etat' && f.changeMessage!.includes('%@'))).toBe(true);
      expect(pass.webServiceURL.startsWith('https://')).toBe(true);
      expect(pass.authenticationToken.length).toBeGreaterThanOrEqual(16);
      for (const date of [pass.expirationDate, pass.relevantDate, ...(pass.relevantDates ?? []).flatMap((d) => [d.startDate, d.endDate])]) {
        if (date) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      }
      expect(JSON.stringify(pass)).not.toContain(TRAP_NAME);
      // Apostrophes typographiques seulement (les liens construits par le
      // serveur, attributedValue, gardent leurs guillemets HTML).
      const texts = allFields(pass).flatMap((f) => [f.label ?? '', String(f.value), f.changeMessage ?? '']);
      for (const text of [...texts, pass.description, pass.logoText ?? '']) expect(text).not.toMatch(/'/);
    });
  }
});

describe('.pkpass complet, signé par l’AC de test', () => {
  const opts = { sources: { logo: null, cover: null } };

  it('empreinte stable pour un même état, différente quand la position change', async () => {
    const snap = queue();
    const a = await buildApplePass({ snap, view: viewOf(snap), now: NOW, config, ...opts });
    const b = await buildApplePass({ snap, view: viewOf(snap), now: new Date(NOW.getTime() + 60_000), config, ...opts });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    const moved = queue({ entry: { peopleAhead: 5 } });
    const c = await buildApplePass({ snap: moved, view: viewOf(moved), now: NOW, config, ...opts });
    expect(c.hash).not.toBe(a.hash);
  });

  it('file : images @1x/@2x/@3x aux bonnes dimensions, pass < 150 ko', async () => {
    const snap = queue();
    const built = await buildApplePass({ snap, view: viewOf(snap), now: NOW, config, ...opts });
    const expected: Record<string, [number, number]> = {
      'icon.png': [29, 29], 'icon@2x.png': [58, 58], 'icon@3x.png': [87, 87],
      'logo.png': [50, 50], 'logo@2x.png': [100, 100], 'logo@3x.png': [150, 150],
      'thumbnail.png': [90, 90], 'thumbnail@2x.png': [180, 180], 'thumbnail@3x.png': [270, 270],
    };
    expect([...built.files.keys()].sort()).toEqual(['pass.json', ...Object.keys(expected)].sort());
    for (const [name, [w, h]] of Object.entries(expected)) {
      const meta = await sharp(built.files.get(name)!).metadata();
      expect([name, meta.format, meta.width, meta.height]).toEqual([name, 'png', w, h]);
    }
    const pkpass = packApplePass(built, config.signer, NOW);
    expect(pkpass.length).toBeLessThan(150 * 1024);
  });

  it('drop : bandeau 375 × 98 pt, logo et couverture téléversés', async () => {
    const logo = await sharp({ create: { width: 400, height: 200, channels: 4, background: '#D9903A' } }).png().toBuffer();
    const cover = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#3A63D8' } }).jpeg().toBuffer();
    const snap = eventSnapshot({ access: issued });
    const built = await buildApplePass({ snap, view: viewOf(snap), now: NOW, config, sources: { logo, cover } });
    expect(built.passJson.logoText).toBeUndefined();
    const strip = await sharp(built.files.get('strip@3x.png')!).metadata();
    expect([strip.width, strip.height]).toEqual([1125, 294]);
    const logoMeta = await sharp(built.files.get('logo@2x.png')!).metadata();
    expect(logoMeta.height).toBeLessThanOrEqual(100);
    expect(logoMeta.width).toBeLessThanOrEqual(320);
    expect(built.files.has('thumbnail.png')).toBe(false);
    // QR présent : l'accès est ouvert et le contrôle l'accepte.
    expect(built.passJson.barcodes?.[0]?.message).toBe(`${config.siteUrl}/scan/${issued.publicId}?w=${signWalletQrCode(issued.tokenHash, snap.pass.id)}`);
  });

  it('logo illisible : repli sur le signe, nom écrit à côté', async () => {
    const snap = queue();
    const built = await buildApplePass({ snap, view: viewOf(snap), now: NOW, config, sources: { logo: Buffer.from('pas une image'), cover: null } });
    expect(built.passJson.logoText).toBe('Barber House');
    expect((await sharp(built.files.get('logo@3x.png')!).metadata()).width).toBe(150);
  });

  it('archive relue : manifest SHA-1 exact, signature vérifiée par OpenSSL', async () => {
    const snap = queue({ entry: { peopleAhead: 2 } });
    const built = await buildApplePass({ snap, view: viewOf(snap), now: NOW, config, ...opts });
    const pkpass = packApplePass(built, config.signer, NOW);
    const entries = readZip(pkpass);
    const byName = new Map(entries.map((e) => [e.info.name, e.data]));
    expect(entries[0]?.info.name).toBe('pass.json');
    expect(entries.every((e) => e.info.method === 0)).toBe(true);
    const manifest = JSON.parse(byName.get('manifest.json')!.toString('utf8')) as Record<string, string>;
    const payload = entries.map((e) => e.info.name).filter((n) => n !== 'manifest.json' && n !== 'signature');
    expect(Object.keys(manifest).sort()).toEqual(payload.sort());
    for (const name of payload) expect(manifest[name]).toBe(sha1Hex(byName.get(name)!));
    const passJson = JSON.parse(byName.get('pass.json')!.toString('utf8')) as ApplePassJson;
    expect(passJson.passTypeIdentifier).toBe('pass.test.rangvia');
    expect(passJson.teamIdentifier).toBe('TESTTEAM01');
    expect(passJson.webServiceURL).toBe('https://rangvia.test/api/wallet/apple');

    const file = path.join(work, 'ticket.pkpass');
    writeFileSync(file, pkpass);
    if (!(process.env.PATH ?? '').split(path.delimiter).some((d) => existsSync(path.join(d, 'openssl')))) return;
    const dir = mkdtempSync(path.join(work, 'x-'));
    writeFileSync(path.join(dir, 'manifest.json'), byName.get('manifest.json')!);
    writeFileSync(path.join(dir, 'signature'), byName.get('signature')!);
    writeFileSync(path.join(dir, 'root.pem'), rootPem);
    execFileSync('openssl', ['smime', '-verify', '-inform', 'DER', '-in', path.join(dir, 'signature'), '-content', path.join(dir, 'manifest.json'), '-binary', '-noverify', '-out', path.join(dir, 'out')], { stdio: 'pipe' });
    execFileSync('openssl', ['cms', '-verify', '-inform', 'DER', '-in', path.join(dir, 'signature'), '-content', path.join(dir, 'manifest.json'), '-binary', '-CAfile', path.join(dir, 'root.pem'), '-purpose', 'any', '-out', path.join(dir, 'out')], { stdio: 'pipe' });
  });
});
