import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyEventPassCookie } from '@/lib/event-pass';
import { walletUnavailableNotice } from '@/components/wallet/offer';
import { eventWalletForPass } from '@/components/wallet/server';
import { EventPassCard } from './EventPassCard';
import { PassState, type PassStateKind } from './PassState';

type PassSearchParams = Promise<{ etat?: string | string[]; wallet?: string | string[]; wp?: string | string[] }>;

/** ?etat= posé par /api/pass/activate et /api/pass/access quand le lien est refusé. */
function readState(value: string | string[] | undefined): PassStateKind | null {
  const etat = Array.isArray(value) ? value[0] : value;
  return etat === 'expire' || etat === 'invalide' ? etat : null;
}

export async function generateMetadata({ searchParams }: { searchParams: PassSearchParams }): Promise<Metadata> {
  const state = readState((await searchParams).etat);
  return {
    title: state === 'expire'
      ? 'Laisser-passer expiré'
      : state === 'invalide'
        ? 'Lien de laisser-passer invalide'
        : 'Laisser-passer',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}
export const dynamic = 'force-dynamic';

const COOKIE = 'rv_event_pass';

export default async function PassHomePage({ searchParams }: { searchParams: PassSearchParams }) {
  const query = await searchParams;
  const state = readState(query.etat);
  const jar = await cookies();
  const session = verifyEventPassCookie(jar.get(COOKIE)?.value);
  // Lien refusé : on dit pourquoi, au lieu de la 404 « Cette file n’existe pas ».
  if (state) return <PassState kind={state} hasPass={Boolean(session)} />;
  if (!session) notFound();

  const { data: pass } = await supabaseAdmin()
    .from('event_access_passes')
    .select(`
      public_id, event_id, organization_id, queue_entry_id, status, issued_at, valid_until, grace_until, redeemed_at,
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
  // tous ses pass partagent le même issued_at. La base compte les
  // émissions distinctes jusqu'à celle de ce pass, en une requête.
  // En cas d'erreur, on n'affiche simplement pas de numéro.
  const { data: waveNumber } = await supabaseAdmin().rpc('event_pass_wave', {
    p_event_id: pass.event_id,
    p_issued_at: pass.issued_at,
  });
  const wave = typeof waveNumber === 'number' && waveNumber > 0 ? waveNumber : null;

  const expired = pass.status === 'issued' && new Date(pass.grace_until).getTime() < Date.now();
  const status = expired ? 'expired' : pass.status;

  // Wallet (lot W4) : offert sous le QR tournant tant que l'accès est
  // ouvert. Rien du tout si le Wallet n'est pas configuré (aucune lecture).
  const eventStatus = event?.status ?? 'ended';
  const wallet = await eventWalletForPass({
    userAgent: (await headers()).get('user-agent'),
    organizationId: pass.organization_id as string,
    queueEntryId: pass.queue_entry_id as string,
    eventId: pass.event_id as string,
    active: status === 'issued' && eventStatus !== 'sold_out' && eventStatus !== 'ended',
  });

  return (
    <EventPassCard
      passId={pass.public_id}
      status={status}
      eventName={event?.name ?? 'Événement Rangvia'}
      eventStatus={eventStatus}
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
      walletOffer={wallet.offer}
      appleSaved={wallet.wallet?.appleSaved === true}
      walletNotice={walletUnavailableNotice(query, { eventContext: true, where: 'pass' })}
    />
  );
}
