import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkScanProof, parseScanProof, type ScanProof } from '@/lib/event-pass';
import { formatEventTicketNumber } from '@/lib/wallet-copy';
import { assertQueueAccess } from '@/server/auth';
import { ScanPassCard, type ScanCheck } from './ScanPassCard';

export const metadata: Metadata = { title: 'Contrôle accès', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Relation<T> = T | T[] | null;
const one = <T,>(value: Relation<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value);

/**
 * Page de contrôle d'un laisser-passer Event, ouverte par l'appareil photo
 * du personnel. Trois QR y mènent (lib/event-pass.ts, parseScanProof) :
 *
 *   /scan/<accès>?slot=…&sig=…   QR tournant de la page /pass
 *   /scan/<accès>?w=…            billet Apple Wallet (Google en repli)
 *   /scan/<accès>?t=…&otp=…      QR tournant de Google Wallet (TOTP)
 *
 * La page ne valide rien : elle dit au personnel ce qu'il a devant lui.
 * La validation passe par redeemEventPass, qui revérifie la preuve et
 * s'en remet à redeem_event_pass (usage unique).
 */
export default async function ScanPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token: passId }, query] = await Promise.all([params, searchParams]);

  if (!/^[0-9A-Za-z]{12,32}$/.test(passId)) notFound();
  const proof = parseScanProof(query);
  if (!proof) notFound();

  const db = supabaseAdmin();

  // Étape 1 : seulement les métadonnées minimales nécessaires au contrôle
  // d'accès. Aucun prénom client n'est chargé avant l'autorisation tenant.
  const { data: passAuth } = await db
    .from('event_access_passes')
    .select('public_id, token_hash, queue_entry_id, event_id, issued_at, event_campaigns(queue_id, wallet_qr_enabled)')
    .eq('public_id', passId)
    .maybeSingle();

  if (!passAuth) notFound();

  const authEvent = one(passAuth.event_campaigns as Relation<{ queue_id: string; wallet_qr_enabled: boolean | null }>);
  if (!authEvent?.queue_id) notFound();

  await assertQueueAccess(authEvent.queue_id, 'queue.operate');

  // Étape 2 : l'utilisateur appartient bien à l'organisation de cette
  // file. Tout le reste part en même temps : le personnel attend devant
  // le client, chaque aller-retour se voit. Du ticket, on ne lit que le
  // prénom (déjà montré aujourd'hui) et le numéro humain du billet, pas
  // l'objet `metadata` entier (il peut porter les détails d'un profil
  // métier, sans rapport avec l'entrée).
  const walletQrEnabled = authEvent.wallet_qr_enabled !== false;
  const [{ data: pass }, verdict, { data: waveNumber }] = await Promise.all([
    db.from('event_access_passes')
      .select(`
        public_id, status, valid_until, grace_until, redeemed_at,
        queue_entries(client_name, ticket_number:metadata->>eventTicketNumber),
        event_campaigns(name),
        locations(name)
      `)
      .eq('public_id', passId)
      .maybeSingle(),
    checkScanProof(db, {
      tokenHash: passAuth.token_hash as string,
      queueEntryId: passAuth.queue_entry_id as string,
      walletQrEnabled,
      proof,
    }),
    db.rpc('event_pass_wave', { p_event_id: passAuth.event_id, p_issued_at: passAuth.issued_at }),
  ]);

  if (!pass) notFound();

  const event = one(pass.event_campaigns as Relation<{ name: string }>);
  const entry = one(pass.queue_entries as Relation<{ client_name: string | null; ticket_number: string | null }>);
  const location = one(pass.locations as Relation<{ name: string }>);

  const expired = new Date(pass.grace_until).getTime() < Date.now();
  const ticketRaw = entry?.ticket_number && /^\d{1,9}$/.test(entry.ticket_number) ? Number(entry.ticket_number) : null;

  const check: ScanCheck = verdict.ok
    ? { state: 'valid', source: verdict.source }
    : { state: verdict.reason, source: proofSource(proof) };

  return (
    <ScanPassCard
      passId={pass.public_id}
      proof={proof}
      check={check}
      passStatus={expired && pass.status === 'issued' ? 'expired' : pass.status}
      clientName={entry?.client_name ?? null}
      ticketNumber={formatEventTicketNumber(ticketRaw)}
      wave={typeof waveNumber === 'number' && waveNumber > 0 ? waveNumber : null}
      eventName={event?.name ?? 'Événement'}
      locationName={location?.name ?? 'Établissement'}
      validUntil={pass.valid_until}
      graceUntil={pass.grace_until}
      redeemedAt={pass.redeemed_at}
    />
  );
}

/** Preuve refusée : on sait seulement de quelle famille de QR elle vient. */
function proofSource(proof: ScanProof): ScanCheck['source'] {
  if (proof.kind === 'slot') return 'web';
  return proof.kind === 'totp' ? 'google' : 'wallet';
}
