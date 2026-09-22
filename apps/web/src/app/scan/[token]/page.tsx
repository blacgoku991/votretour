import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyEventPassSignature } from '@/lib/event-pass';
import { assertQueueAccess } from '@/server/auth';
import { ScanPassCard } from './ScanPassCard';

export const metadata: Metadata = { title: 'Contrôle accès', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function ScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ slot?: string; sig?: string }>;
}) {
  const { token: passId } = await params;
  const { slot: slotRaw, sig } = await searchParams;

  if (!/^[0-9A-Za-z]{12,32}$/.test(passId)) notFound();
  const slot = Number(slotRaw);
  if (!Number.isInteger(slot) || !sig) notFound();

  const { data: pass } = await supabaseAdmin()
    .from('event_access_passes')
    .select(`
      public_id, token_hash, status, valid_until, grace_until, redeemed_at,
      queue_entry_id,
      queue_entries(client_name),
      event_campaigns(id, name, queue_id, organization_id),
      locations(name)
    `)
    .eq('public_id', passId)
    .maybeSingle();

  if (!pass) notFound();

  const event = Array.isArray(pass.event_campaigns) ? pass.event_campaigns[0] : pass.event_campaigns;
  const entry = Array.isArray(pass.queue_entries) ? pass.queue_entries[0] : pass.queue_entries;
  const location = Array.isArray(pass.locations) ? pass.locations[0] : pass.locations;

  if (!event?.queue_id) notFound();

  // Ne révèle aucune donnée client avant d'avoir vérifié que le scanner
  // appartient bien à l'organisation de CET événement.
  await assertQueueAccess(event.queue_id, 'queue.operate');

  const signatureValid = verifyEventPassSignature(pass.token_hash, slot, sig);
  const expired = new Date(pass.grace_until).getTime() < Date.now();

  return (
    <ScanPassCard
      passId={passId}
      slot={slot}
      signature={sig}
      passId={pass.public_id}
      passStatus={expired && pass.status === 'issued' ? 'expired' : pass.status}
      signatureValid={signatureValid}
      clientName={entry?.client_name ?? null}
      eventName={event.name}
      locationName={location?.name ?? 'Établissement'}
      validUntil={pass.valid_until}
      graceUntil={pass.grace_until}
      redeemedAt={pass.redeemed_at}
    />
  );
}
