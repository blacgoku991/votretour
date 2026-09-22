/**
 * Configuration d'environnement.
 *
 * Deux niveaux volontairement distincts :
 *  - le NOYAU (Supabase, URL du site, secret de hachage) est obligatoire :
 *    sans lui l'application n'a aucun sens et on échoue au démarrage ;
 *  - les INTÉGRATIONS (APNs, Web Push, Stripe) sont facultatives. Leur
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

/** Clé privée APNs : accepte le PEM brut ou une version encodée en base64. */
function readPrivateKey(value: string | undefined): string | null {
  const raw = optional(value);
  if (!raw) return null;
  if (raw.includes('BEGIN PRIVATE KEY')) return raw.replace(/\\n/g, '\n');
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (decoded.includes('BEGIN PRIVATE KEY')) return decoded;
  } catch {
    /* on retombe sur l'erreur explicite ci-dessous */
  }
  return null;
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
