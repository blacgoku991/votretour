import 'server-only';

/**
 * Accès à la base pour Apple Wallet : uniquement les fonctions SQL de la
 * migration 0021 (security definer, service_role seul). Jamais de lecture
 * directe des tables : la base garde la main sur l'isolation entre
 * organisations et sur la limite de 5 appareils par pass.
 *
 * Interface injectable : les tests du service web et du traitement
 * tournent sans base ni réseau.
 */

export type RegisterResult = 'created' | 'exists' | 'limit' | 'gone';

export interface PassVersion {
  versionSeq: number;
  versionAt: string;
}

export interface PassLookup extends PassVersion {
  id: string;
  state: 'active' | 'final' | 'revoked' | 'scrubbed';
  contentHash: string | null;
}

export interface AppleStore {
  recordRender(passId: string, hash: string): Promise<PassVersion>;
  pushTargets(passId: string): Promise<string[]>;
  dropTokens(tokens: string[]): Promise<number>;
  register(serial: string, device: string, pushToken: string): Promise<RegisterResult>;
  unregister(serial: string, device: string): Promise<boolean>;
  serials(device: string, passTypeId: string, since: number | null): Promise<{ serial: string; versionSeq: number }[]>;
  lookup(serial: string): Promise<PassLookup | null>;
}

async function rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const { data, error } = await supabaseAdmin().rpc(fn, params);
  if (error) throw new Error(`${fn} : ${error.message}`);
  return data as T;
}

interface VersionRow { version_seq: number | string; version_at: string }

function toVersion(row: VersionRow | undefined): PassVersion {
  if (!row) throw new Error('Pass introuvable');
  return { versionSeq: Number(row.version_seq), versionAt: row.version_at };
}

export function supabaseAppleStore(): AppleStore {
  return {
    async recordRender(passId, hash) {
      const rows = await rpc<VersionRow[] | null>('wallet_record_render', { p_pass_id: passId, p_hash: hash });
      return toVersion(rows?.[0]);
    },
    async pushTargets(passId) {
      return (await rpc<string[] | null>('wallet_apple_push_targets', { p_pass_id: passId })) ?? [];
    },
    async dropTokens(tokens) {
      if (tokens.length === 0) return 0;
      return Number((await rpc<number | null>('wallet_apple_drop_tokens', { p_tokens: tokens })) ?? 0);
    },
    async register(serial, device, pushToken) {
      const result = await rpc<string>('wallet_apple_register', { p_serial: serial, p_device: device, p_push_token: pushToken });
      if (result === 'created' || result === 'exists' || result === 'limit' || result === 'gone') return result;
      throw new Error(`wallet_apple_register : réponse inattendue ${String(result)}`);
    },
    async unregister(serial, device) {
      return Boolean(await rpc<boolean>('wallet_apple_unregister', { p_serial: serial, p_device: device }));
    },
    async serials(device, passTypeId, since) {
      const rows = await rpc<{ serial: string; version_seq: number | string }[] | null>('wallet_apple_serials', {
        p_device: device,
        p_pass_type: passTypeId,
        p_since: since,
      });
      return (rows ?? []).map((row) => ({ serial: row.serial, versionSeq: Number(row.version_seq) }));
    },
    async lookup(serial) {
      const rows = await rpc<(VersionRow & { id: string; state: PassLookup['state']; content_hash: string | null })[] | null>(
        'wallet_apple_lookup',
        { p_serial: serial },
      );
      const row = rows?.[0];
      return row ? { id: row.id, state: row.state, contentHash: row.content_hash, ...toVersion(row) } : null;
    },
  };
}
