import 'server-only';
import { createHash } from 'node:crypto';
import { signWalletQrCode, walletQrUrl } from '@/lib/wallet/scan-proof';
import { decideAlertFor, type WalletAlertDecision } from '../alerts';
import type { WalletSnapshot, WalletView } from '../types';
import type { AppleWalletConfig } from './config';
import { renderAppleImages } from './images';
import { buildManifest, packPkpass } from './pkpass';
import { renderApplePassJson, type ApplePassJson } from './render';
import { signManifest } from './signature';
import { applePassToken } from './tokens';

/**
 * Assemblage d'un pass Apple : vue → pass.json + images → manifest →
 * (empreinte) → signature → .pkpass.
 *
 * L'EMPREINTE DE RENDU est le condensat du manifest, qui couvre pass.json
 * et chaque image : si rien de visible n'a changé, l'empreinte est la
 * même, la version du pass n'avance pas (wallet_record_render) et aucun
 * push ne part. La signature (qui porte l'heure) n'y entre pas.
 */

export const PKPASS_TYPE = 'application/vnd.apple.pkpass';

/** Date HTTP (Last-Modified) d'une version, à la seconde. */
export function httpDate(iso: string): string {
  return new Date(Math.floor(Date.parse(iso) / 1000) * 1000).toUTCString();
}

export interface BuiltApplePass {
  passJson: ApplePassJson;
  files: Map<string, Buffer>;
  manifest: Buffer;
  hash: string;
  alert: WalletAlertDecision | null;
}

/** Contenu du QR Wallet d'un billet dont l'accès est ouvert, si le contrôle l'accepte. */
export function appleQrMessage(view: WalletView, snap: WalletSnapshot, siteUrl: string): string | null {
  if (view.phase !== 'event_access' || !view.qr?.allowWallet) return null;
  return walletQrUrl(siteUrl, view.qr.publicId, signWalletQrCode(view.qr.tokenHash, snap.pass.id));
}

export function renderHash(manifest: Buffer): string {
  return createHash('sha256').update(manifest).digest('hex');
}

export async function buildApplePass(input: {
  snap: WalletSnapshot;
  view: WalletView;
  now: Date;
  config: Pick<AppleWalletConfig, 'passTypeId' | 'teamId' | 'webServiceUrl' | 'authSecret' | 'siteUrl'>;
  /** Sources d'images déjà lues (tests) ; par défaut, lues dans MEDIA_ROOT. */
  sources?: { logo?: Buffer | null; cover?: Buffer | null };
}): Promise<BuiltApplePass> {
  const { snap, view, now, config } = input;
  const alert = decideAlertFor('apple', snap, view, now);
  const images = await renderAppleImages(view, input.sources);
  const passJson = renderApplePassJson(view, snap, {
    passTypeId: config.passTypeId,
    teamId: config.teamId,
    serial: snap.pass.externalId,
    authenticationToken: applePassToken(snap.pass.externalId, config.authSecret),
    webServiceUrl: config.webServiceUrl,
    alert,
    qrMessage: appleQrMessage(view, snap, config.siteUrl),
    hasBrandLogo: images.brandLogo,
  });
  const files = new Map<string, Buffer>([['pass.json', Buffer.from(JSON.stringify(passJson), 'utf8')], ...images.files]);
  const manifest = buildManifest(files);
  return { passJson, files, manifest, hash: renderHash(manifest), alert };
}

/** Signe et emballe : le .pkpass prêt à servir. */
export function packApplePass(built: BuiltApplePass, signer: AppleWalletConfig['signer'], signingTime = new Date()): Buffer {
  const signature = signManifest(built.manifest, signer, { signingTime });
  return packPkpass(built.files, built.manifest, signature);
}
