import { isActiveStatus, type TicketState } from '@/lib/types';
import { walletUnavailableEventText } from '@/lib/wallet-copy';
import type { WalletOffer } from '@/server/wallet/providers';

/**
 * Règles d'affichage du Wallet côté client : fonctions PURES, sans
 * `server-only`, partagées par les pages, la route du ticket et les tests.
 *
 * Décision du propriétaire : le Wallet ne sert QU'AUX ÉVÉNEMENTS ET AUX
 * DROPS, pour passer le contrôle à l'entrée. Un ticket de file classique
 * (barbiers) ou d'une file à métier (atelier, table, guichet, boutique)
 * n'a donc JAMAIS d'offre, quel que soit l'état des fournisseurs : pas de
 * badge, pas de phrase, pas d'encart. La porte est ici, avant toute
 * lecture en base, pour que ce soit vrai même si un fournisseur est prêt.
 */

export type { WalletOffer };

/**
 * Billet d'événement : ticket pris pendant un drop. Le moteur pose
 * `metadata.eventId` à l'inscription (assign_event_ticket_number) et la
 * sérialisation client le transmet (entry.eventId). Un ticket de file
 * n'en a jamais, même dans une file qui a déjà accueilli un drop.
 */
export function eventIdOfTicket(ticket: Pick<TicketState, 'entry'> | null | undefined): string | null {
  const id = ticket?.entry.eventId;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** Le ticket est encore dans la file (seul cas où l'on propose un pass). */
export function ticketIsActive(ticket: Pick<TicketState, 'entry'> | null | undefined): boolean {
  return ticket ? isActiveStatus(ticket.entry.status) : false;
}

/**
 * Filet final, appliqué à toute offre avant de l'envoyer au navigateur :
 * hors billet d'événement, rien. (walletOffer() de W1 sait proposer un
 * pass de file ; le produit ne le veut plus.)
 */
export function eventOnlyOffer(offer: WalletOffer | null, isEventTicket: boolean): WalletOffer | null {
  return isEventTicket ? offer : null;
}

/* ====================================================================
   Encart ?wallet=indisponible&wp=<fournisseur>
   ==================================================================== */

type Query = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Posé par /api/client/wallet/[provider] quand l'ajout échoue (fournisseur
 * tombé entre l'affichage et le toucher, session expirée…). Rendu
 * seulement dans un contexte d'événement : une page de file classique ne
 * parle jamais de Wallet, même si l'adresse porte le paramètre.
 */
export function walletUnavailableNotice(
  query: Query,
  context: { eventContext: boolean; where: 'event' | 'pass' },
): string | null {
  if (!context.eventContext) return null;
  if (first(query.wallet) !== 'indisponible') return null;
  const provider = first(query.wp);
  return walletUnavailableEventText(provider === 'apple' || provider === 'google' ? provider : null, context.where);
}
