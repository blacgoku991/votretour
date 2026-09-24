import {
  WALLET_BACK, WALLET_LABEL, WALLET_OFFER_COPY,
  eventQrAltText, walletAlertText, walletDescription, walletIssuerText, walletPrimaryValue, walletRelevantText,
} from '@/lib/wallet-copy';
import { eventPalette, queuePalette, type WalletPalette } from '../palette';
import type { WalletAlertDecision } from '../alerts';
import type { WalletPhase, WalletSnapshot, WalletView } from '../types';

/**
 * WalletView → pass.json Apple. Fonction PURE.
 *
 * Tous les mots viennent de lib/wallet-copy.ts (et donc de la vue) : le
 * pass Apple dit exactement ce que disent Google et la page web. Ce
 * fichier ne décide que de la MISE EN PAGE Wallet :
 *
 *  - FILE, style `generic` : « la latte dans la poche ». Fond encre, le
 *    chiffre en champ principal (la seule information qui compte), la
 *    vignette des lattes à droite, qui change avec la position ;
 *  - DROP, style `eventTicket` : « le billet de la marque ». Fond à la
 *    couleur de la marque, bandeau (strip), numéro humain en en-tête, QR
 *    seulement quand l'accès est ouvert ET que le contrôle l'accepte.
 *    Pas de `posterEventTicket` : Apple le déclare incompatible avec un
 *    billet à QR.
 *
 * L'alerte de l'écran verrouillé : un SEUL champ porte un changeMessage,
 * `etat`, dont la valeur ne change qu'aux moments clés. Wallet n'alerte
 * que si cette valeur change entre deux versions, ce qui déduplique à lui
 * seul ; on ne pose le message que si decideAlertFor() dit `notify`.
 *
 * Rien de variable dans le temps n'entre ici (pas de « mis à jour à… ») :
 * même état, mêmes octets, même empreinte, donc aucune mise à jour poussée
 * pour rien.
 */

export interface AppleField {
  key: string;
  label?: string;
  value: string | number;
  attributedValue?: string;
  changeMessage?: string;
  dateStyle?: 'PKDateStyleNone' | 'PKDateStyleShort' | 'PKDateStyleMedium';
  timeStyle?: 'PKDateStyleNone' | 'PKDateStyleShort';
  textAlignment?: 'PKTextAlignmentNatural' | 'PKTextAlignmentRight';
}

export interface AppleFieldSet {
  headerFields: AppleField[];
  primaryFields: AppleField[];
  secondaryFields: AppleField[];
  auxiliaryFields: AppleField[];
  backFields: AppleField[];
}

export interface ApplePassJson {
  formatVersion: 1;
  passTypeIdentifier: string;
  teamIdentifier: string;
  serialNumber: string;
  authenticationToken: string;
  webServiceURL: string;
  organizationName: string;
  description: string;
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  logoText?: string;
  sharingProhibited: true;
  voided?: true;
  expirationDate?: string;
  relevantDate?: string;
  relevantDates?: { startDate: string; endDate: string }[];
  locations?: { latitude: number; longitude: number; relevantText: string }[];
  maxDistance?: number;
  groupingIdentifier?: string;
  barcodes?: { format: 'PKBarcodeFormatQR'; message: string; messageEncoding: 'iso-8859-1'; altText: string }[];
  semantics?: { eventName: string; venueName: string };
  generic?: AppleFieldSet;
  eventTicket?: AppleFieldSet;
}

export interface ApplePassContext {
  passTypeId: string;
  teamId: string;
  serial: string;
  authenticationToken: string;
  webServiceUrl: string;
  /** Décision d'alerte (decideAlertFor('apple', …)) : changeMessage seulement si `notify`. */
  alert: WalletAlertDecision | null;
  /** Contenu du QR Wallet (walletQrUrl), calculé par l'appelant qui détient le secret. */
  qrMessage: string | null;
  /** Le pass embarque-t-il le logo de l'établissement ? (sinon, nom écrit à côté du signe Rangvia) */
  hasBrandLogo: boolean;
}

/** Wallet n'affiche pas une valeur trop longue sur le recto : bornes des tests. */
export const FRONT_LIMITS = {
  header: 3, primary: 1, secondary: 4, auxiliary: 4, back: 12,
  valueChars: 60,
  /** `etat` porte la phrase entière de l'alerte ; seule sur sa ligne, tronquée au recto si besoin. */
  statusChars: 100,
  labelChars: 32,
} as const;
export const RELEVANT_DISTANCE_M = 200;

const ACTIVE_PHASES: ReadonlySet<WalletPhase> = new Set<WalletPhase>([
  'waiting', 'soon', 'one', 'turn', 'serving', 'absent', 'paused', 'closed', 'event_waiting', 'event_access',
]);
const POSITION_PHASES: ReadonlySet<WalletPhase> = new Set<WalletPhase>([
  'waiting', 'soon', 'one', 'paused', 'closed', 'event_waiting',
]);

/**
 * Libellés Apple en petites capitales ; toLocaleUpperCase garde les
 * accents (« ARRIVÉE »). Bornés : un nom de lieu servant de libellé peut
 * être long (clipLabel, plus bas).
 */
export function upper(label: string): string {
  return clipLabel(label.toLocaleUpperCase('fr-FR'));
}

/** Date Wallet : ISO 8601 à la seconde, en UTC (Wallet l'affiche dans le fuseau de l'appareil). */
export function appleDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function addMinutes(iso: string, minutes: number): string {
  return appleDate(Date.parse(iso) + minutes * 60_000);
}

/** Un lien de verso, construit par le serveur vers notre site : jamais un texte saisi par un pro. */
function link(url: string, text: string): string {
  const safeUrl = url.replace(/&/g, '&amp;').replace(/'/g, '%27').replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
  const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<a href='${safeUrl}'>${safeText}</a>`;
}

/** Palette du pass : encre et accent pour une file, couleur de la marque pour un drop. */
export function passPalette(view: Pick<WalletView, 'kind' | 'brand'>): WalletPalette {
  return view.kind === 'event' ? eventPalette(view.brand.accentHex, view.brand.accent) : queuePalette(view.brand.accent);
}

/** Minutes de tolérance après l'heure limite d'un accès (« +5 min »). */
function toleranceMinutes(view: WalletView): number | null {
  if (!view.times.limitAt || !view.times.graceUntil) return null;
  const minutes = Math.round((Date.parse(view.times.graceUntil) - Date.parse(view.times.limitAt)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

/**
 * Fenêtre de pertinence d'une attente : au plus 4 h. Au-delà (profils
 * véhicule ou appareil, où un ticket reste actif des jours entre deux
 * étapes), le pass n'a rien à faire sur l'écran verrouillé : il y revient
 * à chaque changement, qui produit une nouvelle version.
 */
export const RELEVANCE_MAX_MINUTES = 240;

/** Le plus récent de deux horodatages ISO (un horodatage absent est ignoré). */
function latest(a: string | null | undefined, b: string): string {
  return a && Date.parse(a) > Date.parse(b) ? a : b;
}

/** Fenêtre de pertinence (écran verrouillé) : l'attente, resserrée quand c'est le tour. */
function relevance(view: WalletView, snap: WalletSnapshot): { startDate: string; endDate: string } | null {
  if (!ACTIVE_PHASES.has(view.phase)) return null;
  if (view.phase === 'event_access' && snap.access) {
    return { startDate: appleDate(snap.access.issuedAt), endDate: appleDate(snap.access.graceUntil) };
  }
  if (view.phase === 'turn' || view.phase === 'serving') {
    const since = snap.entry.calledAt ?? snap.entry.statusChangedAt ?? view.times.joinedAt;
    return { startDate: appleDate(since), endDate: addMinutes(since, 30) };
  }
  // Depuis le dernier changement de statut, pas depuis l'arrivée : un
  // ticket d'atelier déposé lundi redevient pertinent quand il bouge.
  const since = latest(snap.entry.statusChangedAt, view.times.joinedAt);
  const ttl = snap.queue.entryTtlMinutes && snap.queue.entryTtlMinutes > 0 ? snap.queue.entryTtlMinutes : RELEVANCE_MAX_MINUTES;
  return { startDate: appleDate(since), endDate: addMinutes(since, Math.min(ttl, RELEVANCE_MAX_MINUTES)) };
}

/**
 * Date à laquelle Wallet range le pass parmi les passes expirés, même sans
 * mise à jour. JAMAIS sur un ticket actif : depuis la migration 0034, le
 * moteur compte le délai d'expiration depuis le dernier changement
 * d'étape (coalesce(stage_changed_at, joined_at) + TTL), que l'instantané
 * ne porte pas, et un changement d'étape ne met pas le pass en file. Une
 * date calculée ici classerait « expiré » le ticket d'une voiture encore
 * à l'atelier. Quand le moteur expire vraiment le ticket, la file d'envoi
 * pousse une version annulée (voided) : c'est elle qui fait foi.
 */
function expiration(view: WalletView): string | null {
  if (view.phase === 'done' && view.archiveAt) return appleDate(view.archiveAt);
  if (view.phase === 'event_access' && view.times.graceUntil) return appleDate(view.times.graceUntil);
  return null;
}

/**
 * Libellé du recto borné : au-delà, Wallet coupe sans prévenir. Un nom de
 * lieu ou d'événement très long finit par « … » plutôt qu'au milieu d'un mot.
 */
export function clipLabel(label: string, max: number = FRONT_LIMITS.labelChars): string {
  const chars = [...label];
  if (chars.length <= max) return label;
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

function statusField(view: WalletView, ctx: ApplePassContext): AppleField {
  const field: AppleField = {
    key: 'etat',
    label: upper(view.phase === 'event_access' ? WALLET_LABEL.todo : WALLET_LABEL.status),
    value: view.statusText,
  };
  if (ctx.alert?.notify) {
    field.changeMessage = walletAlertText(ctx.alert.kind, {
      placeName: view.brand.placeName,
      peopleAhead: view.position?.value ?? null,
    }).appleChangeMessage;
  }
  return field;
}

function primaryField(view: WalletView): AppleField {
  const positional = POSITION_PHASES.has(view.phase) && view.position !== null;
  // Le chiffre en nombre : Wallet l'affiche en très grand, comme le
  // compteur de la page client. « Plus de 20 » reste un texte.
  const value = positional && view.position?.value !== null && view.position?.value !== undefined
    ? view.position.value
    : walletPrimaryValue(view);
  // Un chiffre se lit toujours avec « Devant vous » : sous le nom d'un
  // drop, « 12 » ne dirait plus rien. Sur un billet, le nom de l'événement
  // est écrit en haut (logoText) ; un mot (« Accès ouvert », « Utilisé »)
  // se suffit, sans étiquette. Sur un ticket de file, le lieu coiffe le mot.
  if (positional) return { key: 'devant', label: upper(WALLET_LABEL.ahead), value };
  if (view.kind === 'event' && view.event) return { key: 'devant', value };
  return { key: 'devant', label: upper(view.brand.placeName), value };
}

function backFields(view: WalletView): AppleField[] {
  const back: AppleField[] = [];
  const openText = view.kind === 'event' ? WALLET_BACK.openEvent : WALLET_BACK.openTicket;
  if (view.event?.rules) back.push({ key: 'regles', label: WALLET_LABEL.rules, value: view.event.rules });
  if (view.kind === 'event') back.push({ key: 'validite', label: WALLET_LABEL.validity, value: WALLET_BACK.eventValidity });
  if (view.qr && !view.qr.allowWallet) {
    back.push({ key: 'controle', label: WALLET_LABEL.validity, value: WALLET_OFFER_COPY.qrNotAccepted });
  }
  if (!view.final) {
    back.push({ key: 'suivre', label: WALLET_LABEL.follow, value: view.links.ticket, attributedValue: link(view.links.ticket, openText) });
  }
  if (view.links.review) {
    back.push({ key: 'avis', label: WALLET_LABEL.review, value: view.links.review, attributedValue: link(view.links.review, WALLET_BACK.review) });
  }
  if (!view.final && view.kind === 'queue') back.push({ key: 'quitter', label: WALLET_LABEL.leave, value: WALLET_BACK.leave });
  if (view.brand.address) back.push({ key: 'adresse', label: WALLET_LABEL.address, value: view.brand.address });
  back.push({ key: 'vieprivee', label: WALLET_LABEL.privacy, value: WALLET_BACK.privacy });
  back.push({ key: 'emetteur', label: WALLET_LABEL.issuer, value: walletIssuerText(view.brand.orgName) });
  return back;
}

function queueFields(view: WalletView, ctx: ApplePassContext): AppleFieldSet {
  const primary = primaryField(view);
  const auxiliary: AppleField[] = [];
  // Le pro assigné : déjà public sur la page client, jamais le client.
  if (view.staffName && ACTIVE_PHASES.has(view.phase)) {
    auxiliary.push({ key: 'avec', label: upper(WALLET_LABEL.staff), value: view.staffName });
  }
  // Le lieu est déjà écrit en grand quand il sert d'étiquette principale.
  if (primary.label !== upper(view.brand.placeName)) {
    auxiliary.push({ key: 'lieu', label: upper(WALLET_LABEL.place), value: view.brand.placeName });
  }
  return {
    headerFields: [{
      key: 'arrivee',
      label: upper(WALLET_LABEL.arrival),
      value: appleDate(view.times.joinedAt),
      dateStyle: 'PKDateStyleNone',
      timeStyle: 'PKDateStyleShort',
      textAlignment: 'PKTextAlignmentRight',
    }],
    primaryFields: [primary],
    // Seul sur sa ligne : « Marqué absent : présentez-vous à l’accueil »
    // doit tenir en entier, sans voisin qui le tronque.
    secondaryFields: [statusField(view, ctx)],
    auxiliaryFields: auxiliary,
    backFields: backFields(view),
  };
}

function eventFields(view: WalletView, ctx: ApplePassContext): AppleFieldSet {
  const header: AppleField[] = [];
  if (view.event?.ticketNumber) {
    header.push({ key: 'numero', label: WALLET_LABEL.ticket, value: view.event.ticketNumber, textAlignment: 'PKTextAlignmentRight' });
  }
  // Accès ouvert : l'heure limite est déjà dans la consigne (« Présentez-
  // vous avant 14:32 »), une seule fois. À côté, la tolérance, qui n'est
  // écrite nulle part ailleurs au recto.
  const secondary: AppleField[] = [statusField(view, ctx)];
  const tolerance = view.phase === 'event_access' ? toleranceMinutes(view) : null;
  if (tolerance) {
    secondary.push({
      key: 'tolerance',
      label: upper(WALLET_LABEL.grace),
      value: `+${tolerance} min`,
      textAlignment: 'PKTextAlignmentRight',
    });
  }
  const auxiliary: AppleField[] = [];
  if (view.event?.wave) auxiliary.push({ key: 'vague', label: upper(WALLET_LABEL.wave), value: String(view.event.wave) });
  auxiliary.push({ key: 'lieu', label: upper(WALLET_LABEL.place), value: view.brand.placeName });
  return {
    headerFields: header,
    primaryFields: [primaryField(view)],
    secondaryFields: secondary,
    auxiliaryFields: auxiliary,
    backFields: backFields(view),
  };
}

export function renderApplePassJson(view: WalletView, snap: WalletSnapshot, ctx: ApplePassContext): ApplePassJson {
  const palette = passPalette(view);
  const isEvent = view.kind === 'event' && Boolean(view.event);
  const name = isEvent && view.event ? view.event.name : view.brand.placeName;

  const pass: ApplePassJson = {
    formatVersion: 1,
    passTypeIdentifier: ctx.passTypeId,
    teamIdentifier: ctx.teamId,
    serialNumber: ctx.serial,
    authenticationToken: ctx.authenticationToken,
    webServiceURL: ctx.webServiceUrl,
    // Le nom que le client reconnaît sur l'écran verrouillé : le commerce.
    organizationName: view.brand.orgName,
    description: walletDescription(isEvent ? 'event' : 'queue', name),
    backgroundColor: palette.apple.backgroundColor,
    foregroundColor: palette.apple.foregroundColor,
    labelColor: palette.apple.labelColor,
    sharingProhibited: true,
  };
  // Billet de drop : le nom de l'événement en haut, à côté du logo de la
  // marque (ou du signe Rangvia), comme sur un billet imprimé ; le
  // commerce reste le nom de l'écran verrouillé (organizationName) et le
  // lieu est écrit plus bas. Ticket de file : sans logo téléversé, le nom
  // du commerce à côté du signe (le lieu précis : champ « Lieu »).
  if (isEvent && view.event) pass.logoText = clipLabel(view.event.name);
  else if (!ctx.hasBrandLogo) pass.logoText = clipLabel(view.brand.orgName);
  if (view.voided) pass.voided = true;

  const expires = expiration(view);
  if (expires) pass.expirationDate = expires;

  const window = relevance(view, snap);
  if (window) {
    pass.relevantDate = window.startDate; // iOS < 18
    pass.relevantDates = [window];
  }
  if (ACTIVE_PHASES.has(view.phase) && view.brand.lat !== null && view.brand.lng !== null) {
    pass.locations = [{
      latitude: view.brand.lat,
      longitude: view.brand.lng,
      relevantText: walletRelevantText(view.phase, view.brand.placeName),
    }];
    pass.maxDistance = RELEVANT_DISTANCE_M;
  }

  if (isEvent && view.event) {
    if (snap.event?.id) pass.groupingIdentifier = `event.${snap.event.id}`;
    // Le QR n'existe qu'en phase d'accès ouvert, et seulement si le
    // contrôle accepte le billet Wallet (sinon il serait refusé à l'entrée).
    if (view.phase === 'event_access' && view.qr?.allowWallet && ctx.qrMessage) {
      pass.barcodes = [{
        format: 'PKBarcodeFormatQR',
        message: ctx.qrMessage,
        messageEncoding: 'iso-8859-1',
        altText: eventQrAltText(view.event.ticketNumber, view.event.wave),
      }];
    }
    pass.semantics = { eventName: view.event.name, venueName: view.brand.placeName };
    pass.eventTicket = eventFields(view, ctx);
  } else {
    pass.generic = queueFields(view, ctx);
  }
  return pass;
}

/* ====================================================================
   Images : quoi dessiner (le dessin lui-même est dans images.ts)
   ==================================================================== */

export type ThumbSpec = { kind: 'slats'; peopleAhead: number } | null;

/**
 * Vignette des lattes (file seulement) : tant que le client attend ou
 * vient d'être appelé. Pas de vignette sur un ticket clos : la latte
 * « Vous » seule dirait « c’est votre tour ».
 */
export function thumbnailSpec(view: WalletView): ThumbSpec {
  if (view.kind === 'event' && view.event) return null;
  if (view.phase === 'turn' || view.phase === 'serving') return { kind: 'slats', peopleAhead: 0 };
  if (POSITION_PHASES.has(view.phase) && view.position) {
    // « Plus de 20 » : n'importe quel nombre au-delà du dernier palier dessiné.
    return { kind: 'slats', peopleAhead: view.position.value ?? 99 };
  }
  return null;
}
