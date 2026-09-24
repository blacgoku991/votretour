/**
 * PHASES DE L'ÉCRAN CLIENT, PAR PROFIL — logique pure, testée à part
 * (`tests/client-phase-profiles.test.ts`), sans React ni réseau.
 *
 * Deux différences de fond avec `phaseFor` des barbiers
 * (`ClientExperience.tsx`), qui reste inchangée :
 *
 *  - « personne devant vous » ne veut PAS dire « c'est votre tour ». Au
 *    fauteuil, la file avance seule (`auto_serve`) ; à table, au guichet
 *    ou à l'atelier, c'est le professionnel qui appelle. Le rideau ne
 *    tombe donc que sur un vrai appel (`next`), jamais sur un compte à 0 ;
 *  - un atelier suit une ÉTAPE, pas une position : « En réparation » est
 *    un ticket `serving` qui n'est pas « à vous ».
 */

import type { EntryStatus } from '@/lib/types';
import type {
  ClientQuote,
  ProfileStage,
  QueueProfile,
  TodayHours,
} from '@/lib/profiles/types';
import { ACTIVITY_LABEL } from '@/lib/copy';
import { profileForActivity } from '@/lib/profiles';
import { formatClock } from '@/lib/profiles/copy';

export type ProfilePhase = 'join' | 'tracking' | 'ready' | 'done' | 'closed';

/** Ce que la phase lit d'un ticket : de quoi la tester sans tout le JSON. */
export interface PhaseInput {
  entry: {
    status: EntryStatus;
    stage: ProfileStage | null;
    calledAt?: string | null;
  };
  queue: { profile: QueueProfile };
}

const CLOSED: readonly EntryStatus[] = ['cancelled', 'expired', 'skipped', 'absent'];

export function isWorkshop(profile: QueueProfile): profile is 'vehicle' | 'device' {
  return profile === 'vehicle' || profile === 'device';
}

/**
 * Une commande suivie en boutique (étape posée par le vendeur) se lit
 * comme un atelier ; un client venu « être conseillé » (sans étape), comme
 * une file.
 */
export function isRetailOrder(profile: QueueProfile, stage: ProfileStage | null): boolean {
  return profile === 'retail' && (stage === 'preparing' || stage === 'ready');
}

export function profilePhase(ticket: PhaseInput | null): ProfilePhase {
  if (!ticket) return 'join';
  const { status, stage, calledAt } = ticket.entry;
  const profile = ticket.queue.profile;
  if (status === 'completed') return 'done';
  if (CLOSED.includes(status)) return 'closed';

  // « Prêt » : l'étape le dit, ou le professionnel a appelé.
  if (stage === 'ready' || status === 'next') return 'ready';
  // « J'arrive » après l'appel : on reste sur le rideau, qui le confirme.
  // Un « présent » posé AVANT tout appel (le pro l'a vu arriver) n'est
  // pas un appel : on reste dans la file.
  if (status === 'present') return calledAt ? 'ready' : 'tracking';

  if (status === 'serving') {
    // À l'atelier, `serving` est une étape de travail (diagnostic, devis,
    // pièce, réparation) ; une commande en préparation aussi. Au guichet,
    // à table ou pour un conseil, c'est « vous êtes servi ».
    if (isWorkshop(profile) || isRetailOrder(profile, stage)) return 'tracking';
    return 'ready';
  }
  return 'tracking';
}

/* ------------------------------------------------------------------ */
/* « 3 véhicules avant le vôtre » (étape « Reçu » seulement)            */
/* ------------------------------------------------------------------ */

export interface PublicEntryLite {
  id: string;
  ahead: number;
  status: EntryStatus;
}

/**
 * Véhicules déposés AVANT le mien et pas encore pris en charge : les
 * entrées `waiting` de la diffusion publique dont le rang est inférieur.
 * `people_ahead` seul compterait aussi les véhicules prêts qui attendent
 * leur propriétaire (`next` passe devant dans le classement) : faux pour
 * « pris en charge dans l'ordre d'arrivée ». null si mon ticket n'y est
 * pas (diffusion pas encore reçue) : on n'affiche alors rien plutôt qu'un
 * chiffre inventé.
 */
export function intakeAhead(entries: readonly PublicEntryLite[] | null | undefined, myId: string): number | null {
  if (!entries) return null;
  const mine = entries.find((e) => e.id === myId);
  if (!mine || mine.status !== 'waiting') return null;
  return entries.filter((e) => e.id !== myId && e.status === 'waiting' && e.ahead < mine.ahead).length;
}

/* ------------------------------------------------------------------ */
/* Heures, dans le fuseau de l'établissement                            */
/* ------------------------------------------------------------------ */

function zonedParts(date: Date, timeZone: string): { day: string; hhmm: string; weekday: string } {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const hhmm = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  const weekday = new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'long' }).format(date);
  return { day, hhmm, weekday };
}

/** « 17 h », « 17 h 30 » (espaces insécables), comme on le dit au comptoir. */
export function spokenHour(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = String(Number(m[1]));
  return m[2] === '00' ? `${h} h` : `${h} h ${m[2]}`;
}

/**
 * La promesse du professionnel, dite comme lui : « aujourd’hui vers 17 h »,
 * « demain vers 9 h 30 », « jeudi vers 17 h », puis la date au-delà d'une
 * semaine. JAMAIS une estimation de Rangvia : sans `readyEta`, rien.
 */
export function promiseLabel(readyEta: string | null | undefined, timeZone: string, now = new Date()): string | null {
  if (!readyEta) return null;
  const at = new Date(readyEta);
  if (Number.isNaN(at.getTime())) return null;
  const t = zonedParts(at, timeZone);
  const today = zonedParts(now, timeZone).day;
  const tomorrow = zonedParts(new Date(now.getTime() + 86_400_000), timeZone).day;
  const hour = spokenHour(t.hhmm);
  if (t.day === today) return `aujourd’hui vers ${hour}`;
  if (t.day === tomorrow) return `demain vers ${hour}`;
  const days = (at.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 6.5) return `${t.weekday} vers ${hour}`;
  const date = new Intl.DateTimeFormat('fr-FR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(at);
  return `${date} vers ${hour}`;
}

/**
 * Ce que l'on peut dire des horaires du jour, sans rien inventer :
 * « Ouvert jusqu’à 19 h 00 », « Ouverture à 08 h 00 », « Fermé pour
 * aujourd’hui ». null sans horaires connus (le texte se tait).
 */
export function hoursLine(hours: TodayHours | null | undefined, timeZone: string, now = new Date()): string | null {
  if (!hours) return null;
  if (!hours.opensAt || !hours.closesAt) return 'Fermé aujourd’hui';
  const hhmm = zonedParts(now, timeZone).hhmm;
  if (hhmm < hours.opensAt) return `Ouverture à ${formatClock(hours.opensAt)}`;
  if (hhmm < hours.closesAt) return `Ouvert jusqu’à ${formatClock(hours.closesAt)}`;
  return 'Fermé pour aujourd’hui';
}

/* ------------------------------------------------------------------ */
/* Table : le délai réel pour se présenter                              */
/* ------------------------------------------------------------------ */

/**
 * Secondes restantes pour se présenter après l'appel : `called_at` +
 * `absent_grace_minutes`, le réglage même qu'applique le moteur. null si
 * l'un des deux manque : pas de compte à rebours inventé.
 */
export function graceRemaining(calledAt: string | null | undefined, graceMinutes: number | null | undefined, now = Date.now()): number | null {
  if (!calledAt || graceMinutes == null || graceMinutes <= 0) return null;
  const start = new Date(calledAt).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.round((start + graceMinutes * 60_000 - now) / 1000));
}

/** « 4:07 » */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Devis                                                                */
/* ------------------------------------------------------------------ */

/**
 * Le devis tel que le client le reçoit (`internal.details_for_client`) :
 * montant, libellé, décision, et son NUMÉRO `n`, que la décision renvoie
 * (`quoteN`) pour ne jamais accepter un devis modifié entre-temps.
 */
export interface ClientQuoteN extends ClientQuote {
  n: number | null;
  sentAt: string | null;
}

export function quoteOf(details: unknown): ClientQuoteN | null {
  if (!details || typeof details !== 'object') return null;
  const raw = (details as { quote?: unknown }).quote;
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const amountCents = typeof q.amountCents === 'number' ? q.amountCents : Number(q.amountCents);
  if (!Number.isFinite(amountCents)) return null;
  const n = typeof q.n === 'number' && Number.isInteger(q.n) && q.n > 0 ? q.n : null;
  const decision = q.decision === 'accepted' || q.decision === 'declined' ? q.decision : null;
  return {
    n,
    amountCents,
    label: typeof q.label === 'string' ? q.label : '',
    decision,
    sentAt: typeof q.sentAt === 'string' ? q.sentAt : null,
  };
}

/**
 * La latte courante du rail quand le client a DÉJÀ répondu au devis mais
 * que l'atelier n'a pas encore changé d'étape : « Devis à valider »
 * serait faux. On dit ce qui s'est passé, en ardoise (la main est à
 * l'atelier) plutôt qu'en cuivre (« attend le client »). null sinon :
 * le rail garde le nom de l'étape.
 */
export function quoteRailOverride(
  profile: QueueProfile,
  stage: ProfileStage | null,
  quote: Pick<ClientQuoteN, 'decision'> | null,
): { label: string; tone: 'ardoise' } | null {
  if (stage !== 'quote_pending' || !quote?.decision) return null;
  const who = profile === 'vehicle' ? 'le garage' : 'l’atelier';
  return quote.decision === 'accepted'
    ? { label: `Devis accepté · ${who} reprend la main`, tone: 'ardoise' }
    : { label: 'Devis refusé', tone: 'ardoise' };
}

/**
 * Le mot sous le nom de l'établissement, dans l'en-tête. L'activité de
 * l'ORGANISATION ne vaut que si elle parle le même métier que la file :
 * une organisation « Garage » qui ouvre aussi un guichet ne doit pas
 * écrire « Garage » au-dessus d'un numéro « A-042 ». Sinon, le mot du
 * profil.
 */
export const PROFILE_PLACE_LABEL: Readonly<Record<QueueProfile, string | null>> = {
  walkin: null,
  event: null,
  vehicle: 'Atelier automobile',
  device: 'Atelier de réparation',
  table: 'Restaurant',
  desk: 'Accueil du public',
  retail: 'Boutique',
};

export function placeLabel(profile: QueueProfile, activity: string | null | undefined): string | null {
  const label = activity ? ACTIVITY_LABEL[activity] ?? null : null;
  if (label && profileForActivity(activity) === profile) return label;
  return PROFILE_PLACE_LABEL[profile] ?? label;
}

/**
 * La pastille d'état de l'en-tête, avant l'inscription, dans le mot du
 * métier : « Liste fermée » au restaurant (comme le titre dessous),
 * « Dépôts ouverts » à l'atelier, « Guichets en pause » au guichet. La
 * boutique garde les mots des barbiers (`File ouverte`).
 */
export function queueStatusLabel(profile: QueueProfile, status: string): string {
  if (status === 'no_staff') return 'Personne de disponible';
  const words: Record<'open' | 'paused' | 'closed', string> = (() => {
    switch (profile) {
      case 'vehicle':
      case 'device':
        return { open: 'Dépôts ouverts', paused: 'Dépôts en pause', closed: 'Dépôts fermés' };
      case 'table':
        return { open: 'Liste ouverte', paused: 'Liste en pause', closed: 'Liste fermée' };
      case 'desk':
        return { open: 'Guichets ouverts', paused: 'Guichets en pause', closed: 'Guichets fermés' };
      default:
        return { open: 'File ouverte', paused: 'En pause', closed: 'File fermée' };
    }
  })();
  return status === 'open' ? words.open : status === 'paused' ? words.paused : words.closed;
}
