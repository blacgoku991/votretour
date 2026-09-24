import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_PROFILE, PROFILES, QUEUE_PROFILES, allStages, getProfile } from '@/lib/profiles';
import type { QueueProfile } from '@/lib/profiles';
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
