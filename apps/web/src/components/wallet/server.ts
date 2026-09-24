import 'server-only';
import type { TicketState } from '@/lib/types';
import { walletOffer, walletStatuses, type WalletOffer } from '@/server/wallet/providers';
import type { ProviderStatus, WalletProviderId } from '@/server/wallet/types';
import { eventIdOfTicket, eventOnlyOffer, ticketIsActive } from './offer';

/**
 * Offre Wallet d'un BILLET D'ÉVÉNEMENT, côté serveur (lot W4).
 *
 * Utilisée par /e/[slug] (rendu initial), /api/client/ticket (après
 * l'inscription, l'écran recharge son ticket) et /pass. Trois portes, dans
 * l'ordre du moins cher au plus cher, pour qu'une page de file ne paie
 * jamais rien pour une fonction qui ne la concerne pas :
 *
 *  1. billet d'événement encore actif (lu dans le ticket, sans requête) ;
 *  2. au moins un fournisseur prêt (état en cache 5 min) : sans Wallet
 *     configuré, aucune lecture en base, aucune offre ;
 *  3. événement toujours en cours (live ou paused) sur la file du ticket.
 *
 * Puis walletOffer() (W1) décide de l'appareil, du badge déposé, du mode
 * démo Google et du réglage `wallet_qr_enabled`.
 */

export interface RunningEvent {
  id: string;
  walletQrEnabled: boolean;
}

export interface EventWalletDeps {
  statuses(): Promise<Record<WalletProviderId, ProviderStatus>>;
  /** Événement live ou paused (et, pour un ticket, sur la file de ce ticket). */
  runningEvent(eventId: string, queueId: string | null): Promise<RunningEvent | null>;
  offer(ctx: Parameters<typeof walletOffer>[0]): Promise<WalletOffer | null>;
  /** Au moins un appareil a RÉELLEMENT inscrit le pass Apple de ce ticket. */
  appleSaved(entry: { publicId: string } | { id: string }): Promise<boolean>;
}

export interface EventWallet {
  offer: WalletOffer | null;
  /** Pour TicketState.wallet : null hors billet d'événement ou sans Wallet prêt. */
  wallet: { appleSaved: boolean } | null;
}

const NONE: EventWallet = { offer: null, wallet: null };

async function db() {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  return supabaseAdmin();
}

export const defaultEventWalletDeps: EventWalletDeps = {
  statuses: walletStatuses,
  async runningEvent(eventId, queueId) {
    let query = (await db())
      .from('event_campaigns')
      .select('id, wallet_qr_enabled')
      .eq('id', eventId)
      .in('status', ['live', 'paused']);
    if (queueId) query = query.eq('queue_id', queueId);
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    // Colonne de la migration 0021 : absente, on retient la valeur par défaut de la base.
    return { id: data.id as string, walletQrEnabled: (data as { wallet_qr_enabled?: boolean }).wallet_qr_enabled !== false };
  },
  offer: walletOffer,
  async appleSaved(entry) {
    const client = await db();
    let entryId: string | null = 'id' in entry ? entry.id : null;
    if (!entryId && 'publicId' in entry) {
      const { data } = await client.from('queue_entries').select('id').eq('public_id', entry.publicId).maybeSingle();
      entryId = (data?.id as string | undefined) ?? null;
    }
    if (!entryId) return false;
    // `live` côté Apple = au moins une inscription d'appareil (service web).
    const { data, error } = await client
      .from('wallet_passes')
      .select('id')
      .eq('queue_entry_id', entryId)
      .eq('provider', 'apple')
      .eq('live', true)
      .in('state', ['active', 'final'])
      .limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  },
};

function anyReady(statuses: Record<WalletProviderId, ProviderStatus>): boolean {
  return statuses.apple?.ready === true || statuses.google?.ready === true;
}

/** Page /e/[slug] et route /api/client/ticket : le ticket de CET appareil. */
export async function eventWalletForTicket(
  input: { ticket: TicketState | null; organizationId: string; userAgent: string | null },
  deps: EventWalletDeps = defaultEventWalletDeps,
): Promise<EventWallet> {
  const { ticket } = input;
  const eventId = eventIdOfTicket(ticket);
  if (!ticket || !eventId || !ticketIsActive(ticket)) return NONE;

  try {
    const statuses = await deps.statuses();
    if (!anyReady(statuses)) return NONE;

    const event = await deps.runningEvent(eventId, ticket.queue.id);
    if (!event) return NONE;

    const offer = await deps.offer({
      userAgent: input.userAgent,
      organizationId: input.organizationId,
      from: 'entry',
      entryPublicId: ticket.entry.id,
      // Le ticket a été retrouvé par la session de cet appareil : identifié.
      ticket: { active: true, identified: true },
      event,
    });
    const appleSaved = statuses.apple?.ready === true && offer?.apple
      ? await deps.appleSaved({ publicId: ticket.entry.id })
      : false;
    return { offer: eventOnlyOffer(offer, true), wallet: { appleSaved } };
  } catch (error) {
    // Le Wallet est un plus : une panne ne doit jamais empêcher d'afficher le ticket.
    console.error('[wallet] offre indisponible', error instanceof Error ? error.message : error);
    return NONE;
  }
}

/** Page /pass : le laisser-passer ouvert par le cookie signé rv_event_pass. */
export async function eventWalletForPass(
  input: {
    userAgent: string | null;
    organizationId: string;
    queueEntryId: string;
    eventId: string;
    /** Accès émis, dans sa fenêtre, événement ni complet ni terminé. */
    active: boolean;
  },
  deps: EventWalletDeps = defaultEventWalletDeps,
): Promise<EventWallet> {
  if (!input.active) return NONE;
  try {
    const statuses = await deps.statuses();
    if (!anyReady(statuses)) return NONE;
    const event = await deps.runningEvent(input.eventId, null);
    if (!event) return NONE;
    const offer = await deps.offer({
      userAgent: input.userAgent,
      organizationId: input.organizationId,
      from: 'pass',
      // Le cookie signé rv_event_pass vient d'être vérifié par la page.
      ticket: { active: true, identified: true },
      event,
    });
    const appleSaved = statuses.apple?.ready === true && offer?.apple
      ? await deps.appleSaved({ id: input.queueEntryId })
      : false;
    return { offer: eventOnlyOffer(offer, true), wallet: { appleSaved } };
  } catch (error) {
    console.error('[wallet] offre indisponible', error instanceof Error ? error.message : error);
    return NONE;
  }
}
