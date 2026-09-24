import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // tsconfig garde `jsx: preserve` pour Next.js ; les tests qui importent un
  // composant serveur (.tsx) ont besoin que Vite transforme le JSX lui-même.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` est un garde-fou de compilation Next.js : il fait
      // échouer la build si un module serveur est importé côté client.
      // Hors de Next, il n'existe pas — on le neutralise pour les tests.
      'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
