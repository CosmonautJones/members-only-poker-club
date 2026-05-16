import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // pglite-applies-cleanly tier tests boot a fresh in-memory Postgres and
    // sequentially apply 12–16 migrations; aggregate parallelism with the
    // rest of the suite pushes some past vitest's 5s default. 30s is a
    // pragmatic ceiling that keeps real hangs detectable. See ADR-0036
    // Slice 1 conductor cycle for context.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      '{lib,components,app}/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next', '_design', 'tests/e2e', 'tests-e2e'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts', 'lib/**/*.spec.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
