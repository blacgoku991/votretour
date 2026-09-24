import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * COMMUTATIVITÉ DES MIGRATIONS — chantier Wallet (0021-0030) et chantier
 * des profils métier (0031-0038).
 *
 * `deploy/scripts/migrate.sh` applique toute migration absente du
 * registre, dans l'ordre alphabétique. Si les profils partent en
 * production avant Wallet, la production applique 0031-0038 PUIS
 * 0021-0030 : l'ordre inverse d'une base neuve. Pour que les deux ordres
 * donnent la même base, aucune des deux plages ne touche à ce que l'autre
 * crée :
 *   1. aucun objet (fonction, table, type, vue, séquence, index,
 *      déclencheur, politique, contrainte nommée, colonne ajoutée, valeur
 *      d'enum) n'est créé, redéfini ou supprimé dans les deux plages ;
 *   2. aucun fichier d'une plage ne cite un objet créé seulement dans
 *      l'autre (appel, lecture, clé étrangère…).
 * La jonction (0039 et au-delà) est exemptée : elle ne fusionne qu'après
 * les deux chantiers, donc s'applique en dernier partout.
 *
 * Analyse lexicale, volontairement prudente : un faux positif fait
 * relire un humain, un faux négatif casserait la production. Le script
 * scripts/verify-db-order.sh complète ce test en rejouant réellement les
 * deux ordres et en comparant les schémas obtenus.
 */

const DIR = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

type Range = 'base' | 'wallet' | 'profiles' | 'junction';

interface Migration {
  file: string;
  range: Range;
  /** Texte sans commentaires, en minuscules (identifiants SQL). */
  sql: string;
}

/** Numéro de migration : 20260101000031_… donne 31 ; toute autre date vient après. */
function rangeOf(file: string): Range {
  const m = /^(\d{14})_/.exec(file);
  if (!m?.[1]) throw new Error(`Nom de migration inattendu : ${file}`);
  const stamp = m[1];
  if (stamp < '20260101000021') return 'base';
  if (stamp <= '20260101000030') return 'wallet';
  if (stamp <= '20260101000038') return 'profiles';
  return 'junction';
}

/**
 * Retire les commentaires (-- et /* *\/) sans toucher aux chaînes : une
 * valeur d'enum ('apple_wallet') est citée entre apostrophes, et « -- »
 * peut apparaître dans une chaîne. Les apostrophes doublées ('l''écran')
 * s'enchaînent naturellement comme deux chaînes adjacentes.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "'") {
      const end = source.indexOf("'", i + 1);
      const stop = end < 0 ? source.length : end + 1;
      out += source.slice(i, stop);
      i = stop;
    } else if (ch === '-' && next === '-') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      out += ' ';
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const QUALIFIED = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;

/** « public.x », « "x" », « x » → « public.x ». */
function qualify(name: string): string {
  const parts = name.replace(/\s+/g, '').split('.').map((p) => p.replace(/^"|"$/g, ''));
  return parts.length === 1 ? `public.${parts[0]}` : parts.join('.');
}

function bare(name: string): string {
  return qualify(name).split('.').pop() ?? name;
}

/** Objet touché par une migration. `table` : table porteuse (colonne, index…). */
interface Touched {
  key: string;
  /** Mot à chercher pour savoir si un autre fichier le cite. */
  word: string;
  table?: string;
  kind: 'create' | 'drop';
}

/** Découpe une instruction « alter table … ; » à partir d'un indice. */
function statementAt(sql: string, from: number): string {
  const end = sql.indexOf(';', from);
  return sql.slice(from, end < 0 ? sql.length : end);
}

function touchedObjects(sql: string): Touched[] {
  const out: Touched[] = [];
  const add = (t: Touched) => out.push(t);
  let m: RegExpExecArray | null;

  const simple: [RegExp, string][] = [
    [new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+${QUALIFIED}\s*\(`, 'g'), 'function'],
    [new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?procedure\s+${QUALIFIED}\s*\(`, 'g'), 'function'],
    [new RegExp(String.raw`\bcreate\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}`, 'g'), 'table'],
    [new RegExp(String.raw`\bcreate\s+type\s+${QUALIFIED}`, 'g'), 'type'],
    [new RegExp(String.raw`\bcreate\s+domain\s+${QUALIFIED}`, 'g'), 'type'],
    [new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}`, 'g'), 'view'],
    [new RegExp(String.raw`\bcreate\s+sequence\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}`, 'g'), 'sequence'],
    [new RegExp(String.raw`\bcreate\s+schema\s+(?:if\s+not\s+exists\s+)?(${IDENT})`, 'g'), 'schema'],
  ];
  for (const [re, kind] of simple) {
    while ((m = re.exec(sql))) {
      const name = kind === 'schema' ? (m[1] ?? '') : qualify(m[1] ?? '');
      add({ key: `${kind}:${name}`, word: bare(m[1] ?? ''), kind: 'create' });
    }
  }

  const drops = new RegExp(
    String.raw`\bdrop\s+(function|procedure|table|type|domain|view|materialized\s+view|sequence|index)\s+(?:if\s+exists\s+)?${QUALIFIED}`,
    'g',
  );
  while ((m = drops.exec(sql))) {
    const raw = (m[1] ?? '').replace(/\s+/g, ' ');
    const kind = raw === 'procedure' ? 'function'
      : raw === 'domain' ? 'type'
      : raw === 'materialized view' ? 'view'
      : raw;
    add({ key: `${kind}:${qualify(m[2] ?? '')}`, word: bare(m[2] ?? ''), kind: 'drop' });
  }

  const index = new RegExp(
    String.raw`\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?${QUALIFIED}\s+on\s+(?:only\s+)?${QUALIFIED}`,
    'g',
  );
  while ((m = index.exec(sql))) {
    add({ key: `index:${qualify(m[1] ?? '')}`, word: bare(m[1] ?? ''), table: qualify(m[2] ?? ''), kind: 'create' });
  }

  const onTable: [RegExp, string][] = [
    [new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(${IDENT})[\s\S]*?\bon\s+${QUALIFIED}`, 'g'), 'trigger'],
    [new RegExp(String.raw`\bcreate\s+policy\s+(${IDENT})\s+on\s+${QUALIFIED}`, 'g'), 'policy'],
    [new RegExp(String.raw`\bdrop\s+trigger\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+${QUALIFIED}`, 'g'), 'trigger'],
    [new RegExp(String.raw`\bdrop\s+policy\s+(?:if\s+exists\s+)?(${IDENT})\s+on\s+${QUALIFIED}`, 'g'), 'policy'],
  ];
  for (const [re, kind] of onTable) {
    while ((m = re.exec(sql))) {
      const table = qualify(m[2] ?? '');
      const name = (m[1] ?? '').replace(/"/g, '');
      add({ key: `${kind}:${table}.${name}`, word: name, table, kind: /^drop/.test(m[0]) ? 'drop' : 'create' });
    }
  }

  // alter table … add column / add constraint / drop column / drop constraint
  const alter = new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QUALIFIED}`, 'g');
  while ((m = alter.exec(sql))) {
    const table = qualify(m[1] ?? '');
    const stmt = statementAt(sql, m.index);
    const clauses = new RegExp(
      String.raw`\b(add|drop)\s+(column|constraint)\s+(?:if\s+(?:not\s+)?exists\s+)?(${IDENT})`,
      'g',
    );
    let c: RegExpExecArray | null;
    while ((c = clauses.exec(stmt))) {
      const name = (c[3] ?? '').replace(/"/g, '');
      add({ key: `${c[2]}:${table}.${name}`, word: name, table, kind: c[1] === 'add' ? 'create' : 'drop' });
    }
    // « alter table t add <nom> <type> » : le mot column est facultatif.
    const implicit = new RegExp(String.raw`\badd\s+(?!column\b|constraint\b|primary\b|unique\b|check\b|foreign\b|exclude\b)(${IDENT})\s+[a-z]`, 'g');
    while ((c = implicit.exec(stmt))) {
      const name = (c[1] ?? '').replace(/"/g, '');
      add({ key: `column:${table}.${name}`, word: name, table, kind: 'create' });
    }
  }

  // Valeurs d'enum : l'ordre des valeurs dépend de l'ordre des migrations.
  const enumValue = new RegExp(String.raw`\balter\s+type\s+${QUALIFIED}\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'`, 'g');
  while ((m = enumValue.exec(sql))) {
    add({ key: `enum:${qualify(m[1] ?? '')}.${m[2]}`, word: m[2] ?? '', kind: 'create' });
  }

  return out;
}

function load(): Migration[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      range: rangeOf(file),
      sql: stripComments(readFileSync(`${DIR}${file}`, 'utf8')).toLowerCase(),
    }));
}

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Le fichier cite-t-il ce mot comme identifiant entier ? */
function cites(sql: string, word: string): boolean {
  return new RegExp(String.raw`(?<![a-z0-9_$])${escape(word)}(?![a-z0-9_$])`).test(sql);
}

interface Owner {
  key: string;
  word: string;
  table?: string;
  files: Map<Range, Set<string>>;
}

function inventory(migrations: Migration[]): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  for (const mig of migrations) {
    for (const t of touchedObjects(mig.sql)) {
      const owner = owners.get(t.key) ?? { key: t.key, word: t.word, table: t.table, files: new Map() };
      const set = owner.files.get(mig.range) ?? new Set<string>();
      set.add(mig.file);
      owner.files.set(mig.range, set);
      owners.set(t.key, owner);
    }
  }
  return owners;
}

/**
 * Objets créés dans la plage `from` et dans aucune autre plage antérieure
 * ou concurrente (base, l'autre chantier) : ceux que l'autre chantier n'a
 * pas le droit de citer.
 */
function ownedOnlyBy(owners: Map<string, Owner>, from: Range, other: Range): Owner[] {
  return [...owners.values()].filter((o) =>
    o.files.has(from) && !o.files.has('base') && !o.files.has(other));
}

function citations(migrations: Migration[], owned: Owner[], range: Range): string[] {
  const found: string[] = [];
  for (const mig of migrations.filter((m) => m.range === range)) {
    for (const o of owned) {
      if (!cites(mig.sql, o.word)) continue;
      // Colonne, index, déclencheur : le nom seul est souvent banal ; on
      // exige aussi la table porteuse dans le même fichier.
      if (o.table && !cites(mig.sql, bare(o.table))) continue;
      found.push(`${mig.file} cite ${o.key}`);
    }
  }
  return found;
}

describe('migrations : Wallet (0021-0030) et profils (0031-0038) commutent', () => {
  const migrations = load();
  const owners = inventory(migrations);

  it('le découpage des plages est celui du plan', () => {
    expect(rangeOf('20260101000020_event_pass_wave.sql')).toBe('base');
    expect(rangeOf('20260101000021_wallet.sql')).toBe('wallet');
    expect(rangeOf('20260101000030_x.sql')).toBe('wallet');
    expect(rangeOf('20260101000031_display_snapshot.sql')).toBe('profiles');
    expect(rangeOf('20260101000038_x.sql')).toBe('profiles');
    expect(rangeOf('20260101000039_wallet_profiles_bridge.sql')).toBe('junction');
    expect(rangeOf('20270301000001_plus_tard.sql')).toBe('junction');
    // Les deux chantiers existent bel et bien : sinon ce test ne prouverait rien.
    expect(migrations.some((m) => m.range === 'wallet')).toBe(true);
    expect(migrations.some((m) => m.range === 'profiles')).toBe(true);
  });

  it('l’analyseur voit ce que chaque plage crée', () => {
    const keys = new Set(owners.keys());
    for (const key of [
      'function:public.display_snapshot',
      'function:public.profile_stats',
      'type:public.queue_profile',
      'table:public.message_templates',
      'column:public.queue_entries.registration_key',
      'index:public.queue_entries_claim_token_idx',
      'enum:public.notification_kind.quote_ready',
      'table:public.wallet_passes',
      'column:public.event_campaigns.wallet_qr_enabled',
      'enum:public.notification_channel.apple_wallet',
      'trigger:public.queue_entries.queue_entries_wallet_touch',
    ]) {
      expect(keys, key).toContain(key);
    }
  });

  it('aucun objet n’est créé, redéfini ou supprimé dans les deux plages', () => {
    const both = [...owners.values()]
      .filter((o) => o.files.has('wallet') && o.files.has('profiles'))
      .map((o) => `${o.key} : ${[...(o.files.get('wallet') ?? [])].join(', ')} et ${[...(o.files.get('profiles') ?? [])].join(', ')}`);
    expect(both, 'à déplacer dans une migration de jonction (0039 et au-delà)').toEqual([]);
  });

  it('aucune table ne reçoit de colonnes, ni aucune énumération de valeurs, dans les deux plages', () => {
    // Deux objets distincts, mais leur ORDRE dépend de l'ordre des
    // migrations : colonnes (select *, insert sans liste) et valeurs
    // d'énumération (comparaisons < et >) divergeraient en production.
    const parent = (key: string) => key.replace(/^(column|enum):/, '').replace(/\.[^.]+$/, '');
    const extendedBy = (range: Range) => new Set(
      [...owners.values()]
        .filter((o) => /^(column|enum):/.test(o.key) && o.files.has(range))
        .map((o) => `${o.key.split(':')[0]}:${parent(o.key)}`),
    );
    const wallet = extendedBy('wallet');
    expect([...extendedBy('profiles')].filter((k) => wallet.has(k))).toEqual([]);
  });

  it('0031-0038 ne cite aucun objet créé seulement par 0021-0030', () => {
    expect(citations(migrations, ownedOnlyBy(owners, 'wallet', 'profiles'), 'profiles')).toEqual([]);
  });

  it('0021-0030 ne cite aucun objet créé seulement par 0031-0038', () => {
    expect(citations(migrations, ownedOnlyBy(owners, 'profiles', 'wallet'), 'wallet')).toEqual([]);
  });

  it('les deux règles attrapent bien une infraction (témoin)', () => {
    const fake: Migration[] = [
      { file: '20260101000021_w.sql', range: 'wallet', sql: stripComments(
        "create table public.wallet_passes (id uuid);\ncreate or replace function public.purge_expired_data() returns void as $$ select 1 $$ language sql;",
      ).toLowerCase() },
      { file: '20260101000037_p.sql', range: 'profiles', sql: stripComments(
        "-- wallet_passes dans un commentaire ne compte pas\ncreate or replace function public.purge_expired_data() returns void as $$ delete from public.wallet_passes $$ language sql;",
      ).toLowerCase() },
    ];
    const inv = inventory(fake);
    expect([...inv.values()].filter((o) => o.files.has('wallet') && o.files.has('profiles')).map((o) => o.key))
      .toEqual(['function:public.purge_expired_data']);
    expect(citations(fake, ownedOnlyBy(inv, 'wallet', 'profiles'), 'profiles'))
      .toEqual(['20260101000037_p.sql cite table:public.wallet_passes']);
    expect(stripComments("select '-- pas un commentaire' -- commentaire\n")).toBe("select '-- pas un commentaire' \n");
  });
});
