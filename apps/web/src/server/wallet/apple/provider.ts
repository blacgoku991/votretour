import 'server-only';
import { liveLedger } from '../alerts';
import { buildWalletView, passLifecycle } from '../view';
import type {
  ClaimedJob, DistributeContext, JobResult, ProviderStatus, WalletProvider, WalletSnapshot, WalletView,
} from '../types';
import type { AppleWalletConfig } from './config';
import { http2Transport, pushPassUpdate, tokenHint, type PushResult, type PushTransport } from './apns';
import { PKPASS_TYPE, buildApplePass, httpDate, packApplePass } from './pass';
import { appleConfigCheck } from './runtime';
import { signManifest } from './signature';
import { supabaseAppleStore, type AppleStore } from './store';

/**
 * Fournisseur Apple Wallet (lot W2), branché sur le registre commun
 * (providers.ts) :
 *
 *  - status()     : configuration contrôlée (config.ts) + une signature
 *                   d'essai. Sans configuration : `ready: false`, et donc
 *                   aucun bouton, service web en 404, rien de simulé ;
 *  - distribute() : GET /api/client/wallet/apple (coquille commune, qui a
 *                   déjà vérifié la session) → .pkpass signé ;
 *  - process()    : une ligne de la file d'envoi → rendu → si le rendu a
 *                   changé, nouvelle version + push `{}` aux appareils.
 */

/* ====================================================================
   État
   ==================================================================== */

let selfTest: { fingerprint: string; error: string | null } | null = null;

/**
 * Signature d'essai, une fois par certificat : une clé lisible par OpenSSL
 * mais pas par forge, ou un défaut de la bibliothèque, se voit ici
 * (carte du super-admin) et pas au premier client.
 */
function signingSelfTest(config: AppleWalletConfig): string | null {
  if (selfTest?.fingerprint === config.certFingerprint) return selfTest.error;
  let error: string | null = null;
  try {
    signManifest(Buffer.from('{}', 'utf8'), config.signer);
  } catch (cause) {
    error = `Signature d’essai impossible : ${cause instanceof Error ? cause.message : 'erreur inconnue'}`;
  }
  selfTest = { fingerprint: config.certFingerprint, error };
  return error;
}

export async function appleStatus(now = new Date()): Promise<ProviderStatus> {
  const check = await appleConfigCheck(now);
  if (!check.ok) return { ready: false, reason: check.reason, details: check.details };
  const failure = signingSelfTest(check.config);
  if (failure) return { ready: false, reason: failure, details: check.details };
  return { ready: true, reason: null, details: check.details };
}

/* ====================================================================
   Traitement d'une ligne de la file d'envoi
   ==================================================================== */

export interface AppleProcessDeps {
  config: AppleWalletConfig;
  store: AppleStore;
  transport: PushTransport;
  /** Remontée d'incident (certificat refusé) : reportError en production. */
  report(message: string, context: Record<string, unknown>): void;
  /** Sources d'images (tests) ; par défaut lues dans MEDIA_ROOT. */
  sources?: { logo?: Buffer | null; cover?: Buffer | null };
}

function summarize(results: PushResult[], outcome: PushResult['outcome']): string {
  const hit = results.filter((r) => r.outcome === outcome);
  const reasons = [...new Set(hit.map((r) => r.reason ?? `HTTP ${r.status}`))].join(', ');
  return `${hit.length} ${outcome} (${reasons})`;
}

export async function processAppleJob(
  job: ClaimedJob,
  snap: WalletSnapshot,
  now: Date,
  view: WalletView,
  signal: AbortSignal,
  deps: AppleProcessDeps,
): Promise<JobResult> {
  // Effacement : complete_wallet_outbox supprime les inscriptions ; aucun
  // push (l'iPhone garde la dernière version, déjà annulée ou expirée).
  if (job.job === 'scrub') return { ok: true };
  if (snap.pass.state === 'revoked' || snap.pass.state === 'scrubbed') return { ok: true };

  const built = await buildApplePass({ snap, view, now, config: deps.config, sources: deps.sources });
  const lifecycle = passLifecycle(view, snap.pass, now);

  // Rien de visible n'a changé depuis le dernier envoi accepté : pas de push.
  if (built.hash === snap.pass.syncedHash) return { ok: true, syncedHash: built.hash, ...lifecycle };

  signal.throwIfAborted();
  await deps.store.recordRender(snap.pass.id, built.hash);
  const tokens = await deps.store.pushTargets(snap.pass.id);
  const alertKind = built.alert?.kind ?? null;
  if (tokens.length === 0) {
    // Plus aucun appareil : la version est prête pour un futur ajout.
    return { ok: true, syncedHash: built.hash, alertKind, alertNotified: false, ...lifecycle };
  }

  const results = await pushPassUpdate(tokens, { topic: deps.config.passTypeId, transport: deps.transport, signal, now });

  const dead = results.filter((r) => r.outcome === 'dead').map((r) => r.token);
  if (dead.length > 0) {
    try {
      await deps.store.dropTokens(dead);
    } catch (error) {
      console.error('[wallet/apple] suppression des jetons morts impossible', error instanceof Error ? error.message : error);
    }
  }

  if (results.some((r) => r.outcome === 'halt')) {
    const message = `Certificat refusé par APNs : ${summarize(results, 'halt')}`;
    deps.report(message, { tokens: results.filter((r) => r.outcome === 'halt').map((r) => tokenHint(r.token)) });
    return { ok: false, error: message, retryAfterSeconds: 300, dead: false, haltProvider: true };
  }
  if (results.some((r) => r.outcome === 'aborted')) {
    return { ok: false, error: 'Envoi APNs interrompu (délai du vidage)', retryAfterSeconds: 15, dead: false };
  }
  if (results.some((r) => r.outcome === 'retry')) {
    // On repousse à TOUS les appareils : ceux déjà servis recevront 304,
    // sans nouvelle alerte (la valeur de `etat` n'a pas bougé pour eux).
    return { ok: false, error: `APNs indisponible : ${summarize(results, 'retry')}`, retryAfterSeconds: 30, dead: false };
  }

  const delivered = results.filter((r) => r.outcome === 'ok').length;
  const failed = results.filter((r) => r.outcome === 'fail');
  if (delivered === 0 && failed.length > 0) {
    // 400 : défaut de notre requête, un nouvel essai ferait la même chose.
    return { ok: false, error: `APNs a refusé la requête : ${summarize(results, 'fail')}`, retryAfterSeconds: 300, dead: true };
  }

  // « Envoyée » = acceptée par APNs, pour au moins un appareil, et pas
  // déjà comptée : Wallet ne resonne pas tant que `etat` garde sa valeur,
  // le journal (notification_deliveries) ne doit pas compter deux fois.
  const ledger = liveLedger(snap.pass.alerts ?? {}, snap.entry.rankResetAt ?? null);
  const alertNotified = Boolean(built.alert?.notify && delivered > 0 && alertKind && !ledger[alertKind]);
  return { ok: true, syncedHash: built.hash, alertKind, alertNotified, ...lifecycle };
}

/* ====================================================================
   Distribution : le .pkpass du clic sur le badge
   ==================================================================== */

export async function distributeApplePass(ctx: DistributeContext, config: AppleWalletConfig, store: AppleStore): Promise<Response> {
  const issued = await ctx.issue({ provider: 'apple', passTypeId: config.passTypeId });
  const snap = await ctx.snapshot(issued.id);
  if (!snap) throw new Error('Instantané du pass introuvable');
  const view = buildWalletView(snap, ctx.now, { siteUrl: config.siteUrl });
  const built = await buildApplePass({ snap, view, now: ctx.now, config });
  const version = await store.recordRender(snap.pass.id, built.hash);
  const pkpass = packApplePass(built, config.signer, ctx.now);
  return new Response(new Uint8Array(pkpass), {
    status: 200,
    headers: {
      'Content-Type': PKPASS_TYPE,
      'Content-Disposition': 'attachment; filename="rangvia.pkpass"',
      'Content-Length': String(pkpass.length),
      'Last-Modified': httpDate(version.versionAt),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/* ====================================================================
   Enregistrement dans le registre commun
   ==================================================================== */

async function report(message: string, context: Record<string, unknown>): Promise<void> {
  try {
    const { reportError } = await import('@/server/audit');
    await reportError({ source: 'wallet.apple', message, context });
  } catch {
    /* le journal applicatif suffit */
  }
}

export const appleProvider: WalletProvider = {
  id: 'apple',

  status: () => appleStatus(),

  async distribute(ctx) {
    const check = await appleConfigCheck(ctx.now);
    // La coquille a déjà vérifié status().ready ; une configuration tombée
    // entre-temps lève, et la coquille ramène le client à sa page.
    if (!check.ok) throw new Error(`Apple Wallet indisponible : ${check.reason}`);
    return distributeApplePass(ctx, check.config, supabaseAppleStore());
  },

  async process(job, snap, now, view, signal) {
    const check = await appleConfigCheck(now);
    if (!check.ok) {
      return { ok: false, error: `Apple Wallet non prêt : ${check.reason}`, retryAfterSeconds: 300, dead: false, haltProvider: true };
    }
    return processAppleJob(job, snap, now, view, signal, {
      config: check.config,
      store: supabaseAppleStore(),
      transport: http2Transport(check.config.tls),
      report: (message, context) => {
        console.error('[wallet/apple]', message);
        void report(message, context);
      },
    });
  },
};
