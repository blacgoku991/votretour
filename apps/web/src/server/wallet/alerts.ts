import { ALERT_KINDS } from './types';
import type { AlertKind, WalletProviderId, WalletSnapshot, WalletView } from './types';

/**
 * Faut-il faire sonner le téléphone ? Règles communes (§ 5 du plan),
 * fonction PURE : mêmes entrées, même décision, sur les deux plateformes.
 *
 *  1. Pas de moment clé → rien.
 *  2. Mode Événement (billet de drop, ou pass de file pendant qu'un drop
 *     tient la file) : jamais d'alerte de rang (même règle que
 *     dispatchQueueNotifications) ; seule la vague fait venir le client.
 *  3. Rang ahead_two < ahead_one < your_turn (comme
 *     internal.notification_ledger) : Google n'envoie jamais un moment
 *     déjà signalé, ni un moment moins urgent qu'un moment déjà signalé.
 *     Comme le moteur, le registre des paliers repart de zéro à chaque
 *     report, retour après absence ou restauration (`rankResetAt`) : un
 *     client appelé, reporté puis rappelé est prévenu à nouveau.
 *     Premier envoi Google : un palier que le moteur avait déjà atteint
 *     AVANT la création du pass est inscrit sans sonner (le client le voit
 *     déjà à l'écran), comme seed_notification_baseline à l'inscription.
 *  4. Apple ne consulte PAS le registre : un appareil (iPhone, puis
 *     Apple Watch) peut récupérer la version APRÈS que le registre a été
 *     écrit, et l'alerte disparaîtrait. Wallet déduplique de lui-même (il
 *     n'alerte que si la valeur de `etat` change) ; seul cas à trancher :
 *     « En cours » après un appel déjà montré (`turnAnnounced`, donnée
 *     stable de l'instantané), qui ne doit pas sonner une seconde fois.
 *     En auto_serve, un client resté à 0 devant (aucun poste libre) a vu
 *     « Présentez-vous », puis sonne encore à la promotion : assumé, rien
 *     de stable ne distingue ce cas de l'appel lui-même.
 *  5. `your_turn` et `event_access` sonnent toujours (mieux vaut deux
 *     alertes qu'aucune) ; les autres seulement si aucun autre canal
 *     (Web Push, App Clip…) ne les a déjà livrés.
 *  6. Google : 3 notifications par pass et par 24 h. Au-delà, le message
 *     reste au dos du pass, sans sonnerie (TEXT). La troisième est gardée
 *     pour your_turn et event_access : les paliers n'en usent que deux.
 */

const RANK: Partial<Record<AlertKind, number>> = { ahead_two: 1, ahead_one: 2, your_turn: 3 };
const ALWAYS_NOTIFY: ReadonlySet<AlertKind> = new Set<AlertKind>(['your_turn', 'event_access']);

/** Événements de file après lesquels le moteur vide ses paliers (0008). */
export const RANK_RESET_EVENTS: readonly string[] = ['defer', 'absent_move_back', 'restore'];

/** Budget Google : notifications sonores par pass sur 24 h glissantes. */
export const GOOGLE_NOTIFY_BUDGET = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WalletAlertInput {
  provider: WalletProviderId;
  view: Pick<WalletView, 'alertKind' | 'kind' | 'phase' | 'turnAnnounced'>;
  eventMode: boolean;
  /** Moments livrés (statut 'sent') par les AUTRES canaux pour ce ticket. */
  deliveredByOthers: readonly string[];
  /** wallet_passes.alerts */
  ledger: Partial<Record<string, string>>;
  /** wallet_passes.notify_log (ISO) */
  notifyLog: readonly string[];
  now: Date;
  /** Dernière remise à zéro des paliers par le moteur (voir types.ts). */
  rankResetAt?: string | null;
  /** queue_entries.notification_status (voir types.ts). */
  engineLedger?: Partial<Record<string, string>>;
  /** wallet_passes.created_at */
  passCreatedAt?: string | null;
}

export interface WalletAlertDecision {
  kind: AlertKind;
  notify: boolean;
}

/**
 * Horodatage du moteur → ms. to_char(…, 'OF') écrit « +00 » ou « +05:30 » :
 * on complète « +00 » en « +00:00 », seule forme que Date.parse garantit.
 */
export function parseLedgerTime(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const normalized = /[+-]\d{2}$/.test(value) ? `${value}:00` : value;
  return Date.parse(normalized);
}

/**
 * Registre Wallet des paliers encore valables : une entrée antérieure (ou
 * égale) à la dernière remise à zéro du moteur est oubliée. Les autres
 * moments (visit_completed, removed, event_*) ne sont jamais remis à zéro
 * ici : le pass est rouvert, et son registre vidé, par complete_wallet_outbox.
 */
export function liveLedger(
  ledger: Partial<Record<string, string>>,
  rankResetAt: string | null | undefined,
): Partial<Record<string, string>> {
  const reset = parseLedgerTime(rankResetAt);
  if (!Number.isFinite(reset)) return ledger;
  const out: Partial<Record<string, string>> = {};
  for (const [key, value] of Object.entries(ledger)) {
    if (!value) continue;
    const isRank = RANK[key as AlertKind] !== undefined;
    const at = parseLedgerTime(value);
    // Horodatage illisible : on le garde (mieux vaut ne pas renvoyer).
    if (isRank && Number.isFinite(at) && at <= reset) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Le moteur avait-il déjà atteint ce palier avant que le pass existe ?
 * 'at_join' : atteint dès l'inscription, donc avant tout pass. Un
 * horodatage antérieur à la création du pass aussi. 'superseded' ne date
 * rien : on sonne plutôt que de risquer un oubli.
 *
 * Le moteur écrit ses horodatages À LA SECONDE (to_char … SSOF), le pass
 * à la microseconde : un palier atteint dans la même seconde que l'ajout
 * est ambigu, et « C’est votre tour » y resterait muet à tort. On ne
 * conclut donc « avant » que si la seconde du palier précède strictement
 * celle de la création du pass.
 */
export function reachedBeforePass(
  kind: AlertKind,
  engineLedger: Partial<Record<string, string>> | undefined,
  passCreatedAt: string | null | undefined,
): boolean {
  const value = engineLedger?.[kind];
  if (!value) return false;
  if (value === 'at_join') return true;
  const at = parseLedgerTime(value);
  const created = parseLedgerTime(passCreatedAt);
  return Number.isFinite(at) && Number.isFinite(created) && at < Math.floor(created / 1000) * 1000;
}

export function decideWalletAlert(input: WalletAlertInput): WalletAlertDecision | null {
  const kind = input.view.alertKind;
  if (!kind) return null;

  const rank = RANK[kind];
  if (input.eventMode && rank !== undefined) return null;

  if (input.provider === 'apple' && input.view.phase === 'serving' && input.view.turnAnnounced) {
    // next → serving (call_next) : « Présentez-vous » a déjà sonné, et le
    // client est au comptoir. « En cours » passe en silence.
    return null;
  }

  let notify = ALWAYS_NOTIFY.has(kind) || !input.deliveredByOthers.includes(kind);

  if (input.provider === 'google') {
    const ledger = liveLedger(input.ledger, input.rankResetAt);
    if (ledger[kind]) return null;
    if (rank !== undefined) {
      const higher = Object.keys(ledger).some((k) => (RANK[k as AlertKind] ?? 0) > rank && ledger[k]);
      if (higher) return null;
      // Amorce : inscrit au registre, affiché au dos, sans sonnerie.
      if (reachedBeforePass(kind, input.engineLedger, input.passCreatedAt)) notify = false;
    }
  }

  if (notify && input.provider === 'google') {
    const since = input.now.getTime() - DAY_MS;
    const recent = input.notifyLog.filter((iso) => {
      const t = Date.parse(iso);
      return Number.isFinite(t) && t > since;
    }).length;
    // La dernière sonnerie du budget est RÉSERVÉE aux moments qui font
    // venir le client (your_turn, event_access) : après un report, trois
    // paliers de rang ne doivent pas faire taire le rappel lui-même.
    const cap = ALWAYS_NOTIFY.has(kind) ? GOOGLE_NOTIFY_BUDGET : GOOGLE_NOTIFY_BUDGET - 1;
    if (recent >= cap) notify = false;
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

/**
 * Raccourci pour les fournisseurs : décision à partir de l'instantané et
 * de la vue. Le mode Événement se lit à la fois dans la vue et dans
 * l'instantané (drop lancé après l'ajout d'un pass de file).
 */
export function decideAlertFor(
  provider: WalletProviderId,
  snap: WalletSnapshot,
  view: Pick<WalletView, 'alertKind' | 'kind' | 'phase' | 'turnAnnounced'> & Partial<Pick<WalletView, 'eventMode'>>,
  now: Date,
): WalletAlertDecision | null {
  return decideWalletAlert({
    provider,
    view,
    eventMode: view.kind === 'event' || view.eventMode === true || Boolean(snap.queue.runningEventId),
    deliveredByOthers: deliveredByOthers(snap, provider),
    ledger: snap.pass.alerts ?? {},
    notifyLog: snap.pass.notifyLog ?? [],
    now,
    rankResetAt: snap.entry.rankResetAt ?? null,
    engineLedger: snap.entry.engineLedger,
    passCreatedAt: snap.pass.createdAt,
  });
}
