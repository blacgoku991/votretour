import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyEventPassCookie } from '@/lib/event-pass';
import { getClientSession, requestFingerprint } from '@/server/client-session';
import { consumeRateLimit } from '@/server/ratelimit';
import { getWalletProvider, walletStatus } from '@/server/wallet/providers';
import type {
  DistributeContext, IssuedWalletPass, WalletNaming, WalletProviderId, WalletSnapshot,
} from '@/server/wallet/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/client/wallet/[provider]?entry=<ticket> | ?from=pass
 *
 * Point d'entrée commun des badges « Ajouter à Apple Wallet / Google
 * Wallet ». Cette coquille fait tout ce qui ne dépend pas du fournisseur :
 *
 *  1. fournisseur connu ET prêt, sinon 404 (tant qu'aucun n'est prêt,
 *     la route refuse tout : aucun faux succès) ;
 *  2. refus des requêtes intersites (Sec-Fetch-Site: cross-site) ;
 *  3. identification DANS LA MÊME REQUÊTE : cookie de session du ticket,
 *     ou cookie signé rv_event_pass depuis /pass. Un identifiant de ticket
 *     seul ne permet rien ; wallet_issue_pass revérifie tout en SQL ;
 *  4. limites de débit par session et par adresse (condensat, jamais
 *     l'adresse en clair).
 * Puis le fournisseur répond : .pkpass (Apple), redirection vers
 * pay.google.com (Google). Un lien GET, pas un formulaire : la CSP
 * `form-action 'self'` bloquerait une redirection vers Google.
 */

const NO_STORE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
} as const;

const ENTRY_ID = /^[0-9A-Za-z]{8,32}$/;

function plain(status: number, text: string, extra: Record<string, string> = {}): Response {
  return new Response(text, { status, headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8', ...extra } });
}

/** Retour vers la page d'origine, avec l'encart « indisponible » de la page. */
function backTo(request: Request, returnTo: string, provider: WalletProviderId): Response {
  const url = new URL(returnTo, request.url);
  url.searchParams.set('wallet', 'indisponible');
  url.searchParams.set('wp', provider);
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: url.pathname + url.search } });
}

/** Erreurs métier de wallet_issue_pass (migration 0021). */
class WalletIssueError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

interface Identified {
  entryPublicId: string;
  organizationId: string;
  clientSessionId: string | null;
  eventPassPublicId: string | null;
  rateKey: string;
  returnTo: string;
}

async function identify(request: Request): Promise<Identified | Response> {
  const url = new URL(request.url);
  const db = supabaseAdmin();

  if (url.searchParams.get('from') === 'pass') {
    const jar = await cookies();
    const session = verifyEventPassCookie(jar.get('rv_event_pass')?.value);
    if (!session) return plain(401, 'Session expirée');
    const { data: access } = await db
      .from('event_access_passes')
      .select('queue_entry_id, organization_id')
      .eq('public_id', session.publicId)
      .maybeSingle();
    if (!access) return plain(404, 'Introuvable');
    const { data: entry } = await db
      .from('queue_entries')
      .select('public_id')
      .eq('id', access.queue_entry_id)
      .maybeSingle();
    if (!entry) return plain(404, 'Introuvable');
    return {
      entryPublicId: entry.public_id as string,
      organizationId: access.organization_id as string,
      clientSessionId: null,
      eventPassPublicId: session.publicId,
      rateKey: `pass:${session.publicId}`,
      returnTo: '/pass',
    };
  }

  const entryId = url.searchParams.get('entry') ?? '';
  if (!ENTRY_ID.test(entryId)) return plain(404, 'Introuvable');
  const { data: entry } = await db
    .from('queue_entries')
    .select('public_id, organization_id, location_id')
    .eq('public_id', entryId)
    .maybeSingle();
  if (!entry) return plain(404, 'Introuvable');

  const session = await getClientSession(entry.organization_id as string);
  if (!session) return plain(403, 'Ce ticket n’appartient pas à cet appareil.');

  const { data: location } = await db
    .from('locations')
    .select('slug')
    .eq('id', entry.location_id)
    .maybeSingle();

  return {
    entryPublicId: entry.public_id as string,
    organizationId: entry.organization_id as string,
    clientSessionId: session.id,
    eventPassPublicId: null,
    rateKey: session.id,
    returnTo: location?.slug ? `/e/${encodeURIComponent(location.slug as string)}` : '/',
  };
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await context.params;
  const provider = getWalletProvider(providerId);
  if (!provider) return plain(404, 'Introuvable');

  const status = await walletStatus(provider);
  if (!status.ready) return plain(404, 'Introuvable');

  if (request.headers.get('sec-fetch-site') === 'cross-site') return plain(403, 'Requête refusée');

  const tooMany = (retryAfterSeconds: number) =>
    plain(429, 'Trop de tentatives. Réessayez dans un instant.', { 'Retry-After': String(Math.max(1, retryAfterSeconds)) });

  // Par adresse AVANT toute lecture : on ne sonde pas les identifiants de
  // ticket à la chaîne, même pour n'obtenir que des 404.
  const fingerprint = await requestFingerprint();
  if (fingerprint.ipHash) {
    const perIp = await consumeRateLimit(`wallet-dl-ip:${fingerprint.ipHash}`, 30, 300);
    if (!perIp.allowed) return tooMany(perIp.retryAfterSeconds);
  }

  const who = await identify(request);
  if (who instanceof Response) return who;

  const perSession = await consumeRateLimit(`wallet-dl:${who.rateKey}`, 10, 300);
  if (!perSession.allowed) return tooMany(perSession.retryAfterSeconds);

  const db = supabaseAdmin();
  const ctx: DistributeContext = {
    request,
    provider: provider.id,
    entryPublicId: who.entryPublicId,
    organizationId: who.organizationId,
    clientSessionId: who.clientSessionId,
    eventPassPublicId: who.eventPassPublicId,
    from: who.eventPassPublicId ? 'pass' : 'entry',
    returnTo: who.returnTo,
    now: new Date(),
    async issue(naming: WalletNaming): Promise<IssuedWalletPass> {
      if (naming.provider !== provider.id) throw new WalletIssueError('VT022', 'Nommage d’un autre fournisseur');
      const params = naming.provider === 'apple'
        ? { passTypeId: naming.passTypeId }
        : { objectPrefix: naming.objectPrefix, queueClass: naming.queueClass, eventClassPrefix: naming.eventClassPrefix };
      const { data, error } = await db.rpc('wallet_issue_pass', {
        p_provider: provider.id,
        p_entry_public_id: who.entryPublicId,
        p_client_session_id: who.clientSessionId,
        p_event_pass_public_id: who.eventPassPublicId,
        p_naming: params,
      });
      if (error) throw new WalletIssueError(error.code ?? 'unknown', error.message);
      return data as IssuedWalletPass;
    },
    async snapshot(passId: string): Promise<WalletSnapshot | null> {
      const { data, error } = await db.rpc('wallet_pass_snapshot', { p_pass_id: passId });
      if (error) throw new Error(error.message);
      return (data as WalletSnapshot | null) ?? null;
    },
  };

  try {
    const response = await provider.distribute(ctx);
    // Rien de ce qui sort d'ici ne doit être mis en cache ni référencé.
    // (Les en-têtes d'un Response.redirect() sont figés : on n'insiste pas,
    // le fournisseur les a posés lui-même.)
    for (const [key, value] of Object.entries(NO_STORE)) {
      try {
        if (!response.headers.has(key)) response.headers.set(key, value);
      } catch {
        break;
      }
    }
    return response;
  } catch (error) {
    if (error instanceof WalletIssueError) {
      if (error.code === 'VT009') return plain(403, 'Ce ticket n’appartient pas à cet appareil.');
      if (error.code === 'VT005') return plain(404, 'Introuvable');
      // VT020 (ticket plus éligible), VT021 (Wallet coupé), VT007
      // (établissement suspendu) : la page d'origine l'explique.
    }
    console.error('[wallet] distribution impossible', provider.id, error instanceof Error ? error.message : error);
    return backTo(request, who.returnTo, provider.id);
  }
}
