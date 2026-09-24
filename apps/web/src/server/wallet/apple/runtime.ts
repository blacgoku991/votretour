import 'server-only';
import { env } from '@/lib/env';
import {
  evaluateAppleConfig, parseAppleConfigCached,
  type AppleConfigCheck, type AppleConfigInput, type AppleWalletConfig,
} from './config';

/**
 * Configuration Apple Wallet de CE serveur : variables d'environnement
 * (lib/env.ts) + secret des jetons (walletAuthSecret, providers.ts).
 *
 * providers.ts est importé à la demande : il importe lui-même le
 * fournisseur Apple (registre), et un import statique en retour créerait
 * un cycle dont l'ordre d'évaluation dépendrait du premier module chargé.
 */

const VARIABLES = {
  APPLE_WALLET_CERT_PEM: 'certPem',
  APPLE_WALLET_KEY_PEM: 'keyPem',
  APPLE_WALLET_WWDR_PEM: 'wwdrPem',
} as const;

export function appleConfigInputFromEnv(authSecret: string | null): AppleConfigInput {
  const wallet = env.appleWallet;
  // Renseignée mais illisible (ni PEM, ni base64 d'un PEM) : lib/env.ts la
  // ramène à null ; on le dit, plutôt que « variable manquante ».
  const unreadable = (Object.keys(VARIABLES) as (keyof typeof VARIABLES)[])
    .filter((name) => Boolean(process.env[name]?.trim()) && !wallet[VARIABLES[name]]);
  return {
    passTypeId: wallet.passTypeId,
    certPem: wallet.certPem,
    keyPem: wallet.keyPem,
    keyPassphrase: wallet.keyPassphrase,
    wwdrPem: wallet.wwdrPem,
    teamId: wallet.teamId,
    siteUrl: env.siteUrl,
    authSecret,
    production: env.isProduction,
    unreadable,
  };
}

export async function appleConfigCheck(now = new Date()): Promise<AppleConfigCheck> {
  const { walletAuthSecret } = await import('../providers');
  return evaluateAppleConfig(parseAppleConfigCached(appleConfigInputFromEnv(walletAuthSecret())), now);
}

/** Configuration valide et dans ses dates, ou null (rien n'est alors servi : 404). */
export async function readyAppleConfig(now = new Date()): Promise<AppleWalletConfig | null> {
  const check = await appleConfigCheck(now);
  return check.ok ? check.config : null;
}
