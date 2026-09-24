// =====================================================================
// Rangvia — liens d'un laisser-passer d'événement, pour le tournage
// ---------------------------------------------------------------------
// Deux gestes du parcours « événements » passent par des canaux que le
// banc ne peut pas filmer :
//
//  - la notification « Votre accès est prêt » porte le lien d'accès au
//    laisser-passer (/api/pass/access/…) ; Chromium sans affichage ne
//    reçoit pas de notification (mini-étude V0) ;
//  - le personnel scanne le QR tournant du téléphone avec son appareil
//    photo, qui ouvre /scan/…
//
// Ce module reconstruit ces deux URL avec le secret de session DU BANC,
// selon le schéma de `apps/web/src/lib/event-pass.ts` (qui importe
// `server-only` et ne se charge pas hors de Next). Aucune indulgence n'en
// résulte : le serveur revérifie chaque signature. Pour le QR, on va plus
// loin : l'image que le téléphone affiche est comparée, octet pour octet,
// au QR de l'URL reconstruite (même bibliothèque, mêmes réglages). Si le
// produit change son schéma, le tournage échoue.
// =====================================================================

import { createHmac } from 'node:crypto';
import QRCode from 'qrcode';

function hmac(secret, message, length) {
  return createHmac('sha256', secret).update(message, 'utf8').digest('base64url').slice(0, length);
}

/** Chemin porté par la notification `event_access` (eventAccessPath). */
export function accessPath(secret, publicId, graceUntilIso) {
  const expiresAt = Math.floor(new Date(graceUntilIso).getTime() / 1000);
  const signature = hmac(secret, `event-access:${publicId}:${expiresAt}`, 43);
  return `/api/pass/access/${encodeURIComponent(publicId)}?exp=${expiresAt}&sig=${encodeURIComponent(signature)}`;
}

/** URL encodée dans le QR tournant de /pass, pour une tranche de 30 s. */
export function scanUrl(secret, siteUrl, publicId, tokenHash, slot) {
  const signature = hmac(secret, `event-pass:${tokenHash}:${slot}`, 32);
  return `${siteUrl}/scan/${publicId}?slot=${slot}&sig=${encodeURIComponent(signature)}`;
}

/** Mêmes réglages que `app/api/pass/qr/route.ts`. */
export function qrPng(target) {
  return QRCode.toBuffer(target, {
    errorCorrectionLevel: 'H',
    type: 'png',
    width: 720,
    margin: 2,
    color: { dark: '#0B0E13FF', light: '#FFFFFFFF' },
  });
}

/**
 * L'URL que le QR affiché par le téléphone encode réellement : on lit
 * l'image servie à ce téléphone (ses cookies), puis on cherche, parmi les
 * tranches voisines, l'URL dont le QR est identique octet pour octet.
 */
export async function scanUrlShownBy(phone, { secret, siteUrl, publicId, tokenHash }) {
  const response = await phone.context().request.get(new URL('/api/pass/qr', phone.url()).toString());
  if (!response.ok()) throw new Error(`QR du laisser-passer : réponse ${response.status()}`);
  const shown = Buffer.from(await response.body());
  const current = Math.floor(Date.now() / 30_000);
  for (const slot of [current, current - 1, current + 1]) {
    const target = scanUrl(secret, siteUrl, publicId, tokenHash, slot);
    if ((await qrPng(target)).equals(shown)) return target;
  }
  throw new Error('le QR affiché ne correspond à aucune URL de contrôle attendue : le schéma du produit a changé.');
}
