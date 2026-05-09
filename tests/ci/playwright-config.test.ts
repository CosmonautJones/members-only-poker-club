import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('playwright.config.ts CI compatibility', () => {
  it('reads baseURL from process.env.PLAYWRIGHT_BASE_URL with localhost fallback', () => {
    const configPath = resolve(__dirname, '..', '..', 'playwright.config.ts');
    const source = readFileSync(configPath, 'utf8');
    expect(source).toContain('process.env.PLAYWRIGHT_BASE_URL');
    expect(source).toContain('http://localhost:3000');
  });
});

describe('playwright.config.ts CI flag', () => {
  it('AC13: reuseExistingServer is gated by !process.env.CI', () => {
    const configPath = resolve(__dirname, '..', '..', 'playwright.config.ts');
    const source = readFileSync(configPath, 'utf8');
    expect(source).toContain('reuseExistingServer');
    expect(source).toMatch(/!process\.env\.CI/);
  });
});
