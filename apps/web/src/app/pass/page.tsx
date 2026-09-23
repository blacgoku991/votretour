import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyEventPassCookie } from '@/lib/event-pass';
import { EventPassCard } from './EventPassCard';

export const metadata: Metadata = {
  title: 'Laisser-passer',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

const COOKIE = 'rv_event_pass';

export default async function PassHomePage() {
  const jar = await cookies();
  const session = verifyEventPassCookie(jar.get(COOKIE)?.value);
  if (!session) notFound();

  const { data: pass } = await supabaseAdmin()
    .from('event_access_passes')
    .select(`
      public_id, event_id, status, issued_at, valid_until, grace_until, redeemed_at,
      event_campaigns(name, status, hero_title, logo_url, cover_url, accent_hex, rules_text, qr_label),
      locations(name, city, logo_url),
      queue_entries(client_name)
    `)
    .eq('public_id', session.publicId)
    .maybeSingle();

  if (!pass) notFound();

  const event = Array.isArray(pass.event_campaigns) ? pass.event_campaigns[0] : pass.event_campaigns;
  const location = Array.isArray(pass.locations) ? pass.locations[0] : pass.locations;
  const entry = Array.isArray(pass.queue_entries) ? pass.queue_entries[0] : pass.queue_entries;

  // Numéro de vague : une vague est émise en une seule transaction, donc
  // tous ses pass partagent le même issued_at. On compte les émissions
  // distinctes de l'événement jusqu'à celle de ce pass (lecture seule).
  const { data: issuedRows } = await supabaseAdmin()
    .from('event_access_passes')
    .select('issued_at')
    .eq('event_id', pass.event_id)
    .lte('issued_at', pass.issued_at)
    .limit(5000);
  const wave = issuedRows && issuedRows.length > 0
    ? new Set(issuedRows.map((row) => row.issued_at)).size
    : null;

  const expired = pass.status === 'issued' && new Date(pass.grace_until).getTime() < Date.now();
  const status = expired ? 'expired' : pass.status;

  return (
    <EventPassCard
      passId={pass.public_id}
      status={status}
      eventName={event?.name ?? 'Événement Rangvia'}
      eventStatus={event?.status ?? 'ended'}
      locationName={location?.name ?? 'Établissement'}
      city={location?.city ?? null}
      logoUrl={event?.logo_url ?? location?.logo_url ?? null}
      coverUrl={event?.cover_url ?? null}
      accentHex={event?.accent_hex ?? '#FF4B1F'}
      heroTitle={event?.hero_title ?? null}
      rulesText={event?.rules_text ?? null}
      qrLabel={event?.qr_label ?? null}
      clientName={entry?.client_name ?? null}
      validUntil={pass.valid_until}
      graceUntil={pass.grace_until}
      redeemedAt={pass.redeemed_at}
      wave={wave}
    />
  );
}
