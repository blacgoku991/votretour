import 'server-only';
import { requestFingerprint } from '@/server/client-session';
import { consumeRateLimit } from '@/server/ratelimit';
import { loadWalletSnapshot } from '../outbox';
import type { WalletSnapshot } from '../types';
import { buildWalletView } from '../view';
import type { AppleWalletConfig } from './config';
import { buildApplePass, packApplePass } from './pass';
import { readyAppleConfig } from './runtime';
import { supabaseAppleStore, type AppleStore } from './store';
import { PkpassCache, type RenderedPass, type WebServiceDeps } from './webservice';

/**
 * Dépendances réelles du service web Apple (routes /api/wallet/apple/v1/**).
 * Le rendu repart TOUJOURS de l'instantané courant (loadWalletSnapshot,
 * jamais wallet_pass_snapshot() directement) : un appareil qui interroge
 * avant d'avoir reçu le push obtient déjà la bonne version, et
 * wallet_record_render n'avance la version que si le contenu a changé.
 */

const cache = new PkpassCache();

/**
 * Rendu d'un pass pour GET /v1/passes : instantané courant → version
 * (wallet_record_render, qui n'avance que si le contenu a changé) →
 * .pkpass signé, mis en cache par (série, version). Dépendances injectées
 * pour les tests.
 */
export function renderLatestPass(deps: {
  load(passId: string): Promise<WalletSnapshot | null>;
  store: Pick<AppleStore, 'recordRender'>;
  cache: PkpassCache;
  sources?: { logo?: Buffer | null; cover?: Buffer | null };
  clock?: () => Date;
}): (passId: string, config: AppleWalletConfig) => Promise<RenderedPass | null> {
  return async (passId, config) => {
    const snap = await deps.load(passId);
    if (!snap || (snap.pass.state !== 'active' && snap.pass.state !== 'final')) return null;
    const now = deps.clock?.() ?? new Date();
    const view = buildWalletView(snap, now, { siteUrl: config.siteUrl });
    const built = await buildApplePass({ snap, view, now, config, sources: deps.sources });
    const version = await deps.store.recordRender(snap.pass.id, built.hash);
    const serial = snap.pass.externalId;
    // L'iPhone et la montre demandent la même version à quelques
    // secondes d'écart : une seule signature.
    let pkpass = deps.cache.get(serial, version.versionSeq, now.getTime());
    if (!pkpass) {
      pkpass = packApplePass(built, config.signer, now);
      deps.cache.set(serial, version.versionSeq, pkpass, now.getTime());
    }
    return { pkpass, versionSeq: version.versionSeq, versionAt: version.versionAt };
  };
}

export function appleWebServiceDeps(): WebServiceDeps {
  const store = supabaseAppleStore();
  return {
    config: () => readyAppleConfig(),
    store,
    async ipHash() {
      try {
        return (await requestFingerprint()).ipHash;
      } catch {
        return null;
      }
    },
    async allow(key, max, windowSeconds) {
      return (await consumeRateLimit(key, max, windowSeconds)).allowed;
    },
    render: renderLatestPass({ load: loadWalletSnapshot, store, cache }),
    report(message, context) {
      console.error('[wallet/apple]', message);
      void import('@/server/audit')
        .then(({ reportError }) => reportError({ source: 'wallet.apple.render', message, context }))
        .catch(() => undefined);
    },
    log(lines) {
      // Journal de l'iPhone (erreurs de Wallet) : journaux applicatifs seulement.
      console.info('[wallet/apple] journal Wallet', lines);
    },
  };
}

/**
 * Enveloppe des routes : une panne (base injoignable…) répond 503 avec
 * Retry-After, que Wallet sait respecter, plutôt qu'une page d'erreur.
 * Sans configuration, les gestionnaires répondent 404 avant tout accès.
 */
export async function safely(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    console.error('[wallet/apple] service web en échec', error instanceof Error ? error.message : error);
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  }
}
