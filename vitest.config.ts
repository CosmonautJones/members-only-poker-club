import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
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
