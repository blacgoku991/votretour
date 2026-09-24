'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { audit } from '@/server/audit';
import { assertOrgMembership, assertQueueAccess, getSessionUser } from '@/server/auth';
import { propagate, setQueueStatus } from '@/server/queue';
import { dispatchEventEntryNotification } from '@/server/notifications/dispatch';
import { enforceRateLimit, LIMITS } from '@/server/ratelimit';
import { walletStatuses } from '@/server/wallet/providers';
import {
  checkScanProof, eventAccessPath,
  SCAN_OTP_RE, SCAN_SIG_RE, SCAN_WALLET_CODE_RE,
  type ScanProof,
} from '@/lib/event-pass';

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

function fail(error: unknown): Result<never> {
  const appError = toAppError(error);
  if (appError.status >= 500) console.error('[events]', appError);
  return { ok: false, error: appError.message, code: appError.code };
}

const createSchema = z.object({
  queueId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  waveSize: z.number().int().min(1).max(200).default(10),
  passValidMinutes: z.number().int().min(1).max(120).default(10),
  graceMinutes: z.number().int().min(0).max(60).default(5),
  publicNote: z.string().trim().max(500).nullish(),
  /** Absent : la valeur par défaut de la base (accepté). */
  walletQrEnabled: z.boolean().optional(),
});

export async function createEventCampaign(
  input: z.input<typeof createSchema>,
): Promise<Result<{ eventId: string }>> {
  try {
    const parsed = createSchema.parse(input);
    const access = await assertQueueAccess(parsed.queueId, 'queue.configure');
    const db = supabaseAdmin();

    const { data, error } = await db.from('event_campaigns').insert({
      organization_id: access.organizationId,
      location_id: access.locationId,
      queue_id: parsed.queueId,
      name: parsed.name,
      wave_size: parsed.waveSize,
      pass_valid_minutes: parsed.passValidMinutes,
      grace_minutes: parsed.graceMinutes,
      public_note: parsed.publicNote ?? null,
      created_by: access.user.id,
      ...(parsed.walletQrEnabled === undefined ? {} : { wallet_qr_enabled: parsed.walletQrEnabled }),
    }).select('id').single();

    if (error || !data) throw error ?? new Error('Création impossible.');

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: 'event.created',
      targetType: 'event',
      targetId: data.id,
      metadata: {
        name: parsed.name,
        waveSize: parsed.waveSize,
        passValidMinutes: parsed.passValidMinutes,
        graceMinutes: parsed.graceMinutes,
        ...(parsed.walletQrEnabled === undefined ? {} : { walletQrEnabled: parsed.walletQrEnabled }),
      },
    });

    revalidatePath('/app', 'layout');
    return { ok: true, data: { eventId: data.id } };
  } catch (error) {
    return fail(error);
  }
}

const stateSchema = z.object({
  eventId: z.string().uuid(),
  action: z.enum(['start', 'pause', 'resume', 'sold_out', 'end']),
});

async function readEvent(eventId: string) {
  const { data, error } = await supabaseAdmin()
    .from('event_campaigns')
    .select('id, queue_id, organization_id, location_id, name, status, locations(slug)')
    .eq('id', eventId)
    .maybeSingle();
  if (error || !data) throw new AppError('not_found', 'Événement introuvable.', 404);
  return data;
}

export async function changeEventState(
  input: z.input<typeof stateSchema>,
): Promise<Result<{ status: string; notified: number }>> {
  try {
    const parsed = stateSchema.parse(input);
    const event = await readEvent(parsed.eventId);
    const access = await assertQueueAccess(event.queue_id, 'queue.operate');
    await enforceRateLimit(
      `event-state:${access.user.id}`,
      LIMITS.staffAction.max,
      LIMITS.staffAction.window,
    );

    const db = supabaseAdmin();

    if (parsed.action === 'start' || parsed.action === 'resume') {
      const { error } = await db.from('event_campaigns').update({
        status: 'live',
        started_at: parsed.action === 'start' ? new Date().toISOString() : undefined,
        ended_at: null,
      }).eq('id', event.id);
      if (error) throw error;

      await setQueueStatus({
        queueId: event.queue_id,
        status: 'open',
        actorUserId: access.user.id,
        reason: null,
      });

      await audit({
        organizationId: access.organizationId,
        actorUserId: access.user.id,
        action: parsed.action === 'start' ? 'event.started' : 'event.resumed',
        targetType: 'event',
        targetId: event.id,
      });

      revalidatePath('/app', 'layout');
      return { ok: true, data: { status: 'live', notified: 0 } };
    }

    if (parsed.action === 'pause') {
      const { error } = await db.from('event_campaigns')
        .update({ status: 'paused' })
        .eq('id', event.id)
        .in('status', ['live', 'paused']);
      if (error) throw error;

      await audit({
        organizationId: access.organizationId,
        actorUserId: access.user.id,
        action: 'event.paused',
        targetType: 'event',
        targetId: event.id,
      });

      revalidatePath('/app', 'layout');
      return { ok: true, data: { status: 'paused', notified: 0 } };
    }

    const reason = parsed.action === 'sold_out' ? 'sold_out' : 'ended';
    const { data, error } = await db.rpc('close_event_campaign', {
      p_event_id: event.id,
      p_actor_user_id: access.user.id,
      p_reason: reason,
    });
    if (error) throw error;

    const affected = (data ?? []) as { entry_id: string; entry_public_id: string }[];
    const locationRelation = Array.isArray(event.locations) ? event.locations[0] : event.locations;
    const locationSlug = locationRelation?.slug ?? '';
    let notified = 0;
    const kind = parsed.action === 'sold_out' ? 'event_sold_out' as const : 'event_ended' as const;

    for (const row of affected) {
      const summary = await dispatchEventEntryNotification(
        row.entry_id,
        kind,
        `${env.siteUrl}/e/${locationSlug}`,
      );
      notified += summary.sent;
    }

    await propagate(event.queue_id);

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: parsed.action === 'sold_out' ? 'event.sold_out' : 'event.ended',
      targetType: 'event',
      targetId: event.id,
      metadata: { affected: affected.length, notificationsSent: notified },
    });

    revalidatePath('/app', 'layout');
    return {
      ok: true,
      data: { status: parsed.action === 'sold_out' ? 'sold_out' : 'ended', notified },
    };
  } catch (error) {
    return fail(error);
  }
}

const waveSchema = z.object({
  eventId: z.string().uuid(),
  count: z.number().int().min(1).max(200).optional(),
});

export async function callEventWave(
  input: z.input<typeof waveSchema>,
): Promise<Result<{ issued: number; notificationsSent: number; failed: number }>> {
  try {
    const parsed = waveSchema.parse(input);
    const event = await readEvent(parsed.eventId);
    const access = await assertQueueAccess(event.queue_id, 'queue.operate');

    await enforceRateLimit(
      `event-wave:${access.user.id}`,
      LIMITS.staffAction.max,
      LIMITS.staffAction.window,
    );

    const { data, error } = await supabaseAdmin().rpc('issue_event_wave', {
      p_event_id: event.id,
      p_actor_user_id: access.user.id,
      p_count: parsed.count ?? null,
    });
    if (error) throw error;

    const issued = (data ?? []) as {
      entry_id: string;
      entry_public_id: string;
      pass_public_id: string;
      valid_until: string;
      grace_until: string;
    }[];

    let notificationsSent = 0;
    let failed = 0;

    for (const row of issued) {
      // Aucun bearer brut ne quitte le serveur : l'URL d'accès est
      // régénérable et signée HMAC jusqu'à la fin de la grâce.
      const passUrl = `${env.siteUrl}${eventAccessPath(row.pass_public_id, row.grace_until)}`;
      const summary = await dispatchEventEntryNotification(
        row.entry_id,
        'event_access',
        passUrl,
      );
      notificationsSent += summary.sent;
      failed += summary.failed;
    }

    await propagate(event.queue_id);

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: 'event.wave_called',
      targetType: 'event',
      targetId: event.id,
      metadata: { requested: parsed.count ?? null, issued: issued.length, notificationsSent, failed },
    });

    revalidatePath('/app', 'layout');
    return { ok: true, data: { issued: issued.length, notificationsSent, failed } };
  } catch (error) {
    return fail(error);
  }
}

/* --------------------------------------------------------------------
   Billet Wallet au contrôle : réglage par événement
   -------------------------------------------------------------------- */

const walletSettingsSchema = z.object({
  orgSlug: z.string().trim().min(1).max(80),
});

/**
 * Événements dont le réglage se montre : ceux qui peuvent encore faire
 * entrer quelqu'un. Un événement terminé ou en stock épuisé a déjà révoqué
 * ses accès (close_event_campaign) ; sa fiche ne montre plus la bande.
 */
const OPEN_EVENT_STATUSES = ['draft', 'live', 'paused'] as const;

/**
 * État du réglage « Accepter le billet Wallet au contrôle » pour la fiche
 * événement, et `available` : faux tant qu'aucun fournisseur Wallet n'est
 * prêt (identifiants non fournis, certificat expiré…) ou que l'organisation
 * a coupé le Wallet. Sans billet Wallet possible, la case n'aurait pas de
 * sens : la fiche ne la montre pas (masquage propre, § 11 du plan).
 *
 * Le serveur choisit lui-même les événements à lire (ceux de
 * l'organisation, encore ouverts) au lieu de recevoir une liste du
 * navigateur : aucune borne à dépasser quand l'historique s'allonge (une
 * boutique à un drop par semaine passait les 200 événements en quatre ans,
 * et la case disparaissait sans un mot), ni d'URL PostgREST démesurée.
 *
 * Lecture seule, réservée aux membres de l'organisation désignée, avec le
 * contrôle commun des actions serveur (assertOrgMembership). Un slug
 * inconnu répond comme une organisation dont on n'est pas membre.
 */
export async function readEventWalletSettings(
  input: z.input<typeof walletSettingsSchema>,
): Promise<Result<{ available: boolean; enabled: Record<string, boolean> }>> {
  try {
    const parsed = walletSettingsSchema.parse(input);
    // Session d'abord : un visiteur anonyme ne déclenche aucune lecture.
    const user = await getSessionUser();
    if (!user) throw new AppError('unauthorized', 'Connectez-vous pour continuer.', 401);

    const db = supabaseAdmin();
    const { data: organization } = await db
      .from('organizations')
      .select('id')
      .eq('slug', parsed.orgSlug)
      .maybeSingle();
    if (!organization) {
      throw new AppError('forbidden', "Vous n'avez pas accès à cet établissement.", 403);
    }
    await assertOrgMembership(organization.id);

    const [settings, events, statuses] = await Promise.all([
      db.from('organization_settings')
        .select('features')
        .eq('organization_id', organization.id)
        .maybeSingle(),
      db.from('event_campaigns')
        .select('id, wallet_qr_enabled')
        .eq('organization_id', organization.id)
        .in('status', [...OPEN_EVENT_STATUSES]),
      walletStatuses(),
    ]);
    if (events.error) throw events.error;

    // Même lecture que la base (features ->> 'wallet' <> 'false').
    const features = (settings.data?.features ?? {}) as Record<string, unknown>;
    const walletOn = features.wallet !== false && features.wallet !== 'false';
    const anyReady = Object.values(statuses).some((status) => status.ready);

    const enabled: Record<string, boolean> = {};
    for (const row of (events.data ?? []) as { id: string; wallet_qr_enabled: boolean | null }[]) {
      enabled[row.id] = row.wallet_qr_enabled !== false;
    }
    return { ok: true, data: { available: walletOn && anyReady, enabled } };
  } catch (error) {
    return fail(error);
  }
}

const walletQrSchema = z.object({
  eventId: z.string().uuid(),
  enabled: z.boolean(),
});

/**
 * Coupe ou rétablit le billet Wallet au contrôle d'un événement.
 *
 * Coupé : seul le QR tournant de /pass est accepté ; un code Wallet déjà
 * émis est refusé dès le scan suivant (la page de contrôle relit la
 * colonne à chaque passage). Le déclencheur Wallet de 0021 redessine les
 * passes concernés : leur QR disparaît. Même permission que la création.
 */
export async function setEventWalletQr(
  input: z.input<typeof walletQrSchema>,
): Promise<Result<{ enabled: boolean }>> {
  try {
    const parsed = walletQrSchema.parse(input);
    const event = await readEvent(parsed.eventId);
    const access = await assertQueueAccess(event.queue_id, 'queue.configure');
    await enforceRateLimit(
      `event-settings:${access.user.id}`,
      LIMITS.staffAction.max,
      LIMITS.staffAction.window,
    );

    if (event.status === 'sold_out' || event.status === 'ended') {
      throw new AppError('event_closed', 'Un événement terminé ne peut plus être reconfiguré.', 409);
    }

    // `.select('id')` : un événement effacé entre la lecture et l'écriture
    // ne met à jour aucune ligne. Sans ce contrôle, l'action répondrait
    // « enregistré » et le journal d'audit mentirait.
    const { data: updated, error } = await supabaseAdmin()
      .from('event_campaigns')
      .update({ wallet_qr_enabled: parsed.enabled })
      .eq('id', event.id)
      .eq('organization_id', access.organizationId)
      .select('id');
    if (error) throw error;
    if (!updated?.length) throw new AppError('not_found', 'Événement introuvable.', 404);

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: 'event.wallet_qr_changed',
      targetType: 'event',
      targetId: event.id,
      metadata: { enabled: parsed.enabled },
    });

    return { ok: true, data: { enabled: parsed.enabled } };
  } catch (error) {
    return fail(error);
  }
}

/* --------------------------------------------------------------------
   Contrôle à l'entrée
   -------------------------------------------------------------------- */

const passIdSchema = z.string().regex(/^[0-9A-Za-z]{12,32}$/);

/**
 * Une preuve par forme de QR (lib/event-pass.ts, parseScanProof) : les
 * bornes sont les mêmes que celles de la page de contrôle, si bien qu'une
 * preuve affichée comme « valide » passe toujours ce schéma.
 *
 * Objets stricts : une clé d'une autre forme (un `slot` à côté d'un `w`)
 * fait échouer la lecture au lieu d'être retirée en silence. La page de
 * contrôle renvoie exactement la preuve que parseScanProof a retenue ; une
 * clé en trop ne peut venir que d'un appel fabriqué à la main.
 */
const redeemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('slot'),
    passId: passIdSchema,
    slot: z.number().int().positive(),
    sig: z.string().regex(SCAN_SIG_RE),
  }),
  z.strictObject({
    kind: z.literal('wallet'),
    passId: passIdSchema,
    w: z.string().regex(SCAN_WALLET_CODE_RE),
  }),
  z.strictObject({
    kind: z.literal('totp'),
    passId: passIdSchema,
    t: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    otp: z.string().regex(SCAN_OTP_RE),
  }),
]);

export async function redeemEventPass(
  input: z.input<typeof redeemSchema>,
): Promise<Result<{ status: string; clientName?: string | null; redeemedAt?: string | null }>> {
  try {
    const parsed = redeemSchema.parse(input);
    const db = supabaseAdmin();
    const { data: pass } = await db
      .from('event_access_passes')
      .select('token_hash, queue_entry_id, event_campaigns(queue_id, wallet_qr_enabled)')
      .eq('public_id', parsed.passId)
      .maybeSingle();

    if (!pass) {
      throw new AppError('not_found', 'Laisser-passer introuvable.', 404);
    }

    const eventRelation = Array.isArray(pass.event_campaigns)
      ? pass.event_campaigns[0]
      : pass.event_campaigns;

    if (!eventRelation?.queue_id) {
      throw new AppError('not_found', 'Laisser-passer introuvable.', 404);
    }

    // L'appartenance d'abord, la preuve ensuite : un compte d'une autre
    // organisation ne peut pas se servir de cette action pour tester des
    // codes, et chaque essai compte dans la limite de débit.
    const access = await assertQueueAccess(eventRelation.queue_id, 'queue.operate');

    await enforceRateLimit(
      `event-redeem:${access.user.id}`,
      LIMITS.staffAction.max,
      LIMITS.staffAction.window,
    );

    const tokenHash = pass.token_hash as string;
    const proof: ScanProof = parsed.kind === 'slot'
      ? { kind: 'slot', slot: parsed.slot, sig: parsed.sig }
      : parsed.kind === 'wallet'
        ? { kind: 'wallet', w: parsed.w }
        : { kind: 'totp', t: parsed.t, otp: parsed.otp };
    const verdict = await checkScanProof(db, {
      tokenHash,
      queueEntryId: pass.queue_entry_id as string,
      // Relu ici, au moment du rachat : l'interrupteur coupé entre
      // l'affichage de la page et le geste de l'agent l'emporte.
      walletQrEnabled: eventRelation.wallet_qr_enabled !== false,
      proof,
    });
    if (!verdict.ok) {
      if (verdict.reason === 'wallet_disabled') {
        throw new AppError(
          'wallet_not_accepted',
          'Le billet Wallet n’est pas accepté pour cet événement. Demandez au client d’ouvrir son laisser-passer.',
          409,
        );
      }
      throw new AppError('invalid_pass', 'Ce QR a expiré. Demandez au client de rouvrir son laisser-passer.', 409);
    }

    const { data, error } = await db.rpc('redeem_event_pass', {
      p_token_hash: tokenHash,
      p_actor_user_id: access.user.id,
    });
    if (error) throw error;

    const result = data as {
      status: string;
      queueId?: string;
      clientName?: string | null;
      redeemedAt?: string | null;
      passPublicId?: string;
    };

    if (result.queueId) await propagate(result.queueId);

    await audit({
      organizationId: access.organizationId,
      actorUserId: access.user.id,
      action: 'event.pass_checked',
      targetType: 'event_pass',
      targetId: result.passPublicId ?? null,
      metadata: { result: result.status, via: verdict.source },
    });

    return {
      ok: true,
      data: {
        status: result.status,
        clientName: result.clientName ?? null,
        redeemedAt: result.redeemedAt ?? null,
      },
    };
  } catch (error) {
    return fail(error);
  }
}
