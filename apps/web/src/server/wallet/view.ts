import {
  WALLET_HEADLINE, WALLET_STATUS,
  eventAccessStatusText, eventAheadHeadline, eventOverCopy, eventUsedStatusText,
  formatEventTicketNumber, waitingStatusText, walletAheadHeadline, walletPositionLabel,
  WALLET_PLUS_THRESHOLD,
} from '@/lib/wallet-copy';
import { isActiveStatus } from '@/lib/types';
import { ACCENT_HEX, normalizeAccent, normalizeHex } from './palette';
import { mediaRef } from './media';
import type { AlertKind, WalletPhase, WalletSnapshot, WalletView } from './types';

/**
 * Modèle de vue d'un pass : fonction PURE (instantané, horloge) → vue.
 *
 * C'est ici, et seulement ici, que l'état technique d'un ticket devient
 * une phase, des mots et un moment clé. Apple (W2) et Google (W3) ne font
 * que traduire cette vue dans leur format : ils ne peuvent donc pas dire
 * deux choses différentes. Tableaux de référence : § 4 du plan Wallet,
 * vérifiés ligne à ligne par tests/wallet/view.test.ts.
 *
 * Minimisation : on ne recopie de l'instantané que des champs nommés. Un
 * champ inattendu (un prénom glissé par erreur) ne peut pas atteindre le
 * pass : il n'est tout simplement jamais lu.
 */

/** Le « Merci » reste actif 2 h (lien d'avis), puis le pass s'archive. */
export const DONE_ACTIVE_MS = 2 * 60 * 60 * 1000;

const FINAL_PHASES: ReadonlySet<WalletPhase> = new Set<WalletPhase>([
  'done', 'left', 'removed', 'expired', 'event_used', 'event_expired', 'event_over',
]);
const VOIDED_PHASES: ReadonlySet<WalletPhase> = new Set<WalletPhase>([
  'left', 'removed', 'expired', 'event_used', 'event_expired', 'event_over',
]);

export function isFinalPhase(phase: WalletPhase): boolean {
  return FINAL_PHASES.has(phase);
}

interface PhaseResult {
  phase: WalletPhase;
  headline: string;
  statusText: string;
  alertKind: AlertKind | null;
  /** Montrer la position (attente) ? */
  showPosition: boolean;
}

function isEventCloseEvent(value: string | null): value is 'event_sold_out' | 'event_ended' {
  return value === 'event_sold_out' || value === 'event_ended';
}

/** Phases d'un ticket de file (et repli d'un billet sans accès, terminé autrement). */
function queuePhase(snap: WalletSnapshot): PhaseResult {
  const { entry, queue } = snap;
  const n = Math.max(0, entry.peopleAhead ?? 0);
  const threshold = Math.max(0, queue.notifyAheadThreshold ?? 2);

  switch (entry.status) {
    case 'completed':
      return { phase: 'done', headline: WALLET_HEADLINE.done, statusText: WALLET_STATUS.done, alertKind: 'visit_completed', showPosition: false };
    case 'cancelled':
      // Clôture d'un drop : mêmes mots que les notifications de fin.
      if (isEventCloseEvent(entry.statusEvent)) {
        return overPhase(snap, entry.statusEvent === 'event_sold_out' ? 'sold_out' : 'ended');
      }
      // « Quitté » ou « retiré » : c'est l'acteur de l'annulation qui tranche.
      if (entry.statusActor === 'client') {
        return { phase: 'left', headline: WALLET_HEADLINE.left, statusText: WALLET_STATUS.closedTicket, alertKind: null, showPosition: false };
      }
      return { phase: 'removed', headline: WALLET_HEADLINE.removed, statusText: WALLET_STATUS.closedTicket, alertKind: 'removed', showPosition: false };
    case 'skipped':
      return { phase: 'removed', headline: WALLET_HEADLINE.removed, statusText: WALLET_STATUS.closedTicket, alertKind: 'removed', showPosition: false };
    case 'expired':
      return { phase: 'expired', headline: WALLET_HEADLINE.expired, statusText: WALLET_STATUS.closedTicket, alertKind: null, showPosition: false };
    case 'absent':
      // Titre inchangé (dernière position connue) : seul le statut parle.
      return { phase: 'absent', headline: walletAheadHeadline(n), statusText: WALLET_STATUS.absent, alertKind: null, showPosition: false };
    case 'serving':
      // `your_turn` a déjà sonné à l'appel : « En cours » ne réveille personne.
      return { phase: 'serving', headline: WALLET_HEADLINE.turn, statusText: WALLET_STATUS.serving, alertKind: null, showPosition: false };
    case 'next':
      return { phase: 'turn', headline: WALLET_HEADLINE.turn, statusText: WALLET_STATUS.turn, alertKind: 'your_turn', showPosition: false };
    default:
      break;
  }

  // Ticket actif. Fermer ou mettre en pause une file n'annule pas les
  // tickets (set_queue_status) : ce ne sont pas des états finaux.
  if (queue.status === 'paused' || queue.status === 'closed') {
    return {
      phase: queue.status,
      headline: n === 0 ? WALLET_HEADLINE.first : walletAheadHeadline(n),
      statusText: queue.status === 'paused' ? WALLET_STATUS.paused : WALLET_STATUS.closed,
      alertKind: null,
      showPosition: true,
    };
  }
  if (n === 0) {
    return { phase: 'turn', headline: WALLET_HEADLINE.turn, statusText: WALLET_STATUS.turn, alertKind: 'your_turn', showPosition: false };
  }
  if (n === 1) {
    return { phase: 'one', headline: walletAheadHeadline(1), statusText: WALLET_STATUS.one, alertKind: 'ahead_one', showPosition: true };
  }
  if (n <= threshold) {
    return { phase: 'soon', headline: walletAheadHeadline(n), statusText: WALLET_STATUS.soon, alertKind: 'ahead_two', showPosition: true };
  }
  return { phase: 'waiting', headline: walletAheadHeadline(n), statusText: waitingStatusText(entry.status), alertKind: null, showPosition: true };
}

function overPhase(snap: WalletSnapshot, reason: 'sold_out' | 'ended'): PhaseResult {
  const copy = eventOverCopy(reason, snap.location.name);
  return {
    phase: 'event_over',
    headline: copy.headline,
    statusText: copy.statusText,
    alertKind: reason === 'sold_out' ? 'event_sold_out' : 'event_ended',
    showPosition: false,
  };
}

/** Phases d'un billet de drop : l'accès émis prime sur tout le reste. */
function eventPhase(snap: WalletSnapshot, now: Date): PhaseResult {
  const { entry, access, event } = snap;
  const tz = snap.location.timezone;
  const overReason = (): 'sold_out' | 'ended' =>
    event?.status === 'sold_out' || entry.statusEvent === 'event_sold_out' ? 'sold_out' : 'ended';

  if (access) {
    switch (access.status) {
      case 'issued':
        if (now.getTime() <= Date.parse(access.graceUntil)) {
          return {
            phase: 'event_access',
            headline: WALLET_HEADLINE.eventAccess,
            statusText: eventAccessStatusText(access.validUntil, tz),
            alertKind: 'event_access',
            showPosition: false,
          };
        }
        // Tolérance dépassée, le cron n'a pas encore expiré l'accès : on
        // n'affiche pas un QR que le contrôle refuserait.
        return { phase: 'event_expired', headline: WALLET_HEADLINE.eventExpired, statusText: WALLET_STATUS.eventExpired, alertKind: null, showPosition: false };
      case 'redeemed':
        return {
          phase: 'event_used',
          headline: WALLET_HEADLINE.eventUsed,
          statusText: eventUsedStatusText(access.redeemedAt, tz),
          alertKind: null,
          showPosition: false,
        };
      case 'expired':
        return { phase: 'event_expired', headline: WALLET_HEADLINE.eventExpired, statusText: WALLET_STATUS.eventExpired, alertKind: null, showPosition: false };
      case 'revoked':
        return overPhase(snap, overReason());
      default:
        break;
    }
  }

  if (event && (event.status === 'sold_out' || event.status === 'ended')) return overPhase(snap, overReason());
  if (entry.status === 'cancelled' && isEventCloseEvent(entry.statusEvent)) return overPhase(snap, overReason());

  // Ticket terminé hors vague (quitté, retiré, expiré) : mêmes mots qu'en file.
  if (!isActiveStatus(entry.status) && entry.status !== 'absent') return queuePhase(snap);

  const n = Math.max(0, entry.peopleAhead ?? 0);
  return {
    phase: 'event_waiting',
    headline: eventAheadHeadline(n),
    statusText: WALLET_STATUS.eventWaiting,
    // Jamais d'alerte de position en mode Événement (même règle que
    // dispatchQueueNotifications) : seule la vague fait venir le client.
    alertKind: null,
    showPosition: true,
  };
}

function addMs(iso: string | null, ms: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + ms).toISOString() : null;
}

function joinAddress(loc: WalletSnapshot['location']): string | null {
  const city = [loc.postalCode, loc.city].filter((p) => p && p.trim()).join(' ');
  const parts = [loc.addressLine1, loc.addressLine2, city].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.map((p) => p.trim()).join(', ') : null;
}

/**
 * Cycle de vie du pass après un envoi réussi, commun aux deux
 * fournisseurs (champs final / reopen / nextRunAfter du résultat) :
 *  - final : la vue vient de devenir finale ;
 *  - reopen : le moteur a remis en file un ticket final (restauration,
 *    TERMINER annulé) ; la base n'accepte la réouverture que dans les 2 h ;
 *  - nextRunAfter : le « Merci » n'a pas de déclencheur SQL pour son
 *    archivage à +2 h, on programme donc ce passage nous-mêmes.
 */
export function passLifecycle(
  view: Pick<WalletView, 'final' | 'phase' | 'archiveAt'>,
  pass: Pick<WalletSnapshot['pass'], 'state'>,
  now: Date,
): { final?: true; reopen?: true; nextRunAfter?: string } {
  const out: { final?: true; reopen?: true; nextRunAfter?: string } = {};
  if (view.final && pass.state === 'active') out.final = true;
  if (!view.final && pass.state === 'final') out.reopen = true;
  if (view.phase === 'done' && view.archiveAt && Date.parse(view.archiveAt) > now.getTime()) {
    out.nextRunAfter = view.archiveAt;
  }
  return out;
}

export interface BuildViewOptions {
  /** Racine publique du site, sans barre finale (env.siteUrl en production). */
  siteUrl: string;
}

export function buildWalletView(snap: WalletSnapshot, now: Date, options: BuildViewOptions): WalletView {
  const siteUrl = options.siteUrl.replace(/\/+$/, '');
  const tz = snap.location.timezone || 'Europe/Paris';
  const accent = normalizeAccent(snap.organization.brandAccent);
  const isEvent = snap.pass.kind === 'event' && snap.event !== null;
  const event = isEvent ? snap.event : null;

  const result = isEvent ? eventPhase(snap, now) : queuePhase(snap);
  const { phase } = result;
  const n = Math.max(0, snap.entry.peopleAhead ?? 0);

  const final = FINAL_PHASES.has(phase);
  const voided = VOIDED_PHASES.has(phase);

  let archiveAt: string | null = null;
  if (phase === 'done') {
    archiveAt = addMs(snap.entry.completedAt ?? snap.entry.statusChangedAt ?? snap.at, DONE_ACTIVE_MS);
  } else if (phase === 'event_access' && snap.access) {
    archiveAt = snap.access.graceUntil;
  }

  let googleState: WalletView['googleState'] = 'ACTIVE';
  if (voided) googleState = phase === 'event_used' ? 'COMPLETED' : 'EXPIRED';
  else if (phase === 'done' && archiveAt && now.getTime() >= Date.parse(archiveAt)) googleState = 'COMPLETED';

  const times: WalletView['times'] = { joinedAt: snap.entry.joinedAt, tz };
  if (snap.access && isEvent) {
    if (snap.access.status === 'issued') {
      times.limitAt = snap.access.validUntil;
      times.graceUntil = snap.access.graceUntil;
    }
    if (snap.access.redeemedAt) times.redeemedAt = snap.access.redeemedAt;
  }

  const qr = phase === 'event_access' && snap.access && event
    ? { publicId: snap.access.publicId, tokenHash: snap.access.tokenHash, allowWallet: event.walletQrEnabled }
    : null;

  const accentHex = (event && normalizeHex(event.accentHex)) || ACCENT_HEX[accent];
  const logo = mediaRef(event?.logoUrl, siteUrl)
    ?? mediaRef(snap.location.logoUrl, siteUrl)
    ?? mediaRef(snap.organization.logoUrl, siteUrl);
  const cover = mediaRef(event ? event.coverUrl : snap.location.coverUrl, siteUrl);

  const ticketLink = `${siteUrl}/e/${encodeURIComponent(snap.location.slug)}${event ? `?event=${event.id}` : ''}`;
  // Lien d'avis : seulement après la visite, si l'établissement en a un
  // ET s'il demande des avis (faux par défaut pour les profils de santé).
  const review = phase === 'done' && snap.location.hasReviewUrl && snap.organization.sendCompletionReview
    ? `${siteUrl}/api/client/review/click?entry=${encodeURIComponent(snap.entry.publicId)}&source=wallet`
    : null;

  return {
    kind: snap.pass.kind,
    phase,
    headline: result.headline,
    position: result.showPosition
      ? { value: n > WALLET_PLUS_THRESHOLD ? null : n, label: walletPositionLabel(n) }
      : null,
    statusText: result.statusText,
    alertKind: result.alertKind,
    final,
    archiveAt,
    voided,
    googleState,
    times,
    ...(event
      ? {
          event: {
            name: event.name,
            ticketNumber: formatEventTicketNumber(snap.entry.eventTicketNumber),
            wave: snap.access?.wave ?? null,
            rules: event.rulesText?.trim() || null,
          },
        }
      : {}),
    qr,
    brand: {
      orgName: snap.organization.name,
      placeName: snap.location.name,
      accentHex,
      accent,
      logo,
      cover,
      address: joinAddress(snap.location),
      lat: snap.location.latitude,
      lng: snap.location.longitude,
    },
    links: { ticket: ticketLink, review },
    staffName: snap.entry.staffName?.trim() || null,
  };
}
