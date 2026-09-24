import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_LABEL, auditActionLabel } from '@/app/admin/labels';

/**
 * LIBELLÉS DU JOURNAL D'AUDIT — chaque action écrite a sa phrase.
 *
 * La salle de contrôle et le journal affichent `auditActionLabel(action)`.
 * Une action sans entrée dans AUDIT_ACTION_LABEL retombe sur une
 * traduction mot à mot qui, pour tout verbe hors du petit dictionnaire,
 * laisse passer de l'anglais (« Billing setup fee paid »). Ce test relit
 * le code qui ÉCRIT dans `audit_logs` — les appels `audit({ … })` de
 * src/ et les `insert into public.audit_logs` des migrations — et exige
 * un libellé rédigé pour chaque action trouvée.
 *
 * Analyse lexicale volontairement stricte : une action calculée (gabarit,
 * variable) fait échouer le test tant que ses valeurs possibles ne sont
 * pas déclarées dans EXPANSIONS ci-dessous. Mieux vaut une ligne à écrire
 * qu'un libellé anglais en production.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));

/**
 * Actions calculées : l'expression telle qu'écrite → toutes ses valeurs.
 * `queue.${parsed.status}` suit le z.enum(['open', 'paused', 'closed']) de
 * changeQueueStatus (src/server/actions/queue.ts).
 */
const EXPANSIONS: Record<string, string[]> = {
  '`queue.${parsed.status}`': ['queue.open', 'queue.paused', 'queue.closed'],
};

const ACTION_CODE = /^[a-z_]+\.[a-z0-9_]+$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Texte de l'objet passé à `audit({ … })`, accolades équilibrées. */
function auditCallBodies(source: string): string[] {
  const bodies: string[] = [];
  const opener = /\baudit\(\{/g;
  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    // Un appel cité dans un commentaire (JSDoc, `//`) n'écrit rien.
    const line = source.slice(source.lastIndexOf('\n', match.index) + 1, match.index).trim();
    if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue;
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          bodies.push(source.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return bodies;
}

interface Found {
  action: string;
  where: string;
}

function actionsFromSource(): { found: Found[]; unresolved: string[] } {
  const found: Found[] = [];
  const unresolved: string[] = [];
  for (const file of walk(SRC)) {
    const where = relative(SRC, file);
    for (const body of auditCallBodies(readFileSync(file, 'utf8'))) {
      const expr = /\baction:\s*([^\n]+?),?\s*$/m.exec(body)?.[1]?.trim();
      if (!expr) {
        unresolved.push(`${where} : audit() sans propriété action lisible`);
        continue;
      }
      const expanded = EXPANSIONS[expr];
      if (expanded) {
        for (const action of expanded) found.push({ action, where });
        continue;
      }
      const literals = [...expr.matchAll(/'([^']+)'/g)]
        .map((m) => m[1] ?? '')
        .filter((value) => ACTION_CODE.test(value));
      // Une ternaire entre deux littéraux est lisible ; tout le reste
      // (gabarit, variable) doit passer par EXPANSIONS.
      if (literals.length === 0 || expr.includes('`')) {
        unresolved.push(`${where} : action calculée « ${expr} »`);
        continue;
      }
      for (const action of literals) found.push({ action, where });
    }
  }
  return { found, unresolved };
}

function actionsFromMigrations(): Found[] {
  const found: Found[] = [];
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
    const insert = /insert\s+into\s+(?:public\.)?audit_logs\b[^;]*;/gi;
    for (const statement of sql.match(insert) ?? []) {
      for (const m of statement.matchAll(/'([^']+)'/g)) {
        const value = m[1] ?? '';
        if (ACTION_CODE.test(value)) found.push({ action: value, where: name });
      }
    }
  }
  return found;
}

describe('journal d’audit : libellés', () => {
  const { found: fromSource, unresolved } = actionsFromSource();
  const fromMigrations = actionsFromMigrations();

  it('trouve bien les écritures (garde-fou de l’analyse)', () => {
    // Si l'analyse cassait (renommage d'audit(), chemin), le test suivant
    // passerait à vide : on exige un volume plausible des deux côtés.
    expect(fromSource.length).toBeGreaterThan(40);
    expect(fromMigrations.length).toBeGreaterThanOrEqual(3);
    expect(fromSource.map((f) => f.action)).toContain('billing.setup_fee_paid');
    expect(fromMigrations.map((f) => f.action)).toContain('plans.single_offer');
  });

  it('aucune action calculée non déclarée', () => {
    expect(unresolved).toEqual([]);
  });

  it('chaque action écrite a un libellé rédigé', () => {
    const missing = [...fromSource, ...fromMigrations]
      .filter(({ action }) => !(action in AUDIT_ACTION_LABEL))
      .map(({ action, where }) => `${action} (${where})`);
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it('les libellés sont en français typographique', () => {
    for (const [action, label] of Object.entries(AUDIT_ACTION_LABEL)) {
      expect(label, action).not.toMatch(/'/);
      expect(label, action).toMatch(/^[A-ZÀÉÈÊ]/);
      expect(auditActionLabel(action)).toBe(label);
    }
  });
});
