/**
 * Playwright e2e configuration.
 *
 * Scaffolded as part of T0 of ADR-0030 (SEO & content strategy slice 1).
 * The smoke spec at `tests-e2e/smoke.spec.ts` proves the harness end-to-end
 * before any AC-driven e2e suite is written. Subsequent SEO tasks
 * (T1-T9) add `seo-metadata.spec.ts`, `seo-jsonld.spec.ts`, etc.
 *
 * `webServer` boots `corepack pnpm start` against the production build so
 * the run mirrors the surface that ships. CI runs do not reuse an existing
 * server; local runs do, to keep the inner loop fast.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests-e2e',
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'corepack pnpm start',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
