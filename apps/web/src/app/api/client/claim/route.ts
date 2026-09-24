import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, jsonOk } from '@/lib/api';
import { AppError } from '@/lib/errors';
import {
  detectPlatform,
  getOrCreateClientSession,
  requestFingerprint,
  sessionCookieName,
  sessionCookieOptions,
} from '@/server/client-session';
import { enforceRateLimit } from '@/server/ratelimit';
import { PROFILE_LIMITS } from '@/server/profiles/limits';
import { claimEntry, peekClaim } from '@/server/profiles/queue';
import { hashTrackingToken, TRACKING_TOKEN_RE } from '@/server/profiles/tracking-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rattachement d'une fiche par QR de suivi (« Suivre mon véhicule »).
 *
 * Le client a scanné l'étiquette de clé ; la page `/s/[jeton]` lui a
 * montré un aperçu masqué, il confirme. Ici :
 *   1. limite de débit par IP anonymisée (10 par minute) ;
 *   2. aperçu (`peek_claim`) pour connaître l'organisation : la session
 *      d'un appareil est cloisonnée par commerce ;
 *   3. session de l'appareil (créée au besoin), puis `claim_entry` :
 *      verrou de ligne, jeton non expiré, fiche sans appareil, même
 *      organisation ; le jeton est effacé (usage unique) ;
 *   4. cookie de session (même code que `join`), puis direction `/e/…`,
 *      où `find_active_ticket` retrouve la fiche.
 *
 * Tout refus (jeton inconnu, expiré, déjà servi, fiche déjà suivie) donne
 * le MÊME message : on ne dit pas à un inconnu lequel de ces cas il a
 * rencontré. Le jeton n'est jamais journalisé.
 *
 * Deux formes de requête : JSON (le bouton de la page, qui garde la main
 * sur l'animation) et formulaire classique (sans JavaScript), qui reçoit
 * une redirection 303.
 *
 * Un POST venu d'un AUTRE site est refusé avant tout (`Sec-Fetch-Site:
 * cross-site`) : avec des cookies SameSite=Lax, il arriverait sans le
 * cookie de l'appareil, créerait une session neuve et écraserait ce
 * cookie ; l'appareil perdrait le suivi de son vrai ticket. Le jeton
 * n'est alors pas consommé : un formulaire est renvoyé vers la page du
 * lien, où le client confirme lui-même, sur notre origine.
 */

const bodySchema = z.object({ token: z.string().regex(TRACKING_TOKEN_RE) }).strict();

const INVALID = 'Ce lien de suivi a déjà servi ou a expiré. Demandez-en un nouveau à l’accueil.';

/**
 * Aucune page de suivi ne doit transmettre son adresse, ni être mise en cache.
 *
 * Attention : l'en-tête global de `next.config.ts` (source `/:path*`)
 * l'emporte aujourd'hui sur le `Referrer-Policy` posé ici (relevé au
 * banc : `strict-origin-when-cross-origin`). Sans conséquence pratique,
 * la redirection restant sur notre origine ; une règle dédiée à
 * `/api/client/claim` et `/s/:path*` est demandée au propriétaire du
 * fichier. `Cache-Control` et `X-Robots-Tag` passent bien.
 */
const PRIVATE_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

async function readToken(request: Request): Promise<{ token: string | null; form: boolean }> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const data = await request.formData().catch(() => null);
    const raw = data?.get('token');
    return { token: typeof raw === 'string' ? raw : null, form: true };
  }
  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  return { token: parsed.success ? parsed.data.token : null, form: false };
}

/**
 * 303 vers un chemin RELATIF : le navigateur le résout sur l'origine qu'il
 * a demandée, quel que soit l'hôte vu par le serveur derrière le proxy.
 */
function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

function withHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(key, value);
  return response;
}

export async function POST(request: Request) {
  let form = false;
  let token: string | null = null;
  try {
    ({ token, form } = await readToken(request));
    if (request.headers.get('sec-fetch-site') === 'cross-site') {
      throw new AppError('forbidden', 'Confirmez le suivi depuis la page du lien.', 403);
    }
    const fingerprint = await requestFingerprint();
    await enforceRateLimit(
      `claim:ip:${fingerprint.ipHash ?? 'inconnue'}`,
      PROFILE_LIMITS.claim.max,
      PROFILE_LIMITS.claim.window,
      'Trop de tentatives. Patientez une minute, puis réessayez.',
    );

    if (!token || !TRACKING_TOKEN_RE.test(token)) throw new AppError('claim_invalid', INVALID, 410);
    const hash = hashTrackingToken(token);

    const preview = await peekClaim(hash);
    if (!preview) throw new AppError('claim_invalid', INVALID, 410);

    const platform = await detectPlatform();
    const session = await getOrCreateClientSession(preview.organization.id, { platform });

    const claimed = await claimEntry(hash, session.id);
    if (!claimed) throw new AppError('claim_invalid', INVALID, 410);

    const target = `/e/${encodeURIComponent(claimed.locationSlug)}?src=link`;
    const response = form
      ? seeOther(target)
      : jsonOk({ redirect: target, entryId: claimed.entry.id });
    if (session.issuedToken) {
      response.cookies.set(sessionCookieName(preview.organization.id), session.issuedToken, sessionCookieOptions());
    }
    return withHeaders(response);
  } catch (error) {
    if (form) {
      // Sans JavaScript : retour à la page, qui affiche l'état réel du
      // lien (expiré, déjà servi) à partir de la base, pas d'un paramètre.
      const back = token && TRACKING_TOKEN_RE.test(token) ? `/s/${token}` : '/';
      return withHeaders(seeOther(back));
    }
    return withHeaders(jsonError(error));
  }
}
