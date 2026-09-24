import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { verifyWalletProof, type WalletScanProof } from '@/lib/wallet/scan-proof';

/** Hash SHA-256 du bearer token. Le jeton brut n'est jamais stocké en base. */
export function hashEventPassToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Signature courte d'un QR Event.
 *
 * Le QR tourne par tranche de 30 s. Une capture d'écran ancienne ne reste
 * donc pas utile indéfiniment, et le serveur revérifie toujours le statut
 * du pass en base avant validation.
 */
export function signEventPassSlot(tokenHash: string, slot: number): string {
  if (!env.sessionSecret) {
    throw new Error('SESSION_HASH_SECRET est requis pour signer les laisser-passer Event.');
  }
  return createHmac('sha256', env.sessionSecret)
    .update(`event-pass:${tokenHash}:${slot}`, 'utf8')
    .digest('base64url')
    .slice(0, 32);
}

export function currentEventPassSlot(now = Date.now()): number {
  return Math.floor(now / 30_000);
}

export function verifyEventPassSignature(
  tokenHash: string,
  slot: number,
  signature: string,
  now = Date.now(),
): boolean {
  const current = currentEventPassSlot(now);
  // Tolérance réseau : tranche courante + précédente uniquement.
  if (slot < current - 1 || slot > current) return false;
  const expected = signEventPassSlot(tokenHash, slot);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}


const EVENT_COOKIE_PREFIX = 'event-session';

export function signEventPassCookie(publicId: string, expiresAt: number): string {
  if (!env.sessionSecret) {
    throw new Error('SESSION_HASH_SECRET est requis pour les sessions Event.');
  }
  return createHmac('sha256', env.sessionSecret)
    .update(`${EVENT_COOKIE_PREFIX}:${publicId}:${expiresAt}`, 'utf8')
    .digest('base64url');
}

export function makeEventPassCookie(publicId: string, expiresAt: number): string {
  const signature = signEventPassCookie(publicId, expiresAt);
  return `${publicId}.${expiresAt}.${signature}`;
}

export function verifyEventPassCookie(
  value: string | null | undefined,
  now = Date.now(),
): { publicId: string; expiresAt: number } | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;

  const [publicId, expiresRaw, signature] = parts;
  if (!publicId || !/^[0-9A-Za-z]{12,32}$/.test(publicId)) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return null;

  const expected = signEventPassCookie(publicId, expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? '');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { publicId, expiresAt };
}


/**
 * Lien d'ouverture d'un laisser-passer.
 *
 * Contrairement à un bearer aléatoire stocké/transporté, ce lien est
 * dérivé à la demande d'un identifiant public + échéance et signé HMAC.
 * Il peut donc être régénéré en cas de retry push sans stocker de secret
 * récupérable en base.
 */
export function signEventAccessLink(publicId: string, expiresAt: number): string {
  if (!env.sessionSecret) {
    throw new Error('SESSION_HASH_SECRET est requis pour signer les accès Event.');
  }
  return createHmac('sha256', env.sessionSecret)
    .update(`event-access:${publicId}:${expiresAt}`, 'utf8')
    .digest('base64url')
    .slice(0, 43);
}

export function verifyEventAccessLink(
  publicId: string,
  expiresAt: number,
  signature: string,
  now = Date.now(),
): boolean {
  if (!/^[0-9A-Za-z]{12,32}$/.test(publicId)) return false;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;

  const expected = signEventAccessLink(publicId, expiresAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function eventAccessPath(publicId: string, graceUntilIso: string): string {
  const expiresAt = Math.floor(new Date(graceUntilIso).getTime() / 1000);
  const signature = signEventAccessLink(publicId, expiresAt);
  return `/api/pass/access/${encodeURIComponent(publicId)}?exp=${expiresAt}&sig=${encodeURIComponent(signature)}`;
}


/* ====================================================================
   Contrôle à l'entrée : une preuve, trois formes (§ 10 du plan Wallet)
   ==================================================================== */

/**
 * Ce que le personnel scanne à l'entrée d'un drop :
 *
 *  - `slot` : le QR tournant de la page /pass (inchangé) ;
 *  - `wallet` : le QR statique d'un billet Apple Wallet (ou Google en
 *    repli), signé et lié à UN pass Wallet ;
 *  - `totp` : le QR tournant que Google Wallet calcule hors ligne.
 *
 * Une preuve ne valide jamais seule : `redeem_event_pass` fait foi en
 * base (accès `issued`, dans sa grâce, usage unique → already_redeemed).
 */
export type ScanProof = { kind: 'slot'; slot: number; sig: string } | WalletScanProof;

/** D'où vient la preuve reconnue : affiché au contrôle et consigné à l'audit. */
export type ScanSource = 'web' | 'apple' | 'google';

export interface ScanWalletPass {
  id: string;
  provider: 'apple' | 'google';
}

export type ScanProofVerdict =
  | { ok: true; source: ScanSource }
  | { ok: false; reason: 'invalid' | 'wallet_disabled' };

/** Formes admises : les mêmes bornes que le schéma zod du rachat. */
export const SCAN_SIG_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const SCAN_WALLET_CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SCAN_OTP_RE = /^\d{1,10}$/;
const SCAN_INT_RE = /^\d{1,12}$/;

function single(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Lit la preuve dans l'URL scannée (`?slot&sig`, `?w`, `?t&otp`).
 *
 * Seule la FORME est contrôlée ici (bornes, alphabet), pas la validité :
 * un code bien formé mais faux doit afficher « QR expiré ou invalide » au
 * contrôle, pas une page introuvable. Un paramètre répété (tableau),
 * incomplet ou hors bornes → null, comme aujourd'hui sans `slot`.
 */
export function parseScanProof(params: Record<string, unknown>): ScanProof | null {
  const slotRaw = single(params.slot);
  const sig = single(params.sig);
  if (slotRaw !== null || sig !== null) {
    if (slotRaw === null || sig === null || !SCAN_INT_RE.test(slotRaw) || !SCAN_SIG_RE.test(sig)) return null;
    const slot = Number(slotRaw);
    return slot > 0 ? { kind: 'slot', slot, sig } : null;
  }

  const w = single(params.w);
  if (w !== null) return SCAN_WALLET_CODE_RE.test(w) ? { kind: 'wallet', w } : null;

  const tRaw = single(params.t);
  const otp = single(params.otp);
  if (tRaw !== null && otp !== null && SCAN_INT_RE.test(tRaw) && SCAN_OTP_RE.test(otp)) {
    return { kind: 'totp', t: Number(tRaw), otp };
  }
  return null;
}

/**
 * Validateur unique, pur : le QR web par sa tranche de 30 s, un billet
 * Wallet par les passes Wallet de CE ticket.
 *
 * - L'interrupteur `wallet_qr_enabled` de l'événement coupe les deux
 *   preuves Wallet, sans toucher au QR tournant de /pass.
 * - `totp` n'est cherché que parmi les passes Google : seul Google reçoit
 *   une clé TOTP (un pass Apple n'en affiche jamais).
 * - Le code statique d'un pass effacé ou révoqué ne vaut plus rien :
 *   l'appelant ne le transmet pas (loadScanWalletPasses).
 * - Une nouvelle vague donne un nouveau token_hash : les codes de la
 *   précédente ne correspondent plus à rien.
 */
export function verifyScanProof(input: {
  tokenHash: string;
  proof: ScanProof;
  walletQrEnabled: boolean;
  walletPasses: readonly ScanWalletPass[];
  now?: Date;
}): ScanProofVerdict {
  const now = input.now ?? new Date();
  const { proof } = input;

  if (proof.kind === 'slot') {
    return verifyEventPassSignature(input.tokenHash, proof.slot, proof.sig, now.getTime())
      ? { ok: true, source: 'web' }
      : { ok: false, reason: 'invalid' };
  }

  if (!input.walletQrEnabled) return { ok: false, reason: 'wallet_disabled' };

  const candidates = proof.kind === 'totp'
    ? input.walletPasses.filter((pass) => pass.provider === 'google')
    : input.walletPasses;
  const matched = verifyWalletProof({
    tokenHash: input.tokenHash,
    walletPassIds: candidates.map((pass) => pass.id),
    proof,
    now,
  });
  const pass = matched ? candidates.find((candidate) => candidate.id === matched) : undefined;
  return pass ? { ok: true, source: pass.provider } : { ok: false, reason: 'invalid' };
}

/**
 * Passes Wallet d'un billet de drop qui peuvent encore présenter un QR :
 * au plus un par fournisseur (unique en base), ni révoqués ni effacés.
 * Liste blanche des états plutôt que liste noire : un état ajouté plus
 * tard reste refusé tant qu'on ne l'a pas admis ici.
 *
 * Une lecture en échec renvoie une liste vide : le billet Wallet est
 * alors refusé (« QR invalide ») et le client montre sa page web. Mieux
 * vaut un refus prudent qu'une page d'erreur à l'entrée.
 */
export async function loadScanWalletPasses(
  db: SupabaseClient,
  queueEntryId: string,
): Promise<ScanWalletPass[]> {
  const { data, error } = await db
    .from('wallet_passes')
    .select('id, provider')
    .eq('queue_entry_id', queueEntryId)
    .eq('kind', 'event')
    .in('state', ['active', 'final'])
    .limit(2);
  if (error) {
    console.error('[scan] passes Wallet illisibles', error.message);
    return [];
  }
  return ((data ?? []) as { id: unknown; provider: unknown }[])
    .filter((row): row is ScanWalletPass =>
      typeof row.id === 'string' && (row.provider === 'apple' || row.provider === 'google'));
}

/**
 * Vérification complète, partagée par la page de contrôle ET l'action de
 * rachat : la base n'est lue que pour une preuve Wallet, et seulement si
 * l'événement l'accepte (le QR web ne coûte aucune requête).
 */
export async function checkScanProof(
  db: SupabaseClient,
  input: {
    tokenHash: string;
    queueEntryId: string;
    walletQrEnabled: boolean;
    proof: ScanProof;
    now?: Date;
  },
): Promise<ScanProofVerdict> {
  const needsWallet = input.proof.kind !== 'slot' && input.walletQrEnabled;
  const walletPasses = needsWallet ? await loadScanWalletPasses(db, input.queueEntryId) : [];
  return verifyScanProof({
    tokenHash: input.tokenHash,
    proof: input.proof,
    walletQrEnabled: input.walletQrEnabled,
    walletPasses,
    now: input.now,
  });
}
