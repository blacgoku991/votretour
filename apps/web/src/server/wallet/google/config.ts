import { z } from 'zod';

/**
 * Configuration Google Wallet, validée par zod.
 *
 * lib/env.ts lit les variables (et décode le JSON du compte de service
 * s'il était en base64) ; ce module dit si elles forment une
 * configuration UTILISABLE, et sinon pourquoi, en une phrase lisible par
 * l'exploitant (carte « Passes Wallet » du super-admin). Une configuration
 * invalide ne fait jamais planter l'application : le fournisseur se
 * déclare « non prêt » et aucun bouton n'apparaît.
 *
 * Fonction pure (`parseGoogleWalletConfig`) : testée sans toucher à
 * process.env. `googleWalletConfig()` l'applique à l'environnement réel.
 */

export const WALLET_OBJECT_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
export const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

/**
 * Clé JSON d'un compte de service Google Cloud. Seuls les champs utiles
 * sont gardés : le reste (project_id, client_id…) n'est jamais recopié.
 */
const serviceAccountSchema = z.object({
  type: z.literal('service_account', { message: 'le champ « type » doit valoir « service_account »' }).optional(),
  client_email: z
    .string({ message: 'client_email manquant' })
    .trim()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'client_email invalide'),
  private_key: z
    .string({ message: 'private_key manquante' })
    .transform((value) => value.replace(/\\n/g, '\n').trim())
    .refine((value) => /-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(value), {
      message: 'private_key n’est pas une clé PKCS#8 (-----BEGIN PRIVATE KEY-----)',
    }),
  private_key_id: z
    .string({ message: 'private_key_id manquant' })
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,128}$/, 'private_key_id invalide'),
  // Google n'émet que vers son propre serveur de jetons : une autre
  // adresse recevrait notre assertion signée.
  token_uri: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || DEFAULT_TOKEN_URI)
    .refine((value) => /^https:\/\/(oauth2|accounts)\.googleapis\.com\/[\w./-]*$/.test(value), {
      message: 'token_uri doit pointer vers oauth2.googleapis.com',
    }),
});

export interface GoogleServiceAccount {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string;
  tokenUri: string;
}

export interface GoogleWalletConfig {
  issuerId: string;
  serviceAccount: GoogleServiceAccount;
  mode: 'demo' | 'production';
  classPrefix: string;
  rotatingBarcode: boolean;
  /** Racine publique du site (HTTPS), sans barre finale. */
  siteUrl: string;
  /** Origine déclarée dans le JWT d'enregistrement (`origins`). */
  origin: string;
  /** Identifiants dérivés : une seule source pour l'émission et la synchronisation. */
  naming: GoogleNaming;
}

export interface GoogleNaming {
  /** `{issuer}.{prefix}_file_v1` : UNE classe Generic pour toutes les files. */
  queueClassId: string;
  /** `{issuer}.{prefix}_evt_` + identifiant d'événement sans tirets. */
  eventClassPrefix: string;
  /** `{issuer}.{prefix}_` + `q_`/`e_` + 32 hexadécimaux (wallet_issue_pass). */
  objectPrefix: string;
}

export interface GoogleWalletEnvInput {
  issuerId: string | null | undefined;
  /** JSON brut (déjà décodé de base64 par lib/env.ts), ou null. */
  serviceAccountJson: string | null | undefined;
  mode: string | null | undefined;
  classPrefix: string | null | undefined;
  rotatingBarcode: boolean | null | undefined;
  siteUrl: string;
  /** SESSION_HASH_SECRET : dérive les QR des billets (lib/wallet/scan-proof.ts). */
  sessionSecretPresent: boolean;
}

export type GoogleWalletConfigResult =
  | { ok: true; config: GoogleWalletConfig }
  | {
      ok: false;
      /** Au moins une variable Google renseignée : c'est une erreur, pas un choix. */
      configured: boolean;
      reason: string;
      mode: 'demo' | 'production';
    };

const ISSUER_ID = /^\d{5,30}$/;
/** Suffixe d'identifiant Google : [A-Za-z0-9._-]. Pas de point ici : il séparerait l'émetteur. */
const CLASS_PREFIX = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export function googleNaming(issuerId: string, classPrefix: string): GoogleNaming {
  return {
    queueClassId: `${issuerId}.${classPrefix}_file_v1`,
    eventClassPrefix: `${issuerId}.${classPrefix}_evt_`,
    objectPrefix: `${issuerId}.${classPrefix}_`,
  };
}

/** Classe d'un événement : `{issuer}.{prefix}_evt_{uuid sans tirets}` (même règle qu'en SQL). */
export function eventClassId(naming: GoogleNaming, eventId: string): string {
  return `${naming.eventClassPrefix}${eventId.replace(/-/g, '').toLowerCase()}`;
}

function normalizeMode(value: string | null | undefined): 'demo' | 'production' {
  // Tout ce qui n'est pas exactement « production » vaut démo : le mode
  // sans risque (bouton réservé aux membres, passes « [TEST ONLY] »).
  return value?.trim().toLowerCase() === 'production' ? 'production' : 'demo';
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? 'clé JSON du compte de service invalide';
}

export function parseGoogleWalletConfig(input: GoogleWalletEnvInput): GoogleWalletConfigResult {
  const mode = normalizeMode(input.mode);
  const issuerId = input.issuerId?.trim() || null;
  const rawJson = input.serviceAccountJson?.trim() || null;
  const configured = Boolean(issuerId || rawJson);

  const missing: string[] = [];
  if (!issuerId) missing.push('GOOGLE_WALLET_ISSUER_ID');
  if (!rawJson) missing.push('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON');
  if (missing.length > 0) {
    return { ok: false, configured, mode, reason: `Variables manquantes : ${missing.join(', ')}` };
  }

  if (!ISSUER_ID.test(issuerId!)) {
    return { ok: false, configured, mode, reason: 'GOOGLE_WALLET_ISSUER_ID doit être l’identifiant numérique de l’émetteur (Google Pay & Wallet Console)' };
  }

  const classPrefix = input.classPrefix?.trim() || 'rangvia';
  if (!CLASS_PREFIX.test(classPrefix)) {
    return { ok: false, configured, mode, reason: 'GOOGLE_WALLET_CLASS_PREFIX : une lettre, puis lettres, chiffres, « _ » ou « - » (40 caractères au plus)' };
  }

  let json: unknown;
  try {
    json = JSON.parse(rawJson!);
  } catch {
    return { ok: false, configured, mode, reason: 'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON n’est pas un JSON valide (ni en clair, ni en base64)' };
  }
  const parsed = serviceAccountSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, configured, mode, reason: `Compte de service Google : ${firstIssue(parsed.error)}` };
  }

  // Google télécharge lui-même logos et images d'en-tête, et n'accepte
  // que des origines HTTPS dans le lien d'enregistrement.
  let site: URL;
  try {
    site = new URL(input.siteUrl);
  } catch {
    return { ok: false, configured, mode, reason: 'NEXT_PUBLIC_SITE_URL illisible' };
  }
  if (site.protocol !== 'https:') {
    return { ok: false, configured, mode, reason: 'NEXT_PUBLIC_SITE_URL doit être en HTTPS : Google télécharge les images du pass et refuse une origine en clair' };
  }

  if (!input.sessionSecretPresent) {
    return { ok: false, configured, mode, reason: 'SESSION_HASH_SECRET manquant : les QR des billets Wallet ne peuvent pas être signés' };
  }

  return {
    ok: true,
    config: {
      issuerId: issuerId!,
      serviceAccount: {
        clientEmail: parsed.data.client_email,
        privateKey: parsed.data.private_key,
        privateKeyId: parsed.data.private_key_id,
        tokenUri: parsed.data.token_uri,
      },
      mode,
      classPrefix,
      rotatingBarcode: input.rotatingBarcode === true,
      siteUrl: input.siteUrl.replace(/\/+$/, ''),
      origin: site.origin,
      naming: googleNaming(issuerId!, classPrefix),
    },
  };
}

/** Détails publiables (carte super-admin) : jamais la clé, jamais l'e-mail du compte. */
export function publicConfigDetails(result: GoogleWalletConfigResult): Record<string, unknown> {
  if (!result.ok) return { mode: result.mode, configured: result.configured };
  const { config } = result;
  return {
    mode: config.mode,
    configured: true,
    issuerId: config.issuerId,
    classPrefix: config.classPrefix,
    queueClassId: config.naming.queueClassId,
    rotatingBarcode: config.rotatingBarcode,
  };
}
