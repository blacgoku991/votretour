import { X509Certificate, createHash, createPrivateKey, type KeyObject } from 'node:crypto';
import forge from 'node-forge';
import { appleRootCa } from './apple-root';

/**
 * Configuration Apple Wallet : lecture ET contrôles.
 *
 * Un pass mal signé n'échoue pas bruyamment : Safari affiche « Impossible
 * d'ajouter le pass », sans dire pourquoi, et un client dans un salon n'a
 * aucun moyen de comprendre. On refuse donc d'être « prêt » tant que la
 * moindre pièce est incohérente, avec une raison EXACTE (lue seulement
 * dans l'espace super-admin) :
 *
 *  1. toutes les variables présentes et lisibles (PEM brut ou base64) ;
 *  2. secret des jetons ApplePass assez long, site en HTTPS (Wallet
 *     n'appelle pas un service web en clair) ;
 *  3. certificat Pass Type ID : UID = APPLE_WALLET_PASS_TYPE_ID, OU = Team
 *     ID (surcharge APPLE_WALLET_TEAM_ID comparée, jamais imposée) ;
 *  4. clé privée : déchiffrée par sa phrase de passe, RSA, et c'est bien
 *     celle du certificat ;
 *  5. chaîne : le certificat est émis ET signé par le WWDR fourni, et ce
 *     WWDR est un certificat d'autorité SIGNÉ par la vraie « Apple Root
 *     CA », dont la clé publique est embarquée (apple-root.ts, empreinte
 *     contrôlée). Le code ne suppose pas G4 : il vérifie la relation, pas
 *     un nom figé. Un nom ne prouve rien : hors production seulement, une
 *     chaîne de TEST (scripts/wallet-dev-certs.sh, racine qui se contente
 *     de s'appeler « Apple Root CA ») est acceptée pour le banc local,
 *     et signalée comme telle (details.chain = 'test') ;
 *  6. validité dans le temps (certificat et WWDR), avec l'échéance en
 *     clair pour la carte du super-admin (alerte à J-30 : le certificat
 *     Pass Type ID se renouvelle chaque année).
 *
 * Les vérifications cryptographiques passent par node:crypto (OpenSSL).
 * node-forge ne sert qu'à LIRE les certificats et la clé pour signer
 * (signature.ts) : ses failles connues de 2026 touchent la vérification
 * de signatures, un chemin que nous n'empruntons pas.
 *
 * Aucune de ces valeurs n'est jamais journalisée ; seule une empreinte
 * courte du certificat (publique) figure dans les détails.
 */

/** OID du champ UID (userId) d'un nom distinctif X.500. */
const OID_UID = '0.9.2342.19200300.100.1.1';
const OID_OU = '2.5.4.11';
const OID_CN = '2.5.4.3';
const OID_O = '2.5.4.10';

/** Au-delà, l'espace super-admin passe l'échéance en alerte. */
export const CERT_WARNING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const PASS_TYPE_ID = /^pass\.[A-Za-z0-9][A-Za-z0-9.-]{1,120}$/;
export const TEAM_ID = /^[A-Z0-9]{10}$/;
/** Un secret HMAC plus court serait devinable hors ligne. */
export const MIN_SECRET_LENGTH = 32;

export interface AppleConfigInput {
  passTypeId: string | null;
  certPem: string | null;
  keyPem: string | null;
  keyPassphrase: string | null;
  wwdrPem: string | null;
  /** Surcharge facultative ; par défaut, OU= du certificat. */
  teamId: string | null;
  siteUrl: string;
  /** walletAuthSecret() : WALLET_AUTH_SECRET, ou dérivé de SESSION_HASH_SECRET. */
  authSecret: string | null;
  production: boolean;
  /** Variables renseignées mais illisibles (ni PEM ni base64 d'un PEM). */
  unreadable?: readonly string[];
  /**
   * Racine de confiance à la place d'Apple Root CA : TESTS SEULEMENT
   * (l'AC générée à la volée joue la racine, pour vérifier le chemin de
   * production). runtime.ts ne la renseigne jamais, aucune variable
   * d'environnement n'y mène.
   */
  trustAnchorPem?: string | null;
}

/** Ce que les autres modules Apple utilisent : jamais sérialisé, jamais journalisé. */
export interface AppleWalletConfig {
  passTypeId: string;
  teamId: string;
  siteUrl: string;
  webServiceUrl: string;
  authSecret: string;
  /** PEM du certificat et de la clé DÉCHIFFRÉE : TLS client d'APNs (apns.ts). */
  tls: { cert: string; key: string };
  /** Objets de signature (signature.ts). */
  signer: {
    certificate: forge.pki.Certificate;
    privateKey: forge.pki.rsa.PrivateKey;
    wwdr: forge.pki.Certificate;
  };
  certNotBefore: Date;
  certNotAfter: Date;
  wwdrNotAfter: Date;
  /** Empreinte SHA-256 courte du certificat (publique), pour reconnaître un renouvellement. */
  certFingerprint: string;
  /** 'apple' : WWDR signé par la racine épinglée ; 'test' : chaîne de test, hors production seulement. */
  chain: 'apple' | 'test';
}

export type AppleConfigIssue =
  | 'missing' | 'unreadable' | 'pass_type_id' | 'secret' | 'site'
  | 'cert' | 'key' | 'key_passphrase' | 'key_not_rsa' | 'key_mismatch'
  | 'uid' | 'team' | 'wwdr' | 'chain' | 'wwdr_root'
  | 'cert_not_yet_valid' | 'cert_expired' | 'wwdr_expired';

export type AppleConfigCheck =
  | { ok: true; config: AppleWalletConfig; details: Record<string, unknown> }
  | { ok: false; issue: AppleConfigIssue; reason: string; details: Record<string, unknown> };

/** Étape lourde (lecture, déchiffrement, chaîne), sans horloge : mémorisable. */
export type AppleConfigParse =
  | { ok: true; config: AppleWalletConfig }
  | { ok: false; issue: AppleConfigIssue; reason: string; partial: Partial<Pick<AppleWalletConfig, 'certNotAfter' | 'certNotBefore' | 'wwdrNotAfter' | 'certFingerprint' | 'passTypeId' | 'teamId'>> };

class ConfigError extends Error {
  constructor(readonly issue: AppleConfigIssue, message: string) {
    super(message);
  }
}

function attribute(name: forge.pki.Certificate['subject'], oid: string): string | null {
  const found = name.attributes.find((a) => a.type === oid);
  const value = found?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readCertificate(pem: string, what: string): { forge: forge.pki.Certificate; x509: X509Certificate } {
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(pem);
  } catch {
    throw new ConfigError(what === 'WWDR' ? 'wwdr' : 'cert', `${what} illisible : PEM (ou base64 d’un PEM) attendu`);
  }
  try {
    return { forge: forge.pki.certificateFromPem(pem), x509 };
  } catch {
    // forge ne lit que les clés publiques RSA : c'est justement ce qu'il faut.
    throw new ConfigError(what === 'WWDR' ? 'wwdr' : 'cert', `${what} illisible (clé publique non RSA ?)`);
  }
}

function readKey(pem: string, passphrase: string | null): KeyObject {
  const encrypted = /ENCRYPTED/.test(pem);
  if (encrypted && !passphrase) {
    throw new ConfigError('key_passphrase', 'Clé privée chiffrée : APPLE_WALLET_KEY_PASSPHRASE est vide');
  }
  try {
    return createPrivateKey(encrypted ? { key: pem, format: 'pem', passphrase: passphrase ?? '' } : { key: pem, format: 'pem' });
  } catch {
    throw new ConfigError(
      encrypted ? 'key_passphrase' : 'key',
      encrypted ? 'Clé privée : phrase de passe incorrecte (APPLE_WALLET_KEY_PASSPHRASE)' : 'Clé privée illisible',
    );
  }
}

/** URL du service web : Wallet y ajoute /v1/… (§ 8.2 du plan). */
export function appleWebServiceUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/api/wallet/apple`;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Étape 1 à 5 : tout ce qui ne dépend pas de l'heure. Ne lève jamais.
 */
export function parseAppleConfig(input: AppleConfigInput): AppleConfigParse {
  const partial: Extract<AppleConfigParse, { ok: false }>['partial'] = {};
  try {
    const missing: string[] = [];
    if (!input.passTypeId) missing.push('APPLE_WALLET_PASS_TYPE_ID');
    if (!input.certPem && !input.unreadable?.includes('APPLE_WALLET_CERT_PEM')) missing.push('APPLE_WALLET_CERT_PEM');
    if (!input.keyPem && !input.unreadable?.includes('APPLE_WALLET_KEY_PEM')) missing.push('APPLE_WALLET_KEY_PEM');
    if (!input.wwdrPem && !input.unreadable?.includes('APPLE_WALLET_WWDR_PEM')) missing.push('APPLE_WALLET_WWDR_PEM');
    if (missing.length > 0) throw new ConfigError('missing', `Non configuré : ${missing.join(', ')}`);
    if (input.unreadable && input.unreadable.length > 0) {
      throw new ConfigError('unreadable', `Illisible (PEM ou base64 d’un PEM attendu) : ${input.unreadable.join(', ')}`);
    }
    const passTypeId = input.passTypeId!.trim();
    if (!PASS_TYPE_ID.test(passTypeId)) {
      throw new ConfigError('pass_type_id', `APPLE_WALLET_PASS_TYPE_ID invalide (« pass.… » attendu) : ${passTypeId}`);
    }
    partial.passTypeId = passTypeId;

    if (!input.authSecret || input.authSecret.length < MIN_SECRET_LENGTH) {
      throw new ConfigError('secret', 'Secret des jetons absent ou trop court : WALLET_AUTH_SECRET (ou SESSION_HASH_SECRET)');
    }

    let site: URL;
    try {
      site = new URL(input.siteUrl);
    } catch {
      throw new ConfigError('site', 'NEXT_PUBLIC_SITE_URL illisible');
    }
    // Wallet n'appelle qu'un service web HTTPS. Seule exception : un poste
    // de développement en boucle locale (iOS : Réglages → Développeur →
    // « Autoriser les services HTTP »), jamais en production.
    if (site.protocol !== 'https:' && !(site.protocol === 'http:' && !input.production && isLoopback(site.hostname))) {
      throw new ConfigError('site', 'NEXT_PUBLIC_SITE_URL doit être en HTTPS : Wallet refuse un service web en clair');
    }

    const cert = readCertificate(input.certPem!, 'Certificat Pass Type ID');
    partial.certNotBefore = new Date(cert.x509.validFrom);
    partial.certNotAfter = new Date(cert.x509.validTo);
    partial.certFingerprint = createHash('sha256').update(cert.x509.raw).digest('hex').slice(0, 16);

    const uid = attribute(cert.forge.subject, OID_UID);
    if (uid !== passTypeId) {
      throw new ConfigError(
        'uid',
        uid
          ? `Le certificat est celui de ${uid}, pas de APPLE_WALLET_PASS_TYPE_ID (${passTypeId})`
          : 'Le certificat ne porte pas d’UID : ce n’est pas un certificat Pass Type ID',
      );
    }

    const ou = attribute(cert.forge.subject, OID_OU);
    if (!ou || !TEAM_ID.test(ou)) {
      throw new ConfigError('team', 'Identifiant d’équipe (OU=) absent du certificat : ce n’est pas un certificat Pass Type ID');
    }
    const override = input.teamId?.trim() || null;
    if (override && override !== ou) {
      throw new ConfigError('team', `APPLE_WALLET_TEAM_ID (${override}) ne correspond pas au certificat (OU=${ou}) : laissez-le vide`);
    }
    partial.teamId = ou;

    const key = readKey(input.keyPem!, input.keyPassphrase);
    if (key.asymmetricKeyType !== 'rsa') {
      throw new ConfigError('key_not_rsa', 'La clé privée n’est pas une clé RSA');
    }
    if (!cert.x509.checkPrivateKey(key)) {
      throw new ConfigError('key_mismatch', 'La clé privée ne correspond pas au certificat Pass Type ID');
    }
    // Clé déchiffrée, en mémoire seulement : PKCS#1 pour forge, PKCS#8 pour TLS.
    const pkcs1 = key.export({ type: 'pkcs1', format: 'pem' }).toString();
    const privateKey = forge.pki.privateKeyFromPem(pkcs1);

    const wwdr = readCertificate(input.wwdrPem!, 'WWDR');
    partial.wwdrNotAfter = new Date(wwdr.x509.validTo);
    if (!wwdr.x509.ca) {
      throw new ConfigError('wwdr', 'APPLE_WALLET_WWDR_PEM n’est pas un certificat d’autorité (WWDR attendu)');
    }
    if (!cert.x509.checkIssued(wwdr.x509) || !cert.x509.verify(wwdr.x509.publicKey)) {
      throw new ConfigError('chain', 'Certificat intermédiaire incohérent : le certificat Pass Type ID n’est pas émis par ce WWDR');
    }
    const chain = wwdrTrust(wwdr, input);

    return {
      ok: true,
      config: {
        passTypeId,
        teamId: ou,
        siteUrl: input.siteUrl.replace(/\/+$/, ''),
        webServiceUrl: appleWebServiceUrl(input.siteUrl),
        authSecret: input.authSecret,
        tls: { cert: input.certPem!, key: key.export({ type: 'pkcs8', format: 'pem' }).toString() },
        signer: { certificate: cert.forge, privateKey, wwdr: wwdr.forge },
        certNotBefore: partial.certNotBefore,
        certNotAfter: partial.certNotAfter,
        wwdrNotAfter: partial.wwdrNotAfter,
        certFingerprint: partial.certFingerprint,
        chain,
      },
    };
  } catch (error) {
    if (error instanceof ConfigError) return { ok: false, issue: error.issue, reason: error.message, partial };
    return { ok: false, issue: 'cert', reason: 'Configuration Apple Wallet illisible', partial };
  }
}

/**
 * Le WWDR est-il signé par la racine épinglée (Apple Root CA, ou l'ancre
 * d'un test) ? Nom d'émetteur ET identifiant de clé (checkIssued), puis
 * la signature elle-même (verify). En production, rien d'autre ne passe.
 */
function wwdrTrust(wwdr: { forge: forge.pki.Certificate; x509: X509Certificate }, input: AppleConfigInput): 'apple' | 'test' {
  let anchor: X509Certificate;
  try {
    anchor = input.trustAnchorPem ? new X509Certificate(input.trustAnchorPem) : appleRootCa();
  } catch (cause) {
    throw new ConfigError('wwdr_root', cause instanceof Error ? cause.message : 'Racine Apple Root CA illisible');
  }
  if (wwdr.x509.checkIssued(anchor) && wwdr.x509.verify(anchor.publicKey)) return 'apple';

  const rootCn = attribute(wwdr.forge.issuer, OID_CN);
  const rootO = attribute(wwdr.forge.issuer, OID_O);
  if (input.production) {
    throw new ConfigError(
      'wwdr_root',
      rootCn === 'Apple Root CA'
        ? 'Le WWDR se dit émis par Apple Root CA mais n’est pas signé par la vraie racine d’Apple : chaîne de test ? Aucun iPhone n’accepterait ces passes'
        : 'Le WWDR fourni n’est pas émis par Apple Root CA',
    );
  }
  if (rootCn !== 'Apple Root CA' || rootO !== 'Apple Inc.') {
    throw new ConfigError('wwdr_root', 'Le WWDR fourni n’est pas émis par Apple Root CA');
  }
  // Banc local : la chaîne de scripts/wallet-dev-certs.sh. Elle se construit
  // et se vérifie avec OpenSSL, aucun iPhone ne l'acceptera.
  return 'test';
}

function detailsOf(
  source: Extract<AppleConfigParse, { ok: false }>['partial'] | AppleWalletConfig,
  now: Date,
): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  if (source.passTypeId) details.passTypeId = source.passTypeId;
  if (source.teamId) details.teamId = source.teamId;
  if (source.certNotAfter) {
    details.certExpiresAt = source.certNotAfter.toISOString();
    const daysLeft = Math.floor((source.certNotAfter.getTime() - now.getTime()) / DAY_MS);
    details.daysLeft = daysLeft;
    details.expiresSoon = daysLeft <= CERT_WARNING_DAYS;
  }
  if (source.wwdrNotAfter) details.wwdrExpiresAt = source.wwdrNotAfter.toISOString();
  if (source.certFingerprint) details.certFingerprint = source.certFingerprint;
  if ('webServiceUrl' in source) details.webServiceURL = source.webServiceUrl;
  if ('chain' in source) details.chain = source.chain;
  return details;
}

/** Étape 6 : validité dans le temps, à chaque contrôle (le cache de lecture n'y touche pas). */
export function evaluateAppleConfig(parsed: AppleConfigParse, now: Date): AppleConfigCheck {
  if (!parsed.ok) return { ok: false, issue: parsed.issue, reason: parsed.reason, details: detailsOf(parsed.partial, now) };
  const { config } = parsed;
  const details = detailsOf(config, now);
  if (now < config.certNotBefore) {
    return { ok: false, issue: 'cert_not_yet_valid', reason: 'Certificat Pass Type ID pas encore valide', details };
  }
  if (now >= config.certNotAfter) {
    return {
      ok: false,
      issue: 'cert_expired',
      reason: `Certificat Pass Type ID expiré le ${config.certNotAfter.toISOString().slice(0, 10)} : renouvelez-le`,
      details,
    };
  }
  if (now >= config.wwdrNotAfter) {
    return { ok: false, issue: 'wwdr_expired', reason: 'Certificat intermédiaire WWDR expiré : relancez le script d’import', details };
  }
  return { ok: true, config, details };
}

export function checkAppleConfig(input: AppleConfigInput, now: Date): AppleConfigCheck {
  return evaluateAppleConfig(parseAppleConfig(input), now);
}

/* ====================================================================
   Lecture de l'environnement, mémorisée
   ==================================================================== */

let memo: { key: string; parsed: AppleConfigParse } | null = null;

function memoKey(input: AppleConfigInput): string {
  // Condensat des entrées : le cache suit un changement de variable (tests,
  // rechargement), sans garder en clé une copie lisible des secrets.
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/** Lecture mémorisée (déchiffrer la clé et vérifier la chaîne coûte quelques ms). */
export function parseAppleConfigCached(input: AppleConfigInput): AppleConfigParse {
  const key = memoKey(input);
  if (memo?.key === key) return memo.parsed;
  const parsed = parseAppleConfig(input);
  memo = { key, parsed };
  return parsed;
}

export function resetAppleConfigCache(): void {
  memo = null;
}
