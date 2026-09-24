import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_PROFILE, PROFILES, QUEUE_PROFILES, allStages, getProfile } from '@/lib/profiles';
import type { QueueProfile } from '@/lib/profiles';
import type { QueueDefaults } from '@/lib/profiles/types';
import { defaultProfileOptions } from '@/lib/profiles/options';
import { MASK_CHAR } from '@/lib/profiles/registration';
import { toAppError } from '@/lib/errors';

/**
 * PARITÉ TS ↔ SQL — le registre TypeScript et le moteur (migration 0034)
 * décrivent les mêmes profils. Chaque table SQL est lue dans le fichier
 * de migration, par expression régulière : si l'un change sans l'autre,
 * ce test le voit avant la production.
 *
 * La migration 0034 est écrite par le lot « moteur », fusionné avant ce
 * registre : tant qu'elle manque dans une copie de travail, les cas qui
 * la lisent sont sautés (et non réputés verts).
 */

const MIGRATION = fileURLToPath(
  new URL('../../../supabase/migrations/20260101000034_profiles_engine.sql', import.meta.url),
);
const HAS_ENGINE = existsSync(MIGRATION);
const sql = HAS_ENGINE ? readFileSync(MIGRATION, 'utf8') : '';
/** Valeurs par défaut des colonnes de `queues` (0003) : ce que `queueDefaults` ne dit pas. */
const QUEUES_TABLE = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/20260101000003_queues.sql', import.meta.url)),
  'utf8',
);

/** Corps d'une fonction `internal.<name>`, de sa déclaration au `$$;` qui la ferme. */
function body(name: string): string {
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+internal\\.${name}\\s*\\(`, 'i'));
  if (start < 0) throw new Error(`internal.${name} introuvable dans 0034`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$', open + 2);
  return sql.slice(open + 2, close);
}

/** Profils cités par `p in (…)` ou `p not in (…)` : l'ensemble des profils pour lesquels la fonction vaut vrai. */
function profileSet(name: string): Set<QueueProfile> {
  const b = body(name);
  const m = /\bp\s+(not\s+)?in\s*\(([^)]*)\)/i.exec(b);
  if (!m) throw new Error(`internal.${name} : liste de profils introuvable`);
  const listed = new Set([...(m[2] ?? '').matchAll(/'(\w+)'/g)].map((x) => x[1] as QueueProfile));
  return m[1] ? new Set(QUEUE_PROFILES.filter((p) => !listed.has(p))) : listed;
}

const sorted = <T>(set: Iterable<T>) => [...set].map(String).sort();


/* ------------------------------------------------------------------ */
/* Mini-évaluateur SQL                                                  */
/* ------------------------------------------------------------------ */
/*
 * Les défauts de profil sont écrits en SQL comme des expressions (`case
 * when p_profile in (…) then … end`, `jsonb_build_object(…)`, `not
 * v_sensitive`…). Les comparer par expression régulière laisserait passer
 * un `case` modifié ; on les ÉVALUE donc, pour chaque profil et chaque
 * activité, avec la logique à trois valeurs de SQL (null compris).
 *
 * Grammaire volontairement réduite à ce qu'écrit 0034. Une construction
 * inconnue lève une erreur : le test échoue et demande à être étendu,
 * plutôt que de conclure à tort à la parité.
 */

const UNCHANGED = Symbol('valeur de la colonne conservée');
type SqlValue = string | number | boolean | null | SqlValue[] | { [k: string]: SqlValue } | typeof UNCHANGED;
type Env = Record<string, SqlValue>;

function tokenize(src: string): string[] {
  const code = src.replace(/--[^\n]*/g, ' ');
  const re = /\s*(?:('(?:[^']|'')*')|(\d+)|([A-Za-z_][\w.]*)|(:=|::|\|\||<>|[=(),\[\]]))/y;
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    if (/^\s*$/.test(code.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(code);
    if (!m) throw new Error(`SQL non reconnu près de « ${code.slice(i, i + 30)} »`);
    out.push(m[1] ?? m[2] ?? (m[3] ? m[3].toLowerCase() : undefined) ?? (m[4] as string));
    i = re.lastIndex;
  }
  return out;
}

class SqlExpr {
  private i = 0;
  constructor(
    private readonly t: string[],
    private readonly env: Env,
  ) {}

  static evaluate(src: string, env: Env): SqlValue {
    const p = new SqlExpr(tokenize(src), env);
    const v = p.expr();
    if (p.i !== p.t.length) throw new Error(`fin inattendue : « ${p.t.slice(p.i).join(' ')} »`);
    return v;
  }

  private peek(k = 0) {
    return this.t[this.i + k];
  }
  private take(expected?: string): string {
    const tok = this.t[this.i];
    if (tok === undefined || (expected !== undefined && tok !== expected)) {
      throw new Error(`attendu « ${expected ?? 'un jeton'} », lu « ${tok ?? 'fin'} »`);
    }
    this.i += 1;
    return tok;
  }

  expr(): SqlValue {
    let left = this.and();
    while (this.peek() === 'or') {
      this.take();
      const right = this.and();
      left = left === true || right === true ? true : left === null || right === null ? null : false;
    }
    return left;
  }
  private and(): SqlValue {
    let left = this.not();
    while (this.peek() === 'and') {
      this.take();
      const right = this.not();
      left = left === false || right === false ? false : left === null || right === null ? null : true;
    }
    return left;
  }
  private not(): SqlValue {
    if (this.peek() === 'not') {
      this.take();
      const v = this.not();
      return v === null ? null : !v;
    }
    return this.compare();
  }
  private compare(): SqlValue {
    const left = this.concat();
    const op = this.peek();
    if (op === '=' || op === '<>') {
      this.take();
      const right = this.concat();
      if (left === null || right === null) return null;
      return op === '=' ? left === right : left !== right;
    }
    const negated = op === 'not' && this.peek(1) === 'in';
    if (op === 'in' || negated) {
      if (negated) this.take();
      this.take('in');
      const list = this.list('(', ')');
      if (left === null) return null;
      const found = list.includes(left);
      return negated ? !found : found;
    }
    return left;
  }
  private concat(): SqlValue {
    let left = this.postfix();
    while (this.peek() === '||') {
      this.take();
      const right = this.postfix();
      if (!isObject(left) || !isObject(right)) throw new Error('|| attend deux objets jsonb');
      left = { ...left, ...right };
    }
    return left;
  }
  private postfix(): SqlValue {
    let v = this.primary();
    while (this.peek() === '::') {
      this.take();
      const type = this.take();
      if (this.peek() === '[') {
        this.take('[');
        this.take(']');
      }
      if (type === 'jsonb' && typeof v === 'string') v = JSON.parse(v) as SqlValue;
      // Casts vers un type énuméré (public.advance_mode…) : la valeur reste le libellé.
    }
    return v;
  }
  private list(open: string, close: string): SqlValue[] {
    this.take(open);
    const out: SqlValue[] = [];
    if (this.peek() === close) {
      this.take(close);
      return out;
    }
    for (;;) {
      out.push(this.expr());
      if (this.peek() === ',') this.take();
      else break;
    }
    this.take(close);
    return out;
  }
  private primary(): SqlValue {
    const tok = this.take();
    if (tok.startsWith("'")) return tok.slice(1, -1).replace(/''/g, "'");
    if (/^\d+$/.test(tok)) return Number(tok);
    if (tok === 'true' || tok === 'false') return tok === 'true';
    if (tok === 'null') return null;
    if (tok === '(') {
      const v = this.expr();
      this.take(')');
      return v;
    }
    if (tok === 'case') return this.caseExpr();
    if (tok === 'array') return this.list('[', ']');
    if (tok === 'jsonb_build_array') return this.list('(', ')');
    if (tok === 'jsonb_build_object') {
      const args = this.list('(', ')');
      const obj: Record<string, SqlValue> = {};
      for (let k = 0; k < args.length; k += 2) obj[String(args[k])] = args[k + 1] ?? null;
      return obj;
    }
    if (tok === 'coalesce') return this.list('(', ')').find((v) => v !== null) ?? null;
    // Colonne relue telle quelle (`q.mode`) : la file garde sa valeur.
    if (/^q\.\w+$/.test(tok)) return UNCHANGED;
    if (Object.prototype.hasOwnProperty.call(this.env, tok)) return this.env[tok] as SqlValue;
    throw new Error(`identifiant inconnu de l'évaluateur : ${tok}`);
  }
  private caseExpr(): SqlValue {
    // `case X when a then …` (simple) ou `case when cond then …` (recherché).
    const simple = this.peek() !== 'when';
    const subject = simple ? this.expr() : undefined;
    let result: SqlValue | undefined;
    while (this.peek() === 'when') {
      this.take();
      const cond = this.expr();
      this.take('then');
      const value = this.expr();
      const hit = simple ? cond === subject && subject !== null : cond === true;
      if (hit && result === undefined) result = value;
    }
    let otherwise: SqlValue = null;
    if (this.peek() === 'else') {
      this.take();
      otherwise = this.expr();
    }
    this.take('end');
    return result === undefined ? otherwise : result;
  }
}

function isObject(v: SqlValue): v is { [k: string]: SqlValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Découpe au niveau zéro des parenthèses. */
function splitTop(src: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of src) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && (ch === '(' || ch === '[')) depth += 1;
    if (!quoted && (ch === ')' || ch === ']')) depth -= 1;
    if (!quoted && depth === 0 && ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Exécute `internal.apply_profile_defaults` « à sec » : les affectations
 * `v_x := …` dans l'ordre, puis chaque `colonne = …` de l'`update`.
 */
function applyProfileDefaults(profile: QueueProfile, activity: string) {
  const stripped = body('apply_profile_defaults').replace(/--[^\n]*/g, ' ');
  const main = stripped.slice(stripped.search(/\bbegin\b/i) + 5);
  const env: Env = { p_profile: profile, v_activity: activity, p_activity: activity };
  const columns: Record<string, SqlValue> = {};
  for (const statement of splitTop(main, ';')) {
    const assign = /^\s*(v_\w+)\s*:=\s*([\s\S]+)$/i.exec(statement);
    if (assign) {
      env[(assign[1] as string).toLowerCase()] = SqlExpr.evaluate(assign[2] as string, env);
      continue;
    }
    const update = /^\s*update\s+public\.queues\s+q\s+set\s+([\s\S]+?)\s+where\b/i.exec(statement);
    if (update) {
      for (const clause of splitTop(update[1] as string, ',')) {
        const m = /^\s*(\w+)\s*=\s*([\s\S]+)$/.exec(clause);
        if (!m) throw new Error(`clause SET non reconnue : ${clause.trim()}`);
        columns[m[1] as string] = SqlExpr.evaluate(m[2] as string, env);
      }
    }
  }
  if (Object.keys(columns).length === 0) throw new Error('update public.queues introuvable dans apply_profile_defaults');
  return columns;
}

/** Littéraux `default …` de la table `queues` (0003). */
function queueColumnDefaults(): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const m of QUEUES_TABLE.matchAll(/^\s{2}(\w+)\s+[\w.]+(?:\s+not null)?\s+default\s+('[^']*'|\d+|true|false)/gm)) {
    out[m[1] as string] = SqlExpr.evaluate(m[2] as string, {});
  }
  return out;
}

const DEFAULT_COLUMN: Record<keyof QueueDefaults, string> = {
  mode: 'mode',
  advanceMode: 'advance_mode',
  askClientName: 'ask_client_name',
  clientNameRequired: 'client_name_required',
  entryTtlMinutes: 'entry_ttl_minutes',
  absentPolicy: 'absent_policy',
  absentGraceMinutes: 'absent_grace_minutes',
  allowServiceChoice: 'allow_service_choice',
};

const ACTIVITIES = Object.keys(ACTIVITY_PROFILE);

describe('parité avec le moteur SQL (0034)', () => {
  it.skipIf(!HAS_ENGINE)('internal.default_profile : même correspondance activité → profil', () => {
    const rows = [...body('default_profile').matchAll(/\(\s*'(\w+)'\s*,\s*'(\w+)'\s*\)/g)].map((m) => [m[1], m[2]]);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.fromEntries(rows)).toEqual({ ...ACTIVITY_PROFILE });
  });

  it.skipIf(!HAS_ENGINE)('internal.stage_status : chaque étape SQL a ses libellés TS, et inversement', () => {
    const rows = [...body('stage_status').matchAll(/\(\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*\)/g)].map((m) => ({
      profile: m[1] as QueueProfile,
      stage: m[2] as string,
      status: m[3] as string,
    }));
    expect(rows.length).toBeGreaterThan(0);

    // SQL → TS : l'étape existe, avec le même statut, et elle est rédigée.
    for (const row of rows) {
      const def = getProfile(row.profile).stages.find((s) => s.key === row.stage);
      expect(def, `${row.profile}.${row.stage} absent du registre`).toBeDefined();
      expect(def?.status).toBe(row.status);
      expect(def?.client.length).toBeGreaterThan(0);
      expect(def?.staff.length).toBeGreaterThan(0);
      expect(typeof def?.notifyDefault).toBe('boolean');
    }
    // TS → SQL : aucune étape déclarée en TS que le moteur ignorerait.
    for (const p of QUEUE_PROFILES) {
      for (const s of PROFILES[p].stages) {
        expect(
          rows.some((r) => r.profile === p && r.stage === s.key),
          `${p}.${s.key} absent de internal.stage_status`,
        ).toBe(true);
      }
    }
  });

  it.skipIf(!HAS_ENGINE)('position, parallélisme, avance automatique : mêmes profils', () => {
    const usesPosition = QUEUE_PROFILES.filter((p) => PROFILES[p].usesPosition);
    const parallel = QUEUE_PROFILES.filter((p) => PROFILES[p].parallel);
    const autoAdvance = QUEUE_PROFILES.filter((p) => PROFILES[p].autoAdvance);
    expect(sorted(profileSet('profile_uses_position'))).toEqual(sorted(usesPosition));
    expect(sorted(profileSet('profile_parallel'))).toEqual(sorted(parallel));
    expect(sorted(profileSet('profile_auto_advance'))).toEqual(sorted(autoAdvance));
  });

  it.skipIf(!HAS_ENGINE)('internal.initial_stage : « reçu » pour les mêmes profils', () => {
    const b = body('initial_stage');
    const m = /\bp\s+in\s*\(([^)]*)\)\s*then\s*'(\w+)'/i.exec(b);
    expect(m).not.toBeNull();
    const profiles = [...(m?.[1] ?? '').matchAll(/'(\w+)'/g)].map((x) => x[1]);
    for (const p of QUEUE_PROFILES) {
      expect(PROFILES[p].initialStage, p).toBe(profiles.includes(p) ? m?.[2] : null);
    }
  });

  it.skipIf(!HAS_ENGINE)('internal.apply_profile_defaults : mêmes options, profil par profil et activité par activité', () => {
    expect(ACTIVITIES).toEqual(expect.arrayContaining(['health', 'admin_service', 'other', 'barber']));
    for (const profile of QUEUE_PROFILES) {
      for (const activity of ACTIVITIES) {
        const sqlSide = applyProfileDefaults(profile, activity);
        expect(sqlSide.profile_options, `${profile}/${activity}`).toEqual(defaultProfileOptions(profile, activity));
      }
    }
  });

  it.skipIf(!HAS_ENGINE)('internal.apply_profile_defaults : mêmes réglages de file (queueDefaults + défauts des colonnes)', () => {
    const columnDefaults = queueColumnDefaults();
    expect(columnDefaults.ask_client_name).toBe(true);
    expect(columnDefaults.advance_mode).toBe('auto_serve');
    for (const profile of QUEUE_PROFILES) {
      // `queueDefaults` ne dit que les écarts aux défauts des colonnes.
      const ts: Record<string, SqlValue> = { ...columnDefaults };
      for (const [key, value] of Object.entries(PROFILES[profile].queueDefaults)) {
        ts[DEFAULT_COLUMN[key as keyof QueueDefaults]] = value as SqlValue;
      }
      for (const activity of ACTIVITIES) {
        const sqlSide = applyProfileDefaults(profile, activity);
        for (const [column, value] of Object.entries(sqlSide)) {
          if (column === 'profile' || column === 'profile_options') continue;
          const where = `${profile}/${activity} : ${column}`;
          expect(Object.prototype.hasOwnProperty.call(columnDefaults, column), `${where} (colonne inconnue)`).toBe(true);
          if (value === UNCHANGED) {
            // La colonne est laissée telle quelle : le registre ne doit rien y imposer.
            const key = (Object.keys(DEFAULT_COLUMN) as (keyof QueueDefaults)[]).find((k) => DEFAULT_COLUMN[k] === column);
            expect(key && PROFILES[profile].queueDefaults[key], where).toBeUndefined();
          } else {
            expect(value, where).toEqual(ts[column]);
          }
        }
      }
    }
  });

  it.skipIf(!HAS_ENGINE)('internal.default_services : mêmes prestations par défaut, dans le même ordre', () => {
    const b = body('default_services').replace(/^\s*select\s+/i, '').replace(/;\s*$/, '');
    for (const p of QUEUE_PROFILES) {
      expect(SqlExpr.evaluate(b, { p }), p).toEqual(PROFILES[p].defaultServices);
    }
  });

  it.skipIf(!HAS_ENGINE)('immatriculation : même normalisation et même masquage (vecteurs partagés)', () => {
    // Les vecteurs eux-mêmes sont rejoués côté SQL par le test du moteur ;
    // ici, on vérifie que le SQL applique la même RÈGLE que le registre :
    // filtre ASCII puis majuscules, sans repli des accents…
    const norm = body('normalize_registration');
    expect(norm).toMatch(/upper\s*\(\s*regexp_replace\s*\([^;]*'\[\^A-Za-z0-9\]'/i);
    expect(norm).not.toMatch(/unaccent|translate|normalize\s*\(/i);
    // … au plus 3 caractères lisibles, et toujours au moins un masqué.
    const mask = body('mask_registration');
    expect(mask).toMatch(/least\s*\(\s*3\s*,\s*length\s*\(\s*internal\.normalize_registration\s*\(\s*p_value\s*\)\s*\)\s*-\s*1\s*\)/i);
    expect(mask).toContain(`'${MASK_CHAR}'`);
  });

  it.skipIf(!HAS_ENGINE)('chaque erreur VT levée par le moteur est traduite, sans être prise pour une erreur de plaque', () => {
    const raised = [...sql.matchAll(/raise\s+exception\s+'((?:[^']|'')*)'[^;]*?errcode\s*=\s*'(VT\d{3})'/gi)].map(
      (m) => ({ message: (m[1] ?? '').replace(/''/g, "'"), code: m[2] as string }),
    );
    expect(raised.length).toBeGreaterThan(0);
    for (const { message, code } of raised) {
      const err = toAppError({ code, message });
      expect(err.code, `${code} « ${message} »`).not.toBe('internal');
      expect(err.code, `${code} « ${message} » traduit comme une plaque`).not.toMatch(/^plate_|invalid_quantity/);
    }
  });
});

describe('registre : cohérence interne (sans le moteur)', () => {
  it('toutes les étapes connues ont un statut actif', () => {
    const active = ['waiting', 'notified', 'returning', 'present', 'next', 'serving'];
    for (const p of QUEUE_PROFILES) {
      for (const s of PROFILES[p].stages) expect(active).toContain(s.status);
    }
    expect(allStages()).toEqual(
      expect.arrayContaining(['received', 'diagnosis', 'quote_pending', 'waiting_parts', 'in_repair', 'ready', 'preparing']),
    );
  });
});
