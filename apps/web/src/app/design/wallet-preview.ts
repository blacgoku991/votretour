import { buildWalletView } from '@/server/wallet/view';
import { renderApplePassJson, passPalette, type AppleField, type ApplePassJson } from '@/server/wallet/apple/render';
import { eventClassBody, renderGoogleObject, UPDATED_MODULE_ID } from '@/server/wallet/google/objects';
import { signWalletQrCode, walletQrUrl } from '@/lib/wallet/scan-proof';
import type { WalletPhase, WalletSnapshot, WalletView } from '@/server/wallet/types';

/**
 * APERÇU DES PASSES WALLET pour la planche /design (lot W4).
 *
 * Aucune maquette : chaque pass est produit par le code qui fabrique les
 * vrais passes. Instantané → buildWalletView() → renderApplePassJson()
 * (pass.json Apple) et renderGoogleObject() + eventClassBody() (objet et
 * classe Google). La planche ne fait que DESSINER ces champs, à la façon
 * de chaque Wallet. Si un texte, une couleur ou un QR change dans le
 * rendu, il change ici.
 *
 * Billets d'événement SEULEMENT (décision du propriétaire : le Wallet ne
 * sert qu'aux drops, pour le contrôle d'entrée). Tout est fictif et figé :
 * site en .invalid, secret de QR d'aperçu, identifiants factices. Les QR
 * dessinés ne passent donc aucun contrôle.
 */

const SITE = 'https://apercu.rangvia.invalid';
const PREVIEW_SECRET = 'apercu-planche-design-sans-valeur';
/** Heure figée : l'aperçu ne bouge pas d'un rendu à l'autre. */
const AT = '2026-09-24T12:30:00Z';

type Access = NonNullable<WalletSnapshot['access']>;

const ISSUED: Access = {
  publicId: 'ApercuAcces0000001',
  tokenHash: 'a'.repeat(64),
  status: 'issued',
  issuedAt: '2026-09-24T12:25:00Z',
  validUntil: '2026-09-24T12:40:00Z',
  graceUntil: '2026-09-24T12:45:00Z',
  redeemedAt: null,
  revokedAt: null,
  wave: 3,
};

function snapshot(over: {
  entry?: Partial<WalletSnapshot['entry']>;
  event?: Partial<NonNullable<WalletSnapshot['event']>>;
  access?: Access | null;
}): WalletSnapshot {
  return {
    pass: {
      id: '00000000-0000-4000-8000-00000000a0e1',
      provider: 'apple',
      kind: 'event',
      externalId: '3388000000000000000.apercu_e_0001',
      classRef: '3388000000000000000.apercu_evenement',
      state: 'active',
      live: true,
      holderState: 'saved',
      versionSeq: 1,
      versionAt: AT,
      contentHash: null,
      syncedHash: null,
      lastSyncedAt: null,
      alerts: {},
      notifyLog: [],
      downloadCount: 1,
      finalAt: null,
      revokedAt: null,
      scrubbedAt: null,
      createdAt: '2026-09-24T12:02:00Z',
    },
    entry: {
      publicId: 'ApercuBillet01',
      status: 'waiting',
      peopleAhead: 14,
      joinedAt: '2026-09-24T12:02:00Z',
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      cancelledAt: null,
      expiredAt: null,
      absentAt: null,
      eventTicketNumber: 42,
      staffName: null,
      statusActor: 'client',
      statusEvent: 'join',
      statusChangedAt: '2026-09-24T12:02:00Z',
      ...over.entry,
    },
    queue: {
      id: '00000000-0000-4000-8000-0000000000f1',
      status: 'open',
      mode: 'shared',
      notifyAheadThreshold: 2,
      entryTtlMinutes: 240,
    },
    location: {
      id: '00000000-0000-4000-8000-0000000000c1',
      name: 'Barber House Bastille',
      slug: 'apercu',
      addressLine1: '12 rue de la Roquette',
      addressLine2: null,
      postalCode: '75011',
      city: 'Paris',
      countryCode: 'FR',
      latitude: null,
      longitude: null,
      timezone: 'Europe/Paris',
      logoUrl: null,
      coverUrl: null,
      hasReviewUrl: false,
    },
    organization: {
      id: '00000000-0000-4000-8000-0000000000b1',
      name: 'Barber House',
      logoUrl: null,
      brandAccent: 'cobalt',
      walletEnabled: true,
      sendCompletionReview: false,
    },
    event: {
      id: '00000000-0000-4000-8000-0000000000e1',
      name: 'Drop Aurore',
      heroTitle: null,
      logoUrl: null,
      coverUrl: null,
      accentHex: '#3A63D8',
      rulesText: 'Une paire par personne.',
      status: 'live',
      startedAt: '2026-09-24T12:00:00Z',
      endedAt: null,
      walletQrEnabled: true,
      ...over.event,
    },
    access: over.access === undefined ? null : over.access,
    deliveredKinds: {},
    at: AT,
  };
}

/** Les états clés d'un billet d'événement, dans l'ordre de sa vie. */
const STATES: ReadonlyArray<{ key: string; label: string; note: string; snap: WalletSnapshot }> = [
  {
    key: 'attente',
    label: 'En attente de la vague',
    note: 'Aucune alerte de position en mode Événement : seule la vague fait venir le client.',
    snap: snapshot({}),
  },
  {
    key: 'acces',
    label: 'Accès ouvert',
    note: 'Alerte à l’ouverture de l’accès. Le QR n’existe que pendant la fenêtre, et seulement si le contrôle l’accepte.',
    snap: snapshot({ entry: { status: 'notified', peopleAhead: 0 }, access: ISSUED }),
  },
  {
    key: 'refuse',
    label: 'Accès ouvert, QR Wallet refusé',
    note: 'Réglage de l’événement : pas de QR sur le pass, la consigne renvoie vers la page.',
    snap: snapshot({ entry: { status: 'notified', peopleAhead: 0 }, access: ISSUED, event: { walletQrEnabled: false } }),
  },
  {
    key: 'utilise',
    label: 'Utilisé',
    note: 'Premier passage au contrôle : le pass est annulé, sans alerte.',
    snap: snapshot({
      entry: { status: 'completed', peopleAhead: 0, completedAt: '2026-09-24T12:36:00Z' },
      access: { ...ISSUED, status: 'redeemed', redeemedAt: '2026-09-24T12:36:00Z' },
    }),
  },
  {
    key: 'complet',
    label: 'Stock épuisé',
    note: 'Fin du drop : mêmes mots que la notification.',
    snap: snapshot({
      entry: { status: 'cancelled', statusActor: 'staff', statusEvent: 'event_sold_out' },
      event: { status: 'sold_out' },
    }),
  },
];

/* ====================================================================
   Ce que la planche dessine
   ==================================================================== */

export interface PreviewField {
  key: string;
  label: string | null;
  value: string;
  align: 'start' | 'end';
}

export interface ApplePreview {
  background: string;
  foreground: string;
  label: string;
  logoText: string | null;
  header: PreviewField[];
  primary: PreviewField[];
  secondary: PreviewField[];
  auxiliary: PreviewField[];
  qr: { message: string; altText: string } | null;
  /** Consigne du dos quand le contrôle refuse le QR Wallet (champ `controle`). */
  backNote: string | null;
  voided: boolean;
}

export interface GooglePreview {
  background: string;
  foreground: string;
  issuerName: string;
  eventName: string;
  ticketType: string;
  ticketNumber: string | null;
  modules: Array<{ id: string; header: string; body: string }>;
  qr: { value: string; altText: string } | null;
  state: string;
}

export interface WalletPreviewState {
  key: string;
  label: string;
  note: string;
  phase: WalletPhase;
  headline: string;
  apple: ApplePreview;
  google: GooglePreview;
}

const tz = 'Europe/Paris';
const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz });

/** Valeur d'un champ Apple telle que Wallet l'affiche (dates en heure locale). */
function appleValue(field: AppleField): string {
  if (field.timeStyle && field.timeStyle !== 'PKDateStyleNone' && typeof field.value === 'string') {
    return timeFormat.format(new Date(field.value));
  }
  return String(field.value);
}

function fields(list: AppleField[] | undefined): PreviewField[] {
  return (list ?? []).map((field) => ({
    key: field.key,
    label: field.label ?? null,
    value: appleValue(field),
    align: field.textAlignment === 'PKTextAlignmentRight' ? 'end' : 'start',
  }));
}

function applePreview(pass: ApplePassJson): ApplePreview {
  const set = pass.eventTicket ?? pass.generic;
  const barcode = pass.barcodes?.[0];
  return {
    background: pass.backgroundColor,
    foreground: pass.foregroundColor,
    label: pass.labelColor,
    logoText: pass.logoText ?? null,
    header: fields(set?.headerFields),
    primary: fields(set?.primaryFields),
    secondary: fields(set?.secondaryFields),
    auxiliary: fields(set?.auxiliaryFields),
    qr: barcode ? { message: barcode.message, altText: barcode.altText } : null,
    backNote: (() => {
      const field = set?.backFields.find((f) => f.key === 'controle');
      return field ? String(field.value) : null;
    })(),
    voided: pass.voided === true,
  };
}

const text = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  const localizedValue = (value as { defaultValue?: { value?: unknown } } | null)?.defaultValue?.value;
  return typeof localizedValue === 'string' ? localizedValue : null;
};

function googlePreview(view: WalletView, snap: WalletSnapshot, foreground: string): GooglePreview {
  const object = renderGoogleObject(snap, view, {
    siteUrl: SITE,
    rotatingBarcode: false,
    now: new Date(AT),
    qrSecret: PREVIEW_SECRET,
  }).patch as Record<string, unknown>;
  const event = snap.event!;
  const klass = eventClassBody(snap.pass.classRef, {
    eventId: event.id,
    name: event.name,
    logoUrl: event.logoUrl,
    coverUrl: event.coverUrl,
    accentHex: event.accentHex,
    rulesText: event.rulesText,
    startedAt: event.startedAt,
    location: { ...snap.location, logoUrl: snap.location.logoUrl },
    organization: { name: snap.organization.name, logoUrl: snap.organization.logoUrl, brandAccent: snap.organization.brandAccent },
  }, SITE) as Record<string, unknown>;

  // Recto de la carte : les modules jusqu'à « Mis à jour » ; la suite
  // (validité, émetteur, données) est au dos, dans les détails.
  const modules: GooglePreview['modules'] = [];
  for (const raw of (object.textModulesData as Array<Record<string, unknown>> | undefined) ?? []) {
    if (raw.id === UPDATED_MODULE_ID) break;
    modules.push({ id: String(raw.id), header: String(raw.header ?? ''), body: String(raw.body ?? '') });
  }
  const barcode = object.barcode as { value?: string; alternateText?: string } | null | undefined;
  return {
    background: String(klass.hexBackgroundColor),
    foreground,
    issuerName: String(klass.issuerName ?? ''),
    eventName: text(klass.eventName) ?? event.name,
    ticketType: text(object.ticketType) ?? view.headline,
    ticketNumber: typeof object.ticketNumber === 'string' ? object.ticketNumber : null,
    modules,
    qr: barcode?.value ? { value: barcode.value, altText: barcode.alternateText ?? '' } : null,
    state: String(object.state ?? 'ACTIVE'),
  };
}

export function walletPreviewStates(): WalletPreviewState[] {
  const now = new Date(AT);
  return STATES.map(({ key, label, note, snap }) => {
    const view = buildWalletView(snap, now, { siteUrl: SITE });
    const qrMessage = view.qr?.allowWallet
      ? walletQrUrl(SITE, view.qr.publicId, signWalletQrCode(view.qr.tokenHash, snap.pass.id, PREVIEW_SECRET))
      : null;
    const pass = renderApplePassJson(view, snap, {
      passTypeId: 'pass.invalid.apercu',
      teamId: 'APERCU0000',
      serial: 'Apercu0000000000000000',
      authenticationToken: 'apercu-sans-valeur-0000',
      webServiceUrl: `${SITE}/api/wallet/apple`,
      alert: null,
      qrMessage,
      hasBrandLogo: false,
    });
    const palette = passPalette(view);
    return {
      key,
      label,
      note,
      phase: view.phase,
      headline: view.headline,
      apple: applePreview(pass),
      google: googlePreview(view, snap, palette.foreground),
    };
  });
}
