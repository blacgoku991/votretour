import 'server-only';
import { env } from '@/lib/env';
import { buildWalletView } from '../view';
import type { DistributeContext, ProviderStatus, WalletProvider } from '../types';
import { GoogleAuth } from './auth';
import { GoogleWalletClient } from './client';
import {
  parseGoogleWalletConfig, publicConfigDetails, type GoogleWalletConfig, type GoogleWalletConfigResult,
} from './config';
import { GoogleWalletError } from './errors';
import { buildSaveJwt, saveUrl } from './jwt';
import { objectTypeFor, type EventClassInput } from './objects';
import {
  configurationReason, ensureEventClass, ensureQueueClass, insertObjectAndGoLive, isRejected,
  processGoogleJob, syncDirtyClasses,
  type GoogleClassRow, type GoogleDueClass, type GoogleStore, type GoogleSyncDeps,
} from './sync';

/**
 * Fournisseur Google Wallet (lot W3).
 *
 * Masquage propre : sans configuration valide, ou tant que la classe de
 * file n'existe pas chez Google, status() répond « non prêt » avec la
 * raison exacte (lue seulement par le super-admin) : aucun bouton, la
 * route de distribution répond 404, le vidage laisse les lignes en
 * attente. Rien n'est simulé.
 *
 *  - status()     : configuration (zod) + classe de file synchronisée ;
 *                   `details.mode` = 'demo' | 'production' (carte admin).
 *  - maintain()   : chaque minute (cron), crée la classe de file puis
 *                   synchronise les classes d'événement salies.
 *  - distribute() : insertion REST de l'objet, JWT léger, 302 vers
 *                   pay.google.com ; toute panne ou 8 s de silence →
 *                   retour à la page avec ?wallet=indisponible.
 *  - process()    : une ligne de la file d'envoi (sync.ts).
 */

/** Délai total de la distribution : au-delà, le client revient sur sa page. */
export const DISTRIBUTE_TIMEOUT_MS = 8_000;

/* ====================================================================
   Registre (import différé : providers.ts importe ce module, un import
   statique en retour créerait un cycle dont l'ordre d'évaluation
   dépendrait du premier importateur)
   ==================================================================== */

function degrade(reason: string): void {
  void import('../providers').then((m) => m.markWalletDegraded('google', reason)).catch(() => undefined);
}

function refreshStatuses(): void {
  void import('../providers').then((m) => m.resetWalletStatusCache()).catch(() => undefined);
}

/* ====================================================================
   Configuration et objets partagés par processus
   ==================================================================== */

let configCache: GoogleWalletConfigResult | null = null;

export function googleWalletConfig(): GoogleWalletConfigResult {
  configCache ??= parseGoogleWalletConfig({
    issuerId: env.googleWallet.issuerId,
    serviceAccountJson: env.googleWallet.serviceAccountJson,
    mode: env.googleWallet.mode,
    classPrefix: env.googleWallet.classPrefix,
    rotatingBarcode: env.googleWallet.rotatingBarcode,
    siteUrl: env.siteUrl,
    sessionSecretPresent: Boolean(env.sessionSecret),
  });
  return configCache;
}

/** Ce dont la distribution a besoin (doublures en test : aucun réseau). */
export interface GoogleRuntime {
  config: GoogleWalletConfig;
  auth: Pick<GoogleAuth, 'signingKey'>;
  deps: GoogleSyncDeps;
}

type Runtime = GoogleRuntime & { auth: GoogleAuth };

let runtimeCache: Runtime | null = null;

function runtime(): Runtime | null {
  const result = googleWalletConfig();
  if (!result.ok) return null;
  if (!runtimeCache) {
    const auth = new GoogleAuth(result.config.serviceAccount);
    runtimeCache = {
      config: result.config,
      auth,
      deps: {
        config: result.config,
        api: new GoogleWalletClient({ auth }),
        store: supabaseStore(),
        now: () => new Date(),
        report,
        degrade,
      },
    };
  }
  return runtimeCache;
}

function report(message: string, context?: Record<string, unknown>): void {
  console.error('[wallet.google]', message);
  void import('@/server/audit')
    .then(({ reportError }) => reportError({ source: 'wallet.google', message, context, level: 'error' }))
    .catch(() => undefined);
}

/* ====================================================================
   Accès aux données (service_role, fonctions de la migration 0021)
   ==================================================================== */

async function adminDb() {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  return supabaseAdmin();
}

interface ClassRowDb {
  class_id: string | null;
  kind: 'queue' | 'event';
  event_id: string | null;
  review_status: string | null;
  synced_hash: string | null;
  dirty: boolean;
  dirty_at: string | null;
  synced_at: string | null;
  last_error: string | null;
}

const CLASS_COLUMNS = 'class_id, kind, event_id, review_status, synced_hash, dirty, dirty_at, synced_at, last_error';

function toDue(row: ClassRowDb): GoogleDueClass {
  return {
    classId: row.class_id,
    kind: row.kind,
    eventId: row.event_id,
    reviewStatus: row.review_status,
    syncedHash: row.synced_hash,
    dirty: row.dirty,
    dirtyAt: row.dirty_at,
    syncedAt: row.synced_at,
    lastError: row.last_error,
  };
}

function toRow(row: ClassRowDb): GoogleClassRow {
  const due = toDue(row);
  if (!due.classId) throw new Error('Classe Google sans identifiant');
  return { ...due, classId: due.classId };
}

function supabaseStore(): GoogleStore {
  return {
    async classById(classId) {
      const { data, error } = await (await adminDb())
        .from('wallet_google_classes').select(CLASS_COLUMNS).eq('class_id', classId).maybeSingle();
      if (error) throw new Error(`wallet_google_classes : ${error.message}`);
      return data ? toRow(data as ClassRowDb) : null;
    },
    async classByEvent(eventId) {
      const { data, error } = await (await adminDb())
        .from('wallet_google_classes').select(CLASS_COLUMNS).eq('event_id', eventId).maybeSingle();
      if (error) throw new Error(`wallet_google_classes : ${error.message}`);
      return data ? toRow(data as ClassRowDb) : null;
    },
    async classesDue(limit) {
      const { data, error } = await (await adminDb()).rpc('wallet_google_classes_due', { p_limit: limit });
      if (error) throw new Error(`wallet_google_classes_due : ${error.message}`);
      return ((data ?? []) as ClassRowDb[]).map(toDue);
    },
    async upsertClass(classId, kind, eventId) {
      const { data, error } = await (await adminDb()).rpc('wallet_google_class_upsert', {
        p_class_id: classId, p_kind: kind, p_event_id: eventId,
      });
      if (error) throw new Error(`wallet_google_class_upsert : ${error.message}`);
      return toRow((Array.isArray(data) ? data[0] : data) as ClassRowDb);
    },
    async classSynced(classId, result) {
      const { error } = await (await adminDb()).rpc('wallet_google_class_synced', {
        p_class_id: classId,
        p_hash: result.hash,
        p_review_status: result.reviewStatus,
        p_error: result.error,
        p_dirty_at: result.dirtyAt,
      });
      if (error) throw new Error(`wallet_google_class_synced : ${error.message}`);
    },
    async eventBrand(eventId): Promise<EventClassInput | null> {
      const db = await adminDb();
      const { data: event, error } = await db
        .from('event_campaigns')
        .select('id, name, logo_url, cover_url, accent_hex, rules_text, started_at, location_id, organization_id')
        .eq('id', eventId)
        .maybeSingle();
      if (error) throw new Error(`event_campaigns : ${error.message}`);
      if (!event) return null;
      const [location, organization, settings] = await Promise.all([
        db.from('locations')
          .select('name, address_line1, address_line2, postal_code, city, country_code, timezone, logo_url')
          .eq('id', event.location_id).maybeSingle(),
        db.from('organizations').select('name, logo_url').eq('id', event.organization_id).maybeSingle(),
        db.from('organization_settings').select('brand_accent').eq('organization_id', event.organization_id).maybeSingle(),
      ]);
      if (location.error || organization.error) {
        throw new Error(`marque de l’événement : ${(location.error ?? organization.error)?.message}`);
      }
      if (!location.data || !organization.data) return null;
      const l = location.data;
      return {
        eventId: event.id as string,
        name: event.name as string,
        logoUrl: (event.logo_url as string | null) ?? null,
        coverUrl: (event.cover_url as string | null) ?? null,
        accentHex: (event.accent_hex as string | null) ?? null,
        rulesText: (event.rules_text as string | null) ?? null,
        startedAt: (event.started_at as string | null) ?? null,
        location: {
          name: l.name as string,
          addressLine1: (l.address_line1 as string | null) ?? null,
          addressLine2: (l.address_line2 as string | null) ?? null,
          postalCode: (l.postal_code as string | null) ?? null,
          city: (l.city as string | null) ?? null,
          countryCode: (l.country_code as string | null) ?? null,
          timezone: (l.timezone as string | null) ?? null,
          logoUrl: (l.logo_url as string | null) ?? null,
        },
        organization: {
          name: organization.data.name as string,
          logoUrl: (organization.data.logo_url as string | null) ?? null,
          brandAccent: (settings.data?.brand_accent as string | null) ?? null,
        },
      };
    },
    async markLive(passId, hash) {
      const { data, error } = await (await adminDb()).rpc('wallet_google_mark_live', { p_pass_id: passId, p_hash: hash });
      if (error) throw new Error(`wallet_google_mark_live : ${error.message}`);
      return data === true;
    },
  };
}

/* ====================================================================
   État
   ==================================================================== */

async function status(): Promise<ProviderStatus> {
  const result = googleWalletConfig();
  const details = publicConfigDetails(result);
  if (!result.ok) return { ready: false, reason: result.reason, details };

  let row: GoogleClassRow | null;
  try {
    row = await supabaseStore().classById(result.config.naming.queueClassId);
  } catch (error) {
    return { ready: false, reason: `Registre des classes illisible : ${error instanceof Error ? error.message : 'erreur'}`, details };
  }
  const queueClass = row ? { syncedAt: row.syncedAt, lastError: row.lastError } : null;
  if (!row?.syncedAt) {
    return {
      ready: false,
      reason: row?.lastError
        ? `Classe de file refusée par Google : ${row.lastError}`
        : 'Classe de file pas encore créée chez Google : le cron s’en charge dans la minute.',
      details: { ...details, queueClass },
    };
  }
  if (isRejected(row.reviewStatus)) {
    return { ready: false, reason: 'Classe de file refusée par Google', details: { ...details, queueClass } };
  }
  return { ready: true, reason: null, details: { ...details, queueClass } };
}

/* ====================================================================
   Distribution
   ==================================================================== */

const NO_STORE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
} as const;

/** Retour à la page d'origine, avec l'encart « Google Wallet ne répond pas ». */
function backTo(ctx: DistributeContext): Response {
  const url = new URL(ctx.returnTo, ctx.request.url);
  url.searchParams.set('wallet', 'indisponible');
  url.searchParams.set('wp', 'google');
  // Chemin relatif seulement : jamais de redirection vers un autre site.
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: url.pathname + url.search } });
}

/**
 * Mode démo : Google n'enregistre que pour ses comptes de test ; le
 * bouton n'est montré qu'aux membres de l'organisation et au super-admin
 * (walletOffer), et la route le revérifie : un lien recopié ne crée rien.
 */
async function viewerIsTester(organizationId: string): Promise<boolean> {
  const { getSessionUser } = await import('@/server/auth');
  const user = await getSessionUser().catch(() => null);
  if (!user) return false;
  if (user.isPlatformAdmin) return true;
  const { data } = await (await adminDb())
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  return Boolean(data);
}

/** Borne une étape non annulable (lecture SQL) par le signal de la distribution. */
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new GoogleWalletError('timeout', 'Distribution : délai dépassé'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new GoogleWalletError('timeout', 'Distribution : délai dépassé'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

async function saveLink(ctx: DistributeContext, rt: GoogleRuntime, signal: AbortSignal): Promise<string> {
  const { config } = rt;
  const issued = await bounded(ctx.issue({
    provider: 'google',
    objectPrefix: config.naming.objectPrefix,
    queueClass: config.naming.queueClassId,
    eventClassPrefix: config.naming.eventClassPrefix,
  }), signal);
  const snap = await bounded(ctx.snapshot(issued.id), signal);
  if (!snap) throw new Error('Instantané du pass introuvable');

  if (issued.kind === 'event') {
    // Billet de drop : jamais de lien vers une classe absente ou refusée.
    if (!snap.event) throw new Error('Événement du billet introuvable');
    const state = await bounded(ensureEventClass(rt.deps, snap.event.id, signal), signal);
    if (state !== 'ok') throw new Error(`Classe d’événement ${state === 'rejected' ? 'refusée par Google' : 'indisponible'}`);
  }

  if (!issued.live) {
    // L'objet est créé AVANT le lien : nos mises à jour s'appliquent même
    // si le client met une minute à confirmer l'ajout.
    const view = buildWalletView(snap, rt.deps.now(), { siteUrl: config.siteUrl });
    await bounded(insertObjectAndGoLive(rt.deps, snap, view, signal), signal);
  }

  const jwt = await buildSaveJwt({
    key: await rt.auth.signingKey(),
    clientEmail: config.serviceAccount.clientEmail,
    privateKeyId: config.serviceAccount.privateKeyId,
    origin: config.origin,
    objectType: objectTypeFor(issued.kind),
    objectId: issued.externalId,
  });
  return saveUrl(jwt);
}

export interface DistributeOptions {
  /** Mode démo : le visiteur est-il membre de l'organisation ou super-admin ? */
  isTester(organizationId: string): Promise<boolean>;
  timeoutMs?: number;
}

/**
 * Distribution Google, testable sans réseau : contrôle du mode démo,
 * insertion de l'objet, JWT léger, 302 vers pay.google.com. Toute panne,
 * et tout silence de plus de 8 s, ramène le client sur sa page avec
 * ?wallet=indisponible : jamais de faux succès.
 */
export async function distributeGoogle(ctx: DistributeContext, rt: GoogleRuntime, options: DistributeOptions): Promise<Response> {
  if (rt.config.mode === 'demo' && !(await options.isTester(ctx.organizationId).catch(() => false))) {
    console.info('[wallet.google] mode démo : visiteur hors des testeurs, aucun pass émis');
    return backTo(ctx);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DISTRIBUTE_TIMEOUT_MS);
  try {
    const url = await bounded(saveLink(ctx, rt, controller.signal), controller.signal);
    return new Response(null, { status: 302, headers: { ...NO_STORE, Location: url } });
  } catch (error) {
    if (error instanceof GoogleWalletError && error.configuration) {
      const reason = configurationReason(error);
      rt.deps.degrade?.(reason);
      rt.deps.report?.(reason, { kind: error.kind, status: error.status });
    }
    console.error('[wallet.google] distribution impossible', error instanceof Error ? error.message : error);
    return backTo(ctx);
  } finally {
    clearTimeout(timer);
  }
}

async function distribute(ctx: DistributeContext): Promise<Response> {
  const rt = runtime();
  if (!rt) return new Response('Introuvable', { status: 404, headers: NO_STORE });
  return distributeGoogle(ctx, rt, { isTester: viewerIsTester });
}

/* ====================================================================
   Fournisseur
   ==================================================================== */

export const googleProvider: WalletProvider = {
  id: 'google',
  status,
  distribute,
  async process(job, snap, now, view, signal) {
    const rt = runtime();
    if (!rt) {
      return { ok: false, error: 'Google Wallet non configuré', retryAfterSeconds: 300, dead: false, haltProvider: true };
    }
    return processGoogleJob(rt.deps, job, snap, now, view, signal);
  },
  async maintain() {
    const rt = runtime();
    if (!rt) return { skipped: googleWalletConfig().ok ? 'inconnu' : 'non configuré' };
    const outcome: Record<string, unknown> = {};
    try {
      const queue = await ensureQueueClass(rt.deps);
      outcome.queueClass = queue.created ? 'créée' : 'à jour';
      // Première création : le bouton peut apparaître sans attendre la fin
      // du cache d'état (5 min).
      if (queue.created) refreshStatuses();
    } catch (error) {
      outcome.queueClass = { error: error instanceof Error ? error.message : 'erreur' };
      if (error instanceof GoogleWalletError && error.configuration) {
        const reason = configurationReason(error);
        degrade(reason);
        report(reason, { kind: error.kind, status: error.status });
        return outcome;
      }
    }
    outcome.classes = await syncDirtyClasses(rt.deps, { limit: 5, budgetMs: 6_000 });
    return outcome;
  },
};
