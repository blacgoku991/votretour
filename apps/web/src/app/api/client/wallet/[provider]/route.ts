import { cookies } from 'next/headers';
import { integrationStatus } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyEventPassCookie } from '@/lib/event-pass';
import { getClientSession, requestFingerprint } from '@/server/client-session';
import { consumeRateLimit } from '@/server/ratelimit';
import { loadWalletSnapshot } from '@/server/wallet/outbox';
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
 *  1. fournisseur connu ET configuré, sinon 404 ; refus des requêtes
 *     intersites (Sec-Fetch-Site: cross-site) ;
 *  2. fournisseur prêt, sinon retour à la page (tant qu'aucun n'est prêt,
 *     la route n'émet rien : aucun faux succès) ;
 *  3. identification DANS LA MÊME REQUÊTE : cookie de session du ticket,
 *     ou cookie signé rv_event_pass depuis /pass. Un identifiant de ticket
 *     seul ne permet rien ; wallet_issue_pass revérifie tout en SQL ;
 *  4. limites de débit par session et par adresse (condensat, jamais
 *     l'adresse en clair).
 * Chaque échec vu par une personne qui vient de toucher un badge (session
 * expirée, ticket d'un autre appareil, ticket introuvable, fournisseur
 * tombé entre l'affichage et le toucher, trop de tentatives) la ramène sur
 * sa page avec ?wallet=indisponible, jamais sur un texte brut. Seuls les
 * cas qui ne viennent pas d'un badge (fournisseur inconnu ou non
 * configuré, requête intersites) gardent une réponse brute.
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
  // Chemin relatif seulement : jamais de redirection vers un autre site.
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: url.pathname + url.search } });
}

const RETURN_PATH = /^\/(?:e\/[A-Za-z0-9-]{1,80}|pass)$/;

/**
 * Page d'origine quand l'identification échoue (on ne connaît pas encore le
 * lieu) : /pass pour un laisser-passer, sinon le chemin du Referer s'il
 * désigne une page de ticket, sinon l'accueil. Seul le CHEMIN est repris,
 * et seulement s'il passe RETURN_PATH : aucune redirection hors du site
 * n'est possible. L'origine n'est pas comparée : derrière le proxy,
 * request.url ne porte pas toujours l'hôte public.
 */
function fallbackReturn(request: Request): string {
  const url = new URL(request.url);
  if (url.searchParams.get('from') === 'pass') return '/pass';
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const ref = new URL(referer);
      if (RETURN_PATH.test(ref.pathname)) return ref.pathname;
    } catch {
      /* Referer illisible : accueil */
    }
  }
  return '/';
}

/** Échec d'identification : retour sur la page, avec un journal sans donnée. */
class NotIdentified {
  constructor(
    readonly reason: 'session' | 'owner' | 'missing',
    /** Page du lieu, quand le ticket a pu être lu. */
    readonly returnTo: string | null = null,
  ) {}
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

async function identify(request: Request): Promise<Identified | NotIdentified> {
  const url = new URL(request.url);
  const db = supabaseAdmin();

  if (url.searchParams.get('from') === 'pass') {
    const jar = await cookies();
    const session = verifyEventPassCookie(jar.get('rv_event_pass')?.value);
    if (!session) return new NotIdentified('session', '/pass');
    const { data: access } = await db
      .from('event_access_passes')
      .select('queue_entry_id, organization_id')
      .eq('public_id', session.publicId)
      .maybeSingle();
    if (!access) return new NotIdentified('missing', '/pass');
    const { data: entry } = await db
      .from('queue_entries')
      .select('public_id')
      .eq('id', access.queue_entry_id)
      .maybeSingle();
    if (!entry) return new NotIdentified('missing', '/pass');
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
  if (!ENTRY_ID.test(entryId)) return new NotIdentified('missing');
  const { data: entry } = await db
    .from('queue_entries')
    .select('public_id, organization_id, location_id')
    .eq('public_id', entryId)
    .maybeSingle();
  if (!entry) return new NotIdentified('missing');

  const { data: location } = await db
    .from('locations')
    .select('slug')
    .eq('id', entry.location_id)
    .maybeSingle();
  const returnTo = location?.slug ? `/e/${encodeURIComponent(location.slug as string)}` : '/';

  // Session expirée ou ticket d'un autre appareil : retour à la page du
  // lieu (qui ne dit rien de ce ticket), pas à un texte brut.
  const session = await getClientSession(entry.organization_id as string);
  if (!session) return new NotIdentified('owner', returnTo);

  return {
    entryPublicId: entry.public_id as string,
    organizationId: entry.organization_id as string,
    clientSessionId: session.id,
    eventPassPublicId: null,
    rateKey: session.id,
    returnTo,
  };
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await context.params;
  const provider = getWalletProvider(providerId);
  if (!provider) return plain(404, 'Introuvable');

  if (request.headers.get('sec-fetch-site') === 'cross-site') return plain(403, 'Requête refusée');

  // Rien de configuré : aucun badge n'a jamais été montré, la route
  // n'existe pas (pas même un retour « indisponible »). Configuré mais pas
  // prêt (certificat refusé, compte de service révoqué entre l'affichage du
  // badge et le toucher) : la page l'explique.
  const configured = integrationStatus();
  if (!(provider.id === 'apple' ? configured.appleWalletConfigured : configured.googleWalletConfigured)) {
    return plain(404, 'Introuvable');
  }
  const status = await walletStatus(provider);
  if (!status.ready) return backTo(request, fallbackReturn(request), provider.id);

  // Par adresse AVANT toute lecture : on ne sonde pas les identifiants de
  // ticket à la chaîne, même pour n'obtenir que des retours en arrière.
  const fingerprint = await requestFingerprint();
  if (fingerprint.ipHash) {
    const perIp = await consumeRateLimit(`wallet-dl-ip:${fingerprint.ipHash}`, 30, 300);
    if (!perIp.allowed) return backTo(request, fallbackReturn(request), provider.id);
  }

  const who = await identify(request);
  if (who instanceof NotIdentified) {
    console.info('[wallet] distribution refusée', provider.id, who.reason);
    return backTo(request, who.returnTo ?? fallbackReturn(request), provider.id);
  }

  const perSession = await consumeRateLimit(`wallet-dl:${who.rateKey}`, 10, 300);
  if (!perSession.allowed) return backTo(request, who.returnTo, provider.id);

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
    // Instantané complété (drop en cours, remise à zéro des paliers) :
    // le pass rendu à l'ajout dit la même chose que les mises à jour.
    snapshot: (passId: string): Promise<WalletSnapshot | null> => loadWalletSnapshot(passId),
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
    // VT009 (ticket d'un autre appareil), VT005 (introuvable), VT020
    // (ticket plus éligible), VT021 (Wallet coupé), VT007 (établissement
    // suspendu) : la page d'origine l'explique, comme toute autre panne.
    console.error('[wallet] distribution impossible', provider.id, error instanceof Error ? error.message : error);
    return backTo(request, who.returnTo, provider.id);
  }
}
