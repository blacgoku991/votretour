import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Le layout /admin ne suffit pas : une requête RSC forgée (en-têtes
 * `RSC` et `Next-Router-State-Tree`) fait croire à Next que le client a
 * déjà le segment « admin », et le layout n'est pas exécuté. Seule la
 * page demandée l'est. Chaque page /admin doit donc vérifier le rôle
 * elle-même, avant la moindre lecture avec la clé service_role.
 */

const ADMIN_DIR = fileURLToPath(new URL('../src/app/admin', import.meta.url));

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [path] : [];
  });
}

describe('pages /admin', () => {
  const files = pages(ADMIN_DIR);

  it('trouve les pages à contrôler', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [relative(ADMIN_DIR, file), file]))(
    '%s vérifie le rôle avant toute lecture',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      const body = source.slice(source.indexOf('export default'));
      const guard = body.indexOf('await requirePlatformAdmin()');
      expect(guard, 'await requirePlatformAdmin() absent').toBeGreaterThan(-1);

      const firstRead = [body.indexOf('supabaseAdmin('), body.indexOf('await params'), body.indexOf('await searchParams')]
        .filter((index) => index > -1);
      for (const read of firstRead) expect(guard).toBeLessThan(read);
    },
  );
});
