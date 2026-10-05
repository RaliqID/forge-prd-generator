import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `@/*` path alias so tests import exactly like the app.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Colocated tests; no globals, so each file imports what it uses.
    globals: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      // Only logic that is unit-testable and worth watching. Route handlers,
      // React components and the Prisma client are excluded — they need an
      // integration harness, and including them here would only dilute the
      // signal.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/db/**', 'src/lib/supabase/**'],
    },
  },
});
