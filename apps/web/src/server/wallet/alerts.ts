import { ALERT_KINDS } from './types';
import type { AlertKind, WalletProviderId, WalletSnapshot, WalletView } from './types';

/**
 * Faut-il faire sonner le téléphone ? Règles communes (§ 5 du plan),
 * fonction PURE : mêmes entrées, même décision, sur les deux plateformes.
 *
 *  1. Pas de moment clé → rien.
 *  2. Mode Événement : jamais d'alerte de position (même règle que
 *     dispatchQueueNotifications) ; seule la vague fait venir le client.
 *  3. Rang ahead_two < ahead_one < your_turn (comme
 *     internal.notification_ledger) : Google n'envoie jamais un moment
 *     déjà signalé, ni un moment moins urgent qu'un moment déjà signalé.
 *     Apple ne consulte PAS le registre : un appareil (iPhone, puis
 *     Apple Watch) peut récupérer la version APRÈS que le registre a
 *     été écrit, et l'alerte disparaîtrait. Wallet déduplique de lui-même
 *     (il n'alerte que si la valeur de `etat` change).
 *  4. `your_turn` et `event_access` sonnent toujours (mieux vaut deux
 *     alertes qu'aucune) ; les autres seulement si aucun autre canal
 *     (Web Push, App Clip…) ne les a déjà livrés.
 *  5. Google : 3 notifications par pass et par 24 h. Au-delà, le message
 *     reste au dos du pass, sans sonnerie (TEXT).
 */

const RANK: Partial<Record<AlertKind, number>> = { ahead_two: 1, ahead_one: 2, your_turn: 3 };
const ALWAYS_NOTIFY: ReadonlySet<AlertKind> = new Set<AlertKind>(['your_turn', 'event_access']);

/** Budget Google : notifications sonores par pass sur 24 h glissantes. */
export const GOOGLE_NOTIFY_BUDGET = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WalletAlertInput {
  provider: WalletProviderId;
  view: Pick<WalletView, 'alertKind' | 'kind'>;
  eventMode: boolean;
  /** Moments livrés (statut 'sent') par les AUTRES canaux pour ce ticket. */
  deliveredByOthers: readonly string[];
  /** wallet_passes.alerts */
  ledger: Partial<Record<string, string>>;
  /** wallet_passes.notify_log (ISO) */
  notifyLog: readonly string[];
  now: Date;
}

export interface WalletAlertDecision {
  kind: AlertKind;
  notify: boolean;
}

export function decideWalletAlert(input: WalletAlertInput): WalletAlertDecision | null {
  const kind = input.view.alertKind;
  if (!kind) return null;

  const rank = RANK[kind];
  if (input.eventMode && rank !== undefined) return null;

  if (input.provider === 'google') {
    if (input.ledger[kind]) return null;
    if (rank !== undefined) {
      const higher = Object.keys(input.ledger).some((k) => (RANK[k as AlertKind] ?? 0) > rank && input.ledger[k]);
      if (higher) return null;
    }
  }

  let notify = ALWAYS_NOTIFY.has(kind) || !input.deliveredByOthers.includes(kind);

  if (notify && input.provider === 'google') {
    const since = input.now.getTime() - DAY_MS;
    const recent = input.notifyLog.filter((iso) => {
      const t = Date.parse(iso);
      return Number.isFinite(t) && t > since;
    }).length;
    if (recent >= GOOGLE_NOTIFY_BUDGET) notify = false;
  }

  return { kind, notify };
}

/** Canal de notification_deliveries propre à un fournisseur. */
export function walletChannel(provider: WalletProviderId): 'apple_wallet' | 'google_wallet' {
  return provider === 'apple' ? 'apple_wallet' : 'google_wallet';
}

/** Moments livrés par les autres canaux, lus dans l'instantané. */
export function deliveredByOthers(snap: Pick<WalletSnapshot, 'deliveredKinds'>, provider: WalletProviderId): AlertKind[] {
  const own = walletChannel(provider);
  const kinds = new Set<AlertKind>();
  for (const [channel, list] of Object.entries(snap.deliveredKinds ?? {})) {
    if (channel === own || !Array.isArray(list)) continue;
    for (const k of list) if ((ALERT_KINDS as readonly string[]).includes(k)) kinds.add(k as AlertKind);
  }
  return [...kinds];
}

/** Raccourci pour les fournisseurs : décision à partir de l'instantané et de la vue. */
export function decideAlertFor(
  provider: WalletProviderId,
  snap: WalletSnapshot,
  view: Pick<WalletView, 'alertKind' | 'kind'>,
  now: Date,
): WalletAlertDecision | null {
  return decideWalletAlert({
    provider,
    view,
    eventMode: view.kind === 'event',
    deliveredByOthers: deliveredByOthers(snap, provider),
    ledger: snap.pass.alerts ?? {},
    notifyLog: snap.pass.notifyLog ?? [],
    now,
  });
}
