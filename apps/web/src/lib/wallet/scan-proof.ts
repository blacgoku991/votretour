import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * Preuves de QR des billets Wallet (drops), à côté du QR tournant de /pass.
 *
 * Un code-barres Wallet ne peut pas tourner toutes les 30 s comme la page
 * /pass (le serveur ne pousse pas une mise à jour par tranche). Deux
 * preuves, toutes deux DÉRIVÉES à la demande et jamais stockées :
 *
 *  - `wallet` : code statique, HMAC lié à l'accès (token_hash) ET au pass
 *    Wallet (un seul, révocable). Apple, et Google en repli.
 *    QR : https://<site>/scan/<accès>?w=<code>
 *  - `totp` : QR tournant généré HORS LIGNE par Google Wallet à partir
 *    d'une clé propre au pass (RFC 6238, SHA-1, 8 chiffres, 30 s).
 *    QR : https://<site>/scan/<accès>?t=<secondes>&otp=<code>
 *
 * Dans tous les cas, le serveur revérifie en base : accès `issued` dans
 * sa fenêtre, `wallet_qr_enabled`, pass ni révoqué ni effacé, puis
 * `redeem_event_pass` fait foi (usage unique). Changer SESSION_HASH_SECRET
 * invalide les QR en cours (fenêtre ≤ 15 min), comme ceux du web.
 */

export type WalletScanProof =
  | { kind: 'wallet'; w: string }
  | { kind: 'totp'; t: number; otp: string };

/** Fenêtre d'acceptation d'un code TOTP : 90 s de retard, 30 s d'avance. */
export const TOTP_PAST_SECONDS = 90;
export const TOTP_FUTURE_SECONDS = 30;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 8;

function secretOrThrow(secret: string | null | undefined): string {
  const value = secret ?? env.sessionSecret;
  if (!value) throw new Error('SESSION_HASH_SECRET est requis pour les QR des billets Wallet.');
  return value;
}

/** Code statique du QR Wallet : 32 caractères base64url. */
export function signWalletQrCode(tokenHash: string, walletPassId: string, secret?: string | null): string {
  return createHmac('sha256', secretOrThrow(secret))
    .update(`event-wallet:v1:${tokenHash}:${walletPassId}`, 'utf8')
    .digest('base64url')
    .slice(0, 32);
}

/** Clé TOTP du pass (20 octets, hexadécimal), transmise à Google seulement. */
export function walletTotpKey(tokenHash: string, walletPassId: string, secret?: string | null): string {
  return createHmac('sha256', secretOrThrow(secret))
    .update(`wallet-totp:v1:${tokenHash}:${walletPassId}`, 'utf8')
    .digest()
    .subarray(0, 20)
    .toString('hex');
}

/** HOTP (RFC 4226) : troncature dynamique d'un HMAC-SHA1. */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('Compteur TOTP invalide');
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24)
    | (mac[offset + 1]! << 16)
    | (mac[offset + 2]! << 8)
    | mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** TOTP (RFC 6238) : `counter` = floor(secondes / 30). Clé brute ou hexadécimale. */
export function totp(key: Uint8Array | string, counter: number, digits = TOTP_DIGITS): string {
  const raw = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  return hotp(raw, counter, digits);
}

export function walletQrUrl(siteUrl: string, accessPublicId: string, code: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/scan/${encodeURIComponent(accessPublicId)}?w=${encodeURIComponent(code)}`;
}

/** Modèle d'URL que Google Wallet complète lui-même (rotatingBarcode.valuePattern). */
export function walletTotpPattern(siteUrl: string, accessPublicId: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/scan/${encodeURIComponent(accessPublicId)}?t={totp_timestamp_seconds}&otp={totp_value_0}`;
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Vérifie une preuve Wallet contre les passes Wallet du ticket (au plus un
 * par fournisseur, ni révoqués ni effacés : c'est à l'appelant de les
 * filtrer). Renvoie l'identifiant du pass reconnu, ou null.
 */
export function verifyWalletProof(input: {
  tokenHash: string;
  walletPassIds: readonly string[];
  proof: WalletScanProof;
  now?: Date;
  secret?: string | null;
}): string | null {
  const { tokenHash, walletPassIds, proof } = input;
  if (!tokenHash || walletPassIds.length === 0) return null;

  if (proof.kind === 'wallet') {
    if (!/^[A-Za-z0-9_-]{32}$/.test(proof.w)) return null;
    for (const id of walletPassIds) {
      if (equal(signWalletQrCode(tokenHash, id, input.secret), proof.w)) return id;
    }
    return null;
  }

  if (!Number.isSafeInteger(proof.t) || !/^\d{8}$/.test(proof.otp)) return null;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (proof.t < nowSeconds - TOTP_PAST_SECONDS || proof.t > nowSeconds + TOTP_FUTURE_SECONDS) return null;
  const counter = Math.floor(proof.t / TOTP_PERIOD_SECONDS);
  for (const id of walletPassIds) {
    if (equal(totp(walletTotpKey(tokenHash, id, input.secret), counter), proof.otp)) return id;
  }
  return null;
}
