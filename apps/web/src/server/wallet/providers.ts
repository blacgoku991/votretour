import 'server-only';
import path from 'node:path';
import { hkdfSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { env } from '@/lib/env';
import { appleProvider } from './apple/provider';
import { googleProvider } from './google/provider';
import type { ProviderStatus, WalletProvider, WalletProviderId } from './types';
import { WALLET_PROVIDERS } from './types';

/**
 * Registre des fournisseurs Wallet, et « qui voit quel bouton ».
 *
 * Masquage propre (§ 11 du plan) : un fournisseur qui n'est pas prêt
 * (rien de configuré, certificat expiré, compte de service refusé…) ne
 * produit AUCUN bouton, pas même grisé. La raison exacte n'est montrée
 * que dans l'espace super-admin (walletStatuses).
 */

const REGISTRY: Record<WalletProviderId, WalletProvider> = {
  apple: appleProvider,
  google: googleProvider,
};

export function walletProviders(): WalletProvider[] {
  return WALLET_PROVIDERS.map((id) => REGISTRY[id]);
}

export function getWalletProvider(id: string): WalletProvider | null {
  return (WALLET_PROVIDERS as readonly string[]).includes(id) ? REGISTRY[id as WalletProviderId] : null;
}

/* ====================================================================
   État des fournisseurs, en cache 5 min
   ==================================================================== */

/** Un contrôle de certificat ou de classe coûte : on ne le refait pas à chaque page. */
export const STATUS_TTL_MS = 5 * 60 * 1000;

const statusCache = new Map<WalletProviderId, { value: ProviderStatus; until: number }>();

export async function walletStatus(provider: WalletProvider, now = Date.now()): Promise<ProviderStatus> {
  const hit = statusCache.get(provider.id);
  if (hit && hit.until > now) return hit.value;
  let value: ProviderStatus;
  try {
    value = await provider.status();
  } catch (error) {
    value = { ready: false, reason: error instanceof Error ? error.message : 'état illisible' };
  }
  statusCache.set(provider.id, { value, until: now + STATUS_TTL_MS });
  return value;
}

/**
 * Dégradation constatée en cours d'envoi (APNs refuse le certificat,
 * Google répond 403) : boutons masqués pendant 5 min, sans attendre le
 * prochain contrôle.
 */
export function markWalletDegraded(id: WalletProviderId, reason: string, now = Date.now()): void {
  statusCache.set(id, { value: { ready: false, reason }, until: now + STATUS_TTL_MS });
}

export function resetWalletStatusCache(): void {
  statusCache.clear();
}

/** Pour l'espace super-admin : état et raison de chaque fournisseur. */
export async function walletStatuses(): Promise<Record<WalletProviderId, ProviderStatus>> {
  const entries = await Promise.all(walletProviders().map(async (p) => [p.id, await walletStatus(p)] as const));
  return Object.fromEntries(entries) as Record<WalletProviderId, ProviderStatus>;
}

/**
 * Tâches de fond des fournisseurs (cron, chaque minute), avant le vidage.
 * Appelées même si le fournisseur n'est pas prêt : Google crée ici la
 * classe de file dont dépend justement son état « prêt ». Chaque
 * fournisseur est isolé : l'échec de l'un n'empêche pas l'autre.
 */
export async function runWalletMaintenance(now = new Date()): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  for (const provider of walletProviders()) {
    if (!provider.maintain) continue;
    try {
      report[provider.id] = (await provider.maintain(now)) ?? 'ok';
    } catch (error) {
      report[provider.id] = { error: error instanceof Error ? error.message : 'inconnu' };
      console.error('[wallet] maintenance impossible', provider.id, error);
    }
  }
  return report;
}

/* ====================================================================
   Secret des jetons ApplePass
   ==================================================================== */

/**
 * WALLET_AUTH_SECRET, ou, s'il est vide, une dérivation HKDF-SHA256 de
 * SESSION_HASH_SECRET (libellé dédié) : le propriétaire n'a rien à faire,
 * et la fuite d'un jeton ApplePass ne dit rien du poivre des sessions.
 */
export function walletAuthSecret(): string | null {
  if (env.walletAuthSecret) return env.walletAuthSecret;
  if (!env.sessionSecret) return null;
  return Buffer.from(hkdfSync('sha256', env.sessionSecret, '', 'rangvia/wallet-auth/v1', 32)).toString('base64url');
}

/* ====================================================================
   Offre : qui voit quel bouton (§ 11.1)
   ==================================================================== */

/** Badges officiels, déposés tels quels (ni recolorés, ni recadrés). */
export const WALLET_BADGES: Record<WalletProviderId, string> = {
  apple: '/wallet/apple/ajouter-a-apple-wallet-fr.svg',
  google: '/wallet/google/ajouter-a-google-wallet-fr.svg',
};

/** Données transmises au composant client : aucun secret. */
export interface WalletOffer {
  apple?: { href: string; badgeSrc: string };
  google?: { href: string; badgeSrc: string };
  /** iPhone dans un navigateur intégré : « Ouvrez cette page dans Safari… ». */
  safariHint?: true;
  /** Drop dont le contrôle refuse le QR Wallet : pas de badge, une phrase. */
  qrNotAccepted?: true;
}

export type GoogleEventClassState = 'ok' | 'pending' | 'rejected' | 'missing';

export interface WalletOfferInput {
  statuses: Partial<Record<WalletProviderId, ProviderStatus>>;
  badges: Partial<Record<WalletProviderId, boolean>>;
  userAgent: string | null;
  /** Ticket actif ET identifié (session du ticket, ou cookie rv_event_pass). */
  ticket: { active: boolean; identified: boolean } | null;
  /** organization_settings.features.wallet !== false */
  walletEnabled: boolean;
  /** Page d'origine : /e/[slug] (ticket) ou /pass (laisser-passer). */
  from: 'entry' | 'pass';
  entryPublicId?: string | null;
  google: { mode: 'demo' | 'production'; viewerIsTester: boolean };
  event?: { walletQrEnabled: boolean; googleClass: GoogleEventClassState } | null;
}

const IN_APP_BROWSER = /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|GSA\//;

export function deviceOf(userAgent: string | null): { iphone: boolean; android: boolean; inApp: boolean } {
  const ua = userAgent ?? '';
  return {
    // L'iPad n'a pas l'app Wallet ; iPadOS se présente d'ailleurs en Mac.
    iphone: /iPhone/.test(ua) && !/iPad/.test(ua),
    android: /Android/i.test(ua),
    inApp: IN_APP_BROWSER.test(ua),
  };
}

function hrefFor(provider: WalletProviderId, input: WalletOfferInput): string | null {
  if (input.from === 'pass') return `/api/client/wallet/${provider}?from=pass`;
  if (!input.entryPublicId || !/^[0-9A-Za-z]{8,32}$/.test(input.entryPublicId)) return null;
  return `/api/client/wallet/${provider}?entry=${encodeURIComponent(input.entryPublicId)}`;
}

/** Table de vérité pure (tests/wallet/offer.test.ts). */
export function computeWalletOffer(input: WalletOfferInput): WalletOffer | null {
  if (!input.ticket?.active || !input.ticket.identified || !input.walletEnabled) return null;
  const device = deviceOf(input.userAgent);
  const offer: WalletOffer = {};

  const ready = (id: WalletProviderId) => input.statuses[id]?.ready === true && input.badges[id] === true;

  let appleEligible = false;
  if (ready('apple') && device.iphone) {
    // Le téléchargement d'un .pkpass échoue dans Instagram, Facebook… :
    // on le dit, au lieu d'afficher un bouton qui ne mènerait nulle part.
    if (device.inApp) offer.safariHint = true;
    else {
      const href = hrefFor('apple', input);
      if (href) {
        offer.apple = { href, badgeSrc: WALLET_BADGES.apple };
        appleEligible = true;
      }
    }
  }

  let googleEligible = false;
  if (
    ready('google')
    && device.android
    // Navigateurs intégrés Android : comportement à vérifier en recette,
    // masqué par défaut plutôt qu'un lien qui échoue.
    && !device.inApp
    && (input.google.mode === 'production' || input.google.viewerIsTester)
    && (!input.event || input.event.googleClass === 'ok')
  ) {
    const href = hrefFor('google', input);
    if (href) {
      offer.google = { href, badgeSrc: WALLET_BADGES.google };
      googleEligible = true;
    }
  }

  if (input.event && !input.event.walletQrEnabled) {
    // Le contrôle n'accepterait pas le billet : pas de badge, mais une
    // phrase, seulement là où un badge aurait été proposé.
    return appleEligible || googleEligible ? { qrNotAccepted: true } : null;
  }

  return offer.apple || offer.google || offer.safariHint ? offer : null;
}

function badgeOnDisk(id: WalletProviderId): boolean {
  try {
    return existsSync(path.join(process.cwd(), 'public', ...WALLET_BADGES[id].split('/').filter(Boolean)));
  } catch {
    return false;
  }
}

/**
 * Version serveur, pour e/[slug]/page.tsx et pass/page.tsx (lot W4).
 * Ne lit la base et la session QUE si un fournisseur est prêt : sans
 * Wallet configuré, elle ne coûte rien.
 */
export async function walletOffer(ctx: {
  userAgent: string | null;
  organizationId: string;
  from: 'entry' | 'pass';
  entryPublicId?: string | null;
  ticket: { active: boolean; identified: boolean } | null;
  event?: { id: string; walletQrEnabled: boolean } | null;
}): Promise<WalletOffer | null> {
  if (!ctx.ticket?.active || !ctx.ticket.identified) return null;

  const statuses = await walletStatuses();
  if (!statuses.apple.ready && !statuses.google.ready) return null;

  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const db = supabaseAdmin();

  const { data: settings } = await db
    .from('organization_settings')
    .select('features')
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();
  const features = (settings?.features ?? {}) as Record<string, unknown>;
  const walletEnabled = features.wallet !== false && features.wallet !== 'false';

  let viewerIsTester = false;
  if (statuses.google.ready && env.googleWallet.mode === 'demo' && deviceOf(ctx.userAgent).android) {
    // Mode démo : Google n'accepte que ses comptes de test ; on ne montre
    // le bouton qu'aux membres de l'organisation et au super-admin.
    const { getSessionUser } = await import('@/server/auth');
    const user = await getSessionUser().catch(() => null);
    if (user?.isPlatformAdmin) viewerIsTester = true;
    else if (user) {
      const { data: member } = await db
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', ctx.organizationId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      viewerIsTester = Boolean(member);
    }
  }

  let googleClass: GoogleEventClassState = 'missing';
  if (ctx.event && statuses.google.ready) {
    const { data: row, error } = await db
      .from('wallet_google_classes')
      .select('review_status, synced_at')
      .eq('event_id', ctx.event.id)
      .maybeSingle();
    if (!error && row) {
      if (String(row.review_status ?? '').toUpperCase() === 'REJECTED') googleClass = 'rejected';
      else googleClass = row.synced_at ? 'ok' : 'pending';
    }
  }

  return computeWalletOffer({
    statuses,
    badges: { apple: badgeOnDisk('apple'), google: badgeOnDisk('google') },
    userAgent: ctx.userAgent,
    ticket: ctx.ticket,
    walletEnabled,
    from: ctx.from,
    entryPublicId: ctx.entryPublicId ?? null,
    google: { mode: env.googleWallet.mode, viewerIsTester },
    event: ctx.event ? { walletQrEnabled: ctx.event.walletQrEnabled, googleClass } : null,
  });
}
