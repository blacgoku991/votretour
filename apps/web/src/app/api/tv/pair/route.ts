import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { enforceRateLimit } from '@/server/ratelimit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import {
  TV_COOKIE,
  generateTvDeviceToken,
  hashTvDeviceToken,
  hashTvPairCode,
} from '@/server/tv-kiosk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
});

function clientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
  ).slice(0, 80);
}

export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Saisissez le code à 6 chiffres affiché dans le super-admin.' },
        { status: 422, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const body = parsed.data;

    await enforceRateLimit(
      'tv-pair:' + clientIp(request),
      10,
      600,
      'Trop de codes essayés. Patientez quelques minutes.',
    );

    // Plafond GLOBAL, indépendant de l'adresse IP.
    //
    // La limite par IP ne vaut que si le proxy frontal réécrit lui-même
    // X-Real-IP / X-Forwarded-For. S'il les laisse passer, un attaquant
    // change d'« adresse » à chaque requête et essaie les 10⁶ codes sans
    // limite. Ce plafond borne le total des essais, quelle que soit la
    // configuration du proxy : 300 essais par tranche de 10 minutes (la
    // durée de vie d'un code) donnent 0,03 % de chances de tomber sur un
    // code actif, alors qu'un appairage légitime n'en consomme qu'un.
    //
    // Revers assumé : un attaquant peut épuiser ce plafond et retarder de
    // quelques minutes l'appairage d'un NOUVEL écran. Les écrans déjà
    // appairés et les files ne sont pas concernés.
    await enforceRateLimit(
      'tv-pair:global',
      300,
      600,
      'Trop de tentatives d’appairage en ce moment. Réessayez dans quelques minutes.',
    );

    const rawToken = generateTvDeviceToken();
    const { data, error } = await supabaseAdmin().rpc('consume_display_pair_code', {
      p_code_hash: hashTvPairCode(body.code),
      p_token_hash: hashTvDeviceToken(rawToken),
    });

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { ok: false, error: 'Code invalide ou expiré.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const response = NextResponse.json(
      { ok: true, data: { paired: true } },
      { headers: { 'Cache-Control': 'no-store' } },
    );

    response.cookies.set(TV_COOKIE, rawToken, {
      httpOnly: true,
      secure: env.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (error) {
    // Seules les erreurs prévues remontent telles quelles. Le reste —
    // erreur PostgreSQL, panne réseau — ne doit pas exposer son détail
    // interne à un écran non authentifié.
    if (error instanceof AppError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('[tv-pair]', error);
    return NextResponse.json(
      { ok: false, error: 'Appairage impossible pour le moment. Réessayez.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
