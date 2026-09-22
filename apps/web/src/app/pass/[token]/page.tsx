import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hashEventPassToken } from '@/lib/event-pass';
import { EventPassCard } from './EventPassCard';

export const metadata: Metadata = {
  title: 'Laisser-passer',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

export default async function PassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/i.test(token)) notFound();

  const tokenHash = hashEventPassToken(token);
  const { data: pass } = await supabaseAdmin()
    .from('event_access_passes')
    .select(`
      public_id, status, issued_at, valid_until, grace_until, redeemed_at,
      event_campaigns(name, status),
      locations(name, city, logo_url),
      queue_entries(client_name)
    `)
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!pass) notFound();

  const event = Array.isArray(pass.event_campaigns) ? pass.event_campaigns[0] : pass.event_campaigns;
  const location = Array.isArray(pass.locations) ? pass.locations[0] : pass.locations;
  const entry = Array.isArray(pass.queue_entries) ? pass.queue_entries[0] : pass.queue_entries;

  const expired = pass.status === 'issued' && new Date(pass.grace_until).getTime() < Date.now();
  const status = expired ? 'expired' : pass.status;

  return (
    <EventPassCard
      token={token}
      passId={pass.public_id}
      status={status}
      eventName={event?.name ?? 'Événement Rangvia'}
      eventStatus={event?.status ?? 'ended'}
      locationName={location?.name ?? 'Établissement'}
      city={location?.city ?? null}
      logoUrl={location?.logo_url ?? null}
      clientName={entry?.client_name ?? null}
      validUntil={pass.valid_until}
      graceUntil={pass.grace_until}
      redeemedAt={pass.redeemed_at}
    />
  );
}
