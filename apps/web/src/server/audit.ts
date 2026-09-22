import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requestFingerprint } from './client-session';

/**
 * Journal d'audit : qui a fait quoi, sur quoi, quand.
 * On y consigne les actions sensibles (équipe, réglages, facturation,
 * super-admin), pas le flux de file qui est déjà tracé dans queue_events.
 */
export async function audit(params: {
  organizationId?: string | null;
  actor?: 'staff' | 'client' | 'system' | 'platform_admin';
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const fingerprint = await requestFingerprint().catch(() => ({ ipHash: null, uaHash: null, ip: null }));
    await supabaseAdmin().from('audit_logs').insert({
      organization_id: params.organizationId ?? null,
      actor: params.actor ?? 'staff',
      actor_user_id: params.actorUserId ?? null,
      actor_label: params.actorLabel ?? null,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      ip_hash: fingerprint.ipHash,
      metadata: params.metadata ?? {},
    });
  } catch (error) {
    // Un échec d'audit ne doit jamais casser l'action utilisateur.
    console.error('[audit] écriture impossible', error);
  }
}

/** Remontée d'incident visible dans l'espace super-admin. */
export async function reportError(params: {
  source: string;
  message: string;
  stack?: string | null;
  level?: 'warn' | 'error' | 'fatal';
  organizationId?: string | null;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const fingerprint = `${params.source}:${params.message}`.slice(0, 200);
    const db = supabaseAdmin();
    const { data: existing } = await db
      .from('system_errors')
      .select('id, occurrences')
      .eq('fingerprint', fingerprint)
      .is('resolved_at', null)
      .maybeSingle();

    if (existing) {
      await db
        .from('system_errors')
        .update({ occurrences: existing.occurrences + 1, last_seen_at: new Date().toISOString() })
        .eq('id', existing.id);
      return;
    }

    await db.from('system_errors').insert({
      level: params.level ?? 'error',
      source: params.source,
      message: params.message.slice(0, 2000),
      stack: params.stack?.slice(0, 8000) ?? null,
      organization_id: params.organizationId ?? null,
      fingerprint,
      context: params.context ?? {},
    });
  } catch (error) {
    console.error('[system_errors] écriture impossible', error);
  }
}
