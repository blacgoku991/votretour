/**
 * Configuration d'environnement.
 *
 * Deux niveaux volontairement distincts :
 *  - le NOYAU (Supabase, URL du site, secret de hachage) est obligatoire :
 *    sans lui l'application n'a aucun sens et on échoue au démarrage ;
 *  - les INTÉGRATIONS (APNs, Web Push, Stripe, Apple Wallet, Google
 *    Wallet) sont facultatives. Leur
 *    absence n'empêche pas de lancer le produit : elle désactive
 *    proprement la fonctionnalité et le dit explicitement, au lieu de
 *    faire semblant d'envoyer une notification.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Variable d'environnement manquante : ${name}. Voir apps/web/.env.example et SETUP.md.`,
    );
  }
  return value.trim();
}

function optional(value: string | undefined): string | null {
  const v = value?.trim();
  return v && v.length > 0 ? v : null;
}

/**
 * Bloc PEM : accepte le PEM brut (retours à la ligne réels ou « \\n ») ou
 * sa version encodée en base64, plus simple à coller dans un .env. Seuls
 * les types attendus sont acceptés : un certificat collé à la place d'une
 * clé est refusé ici plutôt qu'au premier envoi.
 */
function readPem(value: string | undefined, markers: readonly string[]): string | null {
  const raw = optional(value);
  if (!raw) return null;
  const matches = (text: string) => markers.some((marker) => text.includes(`BEGIN ${marker}`));
  if (matches(raw)) return raw.replace(/\\n/g, '\n');
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (matches(decoded)) return decoded;
  } catch {
    /* on retombe sur l'erreur explicite ci-dessous */
  }
  return null;
}

/** Clé privée APNs : accepte le PEM brut ou une version encodée en base64. */
function readPrivateKey(value: string | undefined): string | null {
  return readPem(value, ['PRIVATE KEY']);
}

/** Clé JSON d'un compte de service Google : JSON brut ou base64. */
function readJson(value: string | undefined): string | null {
  const raw = optional(value);
  if (!raw) return null;
  if (raw.startsWith('{')) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    if (decoded.startsWith('{')) return decoded;
  } catch {
    /* invalide : signalé comme « non configuré » */
  }
  return null;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  const v = optional(value)?.toLowerCase();
  if (v === undefined || v === null) return fallback;
  return v === 'true' || v === '1' || v === 'oui' || v === 'yes';
}

function siteUrl(): string {
  const explicit = optional(process.env.NEXT_PUBLIC_SITE_URL);
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = optional(process.env.VERCEL_PROJECT_PRODUCTION_URL) ?? optional(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

export const env = {
  siteUrl: siteUrl(),
  isProduction: process.env.NODE_ENV === 'production',

  supabase: {
    url: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    /** Jamais exposée au navigateur : usage serveur exclusif. */
    serviceRoleKey: optional(process.env.SUPABASE_SERVICE_ROLE_KEY),
  },

  /**
   * Poivre appliqué au hachage des jetons de session client et des
   * adresses IP. Sans lui, une fuite de base permettrait de rejouer un
   * jeton ; avec lui, il faut aussi le secret serveur.
   */
  sessionSecret: optional(process.env.SESSION_HASH_SECRET),

  webPush: {
    publicKey: optional(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    privateKey: optional(process.env.VAPID_PRIVATE_KEY),
    subject: optional(process.env.VAPID_SUBJECT) ?? 'mailto:contact@votretour.app',
  },

  apns: {
    keyId: optional(process.env.APNS_KEY_ID),
    teamId: optional(process.env.APNS_TEAM_ID),
    privateKey: readPrivateKey(process.env.APNS_PRIVATE_KEY),
    /** Bundle ID de l'application complète. */
    bundleId: optional(process.env.APNS_BUNDLE_ID) ?? 'app.votretour.ios',
    /** Bundle ID de l'App Clip : c'est LUI le topic APNs des pushes App Clip. */
    clipBundleId: optional(process.env.APNS_CLIP_BUNDLE_ID) ?? 'app.votretour.ios.Clip',
    environment: (optional(process.env.APNS_ENVIRONMENT) ?? 'sandbox') as 'sandbox' | 'production',
  },

  apple: {
    /** <TeamID>.<BundleID> de l'app, pour apple-app-site-association. */
    appId: optional(process.env.APPLE_APP_ID),
    clipAppId: optional(process.env.APPLE_CLIP_APP_ID),
  },

  stripe: {
    secretKey: optional(process.env.STRIPE_SECRET_KEY),
    webhookSecret: optional(process.env.STRIPE_WEBHOOK_SECRET),
    publishableKey: optional(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
  },

  /**
   * APPLE WALLET (facultatif). Sans ces valeurs : aucun bouton, service
   * web en 404, aucune simulation. La validité réelle (UID du certificat,
   * clé ↔ certificat, WWDR, expiration) est contrôlée par le fournisseur
   * (server/wallet/apple), pas ici.
   */
  appleWallet: {
    passTypeId: optional(process.env.APPLE_WALLET_PASS_TYPE_ID),
    certPem: readPem(process.env.APPLE_WALLET_CERT_PEM, ['CERTIFICATE']),
    keyPem: readPem(process.env.APPLE_WALLET_KEY_PEM, ['ENCRYPTED PRIVATE KEY', 'PRIVATE KEY', 'RSA PRIVATE KEY']),
    keyPassphrase: optional(process.env.APPLE_WALLET_KEY_PASSPHRASE),
    wwdrPem: readPem(process.env.APPLE_WALLET_WWDR_PEM, ['CERTIFICATE']),
    /** Surcharge facultative : par défaut, lu dans le certificat (OU=). */
    teamId: optional(process.env.APPLE_WALLET_TEAM_ID),
  },

  /** GOOGLE WALLET (facultatif). Même règle : sans valeurs, rien ne s'affiche. */
  googleWallet: {
    issuerId: optional(process.env.GOOGLE_WALLET_ISSUER_ID),
    /** JSON du compte de service (décodé s'il était en base64), jamais journalisé. */
    serviceAccountJson: readJson(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON),
    /** demo : testeurs déclarés seulement ; production : après accord de Google. */
    mode: (optional(process.env.GOOGLE_WALLET_MODE)?.toLowerCase() === 'production' ? 'production' : 'demo') as
      'demo' | 'production',
    /** rangvia_staging en préproduction : ne jamais mélanger deux environnements. */
    classPrefix: optional(process.env.GOOGLE_WALLET_CLASS_PREFIX) ?? 'rangvia',
    /** QR TOTP tournant : seulement après validation en recette. */
    rotatingBarcode: flag(process.env.GOOGLE_WALLET_ROTATING_BARCODE, false),
  },

  /**
   * Secret des jetons ApplePass (service web Apple Wallet), généré par
   * deploy/scripts/bootstrap.sh. Vide : dérivé de SESSION_HASH_SECRET par
   * walletAuthSecret() (server/wallet/providers.ts). La dérivation n'est pas
   * faite ici : ce module est aussi chargé dans le navigateur, qui n'a pas
   * node:crypto (et n'a de toute façon aucun secret).
   */
  walletAuthSecret: optional(process.env.WALLET_AUTH_SECRET),

  /** Protège /api/cron/* (Vercel Cron envoie ce jeton en Bearer). */
  cronSecret: optional(process.env.CRON_SECRET),
} as const;

/** Décrit ce qui est réellement branché — affiché dans l'espace super-admin. */
export function integrationStatus() {
  return {
    webPush: Boolean(env.webPush.publicKey && env.webPush.privateKey),
    apns: Boolean(env.apns.keyId && env.apns.teamId && env.apns.privateKey),
    stripe: Boolean(env.stripe.secretKey),
    serviceRole: Boolean(env.supabase.serviceRoleKey),
    sessionSecret: Boolean(env.sessionSecret),
    appleAssociation: Boolean(env.apple.appId),
    /**
     * Variables Wallet présentes. « Présentes » n'est pas « prêtes » :
     * certificat expiré, classe Google refusée… L'état réel, avec sa
     * raison, vient de walletStatuses() (server/wallet/providers.ts).
     */
    appleWalletConfigured: Boolean(
      env.appleWallet.passTypeId && env.appleWallet.certPem && env.appleWallet.keyPem && env.appleWallet.wwdrPem,
    ),
    googleWalletConfigured: Boolean(env.googleWallet.issuerId && env.googleWallet.serviceAccountJson),
  };
}

export function requireServiceRoleKey(): string {
  if (!env.supabase.serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY est requise côté serveur pour agir sur les files. " +
        'Ajoutez-la dans vos variables d\'environnement (jamais avec le préfixe NEXT_PUBLIC_).',
    );
  }
  return env.supabase.serviceRoleKey;
}
