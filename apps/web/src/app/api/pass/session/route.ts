import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyEventPassCookie } from '@/lib/event-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE = 'rv_event_pass';

async function loadPassByPublicId(publicId: string) {
  const { data: pass } = await supabaseAdmin()
    .from('event_access_passes')
    .select(`
      public_id, status, issued_at, valid_until, grace_until, redeemed_at,
      event_campaigns(name, status),
      locations(name, city, logo_url),
      queue_entries(client_name)
    `)
    .eq('public_id', publicId)
    .maybeSingle();

  if (!pass) return null;

  const event = Array.isArray(pass.event_campaigns) ? pass.event_campaigns[0] : pass.event_campaigns;
  const location = Array.isArray(pass.locations) ? pass.locations[0] : pass.locations;
  const entry = Array.isArray(pass.queue_entries) ? pass.queue_entries[0] : pass.queue_entries;

  const expired = pass.status === 'issued' && new Date(pass.grace_until).getTime() < Date.now();

  return {
    passId: pass.public_id,
    status: expired ? 'expired' : pass.status,
    eventName: event?.name ?? 'Événement Rangvia',
    eventStatus: event?.status ?? 'ended',
    locationName: location?.name ?? 'Établissement',
    city: location?.city ?? null,
    logoUrl: location?.logo_url ?? null,
    clientName: entry?.client_name ?? null,
    validUntil: pass.valid_until,
    graceUntil: pass.grace_until,
    redeemedAt: pass.redeemed_at,
  };
}

/**
 * État live du laisser-passer.
 *
 * Aucun bearer n'est accepté ici : seule la session HttpOnly signée créée
 * lors de l'activation peut relire ce pass.
 */
export async function GET() {
  const jar = await cookies();
  const session = verifyEventPassCookie(jar.get(COOKIE)?.value);

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Session de laisser-passer absente ou expirée.' },
      {
        status: 401,
        headers: {
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      },
    );
  }

  const data = await loadPassByPublicId(session.publicId);
  if (!data) {
    return NextResponse.json(
      { ok: false, error: 'Laisser-passer introuvable.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { ok: true, data },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}
