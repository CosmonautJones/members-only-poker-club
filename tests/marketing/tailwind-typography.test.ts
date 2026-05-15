/**
 * Site audit 2026-05-15, P1 item #4: install @tailwindcss/typography.
 *
 * /privacy applies `className="prose"` expecting the plugin's styles but
 * the plugin isn't installed, so headings render identical to body
 * paragraphs. Fix is to add `@tailwindcss/typography` to devDeps and
 * register it in tailwind.config.ts `plugins`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TAILWIND_CONFIG = path.join(REPO_ROOT, 'tailwind.config.ts');
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');

describe('@tailwindcss/typography plugin (audit P1 #4)', () => {
  it('is declared in package.json devDependencies', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    const deps = pkg.devDependencies ?? {};
    expect(deps).toHaveProperty('@tailwindcss/typography');
  });

  it('is registered in tailwind.config.ts plugins array', () => {
    const cfg = readFileSync(TAILWIND_CONFIG, 'utf8');
    expect(cfg).toMatch(/@tailwindcss\/typography/);
  });
});
