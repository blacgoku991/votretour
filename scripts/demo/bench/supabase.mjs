// =====================================================================
// Rangvia — client HTTP minimal du banc (PostgREST et administration
// GoTrue), avec la clé service_role DU BANC.
// ---------------------------------------------------------------------
// Pas de @supabase/supabase-js ici : le script ne dépend que de Node, et
// chaque appel est lisible tel qu'il part. Les adresses ont déjà passé la
// garde (`benchConfig`) : ce module ne parle qu'à 127.0.0.1.
// =====================================================================

export class BenchHttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function supabaseClient(config) {
  const headers = {
    apikey: config.serviceKey,
    authorization: `Bearer ${config.serviceKey}`,
  };

  async function call(path, { method = 'GET', body, prefer } = {}) {
    const response = await fetch(`${config.supabaseUrl}${path}`, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(prefer ? { prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new BenchHttpError(`${method} ${path.split('?')[0]} → ${response.status} ${text.slice(0, 300)}`, response.status);
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    /** Appel d'une fonction SQL exposée (`/rest/v1/rpc/<nom>`). */
    rpc: (fn, args) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args }),
    /** Lecture d'une table ; `query` est la chaîne PostgREST (`select=…&x=eq.…`). */
    select: (table, query) => call(`/rest/v1/${table}?${query}`),
    insert: (table, rows) => call(`/rest/v1/${table}`, { method: 'POST', body: rows, prefer: 'return=representation' }),
    update: (table, query, patch) =>
      call(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }),
    remove: (table, query) => call(`/rest/v1/${table}?${query}`, { method: 'DELETE', prefer: 'return=representation' }),
    /** Compte GoTrue (API d'administration), confirmé d'office. */
    createUser: (email, password, metadata) =>
      call('/auth/v1/admin/users', {
        method: 'POST',
        body: { email, password, email_confirm: true, user_metadata: metadata },
      }),
    deleteUser: (id) => call(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

/** Valeur d'un filtre PostgREST `in.(…)`, chaque élément entre guillemets. */
export function inList(values) {
  return `in.(${values.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',')})`;
}
