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

  const db = supabaseAdmin();

  // Étape 1 : seulement les métadonnées minimales nécessaires au contrôle
  // d'accès. Aucun prénom client n'est chargé avant l'autorisation tenant.
  const { data: passAuth } = await db
    .from('event_access_passes')
    .select('public_id, token_hash, event_campaigns(queue_id)')
    .eq('public_id', passId)
    .maybeSingle();

  if (!passAuth) notFound();

  const authEvent = Array.isArray(passAuth.event_campaigns)
    ? passAuth.event_campaigns[0]
    : passAuth.event_campaigns;

  if (!authEvent?.queue_id) notFound();

  await assertQueueAccess(authEvent.queue_id, 'queue.operate');

  // Étape 2 : l'utilisateur appartient bien à l'organisation de cette
  // file ; on peut maintenant charger les informations visibles à l'entrée.
  const { data: pass } = await db
    .from('event_access_passes')
    .select(`
      public_id, status, valid_until, grace_until, redeemed_at,
      queue_entries(client_name),
      event_campaigns(id, name, queue_id),
      locations(name)
    `)
    .eq('public_id', passId)
    .maybeSingle();

  if (!pass) notFound();

  const event = Array.isArray(pass.event_campaigns) ? pass.event_campaigns[0] : pass.event_campaigns;
  const entry = Array.isArray(pass.queue_entries) ? pass.queue_entries[0] : pass.queue_entries;
  const location = Array.isArray(pass.locations) ? pass.locations[0] : pass.locations;

  if (!event?.queue_id) notFound();

  const signatureValid = verifyEventPassSignature(passAuth.token_hash, slot, sig);
  const expired = new Date(pass.grace_until).getTime() < Date.now();

  return (
    <ScanPassCard
      passId={pass.public_id}
      slot={slot}
      signature={sig}
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
