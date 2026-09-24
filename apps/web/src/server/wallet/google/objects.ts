import { createHash } from 'node:crypto';
import {
  WALLET_BACK, WALLET_LABEL, WALLET_OFFER_COPY, WALLET_STATUS,
  eventQrAltText, eventWaveLabel, walletAlertText, walletIssuerText, walletTime,
} from '@/lib/wallet-copy';
import { signWalletQrCode, walletQrUrl, walletTotpKey, walletTotpPattern } from '@/lib/wallet/scan-proof';
import { heroUrl } from '../art/slats';
import { mediaRef, publicHttpsUrl, rangviaLogoUrl } from '../media';
import { eventPalette, normalizeAccent, queuePalette } from '../palette';
import type { AlertKind, WalletKind, WalletPhase, WalletSnapshot, WalletView } from '../types';
import type { GoogleClassType, GoogleMessage, GoogleObjectType, GoogleResource } from './client';
import type { GoogleNaming } from './config';

/**
 * WalletView → classes et objets Google Wallet. Fonctions PURES.
 *
 * La vue (view.ts) a déjà tout décidé : phase, mots, moment clé, QR.
 * Ici, on ne fait que la traduire dans le vocabulaire de Google, avec
 * les textes de lib/wallet-copy.ts et rien d'autre : un pass Android dit
 * exactement ce que dit l'iPhone, au même moment.
 *
 *  - FILE → Generic `GENERIC_OTHER`, UNE classe pour toutes les files ;
 *    tout le visible est porté par l'objet (nom du lieu, logo, position).
 *  - DROP → Event ticket, une classe par événement (nom, logo, visuel,
 *    couleur de la marque, lieu, règles) ; l'objet porte le numéro humain
 *    (A-042), la vague, la fenêtre de validité et le QR.
 *
 * Direction « Le Rang en relief » : fond encre #0B0E13, os en texte
 * (Google choisit la couleur du texte d'après le fond), et en image
 * d'en-tête les LATTES de la page client (art/slats.ts) : une latte par
 * personne devant, la latte « Vous » à l'accent de l'établissement, qui
 * avance réellement vers le comptoir d'un état à l'autre. Une URL par état
 * (Google met les images en cache par URL).
 *
 * Minimisation : jamais de prénom (`ticketHolderName` absent), jamais de
 * `merchantLocations` (notifications de proximité surprenantes), jamais
 * de `notifications` automatiques. Seules des URL HTTPS partent chez
 * Google, qui va chercher les images lui-même (aucun téléchargement par
 * notre serveur, donc aucune SSRF).
 *
 * PATCH : les champs gérés sont TOUJOURS envoyés en bloc (Google remplace
 * un tableau en entier) ; `null` efface un champ (image, QR, fenêtre de
 * validité), à confirmer en recette (§ 20 du plan ; repli : TEXT_ONLY).
 * Empreinte : SHA-256 du JSON canonique des champs gérés, SANS le module
 * « Mis à jour » (l'heure du rendu) : même état, même empreinte, aucun
 * appel. De 21 à 400 personnes devant, le pass dit « Plus de 20 » : une
 * seule empreinte, aucun PATCH pendant un drop qui avance au loin.
 */

const LANGUAGE = 'fr';

/** Module « Mis à jour » : hors empreinte (voir en-tête). */
export const UPDATED_MODULE_ID = 'maj';

/** Longueur maximale de `issuerName` d'une classe d'événement. */
export const ISSUER_NAME_MAX = 20;

/** Un message reste au dos du pass 12 h, puis disparaît. */
export const MESSAGE_DISPLAY_MS = 12 * 60 * 60 * 1000;
/** Au-delà, on élague : Google en garde 10 au plus, et le dos doit rester lisible. */
export const MESSAGES_PRUNE_ABOVE = 6;
export const MESSAGES_KEEP = 5;

export function objectTypeFor(kind: WalletKind): GoogleObjectType {
  return kind === 'event' ? 'eventTicketObject' : 'genericObject';
}

export function classTypeFor(kind: WalletKind): GoogleClassType {
  return kind === 'event' ? 'eventTicketClass' : 'genericClass';
}

/* ====================================================================
   Petits constructeurs
   ==================================================================== */

type Localized = { defaultValue: { language: string; value: string } };

export function localized(value: string): Localized {
  return { defaultValue: { language: LANGUAGE, value } };
}

function image(uri: string, description: string): GoogleResource {
  return { sourceUri: { uri }, contentDescription: localized(description) };
}

function textModule(id: string, header: string, body: string): GoogleResource {
  return { id, header, body };
}

/** Coupe proprement une chaîne trop longue (Google tronque sans prévenir). */
export function clip(value: string, max: number): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Date ISO 8601 avec le décalage EXPLICITE du fuseau de l'établissement
 * (« 2026-10-03T10:42:00+02:00 ») : Google l'exige dès qu'un décalage
 * figure dans un intervalle, et le billet doit dire l'heure locale même
 * lu depuis un autre pays. Heure d'été comprise (Intl, jamais un +01:00
 * codé en dur).
 */
export function isoInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Date invalide : ${iso}`);
  const format = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    }).formatToParts(date);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone);
  } catch {
    parts = format('Europe/Paris');
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00';
  const zone = get('timeZoneName');
  const match = /GMT([+-]\d{2}):?(\d{2})?/.exec(zone);
  const offset = match ? `${match[1]}:${match[2] ?? '00'}` : '+00:00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

/* ====================================================================
   Empreinte
   ==================================================================== */

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonical(v);
    }
    return out;
  }
  return value;
}

/** SHA-256 du JSON canonique (clés triées), hors module « Mis à jour ». */
export function renderHash(fields: GoogleResource): string {
  const copy: GoogleResource = { ...fields };
  if (Array.isArray(copy.textModulesData)) {
    copy.textModulesData = (copy.textModulesData as GoogleResource[]).filter((m) => m.id !== UPDATED_MODULE_ID);
  }
  return createHash('sha256').update(JSON.stringify(canonical(copy))).digest('hex');
}

/** Corps d'insertion : les `null` (effacements) n'ont pas de sens à la création. */
export function withoutNulls(fields: GoogleResource): GoogleResource {
  const out: GoogleResource = {};
  for (const [key, value] of Object.entries(fields)) if (value !== null && value !== undefined) out[key] = value;
  return out;
}

/* ====================================================================
   Classes
   ==================================================================== */

const fieldRef = (id: string) => ({ firstValue: { fields: [{ fieldPath: `object.textModulesData['${id}']` }] } });

/**
 * Classe Generic de la file, commune à tous les établissements. Deux
 * lignes sous le titre : « Devant vous | Où en êtes-vous », puis
 * « Arrivée | Mis à jour ». Un seul compte Google par pass
 * (ONE_USER_ALL_DEVICES) : un lien d'enregistrement qui fuite ne permet
 * pas à un inconnu de suivre le ticket.
 */
export function queueClassBody(naming: GoogleNaming): GoogleResource {
  return {
    id: naming.queueClassId,
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          { twoItems: { startItem: fieldRef('devant'), endItem: fieldRef('statut') } },
          { twoItems: { startItem: fieldRef('arrivee'), endItem: fieldRef(UPDATED_MODULE_ID) } },
        ],
      },
    },
  };
}

/** Ce qu'il faut pour dessiner la classe d'un événement (lu en base par sync.ts). */
export interface EventClassInput {
  eventId: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  accentHex: string | null;
  rulesText: string | null;
  startedAt: string | null;
  location: {
    name: string;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    countryCode: string | null;
    timezone: string | null;
    logoUrl: string | null;
  };
  organization: { name: string; logoUrl: string | null; brandAccent: string | null };
}

/** Adresse du lieu, seulement si elle est COMPLÈTE (EventVenue exige nom et adresse). */
function venueOf(location: EventClassInput['location']): GoogleResource | null {
  const line1 = location.addressLine1?.trim();
  const city = location.city?.trim();
  if (!line1 || !city) return null;
  const cityLine = [location.postalCode?.trim(), city].filter(Boolean).join(' ');
  const lines = [line1, location.addressLine2?.trim(), cityLine].filter((l): l is string => Boolean(l));
  return { name: localized(clip(location.name, 80)), address: localized(lines.join('\n')) };
}

function firstHttpsImage(values: Array<string | null | undefined>, siteUrl: string): string | null {
  for (const value of values) {
    const url = publicHttpsUrl(mediaRef(value, siteUrl));
    if (url) return url;
  }
  return null;
}

/**
 * Classe Event ticket d'un drop. Envoyée avec `reviewStatus:
 * UNDER_REVIEW` (Google l'approuve de lui-même), y compris à chaque mise
 * à jour, comme l'exige la documentation. `venue` est omis plutôt
 * qu'inventé si l'adresse est incomplète ; `null` à la mise à jour efface
 * un visuel retiré par l'organisateur.
 */
export function eventClassBody(classId: string, input: EventClassInput, siteUrl: string): GoogleResource {
  const site = siteUrl.replace(/\/+$/, '');
  const palette = eventPalette(input.accentHex, normalizeAccent(input.organization.brandAccent));
  const logo = firstHttpsImage([input.logoUrl, input.location.logoUrl, input.organization.logoUrl], site) ?? rangviaLogoUrl(site);
  const cover = firstHttpsImage([input.coverUrl], site);
  const tz = input.location.timezone || 'Europe/Paris';
  const rules = input.rulesText?.trim();
  return {
    id: classId,
    issuerName: clip(input.location.name, ISSUER_NAME_MAX),
    eventName: localized(clip(input.name, 120)),
    eventId: input.eventId.replace(/-/g, '').toLowerCase(),
    logo: image(logo, input.location.name),
    heroImage: cover ? image(cover, input.name) : null,
    hexBackgroundColor: palette.google.hexBackgroundColor,
    venue: venueOf(input.location),
    dateTime: input.startedAt ? { start: isoInZone(input.startedAt, tz) } : null,
    finePrint: rules ? localized(clip(rules, 2400)) : null,
    countryCode: (input.location.countryCode?.trim() || 'FR').toUpperCase(),
    reviewStatus: 'UNDER_REVIEW',
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
  };
}

/* ====================================================================
   Objets
   ==================================================================== */

export interface GoogleRenderOptions {
  siteUrl: string;
  /** GOOGLE_WALLET_ROTATING_BARCODE : QR TOTP tournant (après recette) ou QR statique signé. */
  rotatingBarcode: boolean;
  now: Date;
  /** Secret des QR (tests) ; par défaut SESSION_HASH_SECRET. */
  qrSecret?: string | null;
}

export interface RenderedObject {
  type: GoogleObjectType;
  id: string;
  classId: string;
  /** Corps du PATCH : bloc complet des champs gérés, `null` = effacer. */
  patch: GoogleResource;
  /** Corps de l'insertion (identifiants compris, sans `null`). */
  insert: GoogleResource;
  hash: string;
}

/** Phases où la file est dessinée : la latte « Vous » et celles devant. */
const HERO_PHASES: ReadonlySet<WalletPhase> = new Set<WalletPhase>([
  'waiting', 'soon', 'one', 'turn', 'serving', 'paused', 'closed', 'event_waiting', 'done',
]);

/** Position dessinée : au comptoir (0) pour le tour, le service et le « Merci ». */
function heroPeopleAhead(view: WalletView, snap: WalletSnapshot): number {
  if (view.phase === 'turn' || view.phase === 'serving' || view.phase === 'done') return 0;
  return Math.max(0, snap.entry.peopleAhead ?? 0);
}

function linksOf(view: WalletView): GoogleResource {
  const uris: GoogleResource[] = [
    { id: 'ticket', uri: view.links.ticket, description: view.kind === 'event' ? WALLET_BACK.openEvent : WALLET_BACK.openTicket },
  ];
  if (view.links.review) uris.push({ id: 'avis', uri: view.links.review, description: WALLET_BACK.review });
  return { uris };
}

/** Modules communs du dos : professionnel, quitter, émetteur, données. */
function backModules(view: WalletView): GoogleResource[] {
  const modules: GoogleResource[] = [];
  if (view.staffName && !view.final) modules.push(textModule('avec', WALLET_LABEL.staff, view.staffName));
  if (!view.final && view.kind === 'queue') modules.push(textModule('quitter', WALLET_LABEL.leave, WALLET_BACK.leave));
  if (view.kind === 'event') modules.push(textModule('validite', WALLET_LABEL.validity, WALLET_BACK.eventValidity));
  modules.push(textModule('emetteur', WALLET_LABEL.issuer, walletIssuerText(view.brand.orgName)));
  modules.push(textModule('donnees', WALLET_LABEL.privacy, WALLET_BACK.privacy));
  return modules;
}

/**
 * Case « Devant vous » de la carte : la position (palier « Plus de 20 »),
 * 0 au tour et pendant le service (le titre dit déjà « C’est votre
 * tour »), un tiret une fois le passage fini ou suspendu (absent).
 */
function aheadValue(view: WalletView): string {
  if (view.position) return view.position.label;
  return view.phase === 'turn' || view.phase === 'serving' ? '0' : '—';
}

function genericFields(snap: WalletSnapshot, view: WalletView, options: GoogleRenderOptions): GoogleResource {
  const site = options.siteUrl.replace(/\/+$/, '');
  const tz = view.times.tz;
  const palette = queuePalette(view.brand.accent);
  const showHero = HERO_PHASES.has(view.phase);

  const modules: GoogleResource[] = [
    textModule('devant', WALLET_LABEL.ahead, aheadValue(view)),
    textModule('statut', WALLET_LABEL.status, view.statusText),
    textModule('arrivee', WALLET_LABEL.arrival, walletTime(view.times.joinedAt, tz)),
    textModule(UPDATED_MODULE_ID, WALLET_LABEL.updated, walletTime(options.now, tz)),
    ...backModules(view),
  ];

  return {
    genericType: 'GENERIC_OTHER',
    state: view.googleState,
    cardTitle: localized(clip(view.brand.placeName, 60)),
    header: localized(view.headline),
    logo: image(view.brand.logoPublicUrl ?? rangviaLogoUrl(site), view.brand.placeName),
    hexBackgroundColor: palette.google.hexBackgroundColor,
    heroImage: showHero
      ? image(heroUrl(site, heroPeopleAhead(view, snap), view.brand.accent), view.headline)
      : null,
    textModulesData: modules,
    linksModuleData: linksOf(view),
  };
}

/** QR du billet : seulement en accès ouvert ET si le contrôle accepte le QR Wallet. */
function barcodeFields(snap: WalletSnapshot, view: WalletView, options: GoogleRenderOptions): { barcode: GoogleResource | null; rotatingBarcode: GoogleResource | null } {
  if (!view.qr || !view.qr.allowWallet) return { barcode: null, rotatingBarcode: null };
  const site = options.siteUrl.replace(/\/+$/, '');
  const alternateText = eventQrAltText(view.event?.ticketNumber ?? null, view.event?.wave ?? null);
  if (options.rotatingBarcode) {
    // Google génère le code HORS LIGNE (RFC 6238, SHA-1, 8 chiffres,
    // 30 s) : la clé propre à ce pass ne voyage que dans l'objet, jamais
    // dans le JWT d'enregistrement.
    return {
      barcode: null,
      rotatingBarcode: {
        type: 'QR_CODE',
        valuePattern: walletTotpPattern(site, view.qr.publicId),
        alternateText,
        totpDetails: {
          algorithm: 'TOTP_SHA1',
          periodMillis: '30000',
          parameters: [{ key: walletTotpKey(view.qr.tokenHash, snap.pass.id, options.qrSecret), valueLength: 8 }],
        },
      },
    };
  }
  return {
    barcode: {
      type: 'QR_CODE',
      value: walletQrUrl(site, view.qr.publicId, signWalletQrCode(view.qr.tokenHash, snap.pass.id, options.qrSecret)),
      alternateText,
    },
    rotatingBarcode: null,
  };
}

function ticketTypeText(view: WalletView): string {
  switch (view.phase) {
    case 'event_access':
      return eventWaveLabel(view.event?.wave ?? null) ?? view.headline;
    case 'event_waiting':
      return WALLET_STATUS.eventWaiting;
    default:
      return view.headline;
  }
}

function eventFields(snap: WalletSnapshot, view: WalletView, options: GoogleRenderOptions): GoogleResource {
  const tz = view.times.tz;
  const modules: GoogleResource[] = [textModule('statut', WALLET_LABEL.status, view.statusText)];
  if (view.position) modules.push(textModule('devant', WALLET_LABEL.ahead, view.position.label));
  if (view.times.limitAt) modules.push(textModule('limite', WALLET_LABEL.until, walletTime(view.times.limitAt, tz)));
  if (view.times.graceUntil) modules.push(textModule('tolerance', WALLET_LABEL.grace, walletTime(view.times.graceUntil, tz)));
  if (view.qr && !view.qr.allowWallet) modules.push(textModule('controle', WALLET_LABEL.todo, WALLET_OFFER_COPY.qrNotAccepted));
  modules.push(textModule(UPDATED_MODULE_ID, WALLET_LABEL.updated, walletTime(options.now, tz)));
  modules.push(...backModules(view));

  // Fenêtre de validité = l'accès en cours (émis → fin de tolérance).
  const access = view.phase === 'event_access' && snap.access ? snap.access : null;
  return {
    state: view.googleState,
    ticketNumber: view.event?.ticketNumber ?? null,
    ticketType: localized(ticketTypeText(view)),
    validTimeInterval: access
      ? { start: { date: isoInZone(access.issuedAt, tz) }, end: { date: isoInZone(access.graceUntil, tz) } }
      : null,
    ...barcodeFields(snap, view, options),
    // Capture d'écran interdite : le QR se présente depuis le Wallet.
    passConstraints: { screenshotEligibility: 'INELIGIBLE' },
    textModulesData: modules,
    linksModuleData: linksOf(view),
  };
}

export function renderGoogleObject(snap: WalletSnapshot, view: WalletView, options: GoogleRenderOptions): RenderedObject {
  const type = objectTypeFor(snap.pass.kind);
  const patch = type === 'eventTicketObject' ? eventFields(snap, view, options) : genericFields(snap, view, options);
  const ids = { id: snap.pass.externalId, classId: snap.pass.classRef };
  return {
    type,
    ...ids,
    patch,
    insert: { ...ids, ...withoutNulls(patch) },
    hash: renderHash(patch),
  };
}

/** Identifiant du message laissé par l'effacement. */
export const SCRUB_MESSAGE_ID = 'efface';

/**
 * PATCH d'effacement (purge RGPD, 24 h après la fin du passage).
 * L'API n'a pas de suppression d'objet : on remplace tout ce qui décrit
 * le passage (titre « Ticket clos », modules, liens, messages, image, QR,
 * numéro), et l'on garde un état final (le pass reste rangé dans les
 * passes passés). Un pass encore actif (organisation supprimée) passe
 * INACTIVE.
 *
 * Les tableaux ne sont JAMAIS envoyés vides : en JSON proto3, un tableau
 * vide peut se lire comme « champ absent », et un PATCH l'ignorerait
 * (même doute que pour `null`, § 20 du plan). Le lien d'avis, qui porte
 * l'identifiant public du ticket, resterait alors au dos du pass. On
 * envoie donc un seul élément neutre par tableau : un tableau NON vide
 * remplace celui de Google en entier, règle déjà éprouvée par chaque
 * mise à jour.
 */
export function renderScrubPatch(
  snap: WalletSnapshot,
  view: Pick<WalletView, 'googleState'>,
  options: Pick<GoogleRenderOptions, 'siteUrl'>,
): { type: GoogleObjectType; id: string; patch: GoogleResource; hash: string } {
  const type = objectTypeFor(snap.pass.kind);
  const state = view.googleState === 'ACTIVE' ? 'INACTIVE' : view.googleState;
  const site = options.siteUrl.replace(/\/+$/, '');
  const common = {
    state,
    textModulesData: [textModule('donnees', WALLET_LABEL.privacy, WALLET_BACK.privacy)],
    linksModuleData: { uris: [{ id: 'rangvia', uri: `${site}/`, description: 'Rangvia' }] },
    // Sans displayInterval ni sonnerie : il remplace les messages du passage.
    messages: [{ id: SCRUB_MESSAGE_ID, header: WALLET_BACK.scrubbedHeader, body: WALLET_BACK.privacy, messageType: 'TEXT' }],
  };
  const patch: GoogleResource = type === 'eventTicketObject'
    ? {
        ...common,
        ticketType: localized(WALLET_BACK.scrubbedHeader),
        ticketNumber: null,
        validTimeInterval: null,
        barcode: null,
        rotatingBarcode: null,
      }
    : {
        ...common,
        header: localized(WALLET_BACK.scrubbedHeader),
        heroImage: null,
      };
  return { type, id: snap.pass.externalId, patch, hash: renderHash(patch) };
}

/* ====================================================================
   Messages (addMessage)
   ==================================================================== */

/**
 * Identifiant du message : le moment clé, suffixé d'un repère STABLE
 * quand le moteur peut rouvrir ce moment (report, restauration, nouvelle
 * vague, TERMINER annulé puis refait). Un envoi rejoué garde le même
 * identifiant (Google répond 409, ou le message est retrouvé sur
 * l'objet) ; un moment rouvert en a un nouveau et sonne à nouveau.
 */
export function messageId(kind: AlertKind, snap: WalletSnapshot): string {
  const stamp = (iso: string | null | undefined): string | null => {
    const t = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(t) ? Math.floor(t / 1000).toString(36) : null;
  };
  let marker: string | null = null;
  switch (kind) {
    case 'ahead_two':
    case 'ahead_one':
    case 'your_turn':
      marker = stamp(snap.entry.rankResetAt);
      break;
    case 'visit_completed':
      marker = stamp(snap.entry.completedAt);
      break;
    case 'removed':
      marker = stamp(snap.entry.statusChangedAt);
      break;
    case 'event_access':
      marker = stamp(snap.access?.issuedAt);
      break;
    default:
      marker = null;
  }
  return marker ? `${kind}-${marker}` : kind;
}

export function buildAlertMessage(
  kind: AlertKind,
  notify: boolean,
  snap: WalletSnapshot,
  view: Pick<WalletView, 'brand'>,
  now: Date,
): GoogleMessage {
  const text = walletAlertText(kind, { placeName: view.brand.placeName, peopleAhead: snap.entry.peopleAhead });
  return {
    id: messageId(kind, snap),
    header: text.header,
    body: text.body,
    messageType: notify ? 'TEXT_AND_NOTIFY' : 'TEXT',
    displayInterval: {
      start: { date: now.toISOString() },
      end: { date: new Date(now.getTime() + MESSAGE_DISPLAY_MS).toISOString() },
    },
  };
}

/**
 * Messages à garder quand le dos du pass en compte trop : les plus
 * récents, tous rétrogradés en TEXT (un PATCH ne doit rien refaire
 * sonner). Null : rien à élaguer.
 *
 * `incoming` : messages sur le point d'être ajoutés. L'élagage se fait
 * AVANT l'addMessage (sur la lecture qui vérifie déjà l'absence du
 * message) : 6 messages au dos + 1 à venir → on en garde 5.
 */
export function prunedMessages(messages: unknown, incoming = 0): GoogleResource[] | null {
  if (!Array.isArray(messages) || messages.length + incoming <= MESSAGES_PRUNE_ABOVE) return null;
  const startOf = (m: GoogleResource): number => {
    const interval = m.displayInterval as { start?: { date?: string } } | undefined;
    const t = interval?.start?.date ? Date.parse(interval.start.date) : Number.NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const indexed = (messages as GoogleResource[]).map((m, index) => ({ m, index }));
  indexed.sort((a, b) => startOf(b.m) - startOf(a.m) || b.index - a.index);
  return indexed
    .slice(0, MESSAGES_KEEP)
    .sort((a, b) => a.index - b.index)
    .map(({ m }) => ({ ...m, messageType: 'TEXT' }));
}
